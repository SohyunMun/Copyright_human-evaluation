import json

# 파일 경로
INPUT_PATH = "annotations.json"
OUTPUT_PATH = "filtered_annotations.json"

def is_valid_sample(sample_id):
    try:
        cat, doc, sent = sample_id.split('_')
        doc = int(doc)

        return (
            cat == "경제" and
            1 <= doc <= 27
        )
    except:
        return False

def process():
    with open(INPUT_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    filtered = []

    for item in data:
        # 1️sample_id 필터링
        if not is_valid_sample(item["sample_id"]):
            continue

        # 2️q1 점수 기반 final_label 처리
        if item.get("q1") in [4, 5]:
            item["final_label"] = None

        filtered.append(item)

    print(f"원본 개수: {len(data)}")
    print(f"필터링 후 row 개수: {len(filtered)}")

    # unique sample 개수 확인
    sample_ids = set([x["sample_id"] for x in filtered])
    print(f"unique sample 개수: {len(sample_ids)}")

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(filtered, f, ensure_ascii=False, indent=2)

    print(f"저장 완료 → {OUTPUT_PATH}")

if __name__ == "__main__":
    process()