import pandas as pd
import requests
import argparse
import math
import sys

BASE_URL = "https://copyrighthuman-evaluation-production-df30.up.railway.app"

def safe_q1(val):
    if pd.isna(val):
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None

def load_csv(path):
    df = pd.read_csv(path)
    print(f"  컬럼: {list(df.columns)}")
    print(f"  원본 행 수: {len(df)}")
    
    df["q1"] = pd.to_numeric(df["q1"], errors="coerce")
    
    before = len(df)
    # sample_id나 annotator가 없는 잘못된 행 제거
    df = df.dropna(subset=["sample_id", "annotator"])
    after = len(df)
    
    if before != after:
        print(f"  → 필수 값 누락으로 유효하지 않은 행 {before - after}개 제거")
    return df

def restore_via_submit(df):
    """일반 행: /submit (is_correct 사용), 제외 행(q1=null): /exclude"""
    normal_df = df[df["q1"].notna()]
    excluded_df = df[df["q1"].isna()]

    success, fail = 0, 0
    total = len(normal_df)

    # 일반 행 복원 (개별 API 호출)
    for i, (_, row) in enumerate(normal_df.iterrows()):
        q1 = safe_q1(row["q1"])
        label = row.get("final_label")
        if pd.isna(label):
            label = None
            
        # 프론트엔드/백엔드 로직에 맞춘 유효성 검사 및 변환
        if q1 == 1:
            is_correct = True
            label = None  # O(맞음)일 경우 final_label은 없어야 함
        elif q1 == 0:
            is_correct = False
            if label not in ("F", "C", "M"):
                fail += 1
                print(f"  ❌ 건너뜀: {row['sample_id']} - X(비동의)일 경우 라벨(F,C,M) 필수")
                continue
        else:
            fail += 1
            print(f"  ❌ 건너뜀: {row['sample_id']} - 알 수 없는 q1 값 ({q1})")
            continue

        payload = {
            "sample_id": str(row["sample_id"]),
            "annotator": str(row["annotator"]),
            "is_correct": is_correct,
            "final_label": label,
            "round": 1,
        }
        
        try:
            res = requests.post(f"{BASE_URL}/submit", json=payload, timeout=10)
            result = res.json()
            if result.get("status") == "saved":
                success += 1
            else:
                fail += 1
                print(f"  ❌ 실패: {payload['sample_id']} - {result}")
        except Exception as e:
            fail += 1
            print(f"  ❌ 에러: {payload['sample_id']} - {e}")

        if (i + 1) % 100 == 0 or (i + 1) == total:
            pct = round((i + 1) / total * 100)
            print(f"  [일반 {pct}%] {i + 1}/{total} (성공: {success}, 실패: {fail})")

    # 제외 행 복원 (개별 API 호출)
    ex_success, ex_fail = 0, 0
    for _, row in excluded_df.iterrows():
        try:
            res = requests.post(f"{BASE_URL}/exclude", json={
                "sample_id": str(row["sample_id"]),
                "annotator": str(row["annotator"]),
            }, timeout=10)
            result = res.json()
            if result.get("status") == "excluded":
                ex_success += 1
            else:
                ex_fail += 1
                print(f"  ❌ 제외 실패: {row['sample_id']} - {result}")
        except Exception as e:
            ex_fail += 1
            print(f"  ❌ 제외 에러: {row['sample_id']} - {e}")

    print(f"\n  🚫 제외 처리: 성공 {ex_success}개 / 실패 {ex_fail}개")
    return success, fail


