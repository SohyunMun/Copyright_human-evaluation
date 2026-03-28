import json
from database import get_db, init_db
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

file_path = os.path.join(
    BASE_DIR,
    "sample",
    "TS_annotation_local_batch5_results_0828.json"
)

def load_samples(json_path):
    init_db()

    conn = get_db()
    cursor = conn.cursor()

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    documents = data["documents"]

    count = 0

    for doc_idx, doc in enumerate(documents, start=1):
        category = doc.get("topic", "UNK")

        article_index = f"{doc_idx:03d}"
        article_id = f"{category}_{article_index}"

        for sent_idx, sample in enumerate(doc["samples"], start=1):
            sentence_index = f"{sent_idx:03d}"

            safe_category = category.replace("/", "_")

            sample_id = f"{safe_category}_{doc_idx:03d}_{sent_idx:03d}"

            cursor.execute("""
                INSERT OR IGNORE INTO samples
                (sample_id, article_id, category, previous, target, next, predicted)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                sample_id,
                article_id,
                category,
                sample.get("prev_sentence"),
                sample.get("target_sentence"),
                sample.get("next_sentence"),
                sample.get("label")
            ))

            count += 1

    conn.commit()
    conn.close()

    print(f"✅ {count}개 샘플 DB 저장 완료!")


load_samples(file_path)