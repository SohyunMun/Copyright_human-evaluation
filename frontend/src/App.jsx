import { useState, useEffect } from "react";
import axios from "axios";
import "./App.css";

function App() {
  const [annotator, setAnnotator] = useState(null);
  const [scores, setScores] = useState({ q1: null });
  const [label, setLabel] = useState("");

  const [sample, setSample] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [iaa, setIAA] = useState({
    fleiss_kappa: 0,
    alpha_q1: 0
  });

  const [currentStep, setCurrentStep] = useState(1);
  const [total, setTotal] = useState(1);

  const current = sample;

  const [category, setCategory] = useState("ALL");
  const [progressDetail, setProgressDetail] = useState({});

  const ANNOTATORS = ["A", "B", "C", "D", "E"];

  const BASE_URL = "https://copyrighthuman-evaluation-production-df30.up.railway.app";
  
  useEffect(() => {
    fetchSample();
    fetchProgress();
    fetchIAA();
  }, []);

  // Annotator가 바뀌면 해당 샘플 annotation 로드
  useEffect(() => {
    if (current && annotator) {
      loadAnnotation(current);
      fetchProgress();
    }
  }, [annotator]);

  // category 변경 시 
  useEffect(() => {
    fetchSample(category);
    fetchProgress();
    fetchProgressDetail(category);
    fetchIAA();
  }, [category]);

  // 샘플 + annotation 로드 함수
  const loadAnnotation = async (sampleData) => {
    if (annotator) {
      try {
        const ann = await axios.get(
          `${BASE_URL}/annotation/${sampleData.sample_id}/${annotator}`
        );

        setScores({ q1: ann.data.q1 });
        setLabel(ann.data.final_label || "");
      } catch {
        resetState();
      }
    } else {
      resetState();
    }
  };

  const fetchSample = async (selectedCategory = category) => {
    const res = await axios.get(
      `${BASE_URL}/sample?annotator=${annotator || ""}&category=${selectedCategory}`
    );

    setSample(data);
    setCurrentStep(data.current_index);
    setTotal(data.total);

    await loadAnnotation(data);
  };

  const nextSample = async () => {
    if (currentStep === total) return;

    const res = await axios.get(
      `${BASE_URL}/next?annotator=${annotator || ""}&category=${category}`
    );
    const data = res.data;

    setSample(data);
    setCurrentStep(data.current_index);
    setTotal(data.total);

    await loadAnnotation(data);
  };

  const prevSample = async () => {
    if (currentStep === 1) return;

    const res = await axios.get(
      `${BASE_URL}/prev?annotator=${annotator || ""}&category=${category}`
    );
    const data = res.data;

    setSample(data);
    setCurrentStep(data.current_index);
    setTotal(data.total);

    await loadAnnotation(data);
  };

  const fetchProgress = async (selectedCategory = category) => {
    const res = await axios.get(
      `${BASE_URL}/progress?annotator=${annotator || ""}&category=${selectedCategory}`
    );
    setProgress(res.data);
  };

  const fetchProgressDetail = async (selectedCategory = category) => {
    const res = await axios.get(
      `${BASE_URL}/progress_detail?category=${selectedCategory}`
    );
    setProgressDetail(res.data);
  };

  const fetchIAA = async () => {
    const res = await axios.get(`${BASE_URL}/iaa`);
    setIAA(res.data);
  };

  const resetState = () => {
    setScores({ q1: null });
    setLabel("");
  };

  const setScore = (key, value) => {
    setScores({ ...scores, [key]: value });
  };

  const submit = async () => {
    if (!annotator) {
      alert("Annotator를 선택하세요");
      return;
    }

    if (scores.q1 === null || label === "") {
      alert("모든 문항(*)을 입력해야 합니다");
      return;
    }

    if (currentStep === total) {
      alert("모든 문항을 완료했습니다!");
    }

    try {
      await axios.post(`${BASE_URL}/submit`, {
        sample_id: current.sample_id,
        annotator,
        q1: scores.q1,
        final_label: label
      });

      fetchProgress();
      fetchProgressDetail(category);
      fetchIAA();

      // 저장 후 현재 값 유지 + 다음으로 이동
      nextSample();
    } catch (err) {
      console.error(err);
      alert("제출 실패");
    }
  };

  const scoreDescriptions = {
    5: "매우 적절함",
    4: "적절함",
    3: "보통",
    2: "부적절함",
    1: "매우 부적절함"
  };

  const renderRadios = (q) =>
    [1, 2, 3, 4, 5].map((n) => (
      <label key={n} className="radio">
        <input
          type="radio"
          checked={scores[q] === n}
          onChange={() => setScore(q, n)}
        />
        {n} : {scoreDescriptions[n]}
      </label>
    ));

  if (!current) return null;

  return (
    <div className="container">
      {/* HEADER */}
      <div className="header">
        <h1>News Sentence Human Evaluation</h1>

        <div className="header-right nowrap">
          <div className="progress-container">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`
                }}
              />
            </div>

            {/* annotator 기준 진행도 */}
            <span className="progress-text">
              {progress.done} / {progress.total}
            </span>

            <div className="annotator-progress horizontal">
              {ANNOTATORS.map((a) => {
                const p = progressDetail[a] || { done: 0, total: 1 };

                return (
                  <div key={a} className="annotator-row">
                    <span>Annotator {a}</span>
                    <div className="mini-bar">
                      <div
                        className="mini-fill"
                        style={{ width: `${(p.done / p.total) * 100}%` }}
                      />
                    </div>
                    <span>
                      {p.done} / {p.total}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 현재 탐색 위치 */}
          <span className="inline-text">
            Viewing {currentStep} / {total}
          </span>
          
          {/* IAA */}
          <span className="inline-text">
            Fleiss(Label): {iaa.fleiss_kappa?.toFixed(2) ?? "-"}
          </span>
          <span className="inline-text">
            Alpha(Score): {iaa.alpha_q1?.toFixed(2) ?? "-"}
          </span>

          <div className="nav-group">
            <button
              onClick={prevSample}
              className="nav-btn"
              disabled={currentStep === 1}
            >
              ← Prev
            </button>
            <button
              onClick={nextSample}
              className="nav-btn"
              disabled={currentStep === total}
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      <div className="main">
        {/* LEFT */}
        <div className="card">
          <div className="meta">
            <div>Sample ID: {current.sample_id}</div>
            <div>Article: {current.article_id}</div>
            <div className="llm-big">LLM: {current.predicted}</div>
          </div>

          <p className="label">Previous Sentence</p>
          <p>{current.previous || "이전 문장이 없습니다."}</p>

          <p className="label">Target Sentence</p>
          <p className="target">{current.target}</p>

          <p className="label">Next Sentence</p>
          <p>{current.next || "다음 문장이 없습니다."}</p>
        </div>

        {/* RIGHT */}
        <div className="card">
          <h2>Evaluation</h2>

          <div className="category-group">
            {["ALL","경제","정치","사회","문화","국제","IT과학","스포츠","교육","라이프스타일","지역"].map(c => (
              <button
                key={c}
                onClick={() => {
                  setCategory(c);
                }}
                className={category === c ? "selected" : ""}
                >
                  {c}
                </button>
                ))}
              </div>

          <div className="annotator">
            <p>
              Annotator
              <span className="required">*</span>
            </p>

            <div className="annotator-group">
              {ANNOTATORS.map((a) => (
                <button
                  key={a}
                  onClick={async () => {
                    setAnnotator(a);
                    if (current) {
                      await loadAnnotation(current);
                    }
                  }}
                  className={annotator === a ? "selected" : ""}
                >
                  Annotator {a}
                </button>
              ))}
            </div>
          </div>

          <div className="question">
            <p>
              Q. LLM이 부여한 라벨이 적절한가?
              <span className="required">*</span>
            </p>
            {renderRadios("q1")}
          </div>

          <div className="question">
            <p>
              Final Label
              <span className="required">*</span>
            </p>
            <div className="label-group">
              {["F", "C", "M", "Unsure"].map((l) => (
                <button
                  key={l}
                  onClick={() => setLabel(l)}
                  className={`label-btn ${label === l ? "active" : ""}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <button className="submit-btn" onClick={submit}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
