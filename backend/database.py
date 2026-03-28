import sqlite3

DB_NAME = "evaluation.db"

def get_db():
    conn = sqlite3.connect("evaluation.db")
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
        q1 INTEGER
    )
    """)

    conn.commit()
    conn.close()