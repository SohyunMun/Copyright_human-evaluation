from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse   # 추가
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
current_idx = 0


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


def load_annotation(sample_id: str, annotator: str):
    """주어진 sample_id, annotator 기준 annotation 가져오기"""
    if not annotator:
        return {"q1": None, "final_label": None}

    conn = get_db()
    cursor = conn.cursor()
    row = cursor.execute("""
        SELECT q1, final_label
        FROM annotations
        WHERE sample_id=? AND annotator=?
    """, (sample_id, annotator)).fetchone()
    conn.close()

    if row:
        return {"q1": row[0], "final_label": row[1]}
    else:
        return {"q1": None, "final_label": None}


@app.get("/sample")
def get_sample(annotator: str = None, category: str = None):
    global current_idx
    
    # category 바뀌면 index 초기화
    current_idx = 0

    # category 필터링
    filtered = samples
    if category and category != "ALL":
        filtered = [s for s in samples if s["category"] == category]

    if len(filtered) == 0:
        return {"error": "no samples"}

    sample = filtered[current_idx % len(filtered)]

    result = {
        **sample,
        "current_index": (current_idx % len(filtered)) + 1,
        "total": len(filtered)
    }

    return result


@app.get("/next")
def next_sample(annotator: str = None, category: str = None):
    global current_idx

    filtered = samples
    if category and category != "ALL":
        filtered = [s for s in samples if s["category"] == category]

    if len(filtered) == 0:
        return {"error": "no samples"}

    current_idx = (current_idx + 1) % len(filtered)

    sample = filtered[current_idx]

    return {
        **sample,
        "current_index": current_idx + 1,
        "total": len(filtered)
    }


@app.get("/prev")
def prev_sample(annotator: str = None, category: str = None):
    global current_idx

    filtered = samples
    if category and category != "ALL":
        filtered = [s for s in samples if s["category"] == category]

    if current_idx > 0:
        current_idx -= 1

    sample = filtered[current_idx]

    return {
        **sample,
        "current_index": current_idx + 1,
        "total": len(filtered)
    }


@app.post("/submit")
def submit(data: dict):
    conn = get_db()
    cursor = conn.cursor()

    sample_id = data["sample_id"]
    annotator = data["annotator"]

    # 중복 체크
    exists = cursor.execute("""
        SELECT COUNT(*) FROM annotations
        WHERE sample_id=? AND annotator=?
    """, (sample_id, annotator)).fetchone()[0]

    if exists > 0:
        cursor.execute("""
            UPDATE annotations
            SET final_label=?, q1=?
            WHERE sample_id=? AND annotator=?
        """, (
            data["final_label"],
            data["q1"],
            sample_id,
            annotator
        ))
    else:
        cursor.execute("""
            INSERT INTO annotations
            (sample_id, annotator, final_label, q1)
            VALUES (?, ?, ?, ?)
        """, (
            sample_id,
            annotator,
            data["final_label"],
            data["q1"]
        ))

    conn.commit()
    conn.close()

    # 파일 저장
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

    # 기존 내용 읽기
    existing_records = {}
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    key = rec["annotator"]
                    existing_records[key] = rec
                except:
                    continue

    # 업데이트
    existing_records[annotator] = record

    # 덮어쓰기
    with open(file_path, "w", encoding="utf-8") as f:
        for rec in existing_records.values():
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    return {"status": "saved"}


@app.get("/annotation/{sample_id}/{annotator}")
def get_annotation(sample_id: str, annotator: str):
    return load_annotation(sample_id, annotator)


