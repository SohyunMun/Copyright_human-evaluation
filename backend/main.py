from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from iaa import compute_fleiss_kappa, compute_krippendorff_alpha_q1
from database import init_db, get_db
import os
import json
import csv
import io
from collections import defaultdict
import math

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(BASE_DIR, "annotator_eval")

samples = []


def get_all_samples():
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, article_id, category, previous, target, next, predicted
        FROM samples
        ORDER BY rowid
    """).fetchall()
    conn.close()
    return [
        {
            "sample_id": r[0],
            "article_id": r[1],
            "category": r[2],
            "previous": r[3],
            "target": r[4],
            "next": r[5],
            "predicted": r[6]
        }
        for r in rows
    ]


@app.on_event("startup")
def startup():
    global samples
    init_db()
    samples = get_all_samples()
    print(f"샘플 개수: {len(samples)}")


def get_filtered(category):
    if category and category != "ALL":
        return [s for s in samples if s["category"] == category]
    return samples


def load_annotation(sample_id: str, annotator: str):
    if not annotator:
        return {"q1": None, "final_label": None}
    conn = get_db()
    cursor = conn.cursor()
    row = cursor.execute("""
        SELECT q1, final_label FROM annotations
        WHERE sample_id=? AND annotator=?
    """, (sample_id, annotator)).fetchone()
    conn.close()
    if row:
        return {"q1": row[0], "final_label": row[1]}
    return {"q1": None, "final_label": None}


# ── index 기반 샘플 조회 (전역변수 제거) ──────────────────
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


# ── 마지막 제출 위치 ──────────────────────────────────────
@app.get("/last_index")
def get_last_index(annotator: str, category: str = "ALL"):
    conn = get_db()
    cursor = conn.cursor()
    filtered = get_filtered(category)
    submitted_ids = set(
        r[0] for r in cursor.execute("""
            SELECT DISTINCT sample_id FROM annotations WHERE annotator=?
        """, (annotator,)).fetchall()
    )
    conn.close()
    last_idx = 0
    for i, s in enumerate(filtered):
        if s["sample_id"] in submitted_ids:
            last_idx = i + 1
    return {"last_index": min(last_idx, len(filtered) - 1)}


@app.post("/submit")
def submit(data: dict):
    conn = get_db()
    cursor = conn.cursor()
    sample_id = data["sample_id"]
    annotator = data["annotator"]

    exists = cursor.execute("""
        SELECT COUNT(*) FROM annotations
        WHERE sample_id=? AND annotator=?
    """, (sample_id, annotator)).fetchone()[0]

    if exists > 0:
        cursor.execute("""
            UPDATE annotations SET final_label=?, q1=?
            WHERE sample_id=? AND annotator=?
        """, (data["final_label"], data["q1"], sample_id, annotator))
    else:
        cursor.execute("""
            INSERT INTO annotations (sample_id, annotator, final_label, q1)
            VALUES (?, ?, ?, ?)
        """, (sample_id, annotator, data["final_label"], data["q1"]))

    conn.commit()
    conn.close()

    annotator_dir = os.path.join(SAVE_DIR, f"Annotator_{annotator}")
    os.makedirs(annotator_dir, exist_ok=True)
    safe_sample_id = sample_id.replace("/", "_")
    file_path = os.path.join(annotator_dir, f"{safe_sample_id}.jsonl")
    record = {
        "sample_id": sample_id,
        "annotator": annotator,
        "q1": data["q1"],
        "final_label": data["final_label"]
    }
    existing_records = {}
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    existing_records[rec["annotator"]] = rec
                except:
                    continue
    existing_records[annotator] = record
    with open(file_path, "w", encoding="utf-8") as f:
        for rec in existing_records.values():
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    return {"status": "saved"}


@app.get("/annotation/{sample_id}/{annotator}")
def get_annotation(sample_id: str, annotator: str):
    return load_annotation(sample_id, annotator)


# ── 제출 여부 목록 (3번 기능: 이미 제출한 샘플 표시용) ────
@app.get("/submitted_ids")
def get_submitted_ids(annotator: str, category: str = "ALL"):
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT DISTINCT sample_id FROM annotations WHERE annotator=?
    """, (annotator,)).fetchall()
    conn.close()
    submitted = set(r[0] for r in rows)
    filtered = get_filtered(category)
    return {
        "submitted_indices": [
            i for i, s in enumerate(filtered)
            if s["sample_id"] in submitted
        ]
    }


@app.get("/progress")
def progress(annotator: str = None, category: str = None):
    conn = get_db()
    cursor = conn.cursor()
    if category and category != "ALL":
        total = cursor.execute("""
            SELECT COUNT(*) FROM samples WHERE category=?
        """, (category,)).fetchone()[0]
    else:
        total = cursor.execute("SELECT COUNT(*) FROM samples").fetchone()[0]

    if annotator:
        if category and category != "ALL":
            done = cursor.execute("""
                SELECT COUNT(DISTINCT a.sample_id)
                FROM annotations a
                JOIN samples s ON a.sample_id = s.sample_id
                WHERE a.annotator=? AND s.category=?
            """, (annotator, category)).fetchone()[0]
        else:
            done = cursor.execute("""
                SELECT COUNT(DISTINCT sample_id)
                FROM annotations WHERE annotator=?
            """, (annotator,)).fetchone()[0]
    else:
        done = 0
    conn.close()
    return {"done": done, "total": total}


