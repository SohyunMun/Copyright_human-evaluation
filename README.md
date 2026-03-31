## 실행 방법

```bash
# 가상환경 생성 및 활성화
conda create -n copyright python=3.10
conda activate copyright

# Back-End 서버 실행
cd backend
pip install fastapi uvicorn numpy scikit-learn krippendorff
uvicorn main:app --reload

# Front-End 서버 실행
cd frontend
npm install
npm run dev
```
