from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from iaa import compute_fleiss_kappa, compute_krippendorff_alpha_q1, compute_icc
from database import init_db, get_db
import os
import json
import csv
import io
import sqlite3
from collections import defaultdict, Counter

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(BASE_DIR, "annotator_eval")

samples = []


def get_db_conn():
    conn = get_db()
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def get_all_samples():
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        rows = cursor.execute("""
            SELECT sample_id, article_id, category, previous, target, next, predicted
            FROM samples ORDER BY rowid
        """).fetchall()
        return [
            {
                "sample_id": r[0], "article_id": r[1], "category": r[2],
                "previous": r[3], "target": r[4], "next": r[5], "predicted": r[6],
            }
            for r in rows
        ]
    except Exception as e:
        print(f"샘플 로드 오류: {e}")
        return []
    finally:
        conn.close()


def _migrate_db():
    """Add `round` column to annotations if it doesn't exist yet."""
    conn = get_db_conn()
    try:
        conn.execute("ALTER TABLE annotations ADD COLUMN round INTEGER DEFAULT 1")
        conn.commit()
        print("DB 마이그레이션: annotations.round 컬럼 추가 완료")
    except Exception:
        pass  # 이미 존재
    finally:
        conn.close()


@app.on_event("startup")
def startup():
    global samples
    try:
        init_db()
        _migrate_db()
        samples = get_all_samples()
        print(f"샘플 개수: {len(samples)}")
    except Exception as e:
        print(f"startup 오류: {e}")


def get_filtered(category):
    if category and category != "ALL":
        return [s for s in samples if s["category"] == category]
    return samples


def load_annotation_from_db(sample_id: str, annotator: str, round_num: int = 1):
    if not annotator:
        return {"q1": None, "final_label": None}
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        row = cursor.execute("""
            SELECT q1, final_label FROM annotations
            WHERE sample_id=? AND annotator=? AND round=?
        """, (sample_id, annotator, round_num)).fetchone()
        if row:
            return {"q1": row[0], "final_label": row[1]}
        return {"q1": None, "final_label": None}
    except Exception as e:
        print(f"annotation 조회 오류: {e}")
        return {"q1": None, "final_label": None}
    finally:
        conn.close()


# ─────────────────────────────────────────────
#  Sample classification helpers
# ─────────────────────────────────────────────

