import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import "./App.css";

const BASE_URL = "https://copyrighthuman-evaluation-production-df30.up.railway.app";
const ANNOTATORS = ["A", "B", "C", "D", "E"];
const CATEGORIES = ["ALL","경제","정치","사회","문화","국제","IT과학","스포츠","교육","라이프스타일","지역"];

function AdminPage({ onBack }) {
  const [adminData, setAdminData] = useState(null);

  useEffect(() => {
    axios.get(`${BASE_URL}/admin`).then(res => setAdminData(res.data));
  }, []);

  if (!adminData) return <div className="container"><p>로딩 중...</p></div>;

  return (
    <div className="container">
      <div className="header">
        <h1>진행도 대시보드</h1>
        <button onClick={onBack} className="nav-btn">← 돌아가기</button>
      </div>
      <div className="main">
        <div className="card">
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

          <h2 style={{ marginTop: 32 }}>IAA (어노테이터 간 일치도)</h2>
          <p>Fleiss Kappa (Label): <strong>{adminData.iaa.fleiss_kappa?.toFixed(3)}</strong></p>
          <p>Krippendorff Alpha (Score): <strong>{adminData.iaa.alpha_q1?.toFixed(3)}</strong></p>

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

function App() {
  const [annotator, setAnnotator] = useState(() => localStorage.getItem("annotator") || null);
  const [scores, setScores] = useState({ q1: null });
  const [label, setLabel] = useState("");
  const [sample, setSample] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [iaa, setIAA] = useState({ fleiss_kappa: 0, alpha_q1: 0 });
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

  const resetState = () => {
    setScores({ q1: null });
    setLabel("");
  };

  const loadAnnotation = useCallback(async (sampleData, ann) => {
    const a = ann ?? annotator;
    if (!a || !sampleData) { resetState(); return; }
    try {
      const res = await axios.get(`${BASE_URL}/annotation`, {params: { sample_id: sampleData.sample_id, annotator: a }});
      setScores({ q1: res.data.q1 });
      setLabel(res.data.final_label || "");
    } catch { resetState(); }
  }, [annotator]);

  const fetchSubmittedIndices = useCallback(async (ann, cat) => {
    if (!ann) return;
    const res = await axios.get(`${BASE_URL}/submitted_ids?annotator=${ann}&category=${cat}`);
    setSubmittedIndices(new Set(res.data.submitted_indices));
  }, []);

  // cat을 항상 명시적으로 받아서 stale closure 방지
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

  const fetchProgress = useCallback(async (ann, cat) => {
    const useAnn = ann ?? annotator ?? "";
    const useCat = cat ?? category ?? "ALL";
    const res = await axios.get(`${BASE_URL}/progress?annotator=${useAnn}&category=${useCat}`);
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

  // 초기 로드
  useEffect(() => {
    const savedAnnotator = localStorage.getItem("annotator");
    fetchIAA();
    fetchProgressDetail("ALL");
    fetchAllSamples();

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

  // category 버튼 클릭 시
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
    fetchProgress(a, category);
    fetchSubmittedIndices(a, category);
    const res = await axios.get(`${BASE_URL}/last_index?annotator=${a}&category=${category}`);
    const lastIdx = res.data.last_index;
    const data = await fetchSampleByIndex(lastIdx, category);
    await loadAnnotation(data, a);
  };

  const nextSample = async () => {
    if (currentStep >= total) return;
    const nextIdx = currentIndex + 1;
    const data = await fetchSampleByIndex(nextIdx, category);
    await loadAnnotation(data);
  };

  const prevSample = async () => {
    if (currentStep <= 1) return;
    const prevIdx = currentIndex - 1;
    const data = await fetchSampleByIndex(prevIdx, category);
    await loadAnnotation(data);
  };

  const setScore = (key, value) => setScores({ ...scores, [key]: value });

  const submit = async () => {
    if (!annotator) { alert("Annotator를 선택하세요"); return; }
    if (scores.q1 === null || label === "") { alert("모든 문항(*)을 입력해야 합니다"); return; }
    try {
      await axios.post(`${BASE_URL}/submit`, {
        sample_id: sample.sample_id,
        annotator,
        q1: scores.q1,
        final_label: label
      });
      fetchProgress(annotator, category);
      fetchProgressDetail(category);
      fetchSubmittedIndices(annotator, category);
      fetchIAA();

      if (currentStep < total) {
        await nextSample();
      } else {
        // 마지막 샘플 제출 시 미제출 샘플 확인
        const progressRes = await axios.get(
          `${BASE_URL}/progress?annotator=${annotator}&category=${category}`
        );
        const { done, total: tot } = progressRes.data;
        const remaining = tot - done;

        if (remaining > 0) {
          // 미제출 샘플 있음
          const submittedRes = await axios.get(
            `${BASE_URL}/submitted_ids?annotator=${annotator}&category=${category}`
          );
          const submittedSet = new Set(submittedRes.data.submitted_indices);
          const firstUnsubmitted = [...Array(tot).keys()].find(i => !submittedSet.has(i));

          const go = window.confirm(
            `⚠️ 아직 미제출 샘플이 ${remaining}개 남아있습니다!\n미제출 첫 번째 샘플로 이동할까요?`
          );
          if (go && firstUnsubmitted !== undefined) {
            const data = await fetchSampleByIndex(firstUnsubmitted, category);
            await loadAnnotation(data);
          }
        } else {
          alert("🎉 모든 문항을 완료했습니다!");
        }
      }
    } catch (err) {
      console.error(err);
      alert("제출 실패");
    }
  };

  // 점프 목록
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
          <span className="inline-text">Fleiss(Label): {iaa.fleiss_kappa?.toFixed(2) ?? "-"}</span>
          <span className="inline-text">Alpha(Score): {iaa.alpha_q1?.toFixed(2) ?? "-"}</span>
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
      {/* 라벨 설명 추가 */}
      <div style={{
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.7,
        color: "#374151"
      }}>
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: "#2563eb" }}>F (Factual)</span>
      　    실제로 일어난 일이나 수치·발표 등 확인 가능한 정보만 전달하는 문장
        </div>
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: "#16a34a" }}>C (Creative)</span>
      　    의견, 평가, 감정, 해석, 예측 등 사람의 생각이나 판단이 들어간 문장
        </div>
        <div>
          <span style={{ fontWeight: 700, color: "#d97706" }}>M (Mixed)</span>
      　    사실을 설명하면서 동시에 의견이나 평가, 해석도 함께 포함된 문장
        </div>
      </div>
          <div className="meta">
            <div>Sample ID: {sample.sample_id}</div>
            <div>Article: {sample.article_id}</div>
            <div className="llm-big">LLM: {sample.predicted}</div>
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
          <h2>Evaluation</h2>

          {/* 카테고리 필터 */}
          <div className="category-group">
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCategory(c)}
                className={category === c ? "selected" : ""}>{c}</button>
            ))}
          </div>

          {/* 샘플 목록으로 이동 */}
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
                    width: "100%",
                    padding: 8,
                    background: "#0f172a",
                    color: "#f1f5f9",
                    border: "1px solid #475569",
                    borderRadius: 6,
                    fontSize: 13
                  }}
                  size={10}
                  onChange={async (e) => {
                    const globalIdx = parseInt(e.target.value);
                    const clickedSample = allSamples[globalIdx];
                    if (!clickedSample) return;

                    const sampleCategory = clickedSample.category;

                    // 해당 샘플의 카테고리 기준 상대 index 계산
                    const categoryList = allSamples.filter(s => s.category === sampleCategory);
                    const categoryIdx = categoryList.findIndex(s => s.sample_id === clickedSample.sample_id);

                    // category useEffect 리셋 방지
                    skipCategoryReset.current = true;
                    setCategory(sampleCategory);

                    const data = await fetchSampleByIndex(categoryIdx, sampleCategory);
                    await loadAnnotation(data);
                    fetchProgress(annotator, sampleCategory);
                    fetchProgressDetail(sampleCategory);
                    if (annotator) fetchSubmittedIndices(annotator, sampleCategory);
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
                    return (
                      <option
                        key={s.sample_id}
                        value={globalIdx}
                        style={{ color: isSubmitted ? "#22c55e" : "#f1f5f9" }}
                      >
                        {isSubmitted ? "✅ " : "⬜ "} {s.sample_id}
                      </option>
                    );
                  })}
                </select>
                <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  ✅ 초록색 = 제출완료 &nbsp; ⬜ 흰색 = 미제출 (Annotator 선택 시 표시)
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
            <div style={{ marginBottom: 8, fontSize: 13, color: submittedIndices.has(currentIndex) ? "#22c55e" : "#94a3b8" }}>
              {submittedIndices.has(currentIndex) ? "✅ 이미 제출한 샘플입니다" : "⬜ 미제출 샘플입니다"}
            </div>
          )}

          {/* Q1 */}
          <div className="question">
            <p>Q. LLM이 부여한 라벨이 적절한가? <span className="required">*</span></p>
            {renderRadios("q1")}
          </div>

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

          <button className="submit-btn" onClick={submit}>Submit</button>
        </div>
      </div>
    </div>
  );
}

export default App;
