from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from iaa import compute_fleiss_kappa, compute_krippendorff_alpha_q1, compute_icc, compute_krippendorff_alpha_label
from database import init_db, get_db
import os, json, csv, io
from collections import defaultdict, Counter
from datetime import datetime
from load_samples import load_all_samples

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
            {"sample_id": r[0], "article_id": r[1], "category": r[2],
             "previous": r[3], "target": r[4], "next": r[5], "predicted": r[6]}
            for r in rows
        ]
    except Exception as e:
        print(f"샘플 로드 오류: {e}")
        return []
    finally:
        conn.close()


def _migrate_db():
    conn = get_db_conn()
    try:
        try:
            conn.execute("ALTER TABLE annotations ADD COLUMN round INTEGER DEFAULT 1")
            conn.commit()
        except Exception:
            pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS excluded_samples (
                sample_id TEXT,
                annotator TEXT,
                excluded_at TEXT,
                PRIMARY KEY (sample_id, annotator)
            )
        """)
        conn.commit()
    finally:
        conn.close()


@app.on_event("startup")
def startup():
    global samples
    try:
        init_db()

        # 서버 시작 시 DB 재구성 + en 데이터 로딩
        load_all_samples()

        _migrate_db()

        # category는 DB에 저장된 값 그대로 사용
        # load_all_samples()가 파일명(business, sport 등)을 category로 저장해야 함
        samples = get_all_samples()

        print(f"샘플 개수: {len(samples)}")
        # 카테고리 확인용 로그
        cats = set(s["category"] for s in samples)
        print(f"카테고리 목록: {cats}")
    except Exception as e:
        print(f"startup 오류: {e}")


def get_filtered(category):
    if category and category != "ALL":
        return [
            s for s in samples
            if s["category"].lower() == category.lower()
        ]
    return samples


def load_annotation_from_db(sample_id: str, annotator: str, round_num: int = 1):
    if not annotator:
        return {"q1": None, "final_label": None, "is_correct": None}
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        row = cursor.execute("""
            SELECT q1, final_label FROM annotations
            WHERE sample_id=? AND annotator=? AND (round=? OR (round IS NULL AND ?=1))
        """, (sample_id, annotator, round_num, round_num)).fetchone()
        if row:
            q1, final_label = row[0], row[1]
            # is_correct 필드 추가: final_label이 없으면 O(True), 있으면 X(False)
            # q1이 None이고 final_label도 None이면 제외 샘플 또는 미제출
            if q1 is None and final_label is None:
                is_correct = None  # 미제출 또는 제외
            else:
                is_correct = final_label is None  # True=O, False=X
            return {"q1": q1, "final_label": final_label, "is_correct": is_correct}
        return {"q1": None, "final_label": None, "is_correct": None}
    except Exception as e:
        print(f"annotation 조회 오류: {e}")
        return {"q1": None, "final_label": None, "is_correct": None}
    finally:
        conn.close()


def _get_all_annotations_raw(conn):
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1, round
        FROM annotations WHERE (round IS NULL OR round = 1)
    """).fetchall()
    return [
        {"sample_id": r[0], "annotator": r[1], "final_label": r[2],
         "q1": r[3], "round": r[4] if r[4] is not None else 1}
        for r in rows
    ]


def _get_decisions(conn):
    """sample_decisions 테이블에서 결정된 최종 라벨 조회"""
    cursor = conn.cursor()
    rows = cursor.execute("SELECT sample_id, final_label FROM sample_decisions").fetchall()
    return {r[0]: r[1] for r in rows}


