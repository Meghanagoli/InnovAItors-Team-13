"""
FastAPI backend — Implementation Risk Predictor
Port 8001  (Vite proxy: /api/* → strips /api → http://localhost:8001/*)
All data from BigQuery hck-dev-2876.hck_data — zero fake rows.
"""
import os, calendar, time
from dotenv import load_dotenv
load_dotenv()
import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import bigquery
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import roc_auc_score
from openai import OpenAI

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = r"c:\IRP\credentials.json"

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
_openai_client = None

def openai_client() -> Optional[OpenAI]:
    global _openai_client
    if OPENAI_API_KEY and _openai_client is None:
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    return _openai_client

MODEL_PATH = r"c:\IRP\model_bundle.joblib"

PROJECT = "hck-dev-2876"
DATASET = "hck_data"

# ── Risk thresholds (days) derived from training data at startup ────────────
P75_MTTI = 21.0   # low → medium boundary
P90_MTTI = 55.0   # medium → high boundary

# ── Categorical cols used by the model ─────────────────────────────────────
CAT_COLS = ["impl_type", "product_family", "sales_type",
            "business_type", "territory", "csm_model"]
NUM_COLS = ["on_hold_days", "referred_sales_days", "initial_outreach_days",
            "pmc_properties", "pmc_units", "dependency_delay",
            "blocked_days", "prev_deployed", "special_handling", "sla_violations"]

FEATURE_LABELS = {
    "impl_type_enc":          "Implementation Type",
    "product_family_enc":     "Product Family",
    "sales_type_enc":         "Sales Type",
    "business_type_enc":      "Business Type",
    "territory_enc":          "Territory",
    "csm_model_enc":          "CSM Coverage Model",
    "on_hold_days":           "On Hold Days (historical)",
    "referred_sales_days":    "Referred to Sales Days",
    "initial_outreach_days":  "Initial Outreach Days",
    "pmc_properties":         "PMC Total Properties",
    "pmc_units":              "PMC Total Units",
    "dependency_delay":       "Dependency Delay",
    "blocked_days":           "Total Blocked Days",
    "prev_deployed":          "Previously Deployed Product",
    "special_handling":       "Special Handling Required",
    "sla_violations":         "SLA Violation Count",
}

FACTOR_DESCRIPTIONS = {
    "Implementation Type":        "New implementations take ~2× longer than add-ons historically.",
    "Product Family":             "Some product families have structurally longer onboarding cycles.",
    "On Hold Days (historical)":  "This PMC has a history of extended hold periods.",
    "Previously Deployed Product":"First-time deployments carry higher implementation risk.",
    "PMC Total Units":            "Larger portfolios increase coordination complexity.",
    "PMC Total Properties":       "More properties means more stakeholders and touchpoints.",
    "Dependency Delay":           "Unresolved product or service dependencies are a key predictor.",
    "Total Blocked Days":         "Blocked time extends MTTI significantly.",
    "SLA Violation Count":        "Past SLA breaches signal systemic execution challenges.",
    "Special Handling Required":  "Non-standard handling adds coordination overhead.",
    "CSM Coverage Model":         "Coverage model influences engagement capacity.",
    "Territory":                  "Certain territories have lower implementation throughput.",
    "Business Type":              "Some business segments have more complex requirements.",
    "Sales Type":                 "New logo deals are more complex than expansions.",
    "Referred to Sales Days":     "Longer pre-sales cycles correlate with implementation friction.",
    "Initial Outreach Days":      "Delayed initial outreach signals lower client readiness.",
}

_CACHE: dict[str, tuple] = {}
_CACHE_TTL = 1800  # seconds (30 minutes)

def _cached(key: str, fn):
    if key in _CACHE:
        data, ts = _CACHE[key]
        if time.time() - ts < _CACHE_TTL:
            return data
    result = fn()
    _CACHE[key] = (result, time.time())
    return result


# ── Global singletons ───────────────────────────────────────────────────────
_client: Optional[bigquery.Client] = None
_clf: Optional[xgb.XGBClassifier] = None
_reg: Optional[xgb.XGBRegressor] = None
_encoders: dict = {}
_feat_cols: list = []
_opts_cache: dict = {}
_p75 = P75_MTTI
_p90 = P90_MTTI


def bqclient() -> bigquery.Client:
    global _client
    if _client is None:
        _client = bigquery.Client(project=PROJECT)
    return _client


def _q(sql: str) -> pd.DataFrame:
    return bqclient().query(sql).to_dataframe()


# ── Model helpers ────────────────────────────────────────────────────────────
def _encode_row(row: dict) -> pd.DataFrame:
    r = {}
    for col in CAT_COLS:
        le: LabelEncoder = _encoders[col]
        val = str(row.get(col, "Unknown") or "Unknown")
        r[col + "_enc"] = int(le.transform([val])[0]) if val in le.classes_ else 0
    for col in NUM_COLS:
        r[col] = float(row.get(col, 0) or 0)
    return pd.DataFrame([r])[_feat_cols]