def _get_all_annotations_raw(conn):
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1, round
        FROM annotations
    """).fetchall()
    return [
        {
            "sample_id": r[0], "annotator": r[1], "final_label": r[2],
            "q1": r[3], "round": r[4] if r[4] is not None else 1,
        }
        for r in rows
    ]


def _classify_samples(all_annotations):
    """
    각 샘플의 파이프라인 상태 분류:
      in_progress           : round-1 어노테이터 < 3
      confirmed             : 모든 round-1 q1 >= 4  (3.1)
      needs_relabeling      : round-1 에서 q1 <= 3 존재, round-2 미시작 (3.2)
      relabeling_in_progress: round-2 시작 but < 3 annotators
      confirmed_relabeled   : round-2 >= 3명 동일 라벨 (3.3)
      disagreement          : round-2 >= 3명 but 과반 없음 (3.4)
    """
    by_sample_r1 = defaultdict(list)
    by_sample_r2 = defaultdict(list)

    for ann in all_annotations:
        sid = ann["sample_id"]
        if ann["round"] == 2:
            by_sample_r2[sid].append(ann)
        else:
            by_sample_r1[sid].append(ann)

    all_ids = set(by_sample_r1.keys()) | set(by_sample_r2.keys())
    results = {}

    for sid in all_ids:
        r1 = by_sample_r1.get(sid, [])
        r2 = by_sample_r2.get(sid, [])

        if len(r1) < 3:
            results[sid] = {"status": "in_progress", "confirmed_label": None}
            continue

        q1_scores = [a["q1"] for a in r1 if a["q1"] is not None]
        if not q1_scores:
            results[sid] = {"status": "in_progress", "confirmed_label": None}
            continue

        all_high = all(q >= 4 for q in q1_scores)
        any_low = any(q <= 3 for q in q1_scores)

        if all_high:
            # 3.1: Round 1에서 확정
            labels = [a["final_label"] for a in r1 if a["final_label"] in ("F", "C", "M")]
            top = Counter(labels).most_common(1)
            confirmed_label = top[0][0] if top else None
            results[sid] = {"status": "confirmed", "confirmed_label": confirmed_label}

        elif any_low:
            # 3.2 → 3.3 / 3.4
            r2_anns = [a for a in r2 if a["final_label"] in ("F", "C", "M")]
            r2_count = len(set(a["annotator"] for a in r2_anns))

            if r2_count == 0:
                results[sid] = {"status": "needs_relabeling", "confirmed_label": None}
            elif r2_count < 5:
                results[sid] = {"status": "relabeling_in_progress", "confirmed_label": None}
            else:
                # 5명 전원 제출 완료 → 3명 이상 동일 라벨이면 확정
                r2_labels = [a["final_label"] for a in r2_anns]
                top = Counter(r2_labels).most_common(1)
                if top and top[0][1] >= 3:
                    results[sid] = {"status": "confirmed_relabeled", "confirmed_label": top[0][0]}
                else:
                    results[sid] = {"status": "disagreement", "confirmed_label": None}
        else:
            results[sid] = {"status": "in_progress", "confirmed_label": None}

    return results


def _build_iaa_data(conn):
    """Round-1 어노테이션에서 IAA 계산용 데이터 구축"""
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1 FROM annotations
        WHERE (round IS NULL OR round = 1)
    """).fetchall()
    sample_dict = defaultdict(list)
    for sample_id, annotator, label, q1 in rows:
        if label not in ("F", "C", "M"):
            continue
        sample_dict[sample_id].append((annotator, label, q1))
    # 3명 이상 어노테이션된 샘플만
    return {
        sid: items for sid, items in sample_dict.items()
        if len(set(a for a, _, _ in items)) >= 3
    }


def _compute_all_iaa(conn):
    filtered_dict = _build_iaa_data(conn)
    if not filtered_dict:
        return {"fleiss_kappa": 0, "alpha_q1": 0, "icc": 0}
    fleiss_input = [
        {"sample_id": sid, "label": label}
        for sid, items in filtered_dict.items()
        for _, label, _ in items
    ]
    return {
        "fleiss_kappa": compute_fleiss_kappa(fleiss_input),
        "alpha_q1": compute_krippendorff_alpha_q1(filtered_dict),
        "icc": compute_icc(filtered_dict, min_raters=3),
    }


# ─────────────────────────────────────────────
#  기존 엔드포인트 (최소 변경)
# ─────────────────────────────────────────────

@app.get("/sample")
def get_sample(index: int = 0, category: str = "ALL"):
    filtered = get_filtered(category)
    if not filtered:
        return {"error": "no samples"}
    idx = max(0, min(index, len(filtered) - 1))
    sample = filtered[idx]
    return {**sample, "current_index": idx + 1, "total": len(filtered)}


@app.get("/next")
def next_sample(index: int = 0, category: str = "ALL"):
    filtered = get_filtered(category)
    if not filtered:
        return {"error": "no samples"}
    idx = min(index + 1, len(filtered) - 1)
    sample = filtered[idx]
    return {**sample, "current_index": idx + 1, "total": len(filtered)}


@app.get("/prev")
def prev_sample(index: int = 0, category: str = "ALL"):
    filtered = get_filtered(category)
    if not filtered:
        return {"error": "no samples"}
    idx = max(index - 1, 0)
    sample = filtered[idx]
    return {**sample, "current_index": idx + 1, "total": len(filtered)}


@app.get("/goto")
def goto_sample(index: int = 0, category: str = "ALL"):
    filtered = get_filtered(category)
    if not filtered:
        return {"error": "no samples"}
    idx = max(0, min(index, len(filtered) - 1))
    sample = filtered[idx]
    return {**sample, "current_index": idx + 1, "total": len(filtered)}


