import sqlite3

DB_NAME = "evaluation.db"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sample_id TEXT,
        annotator TEXT,
        final_label TEXT,
        q1 INTEGER,
        q2 INTEGER,
        q3 INTEGER
    )
    """)

    conn.commit()
    conn.close()