def _get_excluded_samples(conn):
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT DISTINCT sample_id FROM excluded_samples
    """).fetchall()
    return set(r[0] for r in rows)


def _classify_samples(all_annotations, decisions=None):
    conn = get_db_conn()
    try:
        excluded = _get_excluded_samples(conn)
    finally:
        conn.close()

    if decisions is None:
        decisions = {}

    predicted_map = {s["sample_id"]: s.get("predicted") for s in samples}
    by_sample = defaultdict(list)

    for ann in all_annotations:
        by_sample[ann["sample_id"]].append(ann)

    results = {}

    for sid, anns in by_sample.items():

        if sid in excluded:
            results[sid] = {"status": "excluded", "confirmed_label": None}
            continue

        if sid in decisions:
            results[sid] = {
                "status": "discussion_resolved",
                "confirmed_label": decisions[sid]
            }
            continue

        predicted = predicted_map.get(sid)
        labels = []

        for a in anns:
            if a["final_label"] is None:
                # O — LLM 라벨 사용
                label = predicted
            else:
                # X — 어노테이터 직접 선택
                label = a["final_label"]

            if label in ("F", "C", "M"):
                labels.append(label)

        if len(labels) < 3:
            results[sid] = {"status": "in_progress", "confirmed_label": None}
            continue

        counter = Counter(labels)
        top_label, top_count = counter.most_common(1)[0]

        if top_count > len(labels) / 2:
            results[sid] = {
                "status": "confirmed",
                "confirmed_label": top_label
            }
        else:
            results[sid] = {
                "status": "needs_discussion",
                "confirmed_label": None
            }

    return results


def _build_iaa_data(conn):
    """
    IAA 계산용 데이터 구축 (Label 기반만)
    """
    predicted_map = {s["sample_id"]: s.get("predicted") for s in samples}

    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1 FROM annotations
        WHERE (round IS NULL OR round = 1)
    """).fetchall()

    label_dict = defaultdict(list)

    for sample_id, annotator, label, q1 in rows:
        if label is None:
            effective_label = predicted_map.get(sample_id)
        else:
            effective_label = label

        if effective_label in ("F", "C", "M"):
            label_dict[sample_id].append((annotator, effective_label))

    label_filtered = {
        sid: items for sid, items in label_dict.items()
        if len(set(a for a, _ in items)) >= 3
    }

    return label_filtered


def _compute_all_iaa(conn):
    label_filtered = _build_iaa_data(conn)

    result = {
        "fleiss_kappa": 0,
        "alpha_label": 0,
        "label_sample_count": len(label_filtered),
    }

    if label_filtered:
        try:
            fleiss_input = [
                {"sample_id": sid, "label": label}
                for sid, items in label_filtered.items()
                for _, label in items
            ]
            result["fleiss_kappa"] = compute_fleiss_kappa(fleiss_input)
            result["alpha_label"] = compute_krippendorff_alpha_label(label_filtered)
        except Exception as e:
            print(f"label IAA 오류: {e}")

    return result


# ─────────────────────────────────────────────
#  기본 엔드포인트
# ─────────────────────────────────────────────

@app.get("/sample")
def get_sample(index: int = 0, category: str = "ALL"):
    filtered = get_filtered(category)
    if not filtered: return {"error": "no samples"}
    idx = max(0, min(index, len(filtered) - 1))
    return {**filtered[idx], "current_index": idx + 1, "total": len(filtered)}

@app.get("/next")
def next_sample(index: int = 0, category: str = "ALL"):
    filtered = get_filtered(category)
    if not filtered: return {"error": "no samples"}
    idx = min(index + 1, len(filtered) - 1)
    return {**filtered[idx], "current_index": idx + 1, "total": len(filtered)}

@app.get("/prev")
def prev_sample(index: int = 0, category: str = "ALL"):
    filtered = get_filtered(category)
    if not filtered: return {"error": "no samples"}
    idx = max(index - 1, 0)
    return {**filtered[idx], "current_index": idx + 1, "total": len(filtered)}

@app.get("/goto")
def goto_sample(index: int = 0, category: str = "ALL"):
    filtered = get_filtered(category)
    if not filtered: return {"error": "no samples"}
    idx = max(0, min(index, len(filtered) - 1))
    return {**filtered[idx], "current_index": idx + 1, "total": len(filtered)}