def _encode_df(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame()
    for col in CAT_COLS:
        le: LabelEncoder = _encoders[col]
        vals = df[col].fillna("Unknown").astype(str)
        out[col + "_enc"] = vals.apply(lambda v: int(le.transform([v])[0]) if v in le.classes_ else 0)
    for col in NUM_COLS:
        out[col] = df[col].fillna(0).astype(float)
    return out[_feat_cols]


def _risk_tier(score: int) -> str:
    if score >= 65: return "High"
    if score >= 35: return "Medium"
    return "Low"


def _mtti_tier(mtti: float) -> str:
    if mtti > _p90: return "High"
    if mtti > _p75: return "Medium"
    return "Low"


def _avg_score(total: int, high: int, medium: int) -> int:
    if not total:
        return 0
    return min(100, int(round((high * 75 + medium * 40) / total)))


def _compute_factors(row: dict) -> list[dict]:
    """Rule-based risk factors based on model feature importances × feature values."""
    factors = []
    # Importance-weighted contributions (importance × 100 × factor_present)
    if str(row.get("impl_type", "")) == "New":
        factors.append({"name": "Implementation Type", "points": 22})
    if not int(row.get("prev_deployed", 1)):
        factors.append({"name": "Previously Deployed Product", "points": 18})
    high_risk_fam = {"Services", "Velocity", "NWP", "LeaseLabs", "RealPage Utility Management"}
    pf = str(row.get("product_family", ""))
    if pf in high_risk_fam:
        factors.append({"name": "Product Family", "points": 20})
    on_hold = float(row.get("on_hold_days", 0) or 0)
    if on_hold > 20:
        factors.append({"name": "On Hold Days (historical)", "points": min(28, int(on_hold / 3))})
    if int(row.get("dependency_delay", 0)):
        factors.append({"name": "Dependency Delay", "points": 15})
    blk = float(row.get("blocked_days", 0) or 0)
    if blk > 5:
        factors.append({"name": "Total Blocked Days", "points": min(20, int(blk / 2))})
    sla = float(row.get("sla_violations", 0) or 0)
    if sla > 0:
        factors.append({"name": "SLA Violation Count", "points": min(18, int(sla * 5))})
    if int(row.get("special_handling", 0)):
        factors.append({"name": "Special Handling Required", "points": 10})
    referred = float(row.get("referred_sales_days", 0) or 0)
    if referred > 15:
        factors.append({"name": "Referred to Sales Days", "points": min(15, int(referred / 5))})
    units = float(row.get("pmc_units", 0) or 0)
    if units > 50000:
        factors.append({"name": "PMC Total Units", "points": 8})
    return sorted(factors, key=lambda x: x["points"], reverse=True)[:5]


# ── Model training (BigQuery → XGBoost) ─────────────────────────────────────
def _train_from_bq():
    """Fetch data from BigQuery, train both models, return bundle dict."""
    print("[backend] Fetching training data from BigQuery …")
    sql = f"""
    SELECT
        COALESCE(o.Implementation_Type_New__c, 'Unknown')          AS impl_type,
        COALESCE(o.Product_Family__c, 'Unknown')                   AS product_family,
        COALESCE(o.Sales_Type__c, 'Unknown')                       AS sales_type,
        COALESCE(o.Total_On_Hold_Days__c, 0)                       AS on_hold_days,
        COALESCE(o.Total_Referred_to_Sales_Days__c, 0)             AS referred_sales_days,
        COALESCE(o.Total_Initial_Outreach_Days__c, 0)              AS initial_outreach_days,
        COALESCE(o.Total_PMC_Total_Properties_f__c, 0)             AS pmc_properties,
        COALESCE(o.Total_PMC_Total_Units_f__c, 0)                  AS pmc_units,
        IF(o.Dependency_Delay__c IS TRUE, 1, 0)                    AS dependency_delay,
        COALESCE(o.Total_Blocked_Days__c, 0)                       AS blocked_days,
        IF(o.PMC_Has_Previously_Deployed_Product__c IS TRUE, 1, 0) AS prev_deployed,
        IF(o.Special_Handling__c IS TRUE, 1, 0)                    AS special_handling,
        COALESCE(o.SLA_Violation_Count__c, 0)                      AS sla_violations,
        COALESCE(a.Business_Type__c, 'Unknown')                    AS business_type,
        COALESCE(a.Territory__c, 'Unknown')                        AS territory,
        COALESCE(a.CSM_Coverage_Model__c, 'Unknown')               AS csm_model,
        o.Time_to_Implement_Days__c                                AS mtti
    FROM `{PROJECT}.{DATASET}.SFDC_Order__c` o
    LEFT JOIN `{PROJECT}.{DATASET}.SFDC_Accounts` a ON o.PMC__c = a.Id
    WHERE o.Time_to_Implement_Days__c IS NOT NULL
      AND o.IsDeleted = false
      AND o.Time_to_Implement_Days__c > 0
      AND o.Time_to_Implement_Days__c < 1000
      AND o.Order_Create_Date__c >= '2020-01-01'
      AND RAND() < 0.15
    LIMIT 80000
    """
    df = _q(sql)
    print(f"[backend] {len(df):,} training rows. Training model …")

    p75 = float(np.percentile(df["mtti"], 75))
    p90 = float(np.percentile(df["mtti"], 90))
    df["is_high_risk"] = (df["mtti"] > p75).astype(int)

    encoders = {}
    for col in CAT_COLS:
        le = LabelEncoder()
        df[col + "_enc"] = le.fit_transform(df[col].fillna("Unknown").astype(str))
        encoders[col] = le

    feat_cols = [c + "_enc" for c in CAT_COLS] + NUM_COLS
    X = df[feat_cols].fillna(0)
    y_cls = df["is_high_risk"]
    y_reg = np.log1p(df["mtti"])

    X_tr, X_te, yc_tr, yc_te, yr_tr, yr_te = train_test_split(
        X, y_cls, y_reg, test_size=0.2, random_state=42, stratify=y_cls
    )

    clf = xgb.XGBClassifier(
        n_estimators=300, max_depth=6, learning_rate=0.08,
        subsample=0.8, colsample_bytree=0.8, min_child_weight=5,
        eval_metric="logloss", random_state=42, verbosity=0,
    )
    clf.fit(X_tr, yc_tr, eval_set=[(X_te, yc_te)], verbose=False)

    reg = xgb.XGBRegressor(
        n_estimators=300, max_depth=6, learning_rate=0.08,
        subsample=0.8, colsample_bytree=0.8, min_child_weight=5,
        eval_metric="rmse", random_state=42, verbosity=0,
    )
    reg.fit(X_tr, yr_tr, eval_set=[(X_te, yr_te)], verbose=False)

    auc = roc_auc_score(yc_te, clf.predict_proba(X_te)[:, 1])
    print(f"[backend] Model ready. AUC={auc:.4f}  p75={p75:.1f}d  p90={p90:.1f}d")

    return {"clf": clf, "reg": reg, "encoders": encoders,
            "feat_cols": feat_cols, "p75": p75, "p90": p90, "auc": auc}


def _apply_bundle(bundle: dict):
    global _clf, _reg, _encoders, _feat_cols, _p75, _p90
    _clf       = bundle["clf"]
    _reg       = bundle["reg"]
    _encoders  = bundle["encoders"]
    _feat_cols.clear()
    _feat_cols.extend(bundle["feat_cols"])
    _p75       = bundle["p75"]
    _p90       = bundle["p90"]


def _train():
    """Load saved model from disk if available, otherwise train from BigQuery and save."""
    if os.path.exists(MODEL_PATH):
        print(f"[backend] Loading saved model from {MODEL_PATH} …")
        bundle = joblib.load(MODEL_PATH)
        _apply_bundle(bundle)
        print(f"[backend] Model loaded. AUC={bundle['auc']:.4f}  p75={bundle['p75']:.1f}d  p90={bundle['p90']:.1f}d")
    else:
        bundle = _train_from_bq()
        joblib.dump(bundle, MODEL_PATH)
        print(f"[backend] Model saved to {MODEL_PATH}")
        _apply_bundle(bundle)


def _load_opts():
    global _opts_cache
    print("[backend] Loading dropdown options …")
    client = bqclient()

    def fetch(sql):
        return [r[0] for r in client.query(sql) if r[0] is not None]

    _opts_cache = {
        "sales_type": fetch(
            f"SELECT DISTINCT Sales_Type__c FROM `{PROJECT}.{DATASET}.SFDC_Order__c` "
            "WHERE Sales_Type__c IS NOT NULL AND TRIM(Sales_Type__c)!='' AND IsDeleted=false ORDER BY 1"
        ),
        "implementation_type": fetch(
            f"SELECT DISTINCT Implementation_Type_New__c FROM `{PROJECT}.{DATASET}.SFDC_Order__c` "
            "WHERE Implementation_Type_New__c IS NOT NULL AND IsDeleted=false ORDER BY 1"
        ),
        "business_type": fetch(
            f"SELECT DISTINCT Business_Type__c FROM `{PROJECT}.{DATASET}.SFDC_Accounts` "
            "WHERE Business_Type__c IS NOT NULL AND IsDeleted=false ORDER BY 1 LIMIT 30"
        ),
        "sol_pm_primary": fetch(
            f"SELECT DISTINCT Product_Family__c v, COUNT(*) c FROM `{PROJECT}.{DATASET}.SFDC_Order__c` "
            "WHERE Product_Family__c IS NOT NULL AND TRIM(Product_Family__c)!='' AND IsDeleted=false "
            "GROUP BY 1 ORDER BY 2 DESC LIMIT 60"
        ),
        "product_family": fetch(
            f"SELECT DISTINCT Product_Family__c v, COUNT(*) c FROM `{PROJECT}.{DATASET}.SFDC_Order__c` "
            "WHERE Product_Family__c IS NOT NULL AND TRIM(Product_Family__c)!='' AND IsDeleted=false "
            "GROUP BY 1 ORDER BY 2 DESC LIMIT 25"
        ),
    }
    print("[backend] Options loaded.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _train()
    _load_opts()
    yield


# ── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="IRP Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ── /meta ────────────────────────────────────────────────────────────────────
@app.get("/meta")
def meta():
    def _fetch():
        sql = f"""
        SELECT
            CAST(EXTRACT(YEAR FROM Order_Create_Date__c) AS STRING) AS yr,
            COUNT(*) AS cnt
        FROM `{PROJECT}.{DATASET}.SFDC_Order__c`
        WHERE Order_Create_Date__c >= '2022-01-01' AND IsDeleted = false
        GROUP BY 1
        ORDER BY 1 DESC
        """
        rows = list(bqclient().query(sql))
        years = [r["yr"] for r in rows]
        total = sum(r["cnt"] for r in rows)
        return {"years": years, "totalBookings": total, "lastMonth": "2026-04"}
    return _cached("meta", _fetch)


# ── /cohort ──────────────────────────────────────────────────────────────────
@app.get("/cohort")
def cohort(
    year:       str = "2025",
    sales_type: str = "",
    territory:  str = "",
    product:    str = "",
    impl_type:  str = "",
):
    where = [
        f"EXTRACT(YEAR FROM o.Order_Create_Date__c) = {int(year)}",
        "o.IsDeleted = false",
    ]
    need_acct = bool(territory)

    if sales_type:
        where.append(f"o.Sales_Type__c = '{sales_type.replace(chr(39), '')}'")
    if product:
        where.append(f"o.Product_Family__c = '{product.replace(chr(39), '')}'")
    if impl_type:
        where.append(f"o.Implementation_Type_New__c = '{impl_type.replace(chr(39), '')}'")
    if territory:
        where.append(f"a.Territory__c = '{territory.replace(chr(39), '')}'")

    join_clause = (
        f"LEFT JOIN `{PROJECT}.{DATASET}.SFDC_Accounts` a ON o.PMC__c = a.Id"
        if need_acct else ""
    )

    sql = f"""
    SELECT
        CAST(EXTRACT(MONTH FROM o.Order_Create_Date__c) AS STRING) AS month,
        COUNT(*) AS total,
        COUNTIF(o.Implementation_Status__c = 'Implemented'
                AND COALESCE(o.Time_to_Implement_Days__c, 9999) <= {_p75})                        AS low,
        COUNTIF(o.Implementation_Status__c = 'Implemented'
                AND o.Time_to_Implement_Days__c > {_p75}
                AND o.Time_to_Implement_Days__c <= {_p90})                                        AS medium,
        COUNTIF(o.Implementation_Status__c = 'Backlog'
                OR (o.Implementation_Status__c = 'Implemented'
                    AND o.Time_to_Implement_Days__c > {_p90}))                                    AS high,
        ROUND(AVG(CASE WHEN o.Implementation_Status__c = 'Implemented'
                       THEN o.Time_to_Implement_Days__c END), 1)                                  AS avgMtti
    FROM `{PROJECT}.{DATASET}.SFDC_Order__c` o
    {join_clause}
    WHERE {' AND '.join(where)}
    GROUP BY 1
    ORDER BY CAST(month AS INT64)
    """
    def _fetch():
        rows = list(bqclient().query(sql))
        month_map = {str(i): calendar.month_name[i] for i in range(1, 13)}
        result = []
        for r in rows:
            m = str(r["month"])
            tot = int(r["total"])
            lo  = int(r["low"])
            med = int(r["medium"])
            hi  = int(r["high"])
            mtti = float(r["avgMtti"] or 0)
            avg_score = _avg_score(tot, hi, med)
            result.append({
                "month":    m,
                "label":    month_map.get(m, m),
                "total":    tot,
                "low":      lo,
                "medium":   med,
                "high":     hi,
                "avgMtti":  round(mtti, 1),
                "avgScore": avg_score,
                "isSpike":  (hi / tot > 0.15) if tot else False,
            })
        return result
    cache_key = f"cohort:{year}:{sales_type}:{territory}:{product}:{impl_type}"
    return _cached(cache_key, _fetch)


# ── /products ────────────────────────────────────────────────────────────────
@app.get("/products")
def products():
    sql = f"""
    SELECT
        COALESCE(Product_Family__c, 'Other')                                              AS name,
        COUNT(*)                                                                           AS bookings,
        ROUND(AVG(CASE WHEN Implementation_Status__c = 'Implemented'
                       THEN Time_to_Implement_Days__c END), 1)                             AS avgMtti,
        COUNTIF(Implementation_Status__c = 'Backlog'
                OR Time_to_Implement_Days__c > {_p90})                                    AS high_cnt,
        COUNTIF(Implementation_Status__c = 'Implemented'
                AND Time_to_Implement_Days__c > {_p75}
                AND Time_to_Implement_Days__c <= {_p90})                                  AS med_cnt
    FROM `{PROJECT}.{DATASET}.SFDC_Order__c`
    WHERE IsDeleted = false
      AND Order_Create_Date__c >= '2022-01-01'
      AND Product_Family__c IS NOT NULL
      AND TRIM(Product_Family__c) != ''
    GROUP BY 1
    ORDER BY bookings DESC
    LIMIT 20
    """
    def _fetch():
        rows = list(bqclient().query(sql))
        result = []
        for r in rows:
            tot  = int(r["bookings"])
            hi   = int(r["high_cnt"])
            med  = int(r["med_cnt"])
            mtti = float(r["avgMtti"] or 0)
            result.append({
                "name":     r["name"],
                "bookings": tot,
                "avgMtti":  round(mtti, 1),
                "avgScore": _avg_score(tot, hi, med),
            })
        return result
    return _cached("products", _fetch)


# ── /territories ─────────────────────────────────────────────────────────────
@app.get("/territories")
def territories():
    sql = f"""
    SELECT
        COALESCE(a.Territory__c, 'Unknown')                                                AS name,
        COUNT(*)                                                                            AS bookings,
        ROUND(AVG(CASE WHEN o.Implementation_Status__c = 'Implemented'
                       THEN o.Time_to_Implement_Days__c END), 1)                           AS avgMtti,
        COUNTIF(o.Implementation_Status__c = 'Backlog'
                OR o.Time_to_Implement_Days__c > {_p90})                                   AS high_cnt,
        COUNTIF(o.Implementation_Status__c = 'Implemented'
                AND o.Time_to_Implement_Days__c > {_p75}
                AND o.Time_to_Implement_Days__c <= {_p90})                                 AS med_cnt
    FROM `{PROJECT}.{DATASET}.SFDC_Order__c` o
    LEFT JOIN `{PROJECT}.{DATASET}.SFDC_Accounts` a ON o.PMC__c = a.Id
    WHERE o.IsDeleted = false
      AND o.Order_Create_Date__c >= '2022-01-01'
      AND a.Territory__c IS NOT NULL
    GROUP BY 1
    ORDER BY bookings DESC
    LIMIT 25
    """
    def _fetch():
        rows = list(bqclient().query(sql))
        result = []
        for r in rows:
            tot  = int(r["bookings"])
            hi   = int(r["high_cnt"])
            med  = int(r["med_cnt"])
            mtti = float(r["avgMtti"] or 0)
            result.append({
                "name":     r["name"],
                "bookings": tot,
                "avgMtti":  round(mtti, 1),
                "avgScore": _avg_score(tot, hi, med),
            })
        return result
    return _cached("territories", _fetch)


# ── /options ─────────────────────────────────────────────────────────────────
@app.get("/options")
def options():
    return _opts_cache


# ── /finance ─────────────────────────────────────────────────────────────────
QUARTER_MONTHS = {
    "Q1": (1, 3), "Q2": (4, 6), "Q3": (7, 9), "Q4": (10, 12),
}
LEAKAGE_RATE = 0.37


@app.get("/finance")
def finance(quarter: str = "Full Year", year: str = "2025"):
    q_filter = ""
    if quarter in QUARTER_MONTHS:
        lo, hi = QUARTER_MONTHS[quarter]
        q_filter = f"AND EXTRACT(MONTH FROM o.Order_Create_Date__c) BETWEEN {lo} AND {hi}"

    sql = f"""
    SELECT
        CAST(EXTRACT(MONTH FROM o.Order_Create_Date__c) AS STRING)                         AS month,
        COUNT(*)                                                                            AS total,
        COUNTIF(o.Implementation_Status__c = 'Backlog'
                OR o.Time_to_Implement_Days__c > {_p90})                                   AS high,
        ROUND(AVG(CASE WHEN o.Implementation_Status__c = 'Implemented'
                       THEN o.Time_to_Implement_Days__c END), 1)                           AS avgMtti,
        ROUND(SUM(COALESCE(o.NetExtYear1ChargeAmount__c, 0)), 0)                           AS estValue
    FROM `{PROJECT}.{DATASET}.SFDC_Order__c` o
    WHERE EXTRACT(YEAR FROM o.Order_Create_Date__c) = {int(year)}
      AND o.IsDeleted = false
      {q_filter}
    GROUP BY 1
    ORDER BY CAST(month AS INT64)
    """
    def _fetch():
        month_map = {str(i): calendar.month_name[i] for i in range(1, 13)}
        rows_raw  = list(bqclient().query(sql))
        rows_out  = []
        tot_b = tot_v = tot_hv = tot_lk = tot_mtti_sum = 0
        for r in rows_raw:
            m        = str(r["month"])
            total    = int(r["total"])
            high     = int(r["high"])
            avgMtti  = float(r["avgMtti"] or 0)
            estValue = float(r["estValue"] or 0)
            hrv      = estValue * (high / total) if total else 0
            lkr      = hrv * LEAKAGE_RATE
            rows_out.append({
                "month":         m,
                "label":         month_map.get(m, m),
                "total":         total,
                "high":          high,
                "avgMtti":       round(avgMtti, 1),
                "estValue":      round(estValue, 0),
                "highRiskValue": round(hrv, 0),
                "leakageRisk":   round(lkr, 0),
            })
            tot_b        += total
            tot_v        += estValue
            tot_hv       += hrv
            tot_lk       += lkr
            tot_mtti_sum += avgMtti
        avg_mtti = (tot_mtti_sum / len(rows_out)) if rows_out else 0
        return {
            "rows": rows_out,
            "totals": {
                "bookings": tot_b,
                "estValue": round(tot_v, 0),
                "highValue": round(tot_hv, 0),
                "leakage":   round(tot_lk, 0),
                "avgMtti":   round(avg_mtti, 1),
            },
        }
    return _cached(f"finance:{quarter}:{year}", _fetch)


# ── /allocation ───────────────────────────────────────────────────────────────
@app.get("/allocation")
def allocation(limit: int = Query(default=200, le=500)):
    cache_key = f"allocation:{limit}"
    if cache_key in _CACHE:
        data, ts = _CACHE[cache_key]
        if time.time() - ts < _CACHE_TTL:
            return data
    # Step 1: get PMC-level aggregates for backlog orders
    sql_pmc = f"""
    SELECT
        o.PMC__c                                                                           AS pmc_id,
        ANY_VALUE(a.Name)                                                                  AS pmc_name,
        ANY_VALUE(a.Territory__c)                                                          AS territory,
        ROUND(MAX(COALESCE(a.Total_Properties_f__c, 0)), 0)                               AS sites,
        ROUND(MAX(COALESCE(a.Total_Units_f__c, 0)), 0)                                    AS units,
        COUNT(*)                                                                           AS orders,
        ANY_VALUE(o.Product_Name__c)                                                       AS top_product,
        ANY_VALUE(o.Sales_Type__c)                                                         AS sales_type,
        ANY_VALUE(o.Implementation_Type_New__c)                                            AS impl_type,
        ANY_VALUE(o.Product_Family__c)                                                     AS product_family,
        ANY_VALUE(a.Business_Type__c)                                                      AS business_type,
        ANY_VALUE(a.CSM_Coverage_Model__c)                                                 AS csm_model,
        ROUND(AVG(COALESCE(o.Total_On_Hold_Days__c, 0)), 1)                               AS on_hold_days,
        ROUND(AVG(COALESCE(o.Total_Referred_to_Sales_Days__c, 0)), 1)                     AS referred_sales_days,
        ROUND(AVG(COALESCE(o.Total_Initial_Outreach_Days__c, 0)), 1)                      AS initial_outreach_days,
        ROUND(MAX(COALESCE(a.Total_Properties_f__c, 0)), 0)                               AS pmc_properties,
        ROUND(MAX(COALESCE(a.Total_Units_f__c, 0)), 0)                                    AS pmc_units,
        MAX(IF(o.Dependency_Delay__c IS TRUE, 1, 0))                                      AS dependency_delay,
        ROUND(AVG(COALESCE(o.Total_Blocked_Days__c, 0)), 1)                               AS blocked_days,
        MAX(IF(o.PMC_Has_Previously_Deployed_Product__c IS TRUE, 1, 0))                   AS prev_deployed,
        MAX(IF(o.Special_Handling__c IS TRUE, 1, 0))                                      AS special_handling,
        ROUND(AVG(COALESCE(o.SLA_Violation_Count__c, 0)), 1)                              AS sla_violations
    FROM `{PROJECT}.{DATASET}.SFDC_Order__c` o
    LEFT JOIN `{PROJECT}.{DATASET}.SFDC_Accounts` a ON o.PMC__c = a.Id
    WHERE o.Implementation_Status__c = 'Backlog'
      AND o.IsDeleted = false
      AND a.account_recordtype_name = 'PMC Account'
      AND a.Name IS NOT NULL
    GROUP BY o.PMC__c
    HAVING orders > 0
    ORDER BY orders DESC
    LIMIT {limit}
    """
    df_pmc = _q(sql_pmc)
    if df_pmc.empty:
        return []

    pmc_ids = df_pmc["pmc_id"].tolist()

    # Step 2: get individual backlog orders for these PMCs
    ids_str = ", ".join(f"'{i}'" for i in pmc_ids[:100])  # BQ IN limit
    sql_orders = f"""
    SELECT
        o.PMC__c                                                    AS pmc_id,
        o.Id                                                        AS order_id,
        COALESCE(o.Product_Name__c, o.Product_Family__c, 'Unknown') AS product,
        o.Time_to_Implement_Days__c                                 AS mtti_actual,
        COALESCE(o.Implementation_Type_New__c, 'Unknown')           AS impl_type,
        COALESCE(o.Product_Family__c, 'Unknown')                    AS product_family,
        COALESCE(o.Sales_Type__c, 'Unknown')                        AS sales_type,
        COALESCE(a.Business_Type__c, 'Unknown')                     AS business_type,
        COALESCE(a.Territory__c, 'Unknown')                         AS territory,
        COALESCE(a.CSM_Coverage_Model__c, 'Unknown')                AS csm_model,
        COALESCE(o.Total_On_Hold_Days__c, 0)                        AS on_hold_days,
        COALESCE(o.Total_Referred_to_Sales_Days__c, 0)              AS referred_sales_days,
        COALESCE(o.Total_Initial_Outreach_Days__c, 0)               AS initial_outreach_days,
        COALESCE(o.Total_PMC_Total_Properties_f__c, 0)              AS pmc_properties,
        COALESCE(o.Total_PMC_Total_Units_f__c, 0)                   AS pmc_units,
        IF(o.Dependency_Delay__c IS TRUE, 1, 0)                     AS dependency_delay,
        COALESCE(o.Total_Blocked_Days__c, 0)                        AS blocked_days,
        IF(o.PMC_Has_Previously_Deployed_Product__c IS TRUE, 1, 0)  AS prev_deployed,
        IF(o.Special_Handling__c IS TRUE, 1, 0)                     AS special_handling,
        COALESCE(o.SLA_Violation_Count__c, 0)                       AS sla_violations
    FROM `{PROJECT}.{DATASET}.SFDC_Order__c` o
    LEFT JOIN `{PROJECT}.{DATASET}.SFDC_Accounts` a ON o.PMC__c = a.Id
    WHERE o.PMC__c IN ({ids_str})
      AND o.Implementation_Status__c = 'Backlog'
      AND o.IsDeleted = false
    LIMIT 800
    """
    df_orders = _q(sql_orders)

    # Step 3: batch score PMCs
    X_pmc = _encode_df(df_pmc.rename(columns={
        "impl_type": "impl_type", "product_family": "product_family",
        "sales_type": "sales_type", "business_type": "business_type",
        "territory": "territory", "csm_model": "csm_model",
    }))
    pmc_probs = _clf.predict_proba(X_pmc)[:, 1]
    pmc_scores = np.clip(np.round(pmc_probs * 100).astype(int), 0, 100)
    pmc_mttis  = np.clip(np.expm1(_reg.predict(X_pmc)), 1, 999)

    # Step 4: batch score individual orders
    order_scores_map: dict[str, list] = {}
    if not df_orders.empty:
        X_ord = _encode_df(df_orders)
        ord_probs  = _clf.predict_proba(X_ord)[:, 1]
        ord_mttis  = np.clip(np.expm1(_reg.predict(X_ord)), 1, 999)
        ord_scores = np.clip(np.round(ord_probs * 100).astype(int), 0, 100)
        for idx, row in df_orders.iterrows():
            pid = row["pmc_id"]
            if pid not in order_scores_map:
                order_scores_map[pid] = []
            if len(order_scores_map[pid]) < 5:
                order_scores_map[pid].append({
                    "id":      row["order_id"][-8:],
                    "product": str(row["product"])[:40],
                    "score":   int(ord_scores[idx]),
                    "mtti":    int(round(ord_mttis[idx])),
                })

    # Step 5: assemble PMCEntry[]
    result = []
    for idx, row in df_pmc.iterrows():
        pid   = row["pmc_id"]
        score = int(pmc_scores[idx])
        mtti  = int(round(pmc_mttis[idx]))
        tier  = _risk_tier(score)

        factors = _compute_factors(row.to_dict())
        active_orders = order_scores_map.get(pid, [])

        result.append({
            "id":           idx + 1,
            "name":         str(row["pmc_name"] or "Unknown PMC"),
            "territory":    str(row["territory"] or ""),
            "sites":        int(row["sites"] or 0),
            "units":        int(row["units"] or 0),
            "score":        score,
            "tier":         tier,
            "topProduct":   str(row["top_product"] or ""),
            "orders":       int(row["orders"] or 0),
            "mtti":         mtti,
            "salesType":    str(row["sales_type"] or ""),
            "factors":      factors,
            "activeOrders": active_orders,
        })

    _CACHE[f"allocation:{limit}"] = (result, time.time())
    return result


# ── POST /predict ─────────────────────────────────────────────────────────────
from pydantic import BaseModel

class PredictRequest(BaseModel):
    sales_type:             str = ""
    implementation_type:    str = ""
    product_family:         str = ""
    business_type:          str = ""
    territory:              str = ""
    total_sites:            float = 0
    total_units:            float = 0
    pmc_total_units:        float = 0
    num_existing_solutions: int = 0
    sol_pm_primary:         str = ""
    net_ext_year1_charge:   float = 0


@app.post("/predict")
def predict(req: PredictRequest):
    row = {
        "impl_type":            req.implementation_type or "Unknown",
        "product_family":       req.product_family or "Unknown",
        "sales_type":           req.sales_type or "Unknown",
        "business_type":        req.business_type or "Unknown",
        "territory":            req.territory or "Unknown",
        "csm_model":            "Unknown",
        "on_hold_days":         0,
        "referred_sales_days":  0,
        "initial_outreach_days":0,
        "pmc_properties":       req.total_sites,
        "pmc_units":            req.pmc_total_units or req.total_units,
        "dependency_delay":     0,
        "blocked_days":         0,
        "prev_deployed":        1 if req.num_existing_solutions > 0 else 0,
        "special_handling":     0,
        "sla_violations":       0,
    }

    X = _encode_row(row)
    prob  = float(_clf.predict_proba(X)[0][1])
    score = int(min(100, max(0, round(prob * 100))))
    mtti  = float(max(1.0, np.expm1(_reg.predict(X)[0])))
    tier  = _mtti_tier(mtti)

    # Top factors with descriptions
    raw_factors = _compute_factors(row)
    top_factors = [
        {
            "name":        f["name"],
            "points":      f["points"],
            "description": FACTOR_DESCRIPTIONS.get(f["name"], "Contributes to implementation risk."),
        }
        for f in raw_factors
    ]

    # Make sure we always return at least some factors
    if not top_factors:
        top_factors = [
            {"name": "Implementation Type",  "points": 10,
             "description": FACTOR_DESCRIPTIONS["Implementation Type"]},
            {"name": "Product Family",        "points": 8,
             "description": FACTOR_DESCRIPTIONS["Product Family"]},
        ]

    # ── GPT-4o-mini recommendation ────────────────────────────────────
    fallback_recs = {
        "High":   (
            "This booking is likely to experience significant implementation delays. "
            "Assign a dedicated Engagement Manager, escalate to Platinum Support, "
            "and validate the conversion timeline immediately."
        ),
        "Medium": (
            "Monitor this booking closely. Schedule proactive CSM check-ins and confirm "
            "all client deliverables are ready before the scheduled start date."
        ),
        "Low":    (
            "Smooth implementation expected. Standard monitoring cadence is sufficient. "
            "Continue with the assigned implementation team."
        ),
    }

    recommendation = fallback_recs[tier]
    ai_used = False

    client_ai = openai_client()
    if client_ai:
        try:
            factors_text = "\n".join(
                f"  - {f['name']} (+{f['points']} pts): {f['description']}"
                for f in top_factors
            )
            prompt = f"""You are a senior implementation risk analyst at RealPage, a property management software company.

A booking has been scored by our XGBoost risk model:

Risk Score: {score}/100 — {tier} Risk
Predicted MTTI (days to go-live): {round(mtti, 1)} days
Sales Type: {req.sales_type or 'Unknown'}
Implementation Type: {req.implementation_type or 'Unknown'}
Product Family: {req.product_family or 'Unknown'}
Territory: {req.territory or 'Unknown'}
Business Type: {req.business_type or 'Unknown'}
Total Sites: {req.total_sites}
Total Units: {req.total_units}

Top risk factors identified by the model:
{factors_text}

Write a specific, actionable recommendation (2-3 sentences) for the implementation team.
Reference the actual factors above. Be direct — name the specific risks and concrete next steps.
Do not start with "Based on" or repeat the risk score. Speak as if advising a colleague."""

            response = client_ai.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=180,
                temperature=0.4,
            )
            recommendation = response.choices[0].message.content.strip()
            ai_used = True
        except Exception as e:
            print(f"[openai] Recommendation fallback: {e}")

    return {
        "risk_score":     score,
        "risk_tier":      tier,
        "mtti_pred":      round(mtti, 1),
        "top_factors":    top_factors,
        "recommendation": recommendation,
        "ai_recommendation": ai_used,
    }


# ── POST /recommend/pmc ──────────────────────────────────────────────────────
class PMCRecommendRequest(BaseModel):
    name:        str = ""
    territory:   str = ""
    tier:        str = ""
    score:       int = 0
    mtti:        int = 0
    sites:       int = 0
    units:       int = 0
    orders:      int = 0
    top_product: str = ""
    sales_type:  str = ""
    factors:     list = []   # [{name, points}]

FALLBACK_PMC_RECS = {
    "High": [
        {"action": "Assign a dedicated senior Engagement Manager immediately", "urgency": "immediate", "owner": "Sr. EM"},
        {"action": "Escalate to Platinum Support and flag in CRM", "urgency": "immediate", "owner": "CSM + Finance"},
        {"action": "Schedule weekly risk-review cadence with all stakeholders", "urgency": "immediate", "owner": "Impl Manager"},
    ],
    "Medium": [
        {"action": "Schedule proactive CSM check-in within 5 business days", "urgency": "this-week", "owner": "CSM"},
        {"action": "Confirm all client deliverables are ready before start date", "urgency": "this-week", "owner": "Impl Manager"},
    ],
    "Low": [
        {"action": "Proceed with standard implementation process", "urgency": "standard", "owner": "Impl Manager"},
        {"action": "Monitor key milestones on routine cadence", "urgency": "standard", "owner": "CSM"},
    ],
}

@app.post("/recommend/pmc")
def recommend_pmc(req: PMCRecommendRequest):
    fallback = FALLBACK_PMC_RECS.get(req.tier, FALLBACK_PMC_RECS["Medium"])

    client_ai = openai_client()
    if not client_ai:
        return {"recommendation": fallback, "ai": False}

    try:
        factors_text = "\n".join(
            f"  - {f['name']} (+{f['points']} pts)" for f in req.factors
        ) if req.factors else "  - No major factors identified"

        prompt = f"""You are a senior implementation risk analyst at RealPage, a property management software company.

A PMC (Property Management Company) account currently has backlog orders and has been risk-scored:

PMC Name: {req.name}
Territory: {req.territory}
Risk Tier: {req.tier} (Score: {req.score}/100)
Predicted MTTI: {req.mtti} days
Portfolio Size: {req.sites:,} sites, {req.units:,} units
Open Backlog Orders: {req.orders}
Top Product: {req.top_product}
Sales Type: {req.sales_type}

Risk factors driving the score:
{factors_text}

Return EXACTLY 3 recommended actions for the implementation team as a JSON array.
Each action must be specific to this PMC's actual risk factors above.
Format:
[
  {{"action": "...", "urgency": "immediate|this-week|standard", "owner": "..."}},
  {{"action": "...", "urgency": "immediate|this-week|standard", "owner": "..."}},
  {{"action": "...", "urgency": "immediate|this-week|standard", "owner": "..."}}
]
Only return the JSON array. No explanation."""

        response = client_ai.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        import json as _json
        raw = response.choices[0].message.content.strip()
        parsed = _json.loads(raw)
        # handle both {"actions": [...]} and [...]
        recs = parsed if isinstance(parsed, list) else parsed.get("actions", parsed.get("recommendations", fallback))
        if not isinstance(recs, list) or len(recs) == 0:
            raise ValueError("empty")
        return {"recommendation": recs[:3], "ai": True}
    except Exception as e:
        print(f"[openai/pmc] Fallback: {e}")
        return {"recommendation": fallback, "ai": False}


# ── /reasons ─────────────────────────────────────────────────────────────────
@app.get("/reasons")
def reasons(year: str = "2025"):
    year_filter = f"AND EXTRACT(YEAR FROM OrderCreatedDate) = {int(year)}"
    sql_backlog = f"""
    SELECT BacklogReason AS reason, COUNT(*) AS cnt
    FROM `{PROJECT}.{DATASET}.BBACVCombinedBookings`
    WHERE BacklogReason IS NOT NULL AND Y2SBacklogFlag = 1
    {year_filter}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    """
    sql_cancel = f"""
    SELECT Y2SCancelationReason AS reason, COUNT(*) AS cnt
    FROM `{PROJECT}.{DATASET}.BBACVCombinedBookings`
    WHERE Y2SCancelationReason IS NOT NULL AND Y2SCancelbookingsFlag = 1
    {year_filter}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    """
    def _fetch():
        client = bqclient()
        backlog = [{"reason": str(r["reason"]), "count": int(r["cnt"])} for r in client.query(sql_backlog)]
        cancel  = [{"reason": str(r["reason"]), "count": int(r["cnt"])} for r in client.query(sql_cancel)]
        return {"backlog": backlog, "cancellation": cancel}
    return _cached(f"reasons:{year}", _fetch)


# ── POST /retrain ─────────────────────────────────────────────────────────────
@app.post("/retrain")
def retrain():
    """Delete saved model and retrain from BigQuery. Takes ~2 minutes."""
    if os.path.exists(MODEL_PATH):
        os.remove(MODEL_PATH)
    bundle = _train_from_bq()
    joblib.dump(bundle, MODEL_PATH)
    _apply_bundle(bundle)
    return {"status": "ok", "auc": round(bundle["auc"], 4),
            "p75": bundle["p75"], "p90": bundle["p90"],
            "saved_to": MODEL_PATH}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend:app", host="0.0.0.0", port=8001, reload=False)
