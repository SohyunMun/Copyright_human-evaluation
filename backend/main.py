from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from iaa import compute_fleiss_kappa
from database import init_db, get_db
import os
import json
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
        ORDER BY sample_id
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


@app.get("/sample")
def get_sample():
    if len(samples) == 0:
        return {"error": "no samples"}

    return {
        **samples[current_idx],
        "current_index": current_idx + 1,
        "total": len(samples)
    }


# 순환 제거
@app.get("/next")
def next_sample():
    global current_idx

    if current_idx < len(samples) - 1:
        current_idx += 1

    return {
        **samples[current_idx],
        "current_index": current_idx + 1,
        "total": len(samples)
    }


@app.get("/prev")
def prev_sample():
    global current_idx

    if current_idx > 0:
        current_idx -= 1

    return {
        **samples[current_idx],
        "current_index": current_idx + 1,
        "total": len(samples)
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
        # insert
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

    # DB 저장
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

    with open(file_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

    return {"status": "saved"}

# submit한 데이터 가져오기 
@app.get("/annotation/{sample_id}/{annotator}")
def get_annotation(sample_id: str, annotator: str):
    conn = get_db()
    cursor = conn.cursor()

    row = cursor.execute("""
        SELECT q1, final_label
        FROM annotations
        WHERE sample_id=? AND annotator=?
    """, (sample_id, annotator)).fetchone()

    conn.close()

    if row:
        return {
            "q1": row[0],
            "final_label": row[1]
        }

    return {"q1": None, "final_label": None}

@app.get("/progress")
def progress():
    conn = get_db()
    cursor = conn.cursor()

    total_samples = len(samples)

    done = cursor.execute("""
        SELECT COUNT(DISTINCT sample_id)
        FROM annotations
    """).fetchone()[0]

    conn.close()

    return {"done": done, "total": total_samples}


@app.get("/iaa")
def get_iaa():
    conn = get_db()
    cursor = conn.cursor()

    rows = cursor.execute("""
        SELECT sample_id, annotator, final_label
        FROM annotations
    """).fetchall()

    conn.close()

    sample_dict = defaultdict(list)

    for sample_id, annotator, label in rows:
        if label not in ["F", "C", "M"]:
            continue
        sample_dict[sample_id].append((annotator, label))

    filtered = []

    for sample_id, items in sample_dict.items():
        annotators = set([a for a, _ in items])
        
        # 3명 모두 평가한 경우에만 계산
        if len(annotators) == 3:
            for _, label in items:
                filtered.append({
                    "sample_id": sample_id,
                    "label": label
                })

    if len(filtered) == 0:
        return {"kappa": 0}

    try:
        kappa = compute_fleiss_kappa(filtered)
        
        # Nan / inf 방지
        if math.isnan(kappa) or math.isinf(kappa):
            return {"kappa": 0}
        
    except Exception as e:
        print("IAA 오류:", e)
        return {"kappa": 0}

    return {"kappa": kappa}