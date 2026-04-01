import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "evaluation.db")

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
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sample_id TEXT,
        annotator TEXT,
        final_label TEXT,
        q1 INTEGER,
        round INTEGER DEFAULT 1,
        PRIMARY KEY (sample_id, annotator, round)
    )
    """)
    conn.commit()
    conn.close()
