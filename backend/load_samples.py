import json
from database import get_db, init_db
import os

DB_PATH = "evaluation.db"

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)
    print("🗑️ 기존 DB 삭제 완료")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SAMPLE_DIR = os.path.join(BASE_DIR, "sample", "en")


def load_all_samples():
    init_db()

    conn = get_db()
    cursor = conn.cursor()

    total_count = 0

    # 하위 폴더까지 모두 탐색
    for root, dirs, files in os.walk(SAMPLE_DIR):
        for filename in files:
            if not filename.endswith(".json"):
                continue

            file_path = os.path.join(root, filename)

            # 폴더 기반 category 설정
            # ex) sample/en/xxx.json → category = en
            category = os.path.basename(root)

            print(f"📂 {category} 로딩 중... ({filename})")

            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            # 안전 처리 (구조 다를 경우 대비)
            if "articles" not in data:
                print(f"❌ articles 키 없음: {filename}")
                continue

            articles = data["articles"]

            count = 0

            for article in articles:
                article_id = article.get("article")

                for sample in article.get("samples", []):
                    cursor.execute("""
                        INSERT OR IGNORE INTO samples
                        (sample_id, article_id, category, previous, target, next, predicted)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        sample.get("sample_id"),
                        article_id,
                        category,
                        sample.get("prev_sentence"),
                        sample.get("target_sentence"),
                        sample.get("next_sentence"),
                        sample.get("label")
                    ))

                    count += 1
                    total_count += 1

            print(f"   → {count}개 저장 완료")

    conn.commit()
    conn.close()

    print(f"\n✅ 전체 {total_count}개 샘플 DB 저장 완료!")


if __name__ == "__main__":
    load_all_samples()