@app.get("/progress_by_category")
def progress_by_category(annotator: str):
    conn = get_db()
    cursor = conn.cursor()
    categories = cursor.execute(
        "SELECT DISTINCT category FROM samples"
    ).fetchall()
    result = {}
    for (cat,) in categories:
        total = cursor.execute(
            "SELECT COUNT(*) FROM samples WHERE category=?", (cat,)
        ).fetchone()[0]
        done = cursor.execute("""
            SELECT COUNT(DISTINCT a.sample_id)
            FROM annotations a
            JOIN samples s ON a.sample_id = s.sample_id
            WHERE a.annotator=? AND s.category=?
        """, (annotator, cat)).fetchone()[0]
        result[cat] = {"done": done, "total": total}
    conn.close()
    return result


@app.get("/progress_detail")
def progress_detail(category: str = "ALL"):
    conn = get_db()
    cursor = conn.cursor()
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
                SELECT COUNT(DISTINCT sample_id)
                FROM annotations WHERE annotator=?
            """, (a,)).fetchone()[0]
        else:
            done = cursor.execute("""
                SELECT COUNT(DISTINCT a.sample_id)
                FROM annotations a
                JOIN samples s ON a.sample_id = s.sample_id
                WHERE a.annotator=? AND s.category=?
            """, (a, category)).fetchone()[0]
        result[a] = {"done": done, "total": total}
    conn.close()
    return result


@app.get("/iaa")
def get_iaa():
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1 FROM annotations
    """).fetchall()
    conn.close()
    sample_dict = defaultdict(list)
    for sample_id, annotator, label, q1 in rows:
        if label not in ["F", "C", "M"]:
            continue
        sample_dict[sample_id].append((annotator, label, q1))
    filtered_dict = {
        sid: items for sid, items in sample_dict.items()
        if len(set(a for a, _, _ in items)) >= 4
    }
    if not filtered_dict:
        return {"fleiss_kappa": 0, "alpha_q1": 0}
    fleiss_input = [
        {"sample_id": sid, "label": label}
        for sid, items in filtered_dict.items()
        for _, label, _ in items
    ]
    return {
        "fleiss_kappa": compute_fleiss_kappa(fleiss_input),
        "alpha_q1": compute_krippendorff_alpha_q1(filtered_dict)
    }


# ── 관리자 페이지 데이터 (6번 기능) ──────────────────────
@app.get("/admin")
def admin_dashboard():
    conn = get_db()
    cursor = conn.cursor()
    annotators = ["A", "B", "C", "D", "E"]
    total = cursor.execute("SELECT COUNT(*) FROM samples").fetchone()[0]

    progress_data = {}
    for a in annotators:
        done = cursor.execute("""
            SELECT COUNT(DISTINCT sample_id)
            FROM annotations WHERE annotator=?
        """, (a,)).fetchone()[0]
        progress_data[a] = {"done": done, "total": total, "percent": round(done / total * 100, 1) if total else 0}

    categories = cursor.execute(
        "SELECT DISTINCT category FROM samples"
    ).fetchall()
    category_data = {}
    for (cat,) in categories:
        cat_total = cursor.execute(
            "SELECT COUNT(*) FROM samples WHERE category=?", (cat,)
        ).fetchone()[0]
        cat_done = {}
        for a in annotators:
            done = cursor.execute("""
                SELECT COUNT(DISTINCT a.sample_id)
                FROM annotations a
                JOIN samples s ON a.sample_id = s.sample_id
                WHERE a.annotator=? AND s.category=?
            """, (a, cat)).fetchone()[0]
            cat_done[a] = done
        category_data[cat] = {"total": cat_total, "by_annotator": cat_done}

    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1 FROM annotations
    """).fetchall()
    conn.close()

    sample_dict = defaultdict(list)
    for sample_id, annotator, label, q1 in rows:
        if label not in ["F", "C", "M"]:
            continue
        sample_dict[sample_id].append((annotator, label, q1))
    filtered_dict = {
        sid: items for sid, items in sample_dict.items()
        if len(set(a for a, _, _ in items)) >= 4
    }
    if filtered_dict:
        fleiss_input = [
            {"sample_id": sid, "label": label}
            for sid, items in filtered_dict.items()
            for _, label, _ in items
        ]
        iaa = {
            "fleiss_kappa": compute_fleiss_kappa(fleiss_input),
            "alpha_q1": compute_krippendorff_alpha_q1(filtered_dict)
        }
    else:
        iaa = {"fleiss_kappa": 0, "alpha_q1": 0}

    return {
        "total_samples": total,
        "progress": progress_data,
        "category_progress": category_data,
        "iaa": iaa
    }


# ── 데이터 export ─────────────────────────────────────────
@app.get("/annotations")
def get_all_annotations():
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1
        FROM annotations ORDER BY sample_id, annotator
    """).fetchall()
    conn.close()
    return [
        {"sample_id": r[0], "annotator": r[1],
         "final_label": r[2], "q1": r[3]}
        for r in rows
    ]


@app.get("/export/json")
def export_json():
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1
        FROM annotations ORDER BY sample_id, annotator
    """).fetchall()
    conn.close()
    data = [
        {"sample_id": r[0], "annotator": r[1],
         "final_label": r[2], "q1": r[3]}
        for r in rows
    ]
    output = io.StringIO()
    json.dump(data, output, ensure_ascii=False, indent=2)
    output.seek(0)
    return StreamingResponse(
        output, media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=annotations.json"}
    )


@app.get("/export/csv")
def export_csv():
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1
        FROM annotations ORDER BY sample_id, annotator
    """).fetchall()
    conn.close()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["sample_id", "annotator", "final_label", "q1"])
    writer.writerows(rows)
    output.seek(0)
    return StreamingResponse(
        output, media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=annotations.csv"}
    )
