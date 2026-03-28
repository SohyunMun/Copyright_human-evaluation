from fastapi import FastAPI
from pydantic import BaseModel
import sqlite3

app = FastAPI()

# DB 연결
conn = sqlite3.connect("data.db", check_same_thread=False)
cursor = conn.cursor()

# 테이블 생성
cursor.execute("""
CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id INTEGER,
    annotator TEXT,
    q1 INTEGER,
    q2 INTEGER,
    q3 INTEGER,
    q4_1 INTEGER,
    q4_2 INTEGER,
    final_label TEXT
)
""")

class Evaluation(BaseModel):
    sample_id: int
    annotator: str
    q1: int
    q2: int
    q3: int
    q4_1: int
    q4_2: int
    final_label: str

@app.post("/submit")
def submit_eval(eval: Evaluation):
    cursor.execute("""
    INSERT INTO evaluations 
    (sample_id, annotator, q1, q2, q3, q4_1, q4_2, final_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        eval.sample_id,
        eval.annotator,
        eval.q1,
        eval.q2,
        eval.q3,
        eval.q4_1,
        eval.q4_2,
        eval.final_label
    ))
    conn.commit()
    return {"status": "ok"}