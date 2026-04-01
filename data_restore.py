import pandas as pd
import requests
import argparse
import math
import sys
import json

BASE_URL = "https://copyrighthuman-evaluation-production-df30.up.railway.app"


def safe_q1(val):
    """q1 값을 int 또는 None으로 안전하게 변환 (NaN, 빈 문자열 대응)"""
    if val is None:
        return None
    if isinstance(val, float) and math.isnan(val):
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def load_csv(path):
    """CSV를 로드하고 round/q1 컬럼을 안전하게 처리"""
    df = pd.read_csv(path)
    print(f"  컬럼: {list(df.columns)}")
    print(f"  원본 행 수: {len(df)}")

    # round 컬럼 없으면 기본값 1
    if "round" not in df.columns:
        df["round"] = 1
        print("  → 'round' 컬럼 없음 → 모든 행을 round=1로 처리")

    df["round"] = df["round"].fillna(1).astype(int)

    # q1: 숫자 변환 후 NaN → None
    df["q1"] = pd.to_numeric(df["q1"], errors="coerce")

    # 빈 label/id 행 제거
    before = len(df)
    df = df.dropna(subset=["sample_id", "annotator", "final_label"])
    df = df[df["final_label"].isin(["F", "C", "M", "Unsure"])]
    after = len(df)
    if before != after:
        print(f"  → 유효하지 않은 행 {before - after}개 제거")

    return df


def row_to_payload(row):
    """DataFrame row를 JSON-safe dict로 변환"""
    return {
        "sample_id": str(row["sample_id"]),
        "annotator": str(row["annotator"]),
        "final_label": str(row["final_label"]),
        "q1": safe_q1(row["q1"]),
        "round": int(row["round"]),
    }


def restore_via_submit(df):
    """개별 /submit API — 느리지만 에러 추적 용이"""
    success = 0
    fail = 0
    total = len(df)

    for i, (_, row) in enumerate(df.iterrows()):
        payload = row_to_payload(row)
        try:
            res = requests.post(f"{BASE_URL}/submit", json=payload, timeout=10)
            result = res.json()
            if result.get("status") == "saved":
                success += 1
            else:
                fail += 1
                print(f"  ❌ {payload['sample_id']} R{payload['round']} - {result}")
        except Exception as e:
            fail += 1
            print(f"  ❌ {payload['sample_id']} - {e}")

        if (i + 1) % 100 == 0 or (i + 1) == total:
            pct = round((i + 1) / total * 100)
            print(f"  [{pct}%] {i + 1}/{total} (성공: {success}, 실패: {fail})")

    return success, fail


def restore_via_batch(df):
    """/restore API — 배치 전송, 빠름"""
    data = [row_to_payload(row) for _, row in df.iterrows()]
    print(f"  📤 {len(data)}개 행을 /restore API로 전송 중...")
    try:
        res = requests.post(
            f"{BASE_URL}/restore",
            json={"data": data},
            timeout=120,
        )
        result = res.json()
        if result.get("status") == "restored":
            return result.get("count", 0), 0
        else:
            print(f"  ❌ 복원 실패: {result}")
            return 0, len(data)
    except Exception as e:
        print(f"  ❌ 에러: {e}")
        return 0, len(data)


def main():
    parser = argparse.ArgumentParser(description="어노테이션 CSV 복원")
    parser.add_argument("-f", "--file", default="annotations.csv", help="CSV 파일 경로")
    parser.add_argument("--batch", action="store_true", help="/restore API 배치 사용 (빠름)")
    args = parser.parse_args()

    print(f"\n📂 파일: {args.file}")
    try:
        df = load_csv(args.file)
    except FileNotFoundError:
        print(f"❌ 파일을 찾을 수 없습니다: {args.file}"); sys.exit(1)
    except Exception as e:
        print(f"❌ CSV 로드 실패: {e}"); sys.exit(1)

    # 요약
    r1 = df[df["round"] == 1]
    r2 = df[df["round"] == 2]
    annotators = sorted(df["annotator"].unique())

    print(f"\n📊 데이터 요약")
    print(f"  전체: {len(df)}행")
    print(f"  Round 1: {len(r1)}행  |  Round 2: {len(r2)}행")
    print(f"  Annotators: {', '.join(annotators)}")
    print(f"  샘플 수: {df['sample_id'].nunique()}개")
    if len(r2) > 0:
        r2_q1_null = r2["q1"].isna().sum()
        print(f"  Round 2 중 q1=null: {r2_q1_null}개 (정상)")

    label_dist = df["final_label"].value_counts()
    print(f"  라벨 분포: {dict(label_dist)}")

    proceed = input(f"\n🔄 복원을 진행할까요? (y/n): ").strip().lower()
    if proceed != "y":
        print("취소됨."); return

    method = "배치 /restore" if args.batch else "개별 /submit"
    print(f"\n🔄 복원 시작 ({method})...\n")

    if args.batch:
        success, fail = restore_via_batch(df)
    else:
        success, fail = restore_via_submit(df)

    print(f"\n{'='*40}")
    print(f"✅ 완료: 성공 {success}개 / 실패 {fail}개")
    if fail > 0:
        print("⚠️  실패 항목은 위 로그를 확인하세요.")
    print()


if __name__ == "__main__":
    main()