def restore_via_batch(df):
    """/restore로 일반 행 배치 복원 (q1 사용) + /exclude로 제외 행 개별 복원"""
    normal_df = df[df["q1"].notna()]
    excluded_df = df[df["q1"].isna()]

    # 일반 행 배치 데이터 구성
    data = []
    for _, row in normal_df.iterrows():
        q1 = safe_q1(row["q1"])
        label = row.get("final_label")
        if pd.isna(label):
            label = None

        if q1 == 1:
            label = None
        elif q1 == 0:
            if label not in ("F", "C", "M"):
                print(f"  ❌ 데이터 누락: {row['sample_id']} - X(비동의)일 경우 라벨(F,C,M) 필수")
                continue
        else:
            continue

        data.append({
            "sample_id": str(row["sample_id"]),
            "annotator": str(row["annotator"]),
            "final_label": label,
            "q1": q1,
        })

    print(f"  📤 일반 행 {len(data)}개 /restore API로 전송 중...")
    success, fail = 0, 0
    if data:
        try:
            res = requests.post(f"{BASE_URL}/restore", json={"data": data}, timeout=120)
            result = res.json()
            if result.get("status") == "restored":
                success = result.get("count", 0)
                # 요청 개수와 응답 카운트가 다르면 나머지는 실패로 간주
                fail = len(data) - success
            else:
                print(f"  ❌ 배치 복원 실패: {result}")
                fail = len(data)
        except Exception as e:
            print(f"  ❌ 배치 복원 에러: {e}")
            fail = len(data)

    # 제외 행 복원 (/exclude 개별 호출)
    ex_success, ex_fail = 0, 0
    if not excluded_df.empty:
        print(f"  🚫 제외 행 {len(excluded_df)}개 /exclude API로 처리 중...")
        for _, row in excluded_df.iterrows():
            try:
                res = requests.post(f"{BASE_URL}/exclude", json={
                    "sample_id": str(row["sample_id"]),
                    "annotator": str(row["annotator"]),
                }, timeout=10)
                result = res.json()
                if result.get("status") == "excluded":
                    ex_success += 1
                else:
                    ex_fail += 1
                    print(f"  ❌ 제외 실패: {row['sample_id']} - {result}")
            except Exception as e:
                ex_fail += 1
                print(f"  ❌ 제외 에러: {row['sample_id']} - {e}")

    print(f"  🚫 제외 처리: 성공 {ex_success}개 / 실패 {ex_fail}개")
    return success, fail


def main():
    parser = argparse.ArgumentParser(description="어노테이션 CSV 데이터 서버 복원 스크립트")
    parser.add_argument("-f", "--file", default="annotations.csv", help="CSV 파일 경로 (기본값: annotations.csv)")
    parser.add_argument("--batch", action="store_true", help="/restore API를 이용한 배치 복원 활성화 (빠름)")
    args = parser.parse_args()

    print(f"\n📂 파일: {args.file}")
    try:
        df = load_csv(args.file)
    except FileNotFoundError:
        print(f"❌ 파일을 찾을 수 없습니다: {args.file}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ CSV 로드 실패: {e}")
        sys.exit(1)

    normal_df = df[df["q1"].notna()]
    excluded_df = df[df["q1"].isna()]
    annotators = sorted(df["annotator"].unique())

    print(f"\n📊 데이터 요약")
    print(f"  전체: {len(df)}행")
    print(f"  일반 제출(O/X) 행: {len(normal_df)}개  |  제외(Exclude) 행: {len(excluded_df)}개")
    print(f"  작업자(Annotator): {', '.join(annotators)}")
    print(f"  고유 샘플 수: {df['sample_id'].nunique()}개")

    if "final_label" in df.columns:
        label_dist = normal_df["final_label"].dropna().value_counts()
        print(f"  라벨 분포: {dict(label_dist)}")

    proceed = input(f"\n🔄 복원을 진행할까요? (y/n): ").strip().lower()
    if proceed != "y":
        print("취소되었습니다.")
        return

    method = "배치 /restore + 개별 /exclude" if args.batch else "개별 /submit + 개별 /exclude"
    print(f"\n🔄 복원 시작 ({method})...\n")

    if args.batch:
        success, fail = restore_via_batch(df)
    else:
        success, fail = restore_via_submit(df)

    print(f"\n{'='*40}")
    print(f"✅ 완료: 일반 복원 성공 {success}개 / 실패 {fail}개")
    if fail > 0:
        print("⚠️ 실패 항목은 터미널 로그를 확인하세요.")


if __name__ == "__main__":
    main()
