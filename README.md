# RealInsight
### *Turning Uncertainty into Insight.*

> An AI-powered implementation risk intelligence platform built for RealPage — scoring bookings, allocating resources, and forecasting revenue risk using real BigQuery data and machine learning.

---

## Features

### Dashboard
- Live KPI cards: total bookings, high-risk count, avg MTTI, avg risk score
- Monthly risk distribution bar chart (Low / Medium / High)
- Product family and territory breakdown
- Top backlog and cancellation reasons

### Score a Booking
- XGBoost ML model trained on real Salesforce + BigQuery data
- Input booking parameters (sales type, product family, territory, solutions, etc.)
- Returns a risk score (0–100), tier (High / Medium / Low), and estimated MTTI
- **GPT-4o AI recommendations** — top 3 actions with urgency and owner, flagged with an AI Generated badge

### Cohort Analysis
- Monthly cohort table with Low / Medium / High risk split and drill-down rows
- Spike detection on high-risk months
- Export to CSV (monthly summary + per-month booking drill-downs)

### Resource Allocation
- Scores all PMCs (Property Management Clients) from BigQuery
- Expandable rows with active orders, risk factors, and per-PMC AI recommendations
- **Lazy GPT-4o recommendations** fetched on expand with shimmer loading state

### Finance Forecast
- Revenue at-risk donut chart: Safe Revenue / At-Risk Recoverable / Projected Leakage
- Forward-looking KPIs: Net Expected Revenue, Recovery Opportunity, What-If scenario
- Monthly Revenue Risk Breakdown table with avg MTTI, high-risk value, and leakage
- Export to CSV filtered by year and quarter

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Recharts |
| Backend | FastAPI (Python), Uvicorn |
| ML Model | XGBoost, scikit-learn, joblib |
| AI | OpenAI GPT-4o |
| Data | Google BigQuery (`hck-dev-2876.hck_data`) |
| Auth | Google Cloud service account credentials |

---

## Prerequisites

- Python 3.8 or higher
- Node.js 18 or higher
- A Google Cloud service account credentials file (`credentials.json`)
- An OpenAI API key

---

## Setup & Installation

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

### 3. Add Google Cloud credentials

Place your `credentials.json` service account file in the project root:

```
IRP/
├── credentials.json   ← here
├── backend.py
├── .env
└── ...
```

### 4. Install Python dependencies

```bash
py -3 -m pip install fastapi uvicorn pandas numpy xgboost scikit-learn joblib google-cloud-bigquery openai python-dotenv
```

### 5. Start the backend

```bash
py -3 backend.py
```

The backend starts on **http://localhost:8001**

### 6. Install frontend dependencies

```bash
cd frontend
npm install
```

### 7. Start the frontend

```bash
npm run dev
```

The app opens at **http://localhost:5173**

---

## Project Structure

```
IRP/
├── backend.py              # FastAPI backend — all API endpoints
├── risk_model.py           # XGBoost model training script
├── model_bundle.joblib     # Pre-trained model (loaded at startup)
├── bq_data.py              # BigQuery data helpers
├── credentials.json        # Google Cloud service account (not in git)
├── .env                    # API keys (not in git)
└── frontend/
    └── src/
        ├── pages/          # Dashboard, Scorer, Cohort, Allocation, Finance
        ├── components/     # Sidebar, Header
        ├── api/            # Typed API client with 30-min frontend cache
        └── data/           # Shared types
```

---

## Caching

RealInsight uses a two-layer cache to eliminate loading spinners on repeat visits:

- **Backend** — 30-minute in-memory cache on all BigQuery endpoints
- **Frontend** — Module-level ES cache (30-min TTL) that survives page navigation; data loads instantly on return visits

---

## Notes

- All data is sourced live from BigQuery — no mock or synthetic data in the pipeline
- The XGBoost model is pre-trained and bundled as `model_bundle.joblib`; restart the backend to reload it
- GPT-4o recommendations gracefully fall back to rule-based recommendations if the API key is missing or the call fails