@app.get("/last_index")
def get_last_index(annotator: str, category: str = "ALL", round_num: int = 1):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        filtered = get_filtered(category)
        submitted_ids = set(
            r[0] for r in cursor.execute("""
                SELECT DISTINCT sample_id FROM annotations
                WHERE annotator=? AND (round=? OR (round IS NULL AND ?=1))
            """, (annotator, round_num, round_num)).fetchall()
        )
        last_idx = 0
        for i, s in enumerate(filtered):
            if s["sample_id"] in submitted_ids:
                last_idx = i + 1
        return {"last_index": min(last_idx, len(filtered) - 1)}
    except Exception as e:
        print(f"last_index 오류: {e}")
        return {"last_index": 0}
    finally:
        conn.close()


@app.post("/submit")
def submit(data: dict):
    conn = get_db_conn()
    cursor = conn.cursor()
    round_num = int(data.get("round", 1))
    try:
        sample_id = data["sample_id"]
        annotator = data["annotator"]
        final_label = data["final_label"]
        q1 = data.get("q1")

        exists = cursor.execute("""
            SELECT COUNT(*) FROM annotations
            WHERE sample_id=? AND annotator=? AND round=?
        """, (sample_id, annotator, round_num)).fetchone()[0]

        if exists > 0:
            cursor.execute("""
                UPDATE annotations SET final_label=?, q1=?
                WHERE sample_id=? AND annotator=? AND round=?
            """, (final_label, q1, sample_id, annotator, round_num))
        else:
            cursor.execute("""
                INSERT INTO annotations (sample_id, annotator, final_label, q1, round)
                VALUES (?, ?, ?, ?, ?)
            """, (sample_id, annotator, final_label, q1, round_num))

        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"submit DB 오류: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        conn.close()

    # 파일 저장 (실패해도 DB는 이미 저장됨)
    try:
        annotator_dir = os.path.join(SAVE_DIR, f"Annotator_{annotator}")
        os.makedirs(annotator_dir, exist_ok=True)
        safe_sample_id = sample_id.replace("/", "_")
        suffix = "_r2" if round_num == 2 else ""
        file_path = os.path.join(annotator_dir, f"{safe_sample_id}{suffix}.jsonl")
        record = {
            "sample_id": sample_id, "annotator": annotator,
            "q1": q1, "final_label": final_label, "round": round_num,
        }
        existing_records = {}
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        rec = json.loads(line)
                        existing_records[rec["annotator"]] = rec
                    except Exception:
                        continue
        existing_records[annotator] = record
        with open(file_path, "w", encoding="utf-8") as f:
            for rec in existing_records.values():
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"파일 저장 오류 (DB는 저장됨): {e}")

    return {"status": "saved"}


@app.get("/annotation")
def get_annotation(
    sample_id: str = Query(...),
    annotator: str = Query(...),
    round_num: int = Query(1),
):
    return load_annotation_from_db(sample_id, annotator, round_num)


@app.get("/submitted_ids")
def get_submitted_ids(annotator: str, category: str = "ALL", round_num: int = 1):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        rows = cursor.execute("""
            SELECT DISTINCT sample_id FROM annotations
            WHERE annotator=? AND (round=? OR (round IS NULL AND ?=1))
        """, (annotator, round_num, round_num)).fetchall()
        submitted = set(r[0] for r in rows)
        filtered = get_filtered(category)
        return {
            "submitted_indices": [
                i for i, s in enumerate(filtered)
                if s["sample_id"] in submitted
            ]
        }
    except Exception as e:
        print(f"submitted_ids 오류: {e}")
        return {"submitted_indices": []}
    finally:
        conn.close()


