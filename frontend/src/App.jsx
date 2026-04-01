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


/* ═══════════════════════════════════════════════════════════════
   가이드라인 패널 — 항상 노출, 접기 없음
   섹션 4. Annotation Guideline (Copyright-aware)
   섹션 5. Decision Rule
   ═══════════════════════════════════════════════════════════════ */
function GuidelinePanel() {
  return (
    <div style={{
      marginBottom: 16,
      border: "1px solid #334155",
      borderRadius: 8,
      background: "#0f172a",
      overflow: "hidden",
    }}>
      <div style={{
        background: "#1e293b",
        padding: "10px 14px",
        fontWeight: 700,
        fontSize: 13,
        color: "#e2e8f0",
        borderBottom: "1px solid #334155",
      }}>
        📖 Annotation Guideline
      </div>

      <div style={{ padding: "14px 16px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.8 }}>
        {/* ── 4. Annotation Guideline (Copyright-aware) ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#e2e8f0", marginBottom: 10 }}>
            4. Annotation Guideline (Copyright-aware)
          </div>

          <div style={{
            marginBottom: 12, padding: "10px 14px",
            background: "#1e3a5f", borderRadius: 8, borderLeft: "4px solid #2563eb",
          }}>
            <div style={{ fontWeight: 700, color: "#60a5fa", marginBottom: 4 }}>
              F (Safe)
            </div>
            <div style={{ fontSize: 13 }}>
              표현이 아닌 정보가 핵심이며, 다양한 방식으로 재작성 가능한 문장
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              → 그대로 사용 가능
            </div>
          </div>

          <div style={{
            marginBottom: 12, padding: "10px 14px",
            background: "#3b1f1f", borderRadius: 8, borderLeft: "4px solid #ef4444",
          }}>
            <div style={{ fontWeight: 700, color: "#f87171", marginBottom: 4 }}>
              C (Risky)
            </div>
            <div style={{ fontSize: 13 }}>
              표현 자체가 의미 전달에 중요한 역할을 하며, 그대로 생성 시 위험한 문장
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              → 반드시 재작성 필요
            </div>
          </div>

          <div style={{
            padding: "10px 14px",
            background: "#2d2414", borderRadius: 8, borderLeft: "4px solid #f59e0b",
          }}>
            <div style={{ fontWeight: 700, color: "#fbbf24", marginBottom: 4 }}>
              M (Mixed)
            </div>
            <div style={{ fontSize: 13 }}>
              사실 정보와 표현 요소가 함께 존재하는 문장
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              → 부분 재작성 필요
            </div>
          </div>
        </div>

        {/* ── 5. Decision Rule ── */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#e2e8f0", marginBottom: 10 }}>
            5. Decision Rule
          </div>

          <div style={{
            background: "#1e293b", border: "1px solid #475569",
            borderRadius: 8, padding: "14px 16px", marginBottom: 12,
          }}>
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
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   Admin (Dashboard) Page
   ═══════════════════════════════════════════════════════════════ */
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
        <h1>📊 진행도 대시보드</h1>
        <button onClick={onBack} className="nav-btn">← 돌아가기</button>
      </div>
      <div className="main" style={{ display: "block" }}>
        <div className="card" style={{ maxWidth: 960, margin: "0 auto" }}>

          {/* ── 전체 진행률 ── */}
          <h2>전체 진행률 (총 {adminData.total_samples}개)</h2>
          {ANNOTATORS.map(a => {
            const p = adminData.progress[a] || { done: 0, total: 1, percent: 0 };
            return (
              <div key={a} style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 100 }}>Annotator {a}</span>
                <div className="mini-bar" style={{ flex: 1, maxWidth: 300 }}>
                  <div className="mini-fill" style={{ width: `${p.percent}%` }} />
                </div>
                <span style={{ fontSize: 13 }}>{p.done} / {p.total} ({p.percent}%)</span>
              </div>
            );
          })}

          {/* ── IAA ── */}
          <h2 style={{ marginTop: 32 }}>IAA (어노테이터 간 일치도)</h2>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {[
              ["Fleiss κ (Label)", adminData.iaa.fleiss_kappa],
              ["Krippendorff α (Score)", adminData.iaa.alpha_q1],
              ["ICC(2,1) (Score)", adminData.iaa.icc],
            ].map(([label, val]) => (
              <div key={label} style={{
                background: "#1e293b", borderRadius: 8, padding: "12px 18px", minWidth: 160,
              }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>
                  {typeof val === "number" ? val.toFixed(3) : "-"}
                </div>
              </div>
            ))}
          </div>

          {/* ── 샘플 분류 현황 ── */}
          <h2 style={{ marginTop: 32 }}>샘플 분류 현황</h2>
          {clfTotal > 0 ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                {STATUS_DISPLAY.map(({ key, label, color }) => (
                  <div key={key} style={{
                    background: "#1e293b", borderRadius: 8, padding: "10px 14px", minWidth: 150,
                  }}>
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
                    <div key={key} style={{ width: `${pct}%`, background: color }}
                         title={`${key}: ${clf[key] || 0}`} />
                  ) : null;
                })}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                분류된 샘플 합계: {clfTotal} / {adminData.total_samples}
              </div>
            </>
          ) : (
            <p style={{ color: "#64748b", fontSize: 13 }}>
              아직 분류 가능한 샘플이 없습니다 (최소 3명 이상 어노테이션 필요)
            </p>
          )}

          {/* Disagreement 목록 */}
          {(adminData.disagreement_samples || []).length > 0 && (
            <>
              <h2 style={{ marginTop: 32, color: "#ef4444" }}>
                ❌ Disagreement 샘플 ({adminData.disagreement_samples.length}개) — Expert Adjudication 필요
              </h2>
              <div style={{
                maxHeight: 200, overflowY: "auto", background: "#1e293b",
                borderRadius: 8, padding: 12, fontSize: 12,
              }}>
                {adminData.disagreement_samples.map(sid => (
                  <div key={sid} style={{ padding: "4px 0", color: "#f87171" }}>{sid}</div>
                ))}
              </div>
            </>
          )}

          {/* ── 카테고리별 진행률 ── */}
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


/* ═══════════════════════════════════════════════════════════════
   재라벨링 (Round 2) 페이지
   ═══════════════════════════════════════════════════════════════ */
function RelabelPage({ onBack, annotator: initialAnnotator, allSamples }) {
  const [annotator, setAnnotator] = useState(initialAnnotator || null);
  const [relabelDetails, setRelabelDetails] = useState([]);
  const [selectedSample, setSelectedSample] = useState(null);
  const [sampleData, setSampleData] = useState(null);
  const [label, setLabel] = useState("");
  const [submittedR2, setSubmittedR2] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const fetchRelabelList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${BASE_URL}/relabeling_samples`);
      setRelabelDetails(res.data.details || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchSubmittedR2 = useCallback(async (ann) => {
    if (!ann) return;
    try {
      const res = await axios.get(
        `${BASE_URL}/submitted_ids?annotator=${ann}&category=ALL&round_num=2`
      );
      setSubmittedR2(new Set(
        (res.data.submitted_indices || []).map(i => allSamples[i]?.sample_id).filter(Boolean)
      ));
    } catch { /* ignore */ }
  }, [allSamples]);

  useEffect(() => {
    fetchRelabelList();
  }, []);

  useEffect(() => {
    if (annotator) fetchSubmittedR2(annotator);
  }, [annotator]);

  const selectSample = async (sid) => {
    setSelectedSample(sid);
    setLabel("");
    // 기존 round-2 어노테이션 불러오기
    if (annotator) {
      try {
        const res = await axios.get(`${BASE_URL}/annotation`, {
          params: { sample_id: sid, annotator, round_num: 2 },
        });
        setLabel(res.data.final_label || "");
      } catch { /* ignore */ }
    }
    // 샘플 상세 정보 (target 등)
    const found = allSamples.find(s => s.sample_id === sid);
    if (found) {
      // fetch full data via /sample endpoint using category index
      const catList = allSamples.filter(s => s.category === found.category);
      const idx = catList.findIndex(s => s.sample_id === sid);
      try {
        const res = await axios.get(`${BASE_URL}/sample?index=${idx >= 0 ? idx : 0}&category=${found.category}`);
        setSampleData(res.data);
      } catch { setSampleData(null); }
    }
  };

  const submitRelabel = async () => {
    if (!annotator) { alert("Annotator를 선택하세요"); return; }
    if (!label || !selectedSample) { alert("Final Label을 선택해주세요"); return; }
    try {
      await axios.post(`${BASE_URL}/submit`, {
        sample_id: selectedSample,
        annotator,
        q1: null,
        final_label: label,
        round: 2,
      });
      alert("✅ 재라벨링 제출 완료!");
      setSubmittedR2(prev => new Set([...prev, selectedSample]));
      // 목록 새로고침
      await fetchRelabelList();
      setSelectedSample(null);
      setSampleData(null);
      setLabel("");
    } catch (err) {
      console.error(err);
      alert("제출 실패");
    }
  };

  const getR1Detail = (sid) => relabelDetails.find(d => d.sample_id === sid);

  return (
    <div className="container">
      <div className="header">
        <h1>🔄 재라벨링 (Round 2)</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onBack} className="nav-btn">← 메인으로</button>
        </div>
      </div>

      <div className="main">
        {/* ── LEFT: 재라벨링 대상 목록 ── */}
        <div className="card" style={{ flex: "0 0 380px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
          <h2 style={{ margin: "0 0 8px 0" }}>
            재라벨링 대상 ({relabelDetails.length}개)
          </h2>
          <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 12px 0" }}>
            Round 1에서 Q1 ≤ 3점을 받은 샘플 목록입니다.
            <br />샘플을 클릭하여 재라벨링하세요.
          </p>

          {/* Annotator 선택 */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
            {ANNOTATORS.map(a => (
              <button
                key={a}
                onClick={() => { setAnnotator(a); localStorage.setItem("annotator", a); }}
                className={annotator === a ? "selected" : ""}
                style={{
                  fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                  border: annotator === a ? "1px solid #6366f1" : "1px solid #475569",
                  background: annotator === a ? "#6366f1" : "#1e293b",
                  color: "#e2e8f0",
                }}
              >
                {a}
              </button>
            ))}
          </div>

          {loading ? (
            <p style={{ color: "#64748b" }}>로딩 중...</p>
          ) : relabelDetails.length === 0 ? (
            <p style={{ color: "#22c55e", fontSize: 13 }}>
              🎉 재라벨링이 필요한 샘플이 없습니다!
            </p>
          ) : (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {relabelDetails.map(d => {
                const isSelected = selectedSample === d.sample_id;
                const isDone = submittedR2.has(d.sample_id);
                return (
                  <div
                    key={d.sample_id}
                    onClick={() => selectSample(d.sample_id)}
                    style={{
                      padding: "8px 10px", marginBottom: 4, borderRadius: 6,
                      cursor: "pointer", fontSize: 12,
                      background: isSelected ? "#334155" : "#1e293b",
                      border: isSelected ? "1px solid #6366f1" : "1px solid transparent",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: "#e2e8f0" }}>
                        {isDone ? "✅" : "⬜"} {d.sample_id}
                      </div>
                      <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
                        R1: {d.round1.map(r => `${r.annotator}(${r.label},q1=${r.q1})`).join(", ")}
                      </div>
                      <div style={{ color: "#64748b", fontSize: 11 }}>
                        R2 진행: {d.round2_count}/3
                      </div>
                    </div>
                    <span style={{
                      color: STATUS_LABELS[d.status]?.color || "#94a3b8",
                      fontSize: 10,
                    }}>
                      {STATUS_LABELS[d.status]?.text || d.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT: 선택된 샘플 상세 + 재라벨링 폼 ── */}
        <div className="card" style={{ flex: 1 }}>
          {!selectedSample ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
              <p>좌측 목록에서 재라벨링할 샘플을 선택하세요.</p>
            </div>
          ) : (
            <>
              {/* 샘플 정보 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Sample ID</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>{selectedSample}</div>
              </div>

              {/* Round 1 어노테이션 요약 */}
              {(() => {
                const detail = getR1Detail(selectedSample);
                return detail ? (
                  <div style={{
                    background: "#2d2414", border: "1px solid #f59e0b",
                    borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 12,
                  }}>
                    <div style={{ fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>
                      Round 1 어노테이션 결과 (Q1 ≤ 3 존재 → 재라벨링 대상)
                    </div>
                    {detail.round1.map((r, i) => (
                      <div key={i} style={{ color: r.q1 <= 3 ? "#f87171" : "#94a3b8" }}>
                        Annotator {r.annotator}: Label={r.label}, Q1={r.q1}
                        {r.q1 <= 3 && " ⚠️"}
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}

              {/* 본문 */}
              {sampleData && (
                <div style={{ marginBottom: 16 }}>
                  <div className="meta" style={{ marginBottom: 8 }}>
                    <span>Article: {sampleData.article_id}</span>
                    <span className="llm-big" style={{ marginLeft: 12 }}>LLM: {sampleData.predicted}</span>
                  </div>
                  <p className="label">Previous Sentence</p>
                  <p style={{ fontSize: 13, color: "#94a3b8" }}>{sampleData.previous || "—"}</p>
                  <p className="label">Target Sentence</p>
                  <p className="target">{sampleData.target}</p>
                  <p className="label">Next Sentence</p>
                  <p style={{ fontSize: 13, color: "#94a3b8" }}>{sampleData.next || "—"}</p>
                </div>
              )}

              {/* Final Label 선택 */}
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
                  Final Label <span style={{ color: "#ef4444" }}>*</span>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400, marginLeft: 8 }}>
                    (Round 2: Q1 점수 없이 라벨만 선택)
                  </span>
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  {["F", "C", "M"].map(l => (
                    <button
                      key={l}
                      onClick={() => setLabel(l)}
                      className={`label-btn ${label === l ? "active" : ""}`}
                      style={{ flex: 1 }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="submit-btn"
                onClick={submitRelabel}
                style={{ width: "100%" }}
              >
                Submit (Round 2 재라벨링)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   Main App
   ═══════════════════════════════════════════════════════════════ */
function App() {
  const [annotator, setAnnotator] = useState(() => localStorage.getItem("annotator") || null);
  const [scores, setScores] = useState({ q1: null });
  const [label, setLabel] = useState("");
  const [sample, setSample] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [currentStep, setCurrentStep] = useState(1);
  const [total, setTotal] = useState(1);
  const [category, setCategory] = useState("ALL");
  const [submittedIndices, setSubmittedIndices] = useState(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [allSamples, setAllSamples] = useState([]);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpCategory, setJumpCategory] = useState("ALL");
  const skipCategoryReset = useRef(false);

  // 페이지 전환
  const [page, setPage] = useState("main"); // "main" | "admin" | "relabel"

  // 샘플 분류 상태 (status badge 용)
  const [sampleClassification, setSampleClassification] = useState({});
  const [relabelCount, setRelabelCount] = useState(0);

  const currentStatus = sample ? (sampleClassification[sample.sample_id] || null) : null;

  const resetState = () => {
    setScores({ q1: null });
    setLabel("");
  };

  const loadAnnotation = useCallback(async (sampleData, ann) => {
    const a = ann ?? annotator;
    if (!a || !sampleData) { resetState(); return; }
    try {
      const res = await axios.get(`${BASE_URL}/annotation`, {
        params: { sample_id: sampleData.sample_id, annotator: a, round_num: 1 },
      });
      setScores({ q1: res.data.q1 });
      setLabel(res.data.final_label || "");
    } catch { resetState(); }
  }, [annotator]);

  const fetchSubmittedIndices = useCallback(async (ann, cat) => {
    if (!ann) return;
    const res = await axios.get(
      `${BASE_URL}/submitted_ids?annotator=${ann}&category=${cat}&round_num=1`
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

  const fetchProgress = useCallback(async (ann, cat) => {
    const useAnn = ann ?? annotator ?? "";
    const useCat = cat ?? category ?? "ALL";
    const res = await axios.get(
      `${BASE_URL}/progress?annotator=${useAnn}&category=${useCat}&round_num=1`
    );
    setProgress(res.data);
  }, [annotator, category]);

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

  const fetchRelabelCount = useCallback(async () => {
    try {
      const res = await axios.get(`${BASE_URL}/relabeling_samples`);
      setRelabelCount((res.data.sample_ids || []).length);
    } catch { /* non-critical */ }
  }, []);

  // ── Initial load ──
  useEffect(() => {
    const savedAnnotator = localStorage.getItem("annotator");
    fetchAllSamples();
    fetchClassification();
    fetchRelabelCount();

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

  // ── Category change ──
  useEffect(() => {
    if (skipCategoryReset.current) {
      skipCategoryReset.current = false;
      return;
    }
    fetchSampleByIndex(0, category);
    fetchProgress(annotator, category);
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
    const data = await fetchSampleByIndex(currentIndex + 1, category);
    await loadAnnotation(data, annotator);
  };

  const prevSample = async () => {
    if (currentStep <= 1) return;
    const data = await fetchSampleByIndex(currentIndex - 1, category);
    await loadAnnotation(data, annotator);
  };

  const setScore = (key, value) => setScores({ ...scores, [key]: value });

  const submit = async () => {
    if (!annotator) { alert("Annotator를 선택하세요"); return; }
    if (scores.q1 === null || label === "") {
      alert("모든 문항(*)을 입력해야 합니다");
      return;
    }
    try {
      await axios.post(`${BASE_URL}/submit`, {
        sample_id: sample.sample_id,
        annotator,
        q1: scores.q1,
        final_label: label,
        round: 1,
      });
      fetchProgress(annotator, category);
      fetchSubmittedIndices(annotator, category);
      fetchClassification();
      fetchRelabelCount();

      if (currentStep < total) {
        await nextSample();
      } else {
        const progressRes = await axios.get(
          `${BASE_URL}/progress?annotator=${annotator}&category=${category}&round_num=1`
        );
        const { done, total: tot } = progressRes.data;
        const remaining = tot - done;

        if (remaining > 0) {
          const submittedRes = await axios.get(
            `${BASE_URL}/submitted_ids?annotator=${annotator}&category=${category}&round_num=1`
          );
          const submittedSet = new Set(submittedRes.data.submitted_indices);
          const firstUnsubmitted = [...Array(tot).keys()].find(i => !submittedSet.has(i));
          const go = window.confirm(
            `⚠️ 아직 미제출 샘플이 ${remaining}개 남아있습니다!\n미제출 첫 번째 샘플로 이동할까요?`
          );
          if (go && firstUnsubmitted !== undefined) {
            const data = await fetchSampleByIndex(firstUnsubmitted, category);
            await loadAnnotation(data, annotator);
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

  // Jump list
  const jumpList = jumpCategory === "ALL"
    ? allSamples
    : allSamples.filter(s => s.category === jumpCategory);

  const scoreDescriptions = {
    5: "매우 적절함", 4: "적절함", 3: "보통", 2: "부적절함", 1: "매우 부적절함",
  };

  const renderRadios = (q) =>
    [1, 2, 3, 4, 5].map((n) => (
      <label key={n} className="radio">
        <input type="radio" checked={scores[q] === n} onChange={() => setScore(q, n)} />
        {n} : {scoreDescriptions[n]}
      </label>
    ));

  // ═══ Page Router ═══
  if (page === "admin") return <AdminPage onBack={() => setPage("main")} />;
  if (page === "relabel") {
    return (
      <RelabelPage
        onBack={() => {
          setPage("main");
          fetchClassification();
          fetchRelabelCount();
        }}
        annotator={annotator}
        allSamples={allSamples}
      />
    );
  }

  if (!sample) return null;

  const progressPct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="container">
      {/* ═══ HEADER ═══ */}
      <div className="header" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 8,
      }}>
        <h1 style={{ margin: 0, whiteSpace: "nowrap" }}>News Sentence Human Evaluation</h1>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* 본인 진행도 */}
          {annotator && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>내 진행도:</span>
              <div style={{
                width: 120, height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", width: `${progressPct}%`,
                  background: "#6366f1", borderRadius: 4, transition: "width 0.3s",
                }} />
              </div>
              <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>
                {progress.done}/{progress.total} ({progressPct}%)
              </span>
            </div>
          )}

          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            Viewing {currentStep} / {total}
          </span>

          {/* 대시보드 */}
          <button onClick={() => setPage("admin")} className="nav-btn"
            style={{ background: "#6366f1", color: "white", fontSize: 12 }}>
            📊 대시보드
          </button>

          {/* 재라벨링 페이지 */}
          <button onClick={() => setPage("relabel")} className="nav-btn"
            style={{
              background: relabelCount > 0 ? "#f59e0b" : "#334155",
              color: relabelCount > 0 ? "#1c1917" : "#e2e8f0",
              fontSize: 12, position: "relative",
            }}>
            🔄 재라벨링
            {relabelCount > 0 && (
              <span style={{
                position: "absolute", top: -6, right: -6,
                background: "#ef4444", color: "white", borderRadius: "50%",
                width: 20, height: 20, fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {relabelCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ═══ MAIN ═══ */}
      <div className="main">
        {/* ── LEFT: 가이드라인 + 샘플 + 내비게이션 ── */}
        <div className="card">
          <GuidelinePanel />

          <div className="meta">
            <div>Sample ID: {sample.sample_id}</div>
            <div>Article: {sample.article_id}</div>
            <div className="llm-big">LLM: {sample.predicted}</div>
            {currentStatus && (
              <div style={{
                marginTop: 6, fontSize: 12, fontWeight: 600,
                color: STATUS_LABELS[currentStatus.status]?.color ?? "#94a3b8",
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

          {/* ── Prev / Next 버튼 (샘플 바로 아래) ── */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 16, paddingTop: 12, borderTop: "1px solid #334155",
          }}>
            <button onClick={prevSample} className="nav-btn" disabled={currentStep === 1}
              style={{ minWidth: 100 }}>
              ← Prev
            </button>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {currentStep} / {total}
            </span>
            <button onClick={nextSample} className="nav-btn" disabled={currentStep === total}
              style={{ minWidth: 100 }}>
              Next →
            </button>
          </div>
        </div>

        {/* ── RIGHT: 평가 패널 ── */}
        <div className="card">
          <h2 style={{ margin: "0 0 12px 0" }}>Evaluation (Round 1)</h2>

          {/* 카테고리 필터 */}
          <div className="category-group">
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCategory(c)}
                className={category === c ? "selected" : ""}>{c}</button>
            ))}
          </div>

          {/* 샘플 목록 Jump */}
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => setJumpOpen(!jumpOpen)} className="nav-btn"
              style={{ marginBottom: 6, width: "100%" }}>
              📋 샘플 목록으로 이동 {jumpOpen ? "▲" : "▼"}
            </button>

            {jumpOpen && (
              <div style={{
                border: "1px solid #334155", borderRadius: 8, padding: 12, background: "#1e293b",
              }}>
                <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {CATEGORIES.map(c => (
                    <button key={c} onClick={() => setJumpCategory(c)}
                      className={jumpCategory === c ? "selected" : ""}
                      style={{ fontSize: 11, padding: "2px 6px" }}>
                      {c}
                    </button>
                  ))}
                </div>
                <select
                  style={{
                    width: "100%", padding: 8, background: "#0f172a",
                    color: "#f1f5f9", border: "1px solid #475569",
                    borderRadius: 6, fontSize: 13,
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
                    await loadAnnotation(data, annotator);
                    fetchProgress(annotator, sampleCategory);
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
                    const clf = sampleClassification[s.sample_id];
                    const statusColor = clf
                      ? (STATUS_LABELS[clf.status]?.color ?? "#f1f5f9")
                      : "#f1f5f9";
                    const statusMark =
                      clf?.status === "confirmed" || clf?.status === "confirmed_relabeled" ? "✅"
                      : clf?.status === "needs_relabeling" ? "⚠️"
                      : clf?.status === "disagreement" ? "❌"
                      : isSubmitted ? "✅" : "⬜";
                    return (
                      <option key={s.sample_id} value={globalIdx}
                        style={{ color: isSubmitted ? "#22c55e" : statusColor }}>
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
              color: submittedIndices.has(currentIndex) ? "#22c55e" : "#94a3b8",
            }}>
              {submittedIndices.has(currentIndex)
                ? "✅ 이미 제출한 샘플입니다 (Round 1)"
                : "⬜ 미제출 샘플입니다 (Round 1)"}
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
