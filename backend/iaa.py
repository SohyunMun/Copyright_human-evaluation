import numpy as np
from collections import defaultdict
import krippendorff


# ─────────────────────────────────────────────
#  Fleiss' Kappa  (categorical: F / C / M)
# ─────────────────────────────────────────────
def compute_fleiss_kappa(data):
    """
    data: list of {"sample_id": ..., "label": "F"|"C"|"M"}
    동일 sample_id 에 대해 여러 어노테이터의 라벨이 들어옴.
    """
    label_map = {"F": 0, "C": 1, "M": 2}
    k = 3  # number of categories
    sample_dict = defaultdict(lambda: [0] * k)

    for d in data:
        s = d["sample_id"]
        l_idx = label_map.get(d["label"])
        if l_idx is None:
            continue
        sample_dict[s][l_idx] += 1

    M = np.array(list(sample_dict.values()))
    if len(M) == 0:
        return 0.0

    n = np.max(np.sum(M, axis=1))  # raters per sample
    if n < 2:
        return 0.0

    N = len(M)
    denominator = n * (n - 1)
    if denominator == 0:
        return 0.0

    P = (np.sum(M * M, axis=1) - n) / denominator
    P_bar = np.mean(P)
    p = np.sum(M, axis=0) / (N * n)
    P_e = np.sum(p * p)

    if P_e >= 1.0:
        return 1.0

    kappa = (P_bar - P_e) / (1 - P_e)
    if np.isnan(kappa) or np.isinf(kappa):
        return 0.0
    return float(kappa)


# ─────────────────────────────────────────────
#  Krippendorff Alpha  (ordinal: q1 scores 1-5)
# ─────────────────────────────────────────────
def compute_krippendorff_alpha_q1(sample_dict):
    """
    sample_dict: {sample_id: [(annotator, label, q1), ...]}
    q1 은 1-5 ordinal scale.
    """
    annotators = sorted(list(set(
        a for items in sample_dict.values()
        for a, _, _ in items
    )))

    if len(annotators) < 2:
        return 0.0

    matrix = []
    for sample_id, items in sample_dict.items():
        ann_dict = {a: q1 for a, _, q1 in items if q1 is not None}
        if len(ann_dict) < 2:
            continue
        row = [ann_dict.get(a, np.nan) for a in annotators]
        matrix.append(row)

    if len(matrix) < 2:
        return 0.0

    # krippendorff expects shape (raters, items)
    matrix = np.array(matrix, dtype=float).T

    # 모든 값이 동일하면 완전 일치
    valid = matrix[~np.isnan(matrix)]
    if len(valid) == 0:
        return 0.0
    if np.nanvar(valid) == 0:
        return 1.0

    try:
        alpha = krippendorff.alpha(matrix, level_of_measurement='ordinal')
        if np.isnan(alpha) or np.isinf(alpha):
            return 1.0
        return float(alpha)
    except Exception:
        return 0.0


# ─────────────────────────────────────────────
#  ICC(2,1): Two-way mixed, absolute agreement
# ─────────────────────────────────────────────
def compute_icc(sample_dict, min_raters=3):
    """
    ICC(2,1): Two-way mixed effects, absolute agreement, single measurement.
    sample_dict: {sample_id: [(annotator, label, q1), ...]}
    min_raters: 샘플당 최소 필요 평가자 수 (기본 3)

    * 누락 값은 행 평균으로 대체(impute)하여 계산합니다.
    * 최소 2개 이상의 유효 샘플, 2명 이상의 평가자가 필요합니다.
    """
    annotators = sorted(set(
        a for items in sample_dict.values() for a, _, _ in items
    ))
    if len(annotators) < min_raters:
        return 0.0

    # 유효 샘플: min_raters 이상의 q1 값이 있는 것만
    valid_samples = []
    for items in sample_dict.values():
        ann_dict = {a: q1 for a, _, q1 in items if q1 is not None}
        if len(ann_dict) >= min_raters:
            valid_samples.append(ann_dict)

    n = len(valid_samples)
    if n < 2:
        return 0.0

    k = len(annotators)

    # n × k 행렬 (누락: NaN)
    matrix = np.array(
        [[d.get(a, np.nan) for a in annotators] for d in valid_samples],
        dtype=float,
    )

    # 전체가 NaN인 열 제거
    col_valid = ~np.all(np.isnan(matrix), axis=0)
    matrix = matrix[:, col_valid]
    k = matrix.shape[1]
    if k < 2:
        return 0.0

    # 누락 값 → 행 평균으로 대체
    row_means = np.nanmean(matrix, axis=1, keepdims=True)
    matrix = np.where(np.isnan(matrix), row_means, matrix)

    grand_mean = np.mean(matrix)
    row_means_flat = np.mean(matrix, axis=1)
    col_means = np.mean(matrix, axis=0)

    SS_r = k * np.sum((row_means_flat - grand_mean) ** 2)
    SS_c = n * np.sum((col_means - grand_mean) ** 2)
    SS_total = np.sum((matrix - grand_mean) ** 2)
    SS_e = SS_total - SS_r - SS_c

    df_r = n - 1
    df_c = k - 1
    df_e = df_r * df_c

    if df_r == 0 or df_e == 0:
        return 1.0

    MS_r = SS_r / df_r
    MS_c = SS_c / df_c if df_c > 0 else 0.0
    MS_e = SS_e / df_e if df_e > 0 else 0.0

    denom = MS_r + (k - 1) * MS_e + k * (MS_c - MS_e) / n
    if denom == 0:
        return 0.0

    icc = (MS_r - MS_e) / denom
    return float(np.clip(icc, -1.0, 1.0))
