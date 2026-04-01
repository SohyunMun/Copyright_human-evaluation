import numpy as np
from collections import defaultdict
import krippendorff


# Fleiss' Kappa (label)
def compute_fleiss_kappa(data):
    label_map = {"F": 0, "C": 1, "M": 2}
    k = 3
    sample_dict = defaultdict(lambda: [0] * k)
    for d in data:
        s = d["sample_id"]
        l = label_map[d["label"]]
        sample_dict[s][l] += 1
    M = np.array(list(sample_dict.values()))
    if len(M) == 0:
        return 0
    n = np.max(np.sum(M, axis=1))
    if n < 2:
        return 0
    N = len(M)
    denominator = n * (n - 1)
    if denominator == 0:
        return 0
    P = (np.sum(M * M, axis=1) - n) / denominator
    P_bar = np.mean(P)
    p = np.sum(M, axis=0) / (N * n)
    P_e = np.sum(p * p)
    kappa = (P_bar - P_e) / (1 - P_e)
    if np.isnan(kappa) or np.isinf(kappa):
        return 0
    return float(kappa)


# Krippendorff Alpha (q1, ordinal)
def compute_krippendorff_alpha_q1(sample_dict):
    annotators = sorted(list(set(
        a for items in sample_dict.values()
        for a, _, _ in items
    )))
    matrix = []
    for sample_id, items in sample_dict.items():
        ann_dict = {a: q1 for a, _, q1 in items}
        row = [ann_dict.get(a, None) for a in annotators]
        matrix.append(row)
    if len(matrix) == 0:
        return 0
    matrix = np.array(matrix).T
    if np.nanvar(matrix) == 0:
        return 1.0
    try:
        alpha = krippendorff.alpha(matrix, level_of_measurement='ordinal')
        if np.isnan(alpha) or np.isinf(alpha):
            return 1.0
        return float(alpha)
    except Exception:
        return 0


def compute_icc(sample_dict, min_raters=3):
    """
    ICC(2,1): Two-way mixed effects, absolute agreement, single measurement.
    Based on q1 scores from round-1 annotations.
    - sample_dict: {sample_id: [(annotator, label, q1), ...]}
    - min_raters: minimum number of raters required per sample (default 3)
    Missing values are imputed with the sample's row mean before computation.
    """
    annotators = sorted(set(
        a for items in sample_dict.values() for a, _, _ in items
    ))
    if len(annotators) < min_raters:
        return 0.0

    # Only include samples with at least min_raters valid q1 scores
    valid_samples = []
    for items in sample_dict.values():
        ann_dict = {a: q1 for a, _, q1 in items if q1 is not None}
        if len(ann_dict) >= min_raters:
            valid_samples.append(ann_dict)

    n = len(valid_samples)
    if n < 2:
        return 0.0

    k = len(annotators)

    # Build n x k matrix with NaN for missing
    matrix = np.array(
        [[d.get(a, np.nan) for a in annotators] for d in valid_samples],
        dtype=float
    )

    # Remove annotator columns that are entirely NaN
    col_valid = ~np.all(np.isnan(matrix), axis=0)
    matrix = matrix[:, col_valid]
    k = matrix.shape[1]

    if k < 2:
        return 0.0

    # Impute missing values with row mean
    row_means_imp = np.nanmean(matrix, axis=1, keepdims=True)
    matrix = np.where(np.isnan(matrix), row_means_imp, matrix)

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

    # ICC(2,1) formula: (MSr - MSe) / (MSr + (k-1)*MSe + k*(MSc-MSe)/n)
    denom = MS_r + (k - 1) * MS_e + k * (MS_c - MS_e) / n
    if denom == 0:
        return 0.0

    icc = (MS_r - MS_e) / denom
    return float(np.clip(icc, -1.0, 1.0))
