import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import "./App.css";

const BASE_URL = "https://copyrighthuman-evaluation-production-df30.up.railway.app";
const ANNOTATORS = ["A", "B", "C", "D", "E"];
const CATEGORIES = ["ALL","경제","정치","사회","문화","국제","IT과학","스포츠","교육","라이프스타일","지역"];

const STATUS_LABELS = {
  confirmed:           { text: "✅ 확정 (4~5점)", color: "#16a34a" },
  discussion_resolved: { text: "✅ 상의 완료",    color: "#2563eb" },
  needs_discussion:    { text: "⚠️ 상의 필요",    color: "#d97706" },
  in_progress:         { text: "⬜ 진행 중",       color: "#9ca3af" },
};

function GuidelinePanel() {
  return (
    <div className="guideline-panel">
      <div className="guideline-header">📖 Human Evaluation Guideline</div>
      <div className="guideline-body">
        <div style={{ marginBottom: 12 }}>
          <div className="guideline-section-title">4. Annotation Guideline (Copyright-aware)</div>
          <div className="guideline-label-box safe">
            <div className="guideline-label-title safe">F (Safe)</div>
            <div>표현이 아닌 정보가 핵심이며, 다양한 방식으로 재작성 가능한 문장</div>
            <div className="guideline-label-sub">→ 그대로 사용 가능</div>
          </div>
          <div className="guideline-label-box risky">
            <div className="guideline-label-title risky">C (Risky)</div>
            <div>표현 자체가 의미 전달에 중요한 역할을 하며, 그대로 생성 시 위험한 문장</div>
            <div className="guideline-label-sub">→ 반드시 재작성 필요</div>
          </div>
          <div className="guideline-label-box mixed">
            <div className="guideline-label-title mixed">M (Mixed)</div>
            <div>사실 정보와 표현 요소가 함께 존재하는 문장</div>
            <div className="guideline-label-sub">→ 부분 재작성 필요</div>
          </div>
        </div>
        <div>
          <div className="guideline-section-title">5. Decision Rule</div>
          <div className="decision-rule-box">
            <div className="decision-rule-question">
              "이 문장은 <strong>표현을 바꾸지 않고 그대로 생성해야</strong> 의미가 유지되는가?"
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
              <div><span style={{ color: "#16a34a", fontWeight: 700 }}>NO →</span> F (표현을 바꿔도 의미 유지 가능)</div>
              <div><span style={{ color: "#dc2626", fontWeight: 700 }}>YES →</span> C (표현 자체가 핵심)</div>
              <div><span style={{ color: "#d97706", fontWeight: 700 }}>BOTH →</span> M (사실 + 표현 혼재)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   상의 페이지
   ═══════════════════════════════════════════════════════════════ */
function DiscussionPage({ onBack, allSamples }) {
  const [discussionData, setDiscussionData] = useState({ samples: [], total: 0, resolved_count: 0 });
  const [selected, setSelected] = useState(null);
  const [sampleDetail, setSampleDetail] = useState(null);
  const [decidedLabel, setDecidedLabel] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchDiscussion = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${BASE_URL}/discussion_samples`);
      setDiscussionData(res.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchDiscussion(); }, []);

  const selectSample = async (item) => {
    setSelected(item);
    setDecidedLabel(item.decided_label || "");
    const found = allSamples.find(s => s.sample_id === item.sample_id);
    if (found) {
      const catList = allSamples.filter(s => s.category === found.category);
      const idx = catList.findIndex(s => s.sample_id === item.sample_id);
      try {
        const res = await axios.get(`${BASE_URL}/sample?index=${idx >= 0 ? idx : 0}&category=${found.category}`);
        setSampleDetail(res.data);
      } catch { setSampleDetail(null); }
    }
  };

  const submitDecision = async () => {
    if (!decidedLabel || !selected) return;
    try {
      await axios.post(`${BASE_URL}/set_final_label`, {
        sample_id: selected.sample_id,
        final_label: decidedLabel,
      });
      alert(`✅ ${selected.sample_id} → ${decidedLabel} 확정`);
      await fetchDiscussion();
      // 업데이트된 데이터로 selected 갱신
      const res = await axios.get(`${BASE_URL}/discussion_samples`);
      const updated = res.data.samples.find(s => s.sample_id === selected.sample_id);
      if (updated) { setSelected(updated); setDecidedLabel(updated.decided_label || ""); }
    } catch { alert("저장 실패"); }
  };

  const cancelDecision = async () => {
    if (!selected) return;
    try {
      await axios.delete(`${BASE_URL}/set_final_label?sample_id=${encodeURIComponent(selected.sample_id)}`);
      alert("결정 취소됨");
      await fetchDiscussion();
      setSelected(prev => ({ ...prev, resolved: false, decided_label: null }));
      setDecidedLabel("");
    } catch { alert("취소 실패"); }
  };

  const pendingItems = discussionData.samples.filter(s => !s.resolved);
  const resolvedItems = discussionData.samples.filter(s => s.resolved);

  return (
    <div className="container">
      <div className="header">
        <h1>💬 상의 필요 샘플</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            완료 {discussionData.resolved_count} / 전체 {discussionData.total}
          </span>
          <button onClick={fetchDiscussion} className="nav-btn" style={{ padding: "4px 10px", fontSize: 11 }}>↻ 새로고침</button>
          <button onClick={onBack} className="nav-btn">← 메인으로</button>
        </div>
      </div>

      <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#854d0e" }}>
        ⚠️ 아래 샘플들은 <strong>1명 이상이 1~3점을 선택</strong>하여 LLM 라벨에 동의하지 않은 경우입니다. 어노테이터끼리 상의 후 최종 라벨을 결정해주세요.
      </div>

      <div className="main">
        {/* LEFT: 목록 */}
        <div className="card relabel-list">
          {loading ? (
            <p style={{ color: "#9ca3af" }}>로딩 중...</p>
          ) : discussionData.total === 0 ? (
            <p style={{ color: "#16a34a" }}>🎉 상의가 필요한 샘플이 없습니다!</p>
          ) : (
            <div style={{ overflowY: "auto" }}>
              {pendingItems.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", padding: "6px 0 4px", borderBottom: "1px solid #e5e7eb", marginBottom: 4 }}>
                    ⚠️ 상의 필요 ({pendingItems.length}개)
                  </div>
                  {pendingItems.map(item => (
                    <div key={item.sample_id}
                      onClick={() => selectSample(item)}
                      className={`relabel-item ${selected?.sample_id === item.sample_id ? "active" : ""}`}
                    >
                      <div style={{ fontWeight: 600, fontSize: 12, color: "#111827" }}>{item.sample_id}</div>
                      <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                        LLM: <strong>{item.predicted}</strong> &nbsp;|&nbsp;
                        {item.annotations.map(a => `${a.annotator}:${a.q1}점${a.label ? `(${a.label})` : ""}`).join(" ")}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {resolvedItems.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", padding: "10px 0 4px", borderBottom: "1px solid #e5e7eb", marginBottom: 4 }}>
                    ✅ 상의 완료 ({resolvedItems.length}개)
                  </div>
                  {resolvedItems.map(item => (
                    <div key={item.sample_id}
                      onClick={() => selectSample(item)}
                      className={`relabel-item done ${selected?.sample_id === item.sample_id ? "active" : ""}`}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: "#111827" }}>{item.sample_id}</div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#2563eb" }}>→ {item.decided_label}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: 상세 */}
        <div className="card" style={{ flex: 1 }}>
          {!selected ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#9ca3af" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
              <p>좌측에서 샘플을 선택하세요.</p>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>Sample ID</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{selected.sample_id}</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  LLM 예측 라벨: <strong style={{ color: "#dc2626" }}>{selected.predicted}</strong>
                </div>
              </div>

              {/* 어노테이터별 응답 */}
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, color: "#374151", marginBottom: 8, fontSize: 13 }}>어노테이터별 응답</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                      <th style={{ padding: "5px 8px", textAlign: "left" }}>Annotator</th>
                      <th style={{ padding: "5px 8px", textAlign: "center" }}>Q1 점수</th>
                      <th style={{ padding: "5px 8px", textAlign: "center" }}>선택 라벨</th>
                      <th style={{ padding: "5px 8px", textAlign: "center" }}>LLM 동의</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.annotations.map((a, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: a.q1 <= 3 ? "#fef2f2" : "white" }}>
                        <td style={{ padding: "5px 8px", fontWeight: 600 }}>Annotator {a.annotator}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", color: a.q1 <= 3 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                          {a.q1}점 {a.q1 <= 3 ? "⚠️" : "✅"}
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700,
                          color: a.label === "C" ? "#dc2626" : a.label === "M" ? "#d97706" : "#2563eb" }}>
                          {a.label || "-"}
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>
                          {a.agreed_with_llm === null ? "-" : a.agreed_with_llm ? "✅ 동의" : "❌ 비동의"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 샘플 텍스트 */}
              {sampleDetail && (
                <div style={{ marginBottom: 16 }}>
                  <p className="label">Previous Sentence</p>
                  <p style={{ fontSize: 13, color: "#6b7280" }}>{sampleDetail.previous || "—"}</p>
                  <p className="label">Target Sentence</p>
                  <p className="target">{sampleDetail.target}</p>
                  <p className="label">Next Sentence</p>
                  <p style={{ fontSize: 13, color: "#6b7280" }}>{sampleDetail.next || "—"}</p>
                </div>
              )}

              {/* 최종 라벨 결정 */}
              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 14 }}>
                <div style={{ fontWeight: 700, color: "#1e40af", marginBottom: 10, fontSize: 13 }}>
                  💬 상의 후 최종 라벨 결정
                </div>
                <div className="label-group" style={{ marginBottom: 10 }}>
                  {["F", "C", "M"].map(l => (
                    <button key={l} onClick={() => setDecidedLabel(l)}
                      className={`label-btn ${decidedLabel === l ? "active" : ""}`}
                      style={{ flex: 1 }}>{l}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="submit-btn" onClick={submitDecision}
                    disabled={!decidedLabel} style={{ flex: 1, marginTop: 0 }}>
                    ✅ 최종 라벨 확정
                  </button>
                  {selected.resolved && (
                    <button onClick={cancelDecision} className="nav-btn"
                      style={{ background: "#fee2e2", color: "#dc2626", marginTop: 0 }}>
                      취소
                    </button>
                  )}
                </div>
                {selected.resolved && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#2563eb", fontWeight: 600 }}>
                    현재 결정: {selected.decided_label}
                  </div>
                )}
              </div>
            </>
          )}
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
  const [dbQuery, setDbQuery] = useState({ open: false, sampleId: "", annotator: "", data: [], total: 0, loading: false });

  const runDbQuery = async () => {
    setDbQuery(prev => ({ ...prev, loading: true }));
    try {
      const params = new URLSearchParams();
      if (dbQuery.sampleId) params.append("sample_id", dbQuery.sampleId);
      if (dbQuery.annotator) params.append("annotator", dbQuery.annotator);
      params.append("limit", "100");
      const res = await axios.get(`${BASE_URL}/db_query?${params.toString()}`);
      setDbQuery(prev => ({ ...prev, data: res.data.data, total: res.data.total, loading: false }));
    } catch {
      setDbQuery(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    axios.get(`${BASE_URL}/admin`).then(res => setAdminData(res.data));
  }, []);

  if (!adminData) return <div className="container"><p style={{ color: "#6b7280" }}>로딩 중...</p></div>;

  const clf = adminData.classification || {};
  const clfTotal = Object.values(clf).reduce((a, b) => a + b, 0);
  const STATUS_DISPLAY = [
    { key: "confirmed",           label: "확정 (4~5점)",   color: "#16a34a" },
    { key: "discussion_resolved", label: "상의 완료",      color: "#2563eb" },
    { key: "needs_discussion",    label: "상의 필요",      color: "#d97706" },
    { key: "in_progress",         label: "진행 중",        color: "#9ca3af" },
  ];

  return (
    <div className="container">
      <div className="header">
        <h1>📊 진행도 대시보드</h1>
        <button onClick={onBack} className="nav-btn">← 돌아가기</button>
      </div>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div className="card">

          {/* 전체 진행률 */}
          <h2 className="dash-section-title">전체 진행률 (총 {adminData.total_samples}개)</h2>
          {ANNOTATORS.map(a => {
            const p = adminData.progress[a] || { done: 0, total: 1, percent: 0 };
            return (
              <div key={a} style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 90, fontSize: 13, fontWeight: 600, color: "#374151" }}>Annotator {a}</span>
                <div className="mini-bar" style={{ flex: 1, maxWidth: 280 }}>
                  <div className="mini-fill" style={{ width: `${p.percent}%` }} />
                </div>
                <span style={{ fontSize: 12, color: "#6b7280", minWidth: 130 }}>
                  {p.done} / {p.total} ({p.percent}%)
                </span>
              </div>
            );
          })}

          {/* IAA */}
          <h2 className="dash-section-title" style={{ marginTop: 28 }}>IAA (어노테이터 간 일치도)</h2>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
            {[
              ["Fleiss κ (Label)", adminData.iaa.fleiss_kappa, "라벨(F/C/M) 범주 일치도"],
              ["Krippendorff α (Label)", adminData.iaa.alpha_label, "라벨(F/C/M) 일치도"],
              ["Krippendorff α (Score)", adminData.iaa.alpha_q1, "Q1 점수(1-5) 서열 일치도"],
              ["ICC(2,1) (Score)", adminData.iaa.icc, "Q1 점수 절대 일치도"],
            ].map(([lbl, val, desc]) => (
              <div key={lbl} className="dashboard-card">
                <div className="dashboard-metric-label">{lbl}</div>
                <div className="dashboard-metric-value">{typeof val === "number" ? val.toFixed(3) : "-"}</div>
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{desc}</div>
              </div>
            ))}
          </div>

          {/* 샘플 분류 현황 */}
          <h2 className="dash-section-title" style={{ marginTop: 28 }}>샘플 분류 현황</h2>
          {clfTotal > 0 ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                {STATUS_DISPLAY.map(({ key, label, color }) => (
                  <div key={key} className="dashboard-card" style={{ minWidth: 130 }}>
                    <div style={{ fontSize: 11, color, fontWeight: 600, marginBottom: 2 }}>● {label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{clf[key] || 0}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>
                      {clfTotal ? Math.round(((clf[key] || 0) / clfTotal) * 100) : 0}%
                    </div>
                  </div>
                ))}
              </div>
              <div className="stacked-bar" style={{ marginBottom: 4 }}>
                {STATUS_DISPLAY.map(({ key, color }) => {
                  const pct = clfTotal ? ((clf[key] || 0) / clfTotal) * 100 : 0;
                  return pct > 0 ? (
                    <div key={key} style={{ width: `${pct}%`, background: color }} title={`${key}: ${clf[key] || 0}`} />
                  ) : null;
                })}
              </div>
              <div className="classification-guide">
                <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>분류 기준 안내</div>
                <div>• <strong>확정 (4~5점)</strong>: 3명 이상이 모두 Q1 4~5점 → LLM 라벨 확정</div>
                <div>• <strong>상의 필요</strong>: 1명이라도 Q1 1~3점 → 어노테이터 상의 필요</div>
                <div>• <strong>상의 완료</strong>: 상의 후 최종 라벨 결정됨</div>
                <div>• <strong>진행 중</strong>: 아직 3명 미만 제출</div>
              </div>
            </>
          ) : (
            <p style={{ color: "#9ca3af", fontSize: 13 }}>아직 분류 가능한 샘플이 없습니다 (최소 3명 이상 어노테이션 필요)</p>
          )}

          {/* 카테고리별 진행률 */}
          <h2 className="dash-section-title" style={{ marginTop: 28 }}>카테고리별 진행률</h2>
          {Object.entries(adminData.category_progress).map(([cat, data]) => (
            <div key={cat} style={{ marginBottom: 14 }}>
              <strong style={{ fontSize: 13 }}>{cat}</strong>
              <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 6 }}>(총 {data.total}개)</span>
              <div style={{ display: "flex", gap: 14, marginTop: 4, flexWrap: "wrap" }}>
                {ANNOTATORS.map(a => (
                  <span key={a} style={{ fontSize: 12, color: "#6b7280" }}>
                    {a}: {data.by_annotator[a] || 0}/{data.total}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {/* DB 조회 */}
          <h2 className="dash-section-title" style={{ marginTop: 28 }}>DB 조회</h2>
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => setDbQuery(prev => ({ ...prev, open: !prev.open }))}
              className="nav-btn" style={{ background: "#374151", marginBottom: 8 }}>
              🔍 DB 직접 조회 {dbQuery.open ? "▲" : "▼"}
            </button>
            {dbQuery.open && (
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <input placeholder="Sample ID (부분 검색)" value={dbQuery.sampleId}
                    onChange={e => setDbQuery(prev => ({ ...prev, sampleId: e.target.value }))}
                    style={{ flex: 1, padding: 6, borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12, minWidth: 140 }} />
                  <select value={dbQuery.annotator}
                    onChange={e => setDbQuery(prev => ({ ...prev, annotator: e.target.value }))}
                    style={{ padding: 6, borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
                    <option value="">전체 Annotator</option>
                    {ANNOTATORS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <button onClick={runDbQuery} className="nav-btn" style={{ background: "#4f83f3", fontSize: 12 }}>
                    {dbQuery.loading ? "검색 중..." : "검색"}
                  </button>
                </div>
                {dbQuery.data.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>총 {dbQuery.total}건</div>
                    <div style={{ maxHeight: 300, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: "#f1f5f9" }}>
                            {["Sample ID","Ann","Label","Q1"].map(h => (
                              <th key={h} style={{ padding: "4px 6px", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dbQuery.data.map((row, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "3px 6px" }}>{row.sample_id}</td>
                              <td style={{ padding: "3px 6px" }}>{row.annotator}</td>
                              <td style={{ padding: "3px 6px", fontWeight: 600,
                                color: row.final_label === "C" ? "#dc2626" : row.final_label === "M" ? "#d97706" : "#2563eb" }}>
                                {row.final_label || "-"}
                              </td>
                              <td style={{ padding: "3px 6px" }}>{row.q1 ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 데이터 내보내기 */}
          <h2 className="dash-section-title" style={{ marginTop: 28 }}>데이터 내보내기</h2>

          {/* 최종 데이터셋 */}
          <div className="classification-guide" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12, color: "#111827" }}>
              📊 최종 데이터셋 (확정 + 상의 완료 샘플)
            </div>
            <div>확정 샘플과 상의 완료 샘플의 최종 라벨을 포함합니다.</div>
            <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>
              형식: sample_id, target_sentence, label, prev_sentence, next_sentence
            </div>
            <div style={{ marginTop: 8 }}>
              <a href={`${BASE_URL}/export/final_dataset`} download className="nav-btn"
                style={{ textDecoration: "none", background: "#059669", fontSize: 12, padding: "6px 12px" }}>
                📥 최종 데이터셋 JSON
              </a>
            </div>
          </div>

          {/* Raw 데이터 */}
          <div className="classification-guide">
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12, color: "#111827" }}>
              🗂️ Raw 어노테이션 (개별 응답 전체)
            </div>
            <div>모든 어노테이터의 개별 응답 (sample_id, annotator, final_label, q1)</div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <a href={`${BASE_URL}/export/csv`} download className="nav-btn"
                style={{ textDecoration: "none", background: "#374151", fontSize: 12, padding: "6px 12px" }}>
                📥 Raw CSV
              </a>
              <a href={`${BASE_URL}/export/json`} download className="nav-btn"
                style={{ textDecoration: "none", background: "#374151", fontSize: 12, padding: "6px 12px" }}>
                📥 Raw JSON
              </a>
            </div>
          </div>
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
  const [submittedSampleIds, setSubmittedSampleIds] = useState(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [allSamples, setAllSamples] = useState([]);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpCategory, setJumpCategory] = useState("ALL");
  const skipCategoryReset = useRef(false);
  const [page, setPage] = useState("main");
  const [sampleClassification, setSampleClassification] = useState({});
  const [discussionCount, setDiscussionCount] = useState(0);

  const currentStatus = sample ? sampleClassification[sample.sample_id] || null : null;
  const resetState = () => { setScores({ q1: null }); setLabel(""); };

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
    try {
      const [idxRes, allRes] = await Promise.all([
        axios.get(`${BASE_URL}/submitted_ids?annotator=${ann}&category=${cat}`),
        axios.get(`${BASE_URL}/annotations?annotator=${ann}`),
      ]);
      setSubmittedIndices(new Set(idxRes.data.submitted_indices));
      const ids = (allRes.data || []).filter(a => a.round === 1 || a.round == null).map(a => a.sample_id);
      setSubmittedSampleIds(new Set(ids));
    } catch {}
  }, []);

  const fetchSampleByIndex = async (index, cat) => {
    const res = await axios.get(`${BASE_URL}/sample`, { params: { index, category: cat } });
    const data = res.data;
    setSample(data);
    setCurrentIndex(data.current_index - 1);
    setCurrentStep(data.current_index);
    setTotal(data.total);
    return data;
  };

  const fetchProgress = useCallback(async (ann, cat) => {
    const res = await axios.get(
      `${BASE_URL}/progress?annotator=${ann ?? annotator ?? ""}&category=${cat ?? category ?? "ALL"}`
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
    } catch {}
  }, []);

  const fetchDiscussionCount = useCallback(async () => {
    try {
      const res = await axios.get(`${BASE_URL}/discussion_samples`);
      const unresolved = (res.data.samples || []).filter(s => !s.resolved).length;
      setDiscussionCount(unresolved);
    } catch {}
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("annotator");
    fetchAllSamples(); fetchClassification(); fetchDiscussionCount();
    if (saved) {
      fetchProgress(saved, "ALL"); fetchSubmittedIndices(saved, "ALL");
      axios.get(`${BASE_URL}/last_index?annotator=${saved}&category=ALL`).then(res => {
        fetchSampleByIndex(res.data.last_index, "ALL").then(data => loadAnnotation(data, saved));
      });
    } else {
      fetchSampleByIndex(0, "ALL");
    }
  }, []);

  useEffect(() => {
    if (skipCategoryReset.current) { skipCategoryReset.current = false; return; }
    fetchSampleByIndex(0, category);
    fetchProgress(annotator, category);
    if (annotator) fetchSubmittedIndices(annotator, category);
  }, [category]);

  const handleAnnotatorSelect = async (a) => {
    setAnnotator(a); localStorage.setItem("annotator", a);
    fetchProgress(a, category); fetchSubmittedIndices(a, category);
    const res = await axios.get(`${BASE_URL}/last_index?annotator=${a}&category=${category}`);
    const data = await fetchSampleByIndex(res.data.last_index, category);
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
    if (scores.q1 === null) { alert("Q1 점수를 선택해주세요"); return; }
    if (scores.q1 <= 3 && label === "") { alert("Q1이 1~3점인 경우 Final Label을 선택해야 합니다"); return; }
    try {
      await axios.post(`${BASE_URL}/submit`, {
        sample_id: sample.sample_id, annotator, q1: scores.q1,
        final_label: scores.q1 <= 3 ? label : null, round: 1,
      });
      fetchProgress(annotator, category);
      fetchSubmittedIndices(annotator, category);
      fetchClassification();
      fetchDiscussionCount();
      if (currentStep < total) {
        await nextSample();
      } else {
        const pRes = await axios.get(`${BASE_URL}/progress?annotator=${annotator}&category=${category}`);
        const remaining = pRes.data.total - pRes.data.done;
        if (remaining > 0) {
          const sRes = await axios.get(`${BASE_URL}/submitted_ids?annotator=${annotator}&category=${category}`);
          const sSet = new Set(sRes.data.submitted_indices);
          const first = [...Array(pRes.data.total).keys()].find(i => !sSet.has(i));
          if (window.confirm(`⚠️ 미제출 샘플이 ${remaining}개 남아있습니다!\n이동할까요?`) && first !== undefined) {
            const data = await fetchSampleByIndex(first, category);
            await loadAnnotation(data, annotator);
          }
        } else {
          alert("🎉 모든 문항을 완료했습니다!");
        }
      }
    } catch (err) { console.error(err); alert("제출 실패"); }
  };

  const jumpList = jumpCategory === "ALL" ? allSamples : allSamples.filter(s => s.category === jumpCategory);
  const scoreDescriptions = { 5: "매우 적절함", 4: "적절함", 3: "보통", 2: "부적절함", 1: "매우 부적절함" };
  const renderRadios = q => [1, 2, 3, 4, 5].map(n => (
    <label key={n} className="radio">
      <input type="radio" checked={scores[q] === n} onChange={() => setScore(q, n)} /> {n} : {scoreDescriptions[n]}
    </label>
  ));

  if (page === "admin") return <AdminPage onBack={() => setPage("main")} />;
  if (page === "discussion") return (
    <DiscussionPage
      onBack={() => { setPage("main"); fetchClassification(); fetchDiscussionCount(); }}
      allSamples={allSamples}
    />
  );
  if (!sample) return null;

  const progressPct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="container">
      {/* HEADER */}
      <div className="header">
        <h1>News Sentence Human Evaluation</h1>
        <div className="header-actions">
          {annotator && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>내 진행도</span>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>
                {progress.done}/{progress.total}
              </span>
            </div>
          )}
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{currentStep} / {total}</span>
          <button onClick={() => setPage("admin")} className="nav-btn" style={{ background: "#4f83f3", fontSize: 12 }}>
            📊 대시보드
          </button>
          <button onClick={() => setPage("discussion")} className="nav-btn"
            style={{
              background: discussionCount > 0 ? "#f59e0b" : "#e5e7eb",
              color: discussionCount > 0 ? "#fff" : "#6b7280",
              fontSize: 12, position: "relative",
            }}>
            💬 상의 필요
            {discussionCount > 0 && (
              <span className="badge-count">{discussionCount > 99 ? "99+" : discussionCount}</span>
            )}
          </button>
        </div>
      </div>

      {/* 샘플 영역 */}
      <div className="sample-top-card">
        <div className="sample-top-meta">
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              ID: <strong style={{ color: "#111827" }}>{sample.sample_id}</strong>
            </span>
            <span style={{ fontSize: 13, color: "#6b7280" }}>Article: {sample.article_id}</span>
            <span className="llm-big">LLM: {sample.predicted}</span>
            {currentStatus && (
              <span className="status-badge" style={{
                background: `${STATUS_LABELS[currentStatus.status]?.color}15`,
                color: STATUS_LABELS[currentStatus.status]?.color,
              }}>
                {STATUS_LABELS[currentStatus.status]?.text}
                {currentStatus.confirmed_label && ` (${currentStatus.confirmed_label})`}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={prevSample} className="nav-btn" disabled={currentStep === 1}>← Prev</button>
            <span style={{ fontSize: 12, color: "#9ca3af", minWidth: 60, textAlign: "center" }}>
              {currentStep}/{total}
            </span>
            <button onClick={nextSample} className="nav-btn" disabled={currentStep === total}>Next →</button>
          </div>
        </div>
        <div className="sample-sentences">
          <div className="sentence-block">
            <span className="sentence-label">Previous</span>
            <span className="sentence-text muted">{sample.previous || "이전 문장이 없습니다."}</span>
          </div>
          <div className="sentence-block target-block">
            <span className="sentence-label">Target</span>
            <span className="sentence-text target-text">{sample.target}</span>
          </div>
          <div className="sentence-block">
            <span className="sentence-label">Next</span>
            <span className="sentence-text muted">{sample.next || "다음 문장이 없습니다."}</span>
          </div>
        </div>
      </div>

      {/* 하단: 가이드라인 + 평가 */}
      <div className="main">
        <div style={{ flex: "0 0 320px" }}><GuidelinePanel /></div>

        <div className="card" style={{ flex: 1 }}>
          <h2 style={{ margin: "0 0 12px 0", fontSize: 16, color: "#111827" }}>Evaluation</h2>

          {/* 카테고리 */}
          <div className="category-group">
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCategory(c)} className={category === c ? "selected" : ""}>{c}</button>
            ))}
          </div>

          {/* 샘플 Jump */}
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => setJumpOpen(!jumpOpen)} className="nav-btn"
              style={{ width: "100%", marginBottom: 6, background: "#e5e7eb", color: "#374151" }}>
              📋 샘플 목록 {jumpOpen ? "▲" : "▼"}
            </button>
            {jumpOpen && (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, background: "#f9fafb" }}>
                <div style={{ marginBottom: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {CATEGORIES.map(c => (
                    <button key={c} onClick={() => setJumpCategory(c)}
                      className={jumpCategory === c ? "selected" : ""}
                      style={{ fontSize: 11, padding: "2px 6px" }}>{c}</button>
                  ))}
                </div>
                <select style={{ width: "100%", padding: 8, background: "white", color: "#111827",
                  border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12 }} size={8}
                  onChange={async (e) => {
                    const globalIdx = parseInt(e.target.value);
                    const clicked = allSamples[globalIdx]; if (!clicked) return;
                    const cat = clicked.category;
                    const catList = allSamples.filter(s => s.category === cat);
                    const catIdx = catList.findIndex(s => s.sample_id === clicked.sample_id);
                    skipCategoryReset.current = true; setCategory(cat);
                    const data = await fetchSampleByIndex(catIdx, cat);
                    await loadAnnotation(data, annotator);
                    fetchProgress(annotator, cat);
                    if (annotator) fetchSubmittedIndices(annotator, cat);
                    setJumpOpen(false);
                  }}>
                  {jumpList.map(s => {
                    const globalIdx = allSamples.findIndex(o => o.sample_id === s.sample_id);
                    const mySubmitted = annotator && submittedSampleIds.has(s.sample_id);
                    const clf = sampleClassification[s.sample_id];
                    const mark = mySubmitted ? "✅"
                      : clf?.status === "needs_discussion" ? "⚠️"
                      : clf?.status === "discussion_resolved" ? "💬" : "⬜";
                    return <option key={s.sample_id} value={globalIdx}>{mark} {s.sample_id}</option>;
                  })}
                </select>
              </div>
            )}
          </div>

          {/* Annotator */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontWeight: 600, fontSize: 14, color: "#374151", marginBottom: 6 }}>
              Annotator <span className="required">*</span>
            </p>
            <div className="annotator-group">
              {ANNOTATORS.map(a => (
                <button key={a} onClick={() => handleAnnotatorSelect(a)}
                  className={`annotator-chip ${annotator === a ? "active" : ""}`}>
                  Annotator {a}
                </button>
              ))}
            </div>
          </div>

          {/* 제출 여부 */}
          {annotator && (
            <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 600,
              color: submittedIndices.has(currentIndex) ? "#16a34a" : "#9ca3af" }}>
              {submittedIndices.has(currentIndex) ? "✅ 이미 제출한 샘플입니다" : "⬜ 미제출 샘플입니다"}
            </div>
          )}

          {/* Q1 */}
          <div className="question">
            <p>Q. LLM이 부여한 라벨이 적절한가? <span className="required">*</span></p>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>
              4~5점: LLM 라벨({sample.predicted}) 확정 &nbsp;|&nbsp; 1~3점: 아래에서 직접 라벨 선택 필요
            </div>
            {renderRadios("q1")}
          </div>

          {/* Final Label (q1 <= 3일 때만) */}
          {scores.q1 !== null && scores.q1 <= 3 && (
            <div className="question">
              <p>Final Label <span className="required">*</span>
                <span style={{ fontSize: 11, color: "#d97706", marginLeft: 6 }}>
                  (Q1 1~3점 → 직접 라벨 선택)
                </span>
              </p>
              <div className="label-group">
                {["F", "C", "M", "Unsure"].map(l => (
                  <button key={l} onClick={() => setLabel(l)}
                    className={`label-btn ${label === l ? "active" : ""}`}>{l}</button>
                ))}
              </div>
            </div>
          )}

          <button className="submit-btn" onClick={submit}>Submit</button>
        </div>
      </div>
    </div>
  );
}

export default App;