@app.get("/progress")
def progress(annotator: str = None, category: str = None):
    conn = get_db()
    cursor = conn.cursor()

    # 전체 샘플 수 (카테고리별)
    if category and category != "ALL":
        total = cursor.execute("""
            SELECT COUNT(*)
            FROM samples
            WHERE category=?
        """, (category,)).fetchone()[0]
    else:
        total = cursor.execute("""
            SELECT COUNT(*)
            FROM samples
        """).fetchone()[0]

    # 진행된 샘플 수
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
                FROM annotations
                WHERE annotator=?
            """, (annotator,)).fetchone()[0]
    else:
        done = 0

    conn.close()

    return {"done": done, "total": total}


@app.get("/progress_by_category")
def progress_by_category(annotator: str):
    conn = get_db()
    cursor = conn.cursor()

    categories = cursor.execute("""
        SELECT DISTINCT category FROM samples
    """).fetchall()

    result = {}

    for (cat,) in categories:
        total = cursor.execute("""
            SELECT COUNT(*) FROM samples WHERE category=?
        """, (cat,)).fetchone()[0]

        done = cursor.execute("""
            SELECT COUNT(DISTINCT a.sample_id)
            FROM annotations a
            JOIN samples s ON a.sample_id = s.sample_id
            WHERE a.annotator=? AND s.category=?
        """, (annotator, cat)).fetchone()[0]

        result[cat] = {
            "done": done,
            "total": total
        }

    conn.close()
    return result


@app.get("/progress_detail")
def progress_detail(category: str = "ALL"):
    conn = get_db()
    cursor = conn.cursor()

    # 전체 샘플 수
    if category == "ALL":
        total = cursor.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
    else:
        total = cursor.execute(
            "SELECT COUNT(*) FROM samples WHERE category=?",
            (category,)
        ).fetchone()[0]

    annotators = ["A", "B", "C", "D", "E"]

    result = {}

    for a in annotators:
        if category == "ALL":
            done = cursor.execute("""
                SELECT COUNT(DISTINCT sample_id)
                FROM annotations
                WHERE annotator=?
            """, (a,)).fetchone()[0]
        else:
            done = cursor.execute("""
                SELECT COUNT(DISTINCT a.sample_id)
                FROM annotations a
                JOIN samples s ON a.sample_id = s.sample_id
                WHERE a.annotator=? AND s.category=?
            """, (a, category)).fetchone()[0]

        result[a] = {
            "done": done,
            "total": total
        }

    conn.close()
    return result


@app.get("/iaa")
def get_iaa():
    conn = get_db()
    cursor = conn.cursor()

    # q1까지 가져오기
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1
        FROM annotations
    """).fetchall()
    conn.close()

    sample_dict = defaultdict(list)

    for sample_id, annotator, label, q1 in rows:
        if label not in ["F", "C", "M"]:
            continue
        sample_dict[sample_id].append((annotator, label, q1))

    # 4명 이상의 annotator가 평가한 샘플만 사용
    filtered_dict = {}
    MIN_ANNOTATORS = 4

    for sid, items in sample_dict.items():
        annotators_in_sample = set([a for a, _, _ in items])

        if len(annotators_in_sample) >= MIN_ANNOTATORS:
            filtered_dict[sid] = items

    if len(filtered_dict) == 0:
        return {
            "fleiss_kappa": 0,
            "alpha_q1": 0
        }

    # Fleiss input (label만)
    fleiss_input = []
    for sid, items in filtered_dict.items():
        for _, label, _ in items:
            fleiss_input.append({
                "sample_id": sid,
                "label": label
            })

    return {
        "fleiss_kappa": compute_fleiss_kappa(fleiss_input),
        "alpha_q1": compute_krippendorff_alpha_q1(filtered_dict)
    }

@app.get("/annotations")
def get_all_annotations():
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1
        FROM annotations
        ORDER BY sample_id, annotator
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
        FROM annotations
        ORDER BY sample_id, annotator
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
        output,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=annotations.json"}
    )


@app.get("/export/csv")
def export_csv():
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label, q1
        FROM annotations
        ORDER BY sample_id, annotator
    """).fetchall()
    conn.close()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["sample_id", "annotator", "final_label", "q1"])
    writer.writerows(rows)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=annotations.csv"}
    )

@app.get("/last_index")
def get_last_index(annotator: str, category: str = "ALL"):
    conn = get_db()
    cursor = conn.cursor()
    
    if category == "ALL":
        done = cursor.execute("""
            SELECT COUNT(DISTINCT sample_id)
            FROM annotations
            WHERE annotator=?
        """, (annotator,)).fetchone()[0]
    else:
        done = cursor.execute("""
            SELECT COUNT(DISTINCT a.sample_id)
            FROM annotations a
            JOIN samples s ON a.sample_id = s.sample_id
            WHERE a.annotator=? AND s.category=?
        """, (annotator, category)).fetchone()[0]
    
    conn.close()
    return {"last_index": done}

@app.get("/goto")
def goto_sample(index: int, category: str = "ALL"):
    global current_idx
    
    filtered = samples
    if category and category != "ALL":
        filtered = [s for s in samples if s["category"] == category]
    
    current_idx = min(index, len(filtered) - 1)
    sample = filtered[current_idx]
    
    return {
        **sample,
        "current_index": current_idx + 1,
        "total": len(filtered)
    }
