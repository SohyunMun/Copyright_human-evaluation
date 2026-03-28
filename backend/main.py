from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from iaa import compute_fleiss_kappa
from database import init_db, get_db

app = FastAPI()

# CORS (프론트 연결 필수)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 테스트용 샘플들
samples = [
    {
        "sample_id": "ART_0001",
        "article_id": "ART",
        "previous": "이 정책은 경제 성장에 도움이 될 것으로 보인다.",
        "target": "하지만 실제 효과는 제한적일 수 있다는 비판도 존재한다.",
        "next": "전문가들은 추가적인 보완이 필요하다고 말한다.",
        "predicted": "M"
    },
    {
        "sample_id": "ART_0002",
        "article_id": "ART",
        "previous": "정부는 새로운 정책을 발표했다.",
        "target": "이 정책은 많은 논란을 일으키고 있다.",
        "next": "국민들의 반응은 엇갈리고 있다.",
        "predicted": "C"
    }
]

current_idx = 0

@app.on_event("startup")
def startup():
    init_db()

@app.get("/sample")
def get_sample():
    return {
        **samples[current_idx],
        "current_index": current_idx + 1,
        "total": len(samples)
    }

@app.get("/next")
def next_sample():
    global current_idx
    current_idx = (current_idx + 1) % len(samples)

    return {
        **samples[current_idx],
        "current_index": current_idx + 1,
        "total": len(samples)
    }

@app.get("/prev")
def prev_sample():
    global current_idx
    current_idx = (current_idx - 1) % len(samples)

    return {
        **samples[current_idx],
        "current_index": current_idx + 1,
        "total": len(samples)
    }


@app.post("/submit")
def submit(data: dict):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    INSERT INTO annotations
    (sample_id, annotator, final_label, q1)
    VALUES (?, ?, ?, ?)
    """, (
    data["sample_id"],
    data["annotator"],
    data["final_label"],
    data["q1"]
))

    conn.commit()
    conn.close()

    return {"status": "saved"}


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
        SELECT sample_id, final_label
        FROM annotations
    """).fetchall()

    conn.close()

    data = [
        {"sample_id": r[0], "label": r[1]}
        for r in rows
    ]

    if len(data) == 0:
        return {"kappa": 0}

    kappa = compute_fleiss_kappa(data)

    return {"kappa": kappa}