@app.get("/progress")
def progress(annotator: str = None, category: str = None, round_num: int = 1):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        if category and category != "ALL":
            total = cursor.execute(
                "SELECT COUNT(*) FROM samples WHERE category=?", (category,)
            ).fetchone()[0]
        else:
            total = cursor.execute("SELECT COUNT(*) FROM samples").fetchone()[0]

        done = 0
        if annotator:
            if category and category != "ALL":
                done = cursor.execute("""
                    SELECT COUNT(DISTINCT a.sample_id)
                    FROM annotations a JOIN samples s ON a.sample_id = s.sample_id
                    WHERE a.annotator=? AND s.category=?
                      AND (a.round=? OR (a.round IS NULL AND ?=1))
                """, (annotator, category, round_num, round_num)).fetchone()[0]
            else:
                done = cursor.execute("""
                    SELECT COUNT(DISTINCT sample_id) FROM annotations
                    WHERE annotator=? AND (round=? OR (round IS NULL AND ?=1))
                """, (annotator, round_num, round_num)).fetchone()[0]

        return {"done": done, "total": total}
    except Exception as e:
        print(f"progress 오류: {e}")
        return {"done": 0, "total": 0}
    finally:
        conn.close()


@app.get("/progress_by_category")
def progress_by_category(annotator: str):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        categories = cursor.execute("SELECT DISTINCT category FROM samples").fetchall()
        result = {}
        for (cat,) in categories:
            total = cursor.execute(
                "SELECT COUNT(*) FROM samples WHERE category=?", (cat,)
            ).fetchone()[0]
            done = cursor.execute("""
                SELECT COUNT(DISTINCT a.sample_id)
                FROM annotations a JOIN samples s ON a.sample_id = s.sample_id
                WHERE a.annotator=? AND s.category=?
                  AND (a.round IS NULL OR a.round = 1)
            """, (annotator, cat)).fetchone()[0]
            result[cat] = {"done": done, "total": total}
        return result
    except Exception as e:
        print(f"progress_by_category 오류: {e}")
        return {}
    finally:
        conn.close()


@app.get("/progress_detail")
def progress_detail(category: str = "ALL"):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        if category == "ALL":
            total = cursor.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
        else:
            total = cursor.execute(
                "SELECT COUNT(*) FROM samples WHERE category=?", (category,)
            ).fetchone()[0]
        annotators = ["A", "B", "C", "D", "E"]
        result = {}
        for a in annotators:
            if category == "ALL":
                done = cursor.execute("""
                    SELECT COUNT(DISTINCT sample_id) FROM annotations
                    WHERE annotator=? AND (round IS NULL OR round = 1)
                """, (a,)).fetchone()[0]
            else:
                done = cursor.execute("""
                    SELECT COUNT(DISTINCT a.sample_id)
                    FROM annotations a JOIN samples s ON a.sample_id = s.sample_id
                    WHERE a.annotator=? AND s.category=?
                      AND (a.round IS NULL OR a.round = 1)
                """, (a, category)).fetchone()[0]
            result[a] = {"done": done, "total": total}
        return result
    except Exception as e:
        print(f"progress_detail 오류: {e}")
        return {}
    finally:
        conn.close()


@app.get("/iaa")
def get_iaa():
    conn = get_db_conn()
    try:
        return _compute_all_iaa(conn)
    except Exception as e:
        print(f"iaa 오류: {e}")
        return {"fleiss_kappa": 0, "alpha_q1": 0, "icc": 0}
    finally:
        conn.close()


# ─────────────────────────────────────────────
#  샘플 분류 엔드포인트
# ─────────────────────────────────────────────

@app.get("/sample_classification")
def sample_classification():
    conn = get_db_conn()
    try:
        all_annotations = _get_all_annotations_raw(conn)
        return _classify_samples(all_annotations)
    except Exception as e:
        print(f"sample_classification 오류: {e}")
        return {}
    finally:
        conn.close()


