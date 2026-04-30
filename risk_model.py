"""
XGBoost Implementation Risk Model
Target: binary — MTTI > 75th-percentile = high risk (likely delayed)
Score:  0-100 probability of being high risk
"""
import numpy as np
import pandas as pd
import streamlit as st
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import roc_auc_score, classification_report

CAT_COLS = [
    "impl_type",
    "product_family",
    "sales_type",
    "business_type",
    "territory",
    "csm_model",
]

NUM_COLS = [
    "on_hold_days",
    "referred_sales_days",
    "initial_outreach_days",
    "pmc_properties",
    "pmc_units",
    "dependency_delay",
    "blocked_days",
    "prev_deployed",
    "special_handling",
    "sla_violations",
]

FEATURE_LABEL_MAP = {
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
    "special_handling":       "Special Handling",
    "sla_violations":         "SLA Violation Count",
}


@st.cache_resource(show_spinner="Training XGBoost model on historical order data…")
def train_model(df: pd.DataFrame) -> dict:
    df = df.copy()

    # Risk threshold: orders in the top 25% by MTTI are "high risk"
    threshold = float(np.percentile(df["mtti"].dropna(), 75))
    df["is_high_risk"] = (df["mtti"] > threshold).astype(int)

    # Encode categoricals
    encoders = {}
    for col in CAT_COLS:
        le = LabelEncoder()
        df[col + "_enc"] = le.fit_transform(df[col].fillna("Unknown").astype(str))
        encoders[col] = le

    feature_cols = [c + "_enc" for c in CAT_COLS] + NUM_COLS
    X = df[feature_cols].fillna(0)
    y_cls = df["is_high_risk"]
    y_reg = np.log1p(df["mtti"])          # log-transform for regression stability

    X_train, X_test, y_cls_train, y_cls_test, y_reg_train, y_reg_test = train_test_split(
        X, y_cls, y_reg, test_size=0.2, random_state=42, stratify=y_cls
    )

    # --- Classifier (risk score 0-100) ---
    clf = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.08,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        gamma=1,
        eval_metric="logloss",
        random_state=42,
        verbosity=0,
    )
    clf.fit(X_train, y_cls_train, eval_set=[(X_test, y_cls_test)], verbose=False)
    auc = roc_auc_score(y_cls_test, clf.predict_proba(X_test)[:, 1])

    # --- Regressor (predicted MTTI in days) ---
    reg = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.08,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        eval_metric="rmse",
        random_state=42,
        verbosity=0,
    )
    reg.fit(X_train, y_reg_train, eval_set=[(X_test, y_reg_test)], verbose=False)

    return {
        "model":          clf,
        "regressor":      reg,
        "encoders":       encoders,
        "feature_cols":   feature_cols,
        "threshold":      threshold,
        "auc":            auc,
        "train_rows":     len(df),
        "high_risk_rate": float(y_cls.mean()),
        "mtti_p50":       float(np.percentile(df["mtti"], 50)),
        "mtti_p75":       float(np.percentile(df["mtti"], 75)),
        "mtti_p90":       float(np.percentile(df["mtti"], 90)),
    }


def score_booking(model_bundle: dict, inputs: dict) -> dict:
    clf       = model_bundle["model"]
    reg       = model_bundle["regressor"]
    encoders  = model_bundle["encoders"]
    feat_cols = model_bundle["feature_cols"]

    row = {}
    for col in CAT_COLS:
        le  = encoders[col]
        val = str(inputs.get(col, "Unknown"))
        row[col + "_enc"] = (
            int(le.transform([val])[0]) if val in le.classes_ else 0
        )
    for col in NUM_COLS:
        row[col] = float(inputs.get(col, 0) or 0)

    X = pd.DataFrame([row])[feat_cols]

    prob          = float(clf.predict_proba(X)[0][1])
    score         = int(round(prob * 100))
    pred_mtti_log = float(reg.predict(X)[0])
    pred_mtti     = max(1.0, float(np.expm1(pred_mtti_log)))

    # Percentile-based risk label using training distribution
    p75 = model_bundle["mtti_p75"]
    p90 = model_bundle["mtti_p90"]
    if pred_mtti > p90:
        risk_level, color, emoji = "High Risk",   "#E53935", "🔴"
    elif pred_mtti > p75:
        risk_level, color, emoji = "Medium Risk", "#FB8C00", "🟡"
    else:
        risk_level, color, emoji = "Low Risk",    "#43A047", "🟢"

    importance = {
        FEATURE_LABEL_MAP.get(k, k): float(v)
        for k, v in zip(feat_cols, clf.feature_importances_)
    }

    return {
        "score":      score,
        "prob":       prob,
        "pred_mtti":  round(pred_mtti, 1),
        "risk_level": risk_level,
        "color":      color,
        "emoji":      emoji,
        "importance": importance,
    }
