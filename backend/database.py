import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "evaluation.db")

print("DB PATH:", DB_PATH)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS samples (
        sample_id TEXT PRIMARY KEY,
        article_id TEXT,
        category TEXT,
        previous TEXT,
        target TEXT,
        next TEXT,
        predicted TEXT
    )
    """)

    # annotations 테이블
    # (sample_id, annotator, round) 복합 UNIQUE 제약으로 중복 방지
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sample_id TEXT NOT NULL,
        annotator TEXT NOT NULL,
        final_label TEXT,
        q1 INTEGER,
        round INTEGER DEFAULT 1,
        UNIQUE(sample_id, annotator, round)
    )
    """)

    conn.commit()
    conn.close()