@app.get("/last_index")
def get_last_index(annotator: str, category: str = "ALL"):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        filtered = get_filtered(category)
        submitted_ids = set(
            r[0] for r in cursor.execute("""
                SELECT DISTINCT sample_id FROM annotations
                WHERE annotator=? AND (round IS NULL OR round = 1)
            """, (annotator,)).fetchall()
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
    try:
        sample_id = data["sample_id"]
        annotator = data["annotator"]
        final_label = data.get("final_label")

        # 프론트에서 is_correct로 전송
        is_correct = data.get("is_correct")

        if is_correct is None:
            return {"status": "error", "message": "is_correct is required"}

        # X(False)일 때만 final_label 필요
        if is_correct is False:
            if final_label not in ("F", "C", "M"):
                return {"status": "error", "message": "final_label must be F/C/M when disagree"}
        else:
            final_label = None  # O면 LLM 라벨 사용

        q1 = None  # q1 점수 미사용 (현재 인터페이스에서 제거됨)

        exists = cursor.execute("""
            SELECT COUNT(*) FROM annotations
            WHERE sample_id=? AND annotator=? AND (round IS NULL OR round = 1)
        """, (sample_id, annotator)).fetchone()[0]

        if exists > 0:
            cursor.execute("""
                UPDATE annotations SET final_label=?, q1=?
                WHERE sample_id=? AND annotator=? AND (round IS NULL OR round = 1)
            """, (final_label, q1, sample_id, annotator))
        else:
            cursor.execute("""
                INSERT INTO annotations (sample_id, annotator, final_label, q1, round)
                VALUES (?, ?, ?, ?, 1)
            """, (sample_id, annotator, final_label, q1))

        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"submit DB 오류: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        conn.close()

    try:
        annotator_dir = os.path.join(SAVE_DIR, f"Annotator_{annotator}")
        os.makedirs(annotator_dir, exist_ok=True)
        safe_sample_id = sample_id.replace("/", "_")
        file_path = os.path.join(annotator_dir, f"{safe_sample_id}.jsonl")
        record = {"sample_id": sample_id, "annotator": annotator, "q1": q1, "final_label": final_label}
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
        print(f"파일 저장 오류: {e}")

    return {"status": "saved"}


@app.post("/exclude")
def exclude_sample(data: dict):
    sample_id = data.get("sample_id")
    annotator = data.get("annotator")

    if not sample_id or not annotator:
        return {"status": "error", "message": "sample_id, annotator required"}

    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT OR REPLACE INTO excluded_samples (sample_id, annotator, excluded_at)
            VALUES (?, ?, ?)
        """, (sample_id, annotator, datetime.utcnow().isoformat()))

        exists = cursor.execute("""
            SELECT COUNT(*) FROM annotations
            WHERE sample_id=? AND annotator=? AND (round IS NULL OR round = 1)
        """, (sample_id, annotator)).fetchone()[0]

        if exists > 0:
            cursor.execute("""
                UPDATE annotations SET final_label=NULL, q1=NULL
                WHERE sample_id=? AND annotator=? AND (round IS NULL OR round = 1)
            """, (sample_id, annotator))
        else:
            cursor.execute("""
                INSERT INTO annotations (sample_id, annotator, final_label, q1, round)
                VALUES (?, ?, NULL, NULL, 1)
            """, (sample_id, annotator))

        conn.commit()
        return {"status": "excluded"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        conn.close()


@app.get("/annotation")
def get_annotation(
    sample_id: str = Query(...),
    annotator: str = Query(...),
    round_num: int = Query(1),
):
    return load_annotation_from_db(sample_id, annotator, round_num)


@app.get("/submitted_ids")
def get_submitted_ids(annotator: str, category: str = "ALL"):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        rows = cursor.execute("""
            SELECT DISTINCT sample_id FROM annotations
            WHERE annotator=? AND (round IS NULL OR round = 1)
        """, (annotator,)).fetchall()
        submitted = set(r[0] for r in rows)
        filtered = get_filtered(category)
        return {
            "submitted_indices": [i for i, s in enumerate(filtered) if s["sample_id"] in submitted]
        }
    except Exception as e:
        print(f"submitted_ids 오류: {e}")
        return {"submitted_indices": []}
    finally:
        conn.close()


@app.get("/progress")
def progress(annotator: str = None, category: str = None):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        if category and category != "ALL":
            total = cursor.execute(
                "SELECT COUNT(*) FROM samples WHERE LOWER(category)=LOWER(?)", (category,)
            ).fetchone()[0]
        else:
            total = cursor.execute("SELECT COUNT(*) FROM samples").fetchone()[0]

        done = 0
        if annotator:
            if category and category != "ALL":
                done = cursor.execute("""
                    SELECT COUNT(DISTINCT a.sample_id)
                    FROM annotations a JOIN samples s ON a.sample_id = s.sample_id
                    WHERE a.annotator=? AND LOWER(s.category)=LOWER(?) AND (a.round IS NULL OR a.round = 1)
                """, (annotator, category)).fetchone()[0]
            else:
                done = cursor.execute("""
                    SELECT COUNT(DISTINCT sample_id) FROM annotations
                    WHERE annotator=? AND (round IS NULL OR round = 1)
                """, (annotator,)).fetchone()[0]
        return {"done": done, "total": total}
    except Exception as e:
        print(f"progress 오류: {e}")
        return {"done": 0, "total": 0}
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
                "SELECT COUNT(*) FROM samples WHERE LOWER(category)=LOWER(?)", (category,)
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
                    WHERE a.annotator=? AND LOWER(s.category)=LOWER(?) AND (a.round IS NULL OR a.round = 1)
                """, (a, category)).fetchone()[0]
            result[a] = {"done": done, "total": total}
        return result
    except Exception as e:
        return {}
    finally:
        conn.close()