@app.get("/relabeling_samples")
def relabeling_samples():
    """
    재라벨링이 필요한 샘플 목록 반환.
    needs_relabeling + relabeling_in_progress 상태의 샘플을 포함하며,
    각 샘플의 round-1 어노테이션 정보(annotator, label, q1)도 함께 반환.
    """
    conn = get_db_conn()
    try:
        all_annotations = _get_all_annotations_raw(conn)
        classification = _classify_samples(all_annotations)
        # 모든 R2 관련 샘플 반환 (완료된 것도 포함)
        target_statuses = {
            "needs_relabeling", "relabeling_in_progress",
            "confirmed_relabeled", "disagreement",
        }

        target_ids = set(
            sid for sid, info in classification.items()
            if info["status"] in target_statuses
        )

        # round-1 상세 정보 첨부
        detail = []
        for sid in target_ids:
            r1_anns = [
                a for a in all_annotations
                if a["sample_id"] == sid and a["round"] == 1
            ]
            r2_anns = [
                a for a in all_annotations
                if a["sample_id"] == sid and a["round"] == 2
            ]
            detail.append({
                "sample_id": sid,
                "status": classification[sid]["status"],
                "round1": [
                    {"annotator": a["annotator"], "label": a["final_label"], "q1": a["q1"]}
                    for a in r1_anns
                ],
                "round2_count": len(set(a["annotator"] for a in r2_anns)),
            })

        # sample_ids 는 기존 호환
        return {
            "sample_ids": list(target_ids),
            "details": detail,
        }
    except Exception as e:
        print(f"relabeling_samples 오류: {e}")
        return {"sample_ids": [], "details": []}
    finally:
        conn.close()


@app.get("/classification_summary")
def classification_summary():
    conn = get_db_conn()
    try:
        all_annotations = _get_all_annotations_raw(conn)
        classification = _classify_samples(all_annotations)
        counts = Counter(info["status"] for info in classification.values())
        return dict(counts)
    except Exception as e:
        print(f"classification_summary 오류: {e}")
        return {}
    finally:
        conn.close()


@app.get("/admin")
def admin_dashboard():
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        annotators = ["A", "B", "C", "D", "E"]
        total = cursor.execute("SELECT COUNT(*) FROM samples").fetchone()[0]

        progress_data = {}
        for a in annotators:
            done = cursor.execute("""
                SELECT COUNT(DISTINCT sample_id) FROM annotations
                WHERE annotator=? AND (round IS NULL OR round = 1)
            """, (a,)).fetchone()[0]
            progress_data[a] = {
                "done": done, "total": total,
                "percent": round(done / total * 100, 1) if total else 0,
            }

        categories = cursor.execute("SELECT DISTINCT category FROM samples").fetchall()
        category_data = {}
        for (cat,) in categories:
            cat_total = cursor.execute(
                "SELECT COUNT(*) FROM samples WHERE category=?", (cat,)
            ).fetchone()[0]
            cat_done = {}
            for a in annotators:
                done = cursor.execute("""
                    SELECT COUNT(DISTINCT a.sample_id)
                    FROM annotations a JOIN samples s ON a.sample_id = s.sample_id
                    WHERE a.annotator=? AND s.category=?
                      AND (a.round IS NULL OR a.round = 1)
                """, (a, cat)).fetchone()[0]
                cat_done[a] = done
            category_data[cat] = {"total": cat_total, "by_annotator": cat_done}

        iaa = _compute_all_iaa(conn)

        all_annotations = _get_all_annotations_raw(conn)
        classification = _classify_samples(all_annotations)
        classification_counts = dict(Counter(
            info["status"] for info in classification.values()
        ))

        # Disagreement 샘플 목록
        disagreement_list = [
            sid for sid, info in classification.items()
            if info["status"] == "disagreement"
        ]

        return {
            "total_samples": total,
            "progress": progress_data,
            "category_progress": category_data,
            "iaa": iaa,
            "classification": classification_counts,
            "disagreement_samples": disagreement_list,
        }
    except Exception as e:
        print(f"admin 오류: {e}")
        return {
            "total_samples": 0, "progress": {}, "category_progress": {},
            "iaa": {"fleiss_kappa": 0, "alpha_q1": 0, "icc": 0},
            "classification": {}, "disagreement_samples": [],
        }
    finally:
        conn.close()


