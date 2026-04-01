import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import "./App.css";

const BASE_URL = "https://copyrighthuman-evaluation-production-df30.up.railway.app";
const ANNOTATORS = ["A", "B", "C", "D", "E"];
const CATEGORIES = ["ALL","경제","정치","사회","문화","국제","IT과학","스포츠","교육","라이프스타일","지역"];

const STATUS_LABELS = {
  confirmed:              { text: "✅ 최종 확정",           color: "#22c55e" },
  confirmed_relabeled:    { text: "✅ 재라벨링 후 확정",    color: "#22c55e" },
  needs_relabeling:       { text: "⚠️ 재라벨링 필요",      color: "#f59e0b" },
  relabeling_in_progress: { text: "🔄 재라벨링 진행 중",   color: "#f59e0b" },
  disagreement:           { text: "❌ Disagreement",        color: "#ef4444" },
  in_progress:            { text: "⬜ 진행 중",             color: "#94a3b8" },
};

// ─── Guideline Panel ───────────────────────────────────────────────────────────
function GuidelinePanel() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState("summary");

  const sections = {
    labels: {
      title: "라벨 기준 (F / C / M)",
      content: (
        <div style={{ lineHeight: 1.8 }}>
          <div style={{ marginBottom: 14, padding: "10px 14px", background: "#1e3a5f", borderRadius: 8, borderLeft: "4px solid #2563eb" }}>
            <div style={{ fontWeight: 700, color: "#60a5fa", marginBottom: 4 }}>F (Factual / Safe) — 낮은 위험</div>
            <div style={{ fontSize: 13 }}>의미를 유지한 채 <strong>자유롭게 재표현</strong> 가능한 문장. 표현이 아닌 정보가 핵심이며, 다양한 방식으로 재작성 가능합니다.</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>→ 그대로 사용 가능</div>
          </div>
          <div style={{ marginBottom: 14, padding: "10px 14px", background: "#3b1f1f", borderRadius: 8, borderLeft: "4px solid #ef4444" }}>
            <div style={{ fontWeight: 700, color: "#f87171", marginBottom: 4 }}>C (Creative / Expressive / Risky) — 높은 위험</div>
            <div style={{ fontSize: 13 }}>표현 자체가 의미 전달의 핵심인 문장. 의견, 평가, 감정, 해석, 예측 등 사람의 생각이나 판단이 들어간 표현. 그대로 생성 시 저작권 위험.</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>→ 반드시 재작성 필요</div>
          </div>
          <div style={{ padding: "10px 14px", background: "#2d2414", borderRadius: 8, borderLeft: "4px solid #f59e0b" }}>
            <div style={{ fontWeight: 700, color: "#fbbf24", marginBottom: 4 }}>M (Mixed) — 부분 위험</div>
            <div style={{ fontSize: 13 }}>사실 정보와 표현 요소가 함께 존재하는 문장. 사실을 설명하면서 동시에 의견이나 평가, 해석도 함께 포함.</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>→ 부분 재작성 필요</div>
          </div>
        </div>
      ),
    },
    rule: {
      title: "판단 기준 (Decision Rule)",
      content: (
        <div style={{ lineHeight: 1.9 }}>
          <div style={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ fontStyle: "italic", color: "#e2e8f0", fontSize: 14, marginBottom: 12 }}>
              "이 문장은 <strong>표현을 바꾸지 않고 그대로 생성해야</strong> 의미가 유지되는가?"
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div><span style={{ color: "#22c55e", fontWeight: 700 }}>NO →</span> F (표현을 바꿔도 의미 유지 가능)</div>
              <div><span style={{ color: "#ef4444", fontWeight: 700 }}>YES →</span> C (표현 자체가 핵심)</div>
              <div><span style={{ color: "#f59e0b", fontWeight: 700 }}>BOTH →</span> M (사실 + 표현 혼재)</div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>
            <strong style={{ color: "#e2e8f0" }}>Q. LLM이 부여한 라벨 적절성 (Q1 점수)</strong>
            <ul style={{ margin: "6px 0 0 16px", lineHeight: 2 }}>
              <li><strong>5 (매우 적절)</strong>: LLM 라벨이 위 기준과 완전히 일치</li>
              <li><strong>4 (적절)</strong>: 대체로 타당한 분류</li>
              <li><strong>3 (보통)</strong>: 어느 정도 납득 가능하지만 불확실</li>
              <li><strong>2 (부적절)</strong>: 기준과 맞지 않음</li>
              <li><strong>1 (매우 부적절)</strong>: 명백히 잘못된 분류</li>
            </ul>
          </div>
        </div>
      ),
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", textAlign: "left", background: "#1e293b",
          border: "1px solid #334155", borderRadius: open ? "8px 8px 0 0" : 8,
          padding: "10px 14px", color: "#e2e8f0", cursor: "pointer",
          fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between",
        }}
      >
        <span>📖 어노테이션 가이드라인</span>
        <span style={{ color: "#94a3b8" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ border: "1px solid #334155", borderTop: "none", borderRadius: "0 0 8px 8px", background: "#0f172a" }}>
          {/* Tab navigation */}
          <div style={{ display: "flex", borderBottom: "1px solid #334155" }}>
            {Object.entries(sections).map(([key, { title }]) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                style={{
                  flex: 1, padding: "8px 4px", fontSize: 11, fontWeight: 600,
                  background: section === key ? "#1e293b" : "transparent",
                  color: section === key ? "#e2e8f0" : "#64748b",
                  border: "none", borderBottom: section === key ? "2px solid #6366f1" : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                {title}
              </button>
            ))}
          </div>
          <div style={{ padding: "14px 16px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.7 }}>
            {sections[section].content}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin Page ─────────────────────────────────────────────────────────────
function AdminPage({ onBack }) {
  const [adminData, setAdminData] = useState(null);

  useEffect(() => {
    axios.get(`${BASE_URL}/admin`).then(res => setAdminData(res.data));
  }, []);

  if (!adminData) return <div className="container"><p>로딩 중...</p></div>;

  const clf = adminData.classification || {};
  const clfTotal = Object.values(clf).reduce((a, b) => a + b, 0);

  const STATUS_DISPLAY = [
    { key: "confirmed",              label: "최종 확정 (Round 1)",       color: "#22c55e" },
    { key: "confirmed_relabeled",    label: "최종 확정 (재라벨링 후)",    color: "#86efac" },
    { key: "needs_relabeling",       label: "재라벨링 필요",              color: "#f59e0b" },
    { key: "relabeling_in_progress", label: "재라벨링 진행 중",           color: "#fbbf24" },
    { key: "disagreement",           label: "Disagreement",              color: "#ef4444" },
    { key: "in_progress",            label: "어노테이션 진행 중",          color: "#94a3b8" },
  ];

  return (
    <div className="container">
      <div className="header">
        <h1>진행도 대시보드</h1>
        <button onClick={onBack} className="nav-btn">← 돌아가기</button>
      </div>
      <div className="main">
        <div className="card">

          {/* 전체 진행률 */}
          <h2>전체 진행률 (총 {adminData.total_samples}개)</h2>
          {ANNOTATORS.map(a => {
            const p = adminData.progress[a] || { done: 0, total: 1, percent: 0 };
            return (
              <div key={a} className="annotator-row" style={{ marginBottom: 12 }}>
                <span style={{ width: 100, display: "inline-block" }}>Annotator {a}</span>
                <div className="mini-bar" style={{ display: "inline-block", width: 300, marginRight: 10 }}>
                  <div className="mini-fill" style={{ width: `${p.percent}%` }} />
                </div>
                <span>{p.done} / {p.total} ({p.percent}%)</span>
              </div>
            );
          })}

          {/* IAA */}
          <h2 style={{ marginTop: 32 }}>IAA (어노테이터 간 일치도)</h2>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {[
              ["Fleiss κ (Label)", adminData.iaa.fleiss_kappa],
              ["Krippendorff α (Score)", adminData.iaa.alpha_q1],
              ["ICC(2,1) (Score)", adminData.iaa.icc],
            ].map(([label, val]) => (
              <div key={label} style={{ background: "#1e293b", borderRadius: 8, padding: "12px 18px", minWidth: 160 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>
                  {typeof val === "number" ? val.toFixed(3) : "-"}
                </div>
              </div>
            ))}
          </div>

          {/* 샘플 분류 현황 */}
          <h2 style={{ marginTop: 32 }}>샘플 분류 현황</h2>
          {clfTotal > 0 ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                {STATUS_DISPLAY.map(({ key, label, color }) => (
                  <div key={key} style={{ background: "#1e293b", borderRadius: 8, padding: "10px 14px", minWidth: 150 }}>
                    <div style={{ fontSize: 11, color, marginBottom: 2 }}>● {label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>{clf[key] || 0}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {clfTotal ? Math.round((clf[key] || 0) / clfTotal * 100) : 0}%
                    </div>
                  </div>
                ))}
              </div>
              {/* Stacked bar */}
              <div style={{ height: 12, borderRadius: 6, overflow: "hidden", display: "flex", marginBottom: 4 }}>
                {STATUS_DISPLAY.map(({ key, color }) => {
                  const pct = clfTotal ? (clf[key] || 0) / clfTotal * 100 : 0;
                  return pct > 0 ? (
                    <div key={key} style={{ width: `${pct}%`, background: color }} title={`${key}: ${clf[key] || 0}`} />
                  ) : null;
                })}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>분류된 샘플 합계: {clfTotal} / {adminData.total_samples}</div>
            </>
          ) : (
            <p style={{ color: "#64748b", fontSize: 13 }}>아직 분류 가능한 샘플이 없습니다 (최소 3명 이상 어노테이션 필요)</p>
          )}

          {/* 카테고리별 진행률 */}
          <h2 style={{ marginTop: 32 }}>카테고리별 진행률</h2>
          {Object.entries(adminData.category_progress).map(([cat, data]) => (
            <div key={cat} style={{ marginBottom: 16 }}>
              <strong>{cat}</strong> (총 {data.total}개)
              <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
                {ANNOTATORS.map(a => (
                  <span key={a} style={{ fontSize: 13 }}>
                    {a}: {data.by_annotator[a] || 0}/{data.total}
                  </span>
                ))}
              </div>
            </div>
          ))}

        </div>
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
function App() {
  const [annotator, setAnnotator] = useState(() => localStorage.getItem("annotator") || null);
  const [scores, setScores] = useState({ q1: null });
  const [label, setLabel] = useState("");
  const [sample, setSample] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [iaa, setIAA] = useState({ fleiss_kappa: 0, alpha_q1: 0, icc: 0 });
  const [currentStep, setCurrentStep] = useState(1);
  const [total, setTotal] = useState(1);
  const [category, setCategory] = useState("ALL");
  const [progressDetail, setProgressDetail] = useState({});
  const [submittedIndices, setSubmittedIndices] = useState(new Set());
  const [showAdmin, setShowAdmin] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [allSamples, setAllSamples] = useState([]);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpCategory, setJumpCategory] = useState("ALL");
  const skipCategoryReset = useRef(false);

  // ── Re-labeling mode ──
  const [relabelMode, setRelabelMode] = useState(false);
  const [relabelSampleIds, setRelabelSampleIds] = useState([]);
  const [sampleClassification, setSampleClassification] = useState({});

  // ── Classification summary (for badge) ──
  const currentStatus = sample ? (sampleClassification[sample.sample_id] || null) : null;

  const resetState = () => {
    setScores({ q1: null });
    setLabel("");
  };

  const loadAnnotation = useCallback(async (sampleData, ann, round = 1) => {
    const a = ann ?? annotator;
    if (!a || !sampleData) { resetState(); return; }
    try {
      const res = await axios.get(`${BASE_URL}/annotation`, {
        params: { sample_id: sampleData.sample_id, annotator: a, round_num: round }
      });
      setScores({ q1: res.data.q1 });
      setLabel(res.data.final_label || "");
    } catch { resetState(); }
  }, [annotator]);

  const fetchSubmittedIndices = useCallback(async (ann, cat, round = 1) => {
    if (!ann) return;
    const res = await axios.get(
      `${BASE_URL}/submitted_ids?annotator=${ann}&category=${cat}&round_num=${round}`
    );
    setSubmittedIndices(new Set(res.data.submitted_indices));
  }, []);

  const fetchSampleByIndex = useCallback(async (idx, cat) => {
    const useCat = cat ?? "ALL";
    const res = await axios.get(`${BASE_URL}/sample?index=${idx}&category=${useCat}`);
    const data = res.data;
    setSample(data);
    setCurrentStep(data.current_index);
    setTotal(data.total);
    setCurrentIndex(idx);
    return data;
  }, []);

  const fetchProgress = useCallback(async (ann, cat, round = 1) => {
    const useAnn = ann ?? annotator ?? "";
    const useCat = cat ?? category ?? "ALL";
    const res = await axios.get(
      `${BASE_URL}/progress?annotator=${useAnn}&category=${useCat}&round_num=${round}`
    );
    setProgress(res.data);
  }, [annotator, category]);

  const fetchProgressDetail = useCallback(async (cat) => {
    const useCat = cat ?? category ?? "ALL";
    const res = await axios.get(`${BASE_URL}/progress_detail?category=${useCat}`);
    setProgressDetail(res.data);
  }, [category]);

  const fetchIAA = useCallback(async () => {
    const res = await axios.get(`${BASE_URL}/iaa`);
    setIAA(res.data);
  }, []);

  const fetchAllSamples = useCallback(async () => {
    const res = await axios.get(`${BASE_URL}/samples`);
    setAllSamples(res.data);
  }, []);

  const fetchClassification = useCallback(async () => {
    try {
      const res = await axios.get(`${BASE_URL}/sample_classification`);
      setSampleClassification(res.data);
    } catch { /* non-critical */ }
  }, []);

  const fetchRelabelSamples = useCallback(async () => {
    try {
      const res = await axios.get(`${BASE_URL}/relabeling_samples`);
      setRelabelSampleIds(res.data.sample_ids || []);
    } catch { /* non-critical */ }
  }, []);

  // Initial load
  useEffect(() => {
    const savedAnnotator = localStorage.getItem("annotator");
    fetchIAA();
    fetchProgressDetail("ALL");
    fetchAllSamples();
    fetchClassification();
    fetchRelabelSamples();

    if (savedAnnotator) {
      fetchProgress(savedAnnotator, "ALL");
      fetchSubmittedIndices(savedAnnotator, "ALL");
      axios.get(`${BASE_URL}/last_index?annotator=${savedAnnotator}&category=ALL`)
        .then(res => {
          const lastIdx = res.data.last_index;
          fetchSampleByIndex(lastIdx, "ALL").then(data => {
            loadAnnotation(data, savedAnnotator);
          });
        });
    } else {
      fetchSampleByIndex(0, "ALL");
    }
  }, []);

  // Category change
  useEffect(() => {
    if (skipCategoryReset.current) {
      skipCategoryReset.current = false;
      return;
    }
    fetchSampleByIndex(0, category);
    fetchProgress(annotator, category);
    fetchProgressDetail(category);
    if (annotator) fetchSubmittedIndices(annotator, category);
  }, [category]);

  const handleAnnotatorSelect = async (a) => {
    setAnnotator(a);
    localStorage.setItem("annotator", a);
    const round = relabelMode ? 2 : 1;
    fetchProgress(a, category, round);
    fetchSubmittedIndices(a, category, round);
    const res = await axios.get(`${BASE_URL}/last_index?annotator=${a}&category=${category}`);
    const lastIdx = res.data.last_index;
    const data = await fetchSampleByIndex(lastIdx, category);
    await loadAnnotation(data, a, round);
  };

  const activeRound = relabelMode ? 2 : 1;

  const nextSample = async () => {
    if (currentStep >= total) return;
    const nextIdx = currentIndex + 1;
    const data = await fetchSampleByIndex(nextIdx, category);
    await loadAnnotation(data, annotator, activeRound);
  };

  const prevSample = async () => {
    if (currentStep <= 1) return;
    const prevIdx = currentIndex - 1;
    const data = await fetchSampleByIndex(prevIdx, category);
    await loadAnnotation(data, annotator, activeRound);
  };

  const setScore = (key, value) => setScores({ ...scores, [key]: value });

  const submit = async () => {
    if (!annotator) { alert("Annotator를 선택하세요"); return; }
    if (activeRound === 1 && (scores.q1 === null || label === "")) {
      alert("모든 문항(*)을 입력해야 합니다");
      return;
    }
    if (activeRound === 2 && label === "") {
      alert("Final Label을 선택해야 합니다");
      return;
    }
    try {
      await axios.post(`${BASE_URL}/submit`, {
        sample_id: sample.sample_id,
        annotator,
        q1: activeRound === 1 ? scores.q1 : null,
        final_label: label,
        round: activeRound,
      });
      fetchProgress(annotator, category, activeRound);
      fetchProgressDetail(category);
      fetchSubmittedIndices(annotator, category, activeRound);
      fetchIAA();
      fetchClassification();
      fetchRelabelSamples();

      if (currentStep < total) {
        await nextSample();
      } else {
        const progressRes = await axios.get(
          `${BASE_URL}/progress?annotator=${annotator}&category=${category}&round_num=${activeRound}`
        );
        const { done, total: tot } = progressRes.data;
        const remaining = tot - done;

        if (remaining > 0) {
          const submittedRes = await axios.get(
            `${BASE_URL}/submitted_ids?annotator=${annotator}&category=${category}&round_num=${activeRound}`
          );
          const submittedSet = new Set(submittedRes.data.submitted_indices);
          const firstUnsubmitted = [...Array(tot).keys()].find(i => !submittedSet.has(i));
          const go = window.confirm(
            `⚠️ 아직 미제출 샘플이 ${remaining}개 남아있습니다!\n미제출 첫 번째 샘플로 이동할까요?`
          );
          if (go && firstUnsubmitted !== undefined) {
            const data = await fetchSampleByIndex(firstUnsubmitted, category);
            await loadAnnotation(data, annotator, activeRound);
          }
        } else {
          alert(activeRound === 2 ? "🎉 재라벨링이 완료되었습니다!" : "🎉 모든 문항을 완료했습니다!");
        }
      }
    } catch (err) {
      console.error(err);
      alert("제출 실패");
    }
  };

  // Toggle re-label mode
  const toggleRelabelMode = async () => {
    const next = !relabelMode;
    setRelabelMode(next);
    resetState();
    if (next) {
      // Re-labeling mode: navigate to first relabeling sample
      await fetchRelabelSamples();
      const res2 = await axios.get(`${BASE_URL}/relabeling_samples`);
      const ids = res2.data.sample_ids || [];
      if (ids.length === 0) {
        alert("현재 재라벨링이 필요한 샘플이 없습니다.");
        setRelabelMode(false);
        return;
      }
      // Find first relabeling sample in allSamples
      const firstId = ids[0];
      const firstSample = allSamples.find(s => s.sample_id === firstId);
      if (firstSample) {
        const cat = firstSample.category;
        const catList = allSamples.filter(s => s.category === cat);
        const catIdx = catList.findIndex(s => s.sample_id === firstId);
        skipCategoryReset.current = true;
        setCategory(cat);
        const data = await fetchSampleByIndex(catIdx, cat);
        await loadAnnotation(data, annotator, 2);
        if (annotator) fetchSubmittedIndices(annotator, cat, 2);
        fetchProgress(annotator, cat, 2);
      }
    } else {
      // Back to normal mode
      const data = await fetchSampleByIndex(0, category);
      await loadAnnotation(data, annotator, 1);
      if (annotator) fetchSubmittedIndices(annotator, category, 1);
      fetchProgress(annotator, category, 1);
    }
  };

  // Jump list
  const jumpList = jumpCategory === "ALL"
    ? allSamples
    : allSamples.filter(s => s.category === jumpCategory);

  const scoreDescriptions = {
    5: "매우 적절함", 4: "적절함", 3: "보통", 2: "부적절함", 1: "매우 부적절함"
  };

  const renderRadios = (q) =>
    [1, 2, 3, 4, 5].map((n) => (
      <label key={n} className="radio">
        <input type="radio" checked={scores[q] === n} onChange={() => setScore(q, n)} />
        {n} : {scoreDescriptions[n]}
      </label>
    ));

  if (showAdmin) return <AdminPage onBack={() => setShowAdmin(false)} />;
  if (!sample) return null;

  return (
    <div className="container">
      <div className="header">
        <h1>News Sentence Human Evaluation</h1>
        <div className="header-right nowrap">
          <div className="progress-container">
            <div className="progress-bar">
              <div className="progress-fill"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <span className="progress-text">{progress.done} / {progress.total}</span>
            <div className="annotator-progress horizontal">
              {ANNOTATORS.map((a) => {
                const p = progressDetail[a] || { done: 0, total: 1 };
                return (
                  <div key={a} className="annotator-row">
                    <span>Annotator {a}</span>
                    <div className="mini-bar">
                      <div className="mini-fill" style={{ width: `${(p.done / p.total) * 100}%` }} />
                    </div>
                    <span>{p.done} / {p.total}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <span className="inline-text">Viewing {currentStep} / {total}</span>
          <span className="inline-text">κ: {iaa.fleiss_kappa?.toFixed(2) ?? "-"}</span>
          <span className="inline-text">α: {iaa.alpha_q1?.toFixed(2) ?? "-"}</span>
          <span className="inline-text">ICC: {iaa.icc?.toFixed(2) ?? "-"}</span>
          <button onClick={() => setShowAdmin(true)} className="nav-btn"
            style={{ background: "#6366f1", color: "white" }}>
            대시보드
          </button>
          <div className="nav-group">
            <button onClick={prevSample} className="nav-btn" disabled={currentStep === 1}>← Prev</button>
            <button onClick={nextSample} className="nav-btn" disabled={currentStep === total}>Next →</button>
          </div>
        </div>
      </div>

      <div className="main">
        {/* LEFT */}
        <div className="card">
          {/* Guideline Panel (replaces static label description) */}
          <GuidelinePanel />

          <div className="meta">
            <div>Sample ID: {sample.sample_id}</div>
            <div>Article: {sample.article_id}</div>
            <div className="llm-big">LLM: {sample.predicted}</div>
            {/* Sample status badge */}
            {currentStatus && (
              <div style={{
                marginTop: 6, fontSize: 12, fontWeight: 600,
                color: STATUS_LABELS[currentStatus.status]?.color ?? "#94a3b8"
              }}>
                {STATUS_LABELS[currentStatus.status]?.text ?? currentStatus.status}
                {currentStatus.confirmed_label && (
                  <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>
                    (확정 라벨: {currentStatus.confirmed_label})
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="label">Previous Sentence</p>
          <p>{sample.previous || "이전 문장이 없습니다."}</p>
          <p className="label">Target Sentence</p>
          <p className="target">{sample.target}</p>
          <p className="label">Next Sentence</p>
          <p>{sample.next || "다음 문장이 없습니다."}</p>
        </div>

        {/* RIGHT */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Evaluation</h2>
            {/* Re-labeling mode toggle */}
            <button
              onClick={toggleRelabelMode}
              style={{
                fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
                border: "none",
                background: relabelMode ? "#f59e0b" : "#334155",
                color: relabelMode ? "#1c1917" : "#e2e8f0",
              }}
            >
              {relabelMode ? "⚠️ 재라벨링 모드 ON" : "🔄 재라벨링 모드"}
            </button>
          </div>

          {relabelMode && (
            <div style={{
              background: "#2d2414", border: "1px solid #f59e0b", borderRadius: 8,
              padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#fbbf24"
            }}>
              재라벨링 모드 활성화 — 이 샘플은 Round 2 라벨링 대상입니다.
              Q1 점수 없이 <strong>Final Label만</strong> 선택 후 제출하세요.
              남은 재라벨링 대상: <strong>{relabelSampleIds.length}개</strong>
            </div>
          )}

          {/* 카테고리 필터 */}
          <div className="category-group">
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCategory(c)}
                className={category === c ? "selected" : ""}>{c}</button>
            ))}
          </div>

          {/* 샘플 목록 Jump */}
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => setJumpOpen(!jumpOpen)}
              className="nav-btn"
              style={{ marginBottom: 6, width: "100%" }}
            >
              📋 샘플 목록으로 이동 {jumpOpen ? "▲" : "▼"}
            </button>

            {jumpOpen && (
              <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, background: "#1e293b" }}>
                <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {CATEGORIES.map(c => (
                    <button
                      key={c}
                      onClick={() => setJumpCategory(c)}
                      className={jumpCategory === c ? "selected" : ""}
                      style={{ fontSize: 11, padding: "2px 6px" }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <select
                  style={{
                    width: "100%", padding: 8, background: "#0f172a",
                    color: "#f1f5f9", border: "1px solid #475569",
                    borderRadius: 6, fontSize: 13
                  }}
                  size={10}
                  onChange={async (e) => {
                    const globalIdx = parseInt(e.target.value);
                    const clickedSample = allSamples[globalIdx];
                    if (!clickedSample) return;

                    const sampleCategory = clickedSample.category;
                    const categoryList = allSamples.filter(s => s.category === sampleCategory);
                    const categoryIdx = categoryList.findIndex(s => s.sample_id === clickedSample.sample_id);

                    skipCategoryReset.current = true;
                    setCategory(sampleCategory);

                    const data = await fetchSampleByIndex(categoryIdx, sampleCategory);
                    await loadAnnotation(data, annotator, activeRound);
                    fetchProgress(annotator, sampleCategory, activeRound);
                    fetchProgressDetail(sampleCategory);
                    if (annotator) fetchSubmittedIndices(annotator, sampleCategory, activeRound);
                    setJumpOpen(false);
                  }}
                >
                  {jumpList.map((s) => {
                    const globalIdx = allSamples.findIndex(orig => orig.sample_id === s.sample_id);
                    const isSubmitted = annotator && submittedIndices.has(
                      (() => {
                        const cat = s.category;
                        const catList = allSamples.filter(x => x.category === cat);
                        return catList.findIndex(x => x.sample_id === s.sample_id);
                      })()
                    );
                    const clf = sampleClassification[s.sample_id];
                    const statusColor = clf ? (STATUS_LABELS[clf.status]?.color ?? "#f1f5f9") : "#f1f5f9";
                    const statusMark = clf?.status === "confirmed" || clf?.status === "confirmed_relabeled" ? "✅"
                      : clf?.status === "needs_relabeling" ? "⚠️"
                      : clf?.status === "disagreement" ? "❌"
                      : isSubmitted ? "✅" : "⬜";
                    return (
                      <option
                        key={s.sample_id}
                        value={globalIdx}
                        style={{ color: isSubmitted ? "#22c55e" : statusColor }}
                      >
                        {statusMark} {s.sample_id}
                      </option>
                    );
                  })}
                </select>
                <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  ✅ 확정/제출완료 &nbsp; ⚠️ 재라벨링 필요 &nbsp; ❌ Disagreement &nbsp; ⬜ 미제출
                </p>
              </div>
            )}
          </div>

          {/* Annotator */}
          <div className="annotator">
            <p>Annotator <span className="required">*</span></p>
            <div className="annotator-group">
              {ANNOTATORS.map((a) => (
                <button key={a} onClick={() => handleAnnotatorSelect(a)}
                  className={annotator === a ? "selected" : ""}>
                  Annotator {a}
                </button>
              ))}
            </div>
          </div>

          {/* 제출 여부 표시 */}
          {annotator && (
            <div style={{
              marginBottom: 8, fontSize: 13,
              color: submittedIndices.has(currentIndex) ? "#22c55e" : "#94a3b8"
            }}>
              {submittedIndices.has(currentIndex)
                ? `✅ 이미 제출한 샘플입니다 (Round ${activeRound})`
                : `⬜ 미제출 샘플입니다 (Round ${activeRound})`}
            </div>
          )}

          {/* Q1 — only shown in round 1 */}
          {!relabelMode && (
            <div className="question">
              <p>Q. LLM이 부여한 라벨이 적절한가? <span className="required">*</span></p>
              {renderRadios("q1")}
            </div>
          )}

          {/* Final Label */}
          <div className="question">
            <p>Final Label <span className="required">*</span></p>
            <div className="label-group">
              {["F", "C", "M", "Unsure"].map((l) => (
                <button key={l} onClick={() => setLabel(l)}
                  className={`label-btn ${label === l ? "active" : ""}`}>{l}</button>
              ))}
            </div>
          </div>

          <button className="submit-btn" onClick={submit}>
            {relabelMode ? "Submit (Round 2 재라벨링)" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
