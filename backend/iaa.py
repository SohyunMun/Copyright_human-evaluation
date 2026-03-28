import numpy as np
from collections import defaultdict

def compute_fleiss_kappa(data):
    """
    data: list of dict
    [{"sample_id":1, "label":"F"}, ...]
    """

    label_map = {"F":0, "C":1, "M":2}
    k = 3  # label 개수

    # sample별 count
    sample_dict = defaultdict(lambda: [0]*k)

    for d in data:
        s = d["sample_id"]
        l = label_map[d["label"]]
        sample_dict[s][l] += 1

    M = np.array(list(sample_dict.values()))  # (N, k)

    n = np.sum(M[0])  # annotator 수
    N = len(M)

    # P_i
    P = (np.sum(M*M, axis=1) - n) / (n*(n-1))

    # P_bar
    P_bar = np.mean(P)

    # p_j
    p = np.sum(M, axis=0) / (N*n)

    # P_e
    P_e = np.sum(p*p)

    # kappa
    kappa = (P_bar - P_e) / (1 - P_e)

    return float(kappa)