@app.get("/db_query")
def db_query(
    sample_id: str = None,
    annotator: str = None,
    round_num: int = None,
    limit: int = 200,
    offset: int = 0,
):
    """
    DB 직접 조회 — 필터 조건에 맞는 어노테이션 반환.
    전체 건수(total)와 포맷된 결과를 함께 리턴.
    """
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        where_clauses = []
        params = []
        if sample_id:
            where_clauses.append("sample_id LIKE ?")
            params.append(f"%{sample_id}%")
        if annotator:
            where_clauses.append("annotator = ?")
            params.append(annotator)
        if round_num is not None:
            where_clauses.append("(round = ? OR (round IS NULL AND ? = 1))")
            params.extend([round_num, round_num])

        where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        total = cursor.execute(
            f"SELECT COUNT(*) FROM annotations{where_sql}", params
        ).fetchone()[0]

        rows = cursor.execute(f"""
            SELECT sample_id, annotator, final_label, q1, round
            FROM annotations{where_sql}
            ORDER BY sample_id, annotator, round
            LIMIT ? OFFSET ?
        """, params + [limit, offset]).fetchall()

        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "data": [
                {
                    "sample_id": r[0], "annotator": r[1], "final_label": r[2],
                    "q1": r[3], "round": r[4] if r[4] is not None else 1,
                }
                for r in rows
            ],
        }
    except Exception as e:
        print(f"db_query 오류: {e}")
        return {"total": 0, "limit": limit, "offset": offset, "data": []}
    finally:
        conn.close()


@app.get("/annotations")
def get_all_annotations(annotator: str = None):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        if annotator:
            rows = cursor.execute("""
                SELECT sample_id, annotator, final_label, q1, round
                FROM annotations WHERE annotator=? ORDER BY sample_id
            """, (annotator,)).fetchall()
        else:
            rows = cursor.execute("""
                SELECT sample_id, annotator, final_label, q1, round
                FROM annotations ORDER BY sample_id, annotator
            """).fetchall()
        return [
            {
                "sample_id": r[0], "annotator": r[1], "final_label": r[2],
                "q1": r[3], "round": r[4] if r[4] is not None else 1,
            }
            for r in rows
        ]
    except Exception as e:
        print(f"annotations 오류: {e}")
        return []
    finally:
        conn.close()


@app.get("/export/json")
def export_json():
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        rows = cursor.execute("""
            SELECT sample_id, annotator, final_label, q1, round
            FROM annotations ORDER BY sample_id, annotator
        """).fetchall()
        data = [
            {
                "sample_id": r[0], "annotator": r[1], "final_label": r[2],
                "q1": r[3], "round": r[4] if r[4] is not None else 1,
            }
            for r in rows
        ]
        output = io.StringIO()
        json.dump(data, output, ensure_ascii=False, indent=2)
        output.seek(0)
        return StreamingResponse(
            output, media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=annotations.json"},
        )
    finally:
        conn.close()


@app.get("/export/csv")
def export_csv():
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        rows = cursor.execute("""
            SELECT sample_id, annotator, final_label, q1, round
            FROM annotations ORDER BY sample_id, annotator
        """).fetchall()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["sample_id", "annotator", "final_label", "q1", "round"])
        writer.writerows(
            (r[0], r[1], r[2], r[3], r[4] if r[4] is not None else 1)
            for r in rows
        )
        output.seek(0)
        return StreamingResponse(
            output, media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=annotations.csv"},
        )
    finally:
        conn.close()


# ─────────────────────────────────────────────
#  분류 결과 내보내기 (샘플당 1행)
# ─────────────────────────────────────────────