@app.get("/iaa")
def get_iaa():
    conn = get_db_conn()
    try:
        return _compute_all_iaa(conn)
    except Exception as e:
        print(f"IAA API 오류: {e}")
        return {
            "fleiss_kappa": 0,
            "alpha_label": 0,
            "label_sample_count": 0,
        }
    finally:
        conn.close()


@app.get("/sample_classification")
def sample_classification():
    conn = get_db_conn()
    try:
        all_annotations = _get_all_annotations_raw(conn)
        return _classify_samples(all_annotations)
    except Exception as e:
        return {}
    finally:
        conn.close()


@app.get("/discussion_samples")
def get_discussion_samples():
    conn = get_db_conn()
    try:
        all_annotations = _get_all_annotations_raw(conn)
        classification = _classify_samples(all_annotations)
        predicted_map = {s["sample_id"]: s.get("predicted") for s in samples}

        by_sample = defaultdict(list)
        for ann in all_annotations:
            by_sample[ann["sample_id"]].append(ann)

        result = []
        for sid, anns in by_sample.items():
            # q1 기반 필터 → X(final_label이 있는) 어노테이션이 있는 샘플만 포함
            has_disagreement = any(a["final_label"] is not None for a in anns)
            if not has_disagreement:
                continue

            clf = classification.get(sid, {"status": "in_progress", "confirmed_label": None})

            ann_details = []
            for a in sorted(anns, key=lambda x: x["annotator"]):
                is_correct = a["final_label"] is None
                effective_label = a["final_label"] if a["final_label"] else predicted_map.get(sid)
                ann_details.append({
                    "annotator": a["annotator"],
                    "q1": a["q1"],
                    "label": effective_label,
                    "is_correct": is_correct,
                })

            resolved = clf["status"] == "discussion_resolved"
            result.append({
                "sample_id": sid,
                "predicted": predicted_map.get(sid),
                "annotations": ann_details,
                "resolved": resolved,
                "decided_label": clf["confirmed_label"] if resolved else None,
                "status": clf["status"],
            })

        result.sort(key=lambda x: (x["resolved"], x["sample_id"]))
        return {
            "samples": result,
            "total": len(result),
            "resolved_count": sum(1 for r in result if r["resolved"])
        }
    except Exception as e:
        print(f"discussion_samples 오류: {e}")
        return {"samples": [], "total": 0, "resolved_count": 0}
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

        # 카테고리 목록: DB에서 DISTINCT category 그대로 사용
        categories = cursor.execute("SELECT DISTINCT category FROM samples ORDER BY category").fetchall()
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
                    WHERE a.annotator=? AND s.category=? AND (a.round IS NULL OR a.round = 1)
                """, (a, cat)).fetchone()[0]
                cat_done[a] = done
            category_data[cat] = {"total": cat_total, "by_annotator": cat_done}

        iaa = _compute_all_iaa(conn)
        all_annotations = _get_all_annotations_raw(conn)
        classification = _classify_samples(all_annotations)
        classification_counts = dict(Counter(info["status"] for info in classification.values()))

        # 어노테이터별 제외 개수
        excluded_by_annotator = {}
        for a in annotators:
            cnt = cursor.execute("""
                SELECT COUNT(*) FROM annotations
                WHERE annotator=? AND q1 IS NULL AND final_label IS NULL AND (round IS NULL OR round = 1)
            """, (a,)).fetchone()[0]
            excluded_by_annotator[a] = cnt

        # 제외된 고유 샘플 수
        excluded_sample_count = cursor.execute("""
            SELECT COUNT(DISTINCT sample_id) FROM excluded_samples
        """).fetchone()[0]

        return {
            "total_samples": total,
            "progress": progress_data,
            "category_progress": category_data,
            "iaa": iaa,
            "classification": classification_counts,
            "excluded_by_annotator": excluded_by_annotator,
            "excluded_sample_count": excluded_sample_count,
        }
    except Exception as e:
        print(f"admin 오류: {e}")
        return {
            "total_samples": 0, "progress": {}, "category_progress": {},
            "iaa": {"fleiss_kappa": 0, "alpha_q1": 0, "icc": 0, "alpha_label": 0},
            "classification": {},
            "excluded_by_annotator": {},
            "excluded_sample_count": 0,
        }
    finally:
        conn.close()


@app.get("/db_query")
def db_query(
    sample_id: str = None, annotator: str = None,
    round_num: int = None, limit: int = 200, offset: int = 0,
):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        where_clauses, params = [], []
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
        total = cursor.execute(f"SELECT COUNT(*) FROM annotations{where_sql}", params).fetchone()[0]
        rows = cursor.execute(f"""
            SELECT sample_id, annotator, final_label, q1, round
            FROM annotations{where_sql}
            ORDER BY sample_id, annotator LIMIT ? OFFSET ?
        """, params + [limit, offset]).fetchall()
        return {
            "total": total, "limit": limit, "offset": offset,
            "data": [
                {"sample_id": r[0], "annotator": r[1], "final_label": r[2],
                 "q1": r[3], "round": r[4] if r[4] is not None else 1}
                for r in rows
            ],
        }
    except Exception as e:
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
            {"sample_id": r[0], "annotator": r[1], "final_label": r[2],
             "q1": r[3], "round": r[4] if r[4] is not None else 1}
            for r in rows
        ]
    except Exception as e:
        return []
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
        writer.writerows((r[0], r[1], r[2], r[3], r[4] if r[4] is not None else 1) for r in rows)
        output.seek(0)
        return StreamingResponse(
            output, media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=annotations.csv"},
        )
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
            {"sample_id": r[0], "annotator": r[1], "final_label": r[2],
             "q1": r[3], "round": r[4] if r[4] is not None else 1}
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


@app.get("/export/final_dataset")
def export_final_dataset():
    conn = get_db_conn()
    try:
        all_annotations = _get_all_annotations_raw(conn)
        classification = _classify_samples(all_annotations)
        sample_map = {s["sample_id"]: s for s in samples}
        result = []
        for sid, clf in classification.items():
            if clf["status"] not in ("confirmed", "discussion_resolved"):
                continue
            s = sample_map.get(sid)
            if not s:
                continue
            result.append({
                "sample_id": sid,
                "target_sentence": s["target"],
                "label": clf["confirmed_label"],
                "prev_sentence": s["previous"] or "",
                "next_sentence": s["next"] or "",
            })
        result.sort(key=lambda x: x["sample_id"])
        output = io.StringIO()
        json.dump(result, output, ensure_ascii=False, indent=2)
        output.seek(0)
        return StreamingResponse(
            output, media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=final_dataset.json"},
        )
    except Exception as e:
        print(f"export_final_dataset 오류: {e}")
        return StreamingResponse(io.StringIO("[]"), media_type="application/json")
    finally:
        conn.close()


@app.get("/samples")
def get_samples_list():
    return [{"sample_id": s["sample_id"], "category": s["category"]} for s in samples]


@app.post("/restore")
async def restore_annotations(request: dict):
    conn = get_db_conn()
    cursor = conn.cursor()
    try:
        rows = request.get("data", [])
        count = 0
        for row in rows:
            q1_val = row.get("q1")
            q1_int = int(q1_val) if q1_val is not None else None
            exists = cursor.execute("""
                SELECT COUNT(*) FROM annotations
                WHERE sample_id=? AND annotator=? AND (round IS NULL OR round = 1)
            """, (row["sample_id"], row["annotator"])).fetchone()[0]
            if exists > 0:
                cursor.execute("""
                    UPDATE annotations SET final_label=?, q1=?
                    WHERE sample_id=? AND annotator=? AND (round IS NULL OR round = 1)
                """, (row.get("final_label"), q1_int, row["sample_id"], row["annotator"]))
            else:
                cursor.execute("""
                    INSERT INTO annotations (sample_id, annotator, final_label, q1, round)
                    VALUES (?, ?, ?, ?, 1)
                """, (row["sample_id"], row["annotator"], row.get("final_label"), q1_int))
            count += 1
        conn.commit()
        return {"status": "restored", "count": count}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        conn.close()