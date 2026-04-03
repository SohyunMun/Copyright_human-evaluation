from collections import defaultdict, Counter
import json

ANNOTATION_PATH = "filtered_annotations.json"
RAW_PATH = "backend/sample/경제.json"
OUTPUT_PATH = "final_dataset_ver2.json"

def build_raw_map():
    with open(RAW_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    raw_map = {}
    for article in raw["articles"]:
        for sample in article["samples"]:
            sample_id = sample["sample_id"]
            raw_map[sample_id] = {
                "target_sentence": sample["target_sentence"],
                "prev_sentence": sample.get("prev_sentence", ""),
                "next_sentence": sample.get("next_sentence", ""),
                "llm_label": sample["label"]
            }
    return raw_map

def group_annotations(data):
    grouped = defaultdict(list)
    for item in data:
        grouped[item["sample_id"]].append(item)
    return grouped

def process():
    with open(ANNOTATION_PATH, 'r', encoding='utf-8') as f:
        ann_data = json.load(f)

    raw_map = build_raw_map()
    grouped = group_annotations(ann_data)

    final_data = []

    for sample_id, items in grouped.items():
        # q1 평균 계산
        q1_scores = [x["q1"] for x in items if x["q1"] is not None]
        avg_q1 = sum(q1_scores) / len(q1_scores) if q1_scores else 0

        # label 결정
        if avg_q1 >= 4:
            label = raw_map[sample_id]["llm_label"]
        else:
            # 다수결로 final_label 선택
            labels = [x["final_label"] for x in items if x.get("final_label")]
            if labels:
                label_counts = Counter(labels)
                # 가장 많이 나온 라벨 선택, 동률이면 첫 번째 등장 라벨
                label = label_counts.most_common(1)[0][0]
            else:
                label = None

        # 문장 정보
        raw_info = raw_map[sample_id]

        final_data.append({
            "sample_id": sample_id,
            "target_sentence": raw_info["target_sentence"],
            "label": label,
            "prev_sentence": raw_info["prev_sentence"],
            "next_sentence": raw_info["next_sentence"]
        })

    print("최종 sample 개수:", len(final_data))

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)

    print("저장 완료:", OUTPUT_PATH)

if __name__ == "__main__":
    process()