def _build_classified_rows(conn):
    """
    샘플별 분류 결과를 1행으로 정리.
    Returns list of dicts:
      sample_id, category, status, confirmed_label,
      r1_annotators, r1_labels, r1_q1_scores,
      r2_annotators, r2_labels
    """
    all_annotations = _get_all_annotations_raw(conn)
    classification = _classify_samples(all_annotations)

    # 샘플별 어노테이션 그룹핑
    by_sample_r1 = defaultdict(list)
    by_sample_r2 = defaultdict(list)
    for ann in all_annotations:
        if ann["round"] == 2:
            by_sample_r2[ann["sample_id"]].append(ann)
        else:
            by_sample_r1[ann["sample_id"]].append(ann)

    # 샘플 카테고리 매핑
    sample_cat = {s["sample_id"]: s["category"] for s in samples}

    rows = []
    for sid in sorted(set(list(by_sample_r1.keys()) + list(by_sample_r2.keys()))):
        clf = classification.get(sid, {"status": "unknown", "confirmed_label": None})
        r1 = sorted(by_sample_r1.get(sid, []), key=lambda a: a["annotator"])
        r2 = sorted(by_sample_r2.get(sid, []), key=lambda a: a["annotator"])

        rows.append({
            "sample_id": sid,
            "category": sample_cat.get(sid, ""),
            "status": clf["status"],
            "confirmed_label": clf["confirmed_label"] or "",
            "r1_annotators": ",".join(a["annotator"] for a in r1),
            "r1_labels": ",".join(f"{a['annotator']}:{a['final_label']}" for a in r1),
            "r1_q1_scores": ",".join(f"{a['annotator']}:{a['q1']}" for a in r1 if a["q1"] is not None),
            "r2_annotators": ",".join(a["annotator"] for a in r2),
            "r2_labels": ",".join(f"{a['annotator']}:{a['final_label']}" for a in r2),
        })
    return rows


@app.get("/export/classified_csv")
def export_classified_csv():
    """샘플별 분류 결과 CSV — 샘플당 1행, 상태/확정라벨 포함"""
    conn = get_db_conn()
    try:
        rows = _build_classified_rows(conn)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "sample_id", "category", "status", "confirmed_label",
            "r1_annotators", "r1_labels", "r1_q1_scores",
            "r2_annotators", "r2_labels",
        ])
        for r in rows:
            writer.writerow([
                r["sample_id"], r["category"], r["status"], r["confirmed_label"],
                r["r1_annotators"], r["r1_labels"], r["r1_q1_scores"],
                r["r2_annotators"], r["r2_labels"],
            ])
        output.seek(0)
        return StreamingResponse(
            output, media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=classified_samples.csv"},
        )
    except Exception as e:
        print(f"export_classified_csv 오류: {e}")
        return StreamingResponse(io.StringIO("error"), media_type="text/csv")
    finally:
        conn.close()


@app.get("/export/classified_json")
def export_classified_json():
    """샘플별 분류 결과 JSON — 샘플당 1객체, 상태/확정라벨 포함"""
    conn = get_db_conn()
    try:
        rows = _build_classified_rows(conn)
        output = io.StringIO()
        json.dump(rows, output, ensure_ascii=False, indent=2)
        output.seek(0)
        return StreamingResponse(
            output, media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=classified_samples.json"},
        )
    except Exception as e:
        print(f"export_classified_json 오류: {e}")
        return StreamingResponse(io.StringIO("[]"), media_type="application/json")
    finally:
        conn.close()


@app.get("/samples")
def get_samples_list():
    return [
        {"sample_id": s["sample_id"], "category": s["category"]}
        for s in samples
    ]


@app.post("/restore")
async def restore_annotations(request: dict):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        rows = request.get("data", [])
        count = 0
        for row in rows:
            round_num = int(row.get("round", 1))
            q1_val = row.get("q1")
            q1_int = int(q1_val) if q1_val is not None else None

            exists = cursor.execute("""
                SELECT COUNT(*) FROM annotations
                WHERE sample_id=? AND annotator=? AND round=?
            """, (row["sample_id"], row["annotator"], round_num)).fetchone()[0]

            if exists > 0:
                cursor.execute("""
                    UPDATE annotations SET final_label=?, q1=?
                    WHERE sample_id=? AND annotator=? AND round=?
                """, (row["final_label"], q1_int,
                      row["sample_id"], row["annotator"], round_num))
            else:
                cursor.execute("""
                    INSERT INTO annotations (sample_id, annotator, final_label, q1, round)
                    VALUES (?, ?, ?, ?, ?)
                """, (row["sample_id"], row["annotator"],
                      row["final_label"], q1_int, round_num))
            count += 1
        conn.commit()
        return {"status": "restored", "count": count}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        conn.close()
