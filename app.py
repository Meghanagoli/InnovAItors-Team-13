import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go

from bq_data import (
    load_dropdown_options,
    load_bookings_cohort,
    load_mtti_benchmark,
    load_training_data,
)
from risk_model import train_model, score_booking

# ── Page config ──────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Implementation Risk Predictor",
    page_icon="🎯",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Global CSS ────────────────────────────────────────────────────────────────
st.markdown(
    """
    <style>
    /* header */
    .irp-header {
        background: linear-gradient(90deg,#0d2b4e,#1565c0);
        border-radius:10px; padding:18px 28px; margin-bottom:18px;
        display:flex; align-items:center; gap:16px;
    }
    .irp-header h1 { color:#fff; margin:0; font-size:1.7rem; }
    .irp-header p  { color:#90caf9; margin:0; font-size:.85rem; }

    /* KPI cards */
    div[data-testid="metric-container"] {
        background:#f0f4ff; border-radius:10px;
        padding:14px 18px; border-left:4px solid #1565c0;
    }

    /* risk badge */
    .badge-high   { background:#ffebee; color:#c62828; border-radius:6px;
                    padding:3px 10px; font-weight:700; }
    .badge-medium { background:#fff3e0; color:#e65100; border-radius:6px;
                    padding:3px 10px; font-weight:700; }
    .badge-low    { background:#e8f5e9; color:#2e7d32; border-radius:6px;
                    padding:3px 10px; font-weight:700; }

    /* table */
    div[data-testid="stDataFrame"] { border-radius:8px; overflow:hidden; }

    /* sidebar */
    section[data-testid="stSidebar"] { background:#f7f9fc; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ── Header ────────────────────────────────────────────────────────────────────
st.markdown(
    """
    <div class="irp-header">
      <div>
        <h1>🎯 Implementation Risk Predictor</h1>
        <p>RealPage Hackathon 2026 &nbsp;|&nbsp; All data live from BigQuery · hck-dev-2876.hck_data</p>
      </div>
    </div>
    """,
    unsafe_allow_html=True,
)

# ── Load dropdown options once ────────────────────────────────────────────────
with st.spinner("Loading filter options from BigQuery…"):
    opts = load_dropdown_options()

# ── Tabs ──────────────────────────────────────────────────────────────────────
tab_dash, tab_score, tab_mtti = st.tabs(
    ["📊 Bookings Cohort Dashboard", "🔮 Score a Booking", "📈 MTTI Benchmarks"]
)

# ═══════════════════════════════════════════════════════════════════════════════
# TAB 1 — BOOKINGS COHORT DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════
with tab_dash:

    # ── Sidebar filters ───────────────────────────────────────────────────────
    st.sidebar.header("📅 Dashboard Filters")

    start_date = st.sidebar.date_input("Start Date", value=pd.Timestamp("2024-01-01"))
    end_date   = st.sidebar.date_input("End Date",   value=pd.Timestamp("2026-04-30"))

    category_sel = st.sidebar.selectbox("Category",     opts["category"])
    product_sel  = st.sidebar.selectbox("Product Name", opts["product_name"])

    # ── Load data ─────────────────────────────────────────────────────────────
    with st.spinner("Fetching bookings data from BigQuery…"):
        df_raw = load_bookings_cohort(
            str(start_date), str(end_date), category_sel, product_sel
        )

    if df_raw.empty:
        st.warning("No bookings data found for the selected filters.")
        st.stop()

    # ── Cohort-level aggregation ──────────────────────────────────────────────
    df_cohort = (
        df_raw.groupby("cohort_month")
        .agg(
            total_bookings=("total_bookings", "sum"),
            activated=("activated", "sum"),
            backlog=("backlog", "sum"),
            cancelled=("cancelled", "sum"),
            churned=("churned", "sum"),
            total_units=("total_units", "sum"),
        )
        .reset_index()
        .sort_values("cohort_month", ascending=False)
    )

    def pct(a, b):
        return round(a / b * 100, 1) if b else 0.0

    df_cohort["act_pct"]    = df_cohort.apply(lambda r: pct(r.activated,  r.total_bookings), axis=1)
    df_cohort["back_pct"]   = df_cohort.apply(lambda r: pct(r.backlog,    r.total_bookings), axis=1)
    df_cohort["cancel_pct"] = df_cohort.apply(lambda r: pct(r.cancelled,  r.total_bookings), axis=1)
    df_cohort["churn_pct"]  = df_cohort.apply(lambda r: pct(r.churned,    r.total_bookings), axis=1)

    tot   = int(df_cohort["total_bookings"].sum())
    act   = int(df_cohort["activated"].sum())
    back  = int(df_cohort["backlog"].sum())
    canc  = int(df_cohort["cancelled"].sum())
    churn = int(df_cohort["churned"].sum())

    # ── KPI row ───────────────────────────────────────────────────────────────
    k1, k2, k3, k4, k5 = st.columns(5)
    k1.metric("Total Bookings",  f"{tot:,}")
    k2.metric("Activated",       f"{act:,}",   f"{pct(act,  tot)}%")
    k3.metric("In Backlog",      f"{back:,}",  f"{pct(back, tot)}%")
    k4.metric("Cancelled",       f"{canc:,}",  f"−{pct(canc, tot)}%")
    k5.metric("Churned",         f"{churn:,}", f"−{pct(churn,tot)}%")

    st.divider()

    # ── Monthly trend chart ───────────────────────────────────────────────────
    df_trend = df_cohort.sort_values("cohort_month")

    fig_trend = go.Figure()
    fig_trend.add_trace(go.Bar(
        x=df_trend["cohort_month"], y=df_trend["total_bookings"],
        name="Total Bookings", marker_color="#90caf9", opacity=0.6,
    ))
    fig_trend.add_trace(go.Scatter(
        x=df_trend["cohort_month"], y=df_trend["act_pct"],
        name="Activation %", yaxis="y2",
        line=dict(color="#2e7d32", width=2.5),
    ))
    fig_trend.add_trace(go.Scatter(
        x=df_trend["cohort_month"], y=df_trend["back_pct"],
        name="Backlog %", yaxis="y2",
        line=dict(color="#e65100", width=2, dash="dot"),
    ))
    fig_trend.add_trace(go.Scatter(
        x=df_trend["cohort_month"], y=df_trend["cancel_pct"],
        name="Cancel %", yaxis="y2",
        line=dict(color="#c62828", width=2, dash="dash"),
    ))
    fig_trend.update_layout(
        title="Monthly Bookings — Volume & Rate Trends",
        yaxis=dict(title="Booking Count", showgrid=False),
        yaxis2=dict(title="Rate (%)", overlaying="y", side="right", range=[0, 110]),
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        height=420,
        hovermode="x unified",
        plot_bgcolor="#fafafa",
    )
    st.plotly_chart(fig_trend, use_container_width=True)

    # ── Product breakdown  +  Cancel reasons ─────────────────────────────────
    col_l, col_r = st.columns(2)

    with col_l:
        df_prod = (
            df_raw.groupby("product_name")
            .agg(total=("total_bookings", "sum"), activated=("activated", "sum"))
            .reset_index()
            .sort_values("total", ascending=False)
            .head(15)
        )
        df_prod["act_pct"] = df_prod.apply(lambda r: pct(r.activated, r.total), axis=1)

        fig_prod = px.bar(
            df_prod,
            x="total", y="product_name", orientation="h",
            color="act_pct",
            color_continuous_scale="RdYlGn",
            range_color=[0, 100],
            title="Top 15 Products — Bookings & Activation Rate",
            labels={"total": "Bookings", "product_name": "Product", "act_pct": "Act %"},
        )
        fig_prod.update_layout(height=480, yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig_prod, use_container_width=True)

    with col_r:
        df_cancel = (
            df_raw[df_raw["cancelled"] > 0]
            .groupby("cancel_reason")
            .agg(total=("cancelled", "sum"))
            .reset_index()
            .dropna(subset=["cancel_reason"])
            .sort_values("total", ascending=False)
            .head(12)
        )
        if not df_cancel.empty:
            fig_cancel = px.pie(
                df_cancel, names="cancel_reason", values="total",
                title="Cancellation Reasons",
                hole=0.42,
                color_discrete_sequence=px.colors.qualitative.Set3,
            )
            fig_cancel.update_layout(height=480)
            st.plotly_chart(fig_cancel, use_container_width=True)
        else:
            st.info("No cancellation data for selected filters.")

    # ── Backlog reasons ───────────────────────────────────────────────────────
    df_bl = (
        df_raw[df_raw["backlog"] > 0]
        .groupby("backlog_reason")
        .agg(total=("backlog", "sum"))
        .reset_index()
        .dropna(subset=["backlog_reason"])
        .sort_values("total", ascending=False)
        .head(12)
    )
    if not df_bl.empty:
        fig_bl = px.bar(
            df_bl, x="backlog_reason", y="total",
            color="total", color_continuous_scale="Oranges",
            title="Backlog Reasons",
            labels={"backlog_reason": "Reason", "total": "Count"},
        )
        fig_bl.update_layout(height=360, xaxis_tickangle=-35)
        st.plotly_chart(fig_bl, use_container_width=True)

    # ── PMC leaderboard (top by backlog) ──────────────────────────────────────
    st.subheader("🏢 PMC Leaderboard — Highest Backlog")
    df_pmc = (
        df_raw.groupby(["pmc_id", "pmc_name"])
        .agg(
            total=("total_bookings", "sum"),
            activated=("activated", "sum"),
            backlog=("backlog", "sum"),
            cancelled=("cancelled", "sum"),
            churned=("churned", "sum"),
        )
        .reset_index()
        .sort_values("backlog", ascending=False)
        .head(20)
    )
    df_pmc["act_pct"]    = df_pmc.apply(lambda r: pct(r.activated, r.total), axis=1)
    df_pmc["backlog_pct"]= df_pmc.apply(lambda r: pct(r.backlog,   r.total), axis=1)
    st.dataframe(
        df_pmc[["pmc_name","total","activated","act_pct","backlog","backlog_pct","cancelled","churned"]]
        .rename(columns={
            "pmc_name":    "PMC Name",
            "total":       "Total",
            "activated":   "Activated",
            "act_pct":     "Act %",
            "backlog":     "Backlog",
            "backlog_pct": "Backlog %",
            "cancelled":   "Cancelled",
            "churned":     "Churned",
        }),
        use_container_width=True,
        hide_index=True,
    )

    # ── Monthly cohort table ──────────────────────────────────────────────────
    st.subheader("📋 Monthly Cohort Summary")
    st.dataframe(
        df_cohort[[
            "cohort_month","total_bookings","activated","act_pct",
            "backlog","back_pct","cancelled","cancel_pct","churned","churn_pct","total_units"
        ]].rename(columns={
            "cohort_month":    "Month",
            "total_bookings":  "Total",
            "activated":       "Activated",
            "act_pct":         "Act %",
            "backlog":         "Backlog",
            "back_pct":        "Backlog %",
            "cancelled":       "Cancelled",
            "cancel_pct":      "Cancel %",
            "churned":         "Churned",
            "churn_pct":       "Churn %",
            "total_units":     "Units",
        }),
        use_container_width=True,
        hide_index=True,
    )

    with st.expander("ℹ️ Data gaps — what is NOT in BigQuery"):
        st.markdown(
            """
            | Charter Data Point | Status |
            |---|---|
            | DocuSign Hours to Complete | ⚠️ `SFDC_Apttus_APTS_Agreement.EO_Cycle_Time1_c` exists but **not joined** to bookings |
            | CSR Times Scheduled | ⚠️ `SFDC_ConversionServiceRecord` has individual CSR records but **no aggregated count per order** |
            | Count of Revisions | ⚠️ `SFDC_OrderRequests.Revision__c` is a **flag/string**, not a numeric count |
            | EDW Finance Hierarchy | ❌ **Not present** in `hck_data` dataset |
            """
        )


# ═══════════════════════════════════════════════════════════════════════════════
# TAB 2 — SCORE A BOOKING
# ═══════════════════════════════════════════════════════════════════════════════
with tab_score:
    st.subheader("🔮 Score a New Booking for Implementation Risk")
    st.caption(
        "Model: XGBoost binary classifier · Target: MTTI > 75th percentile = High Risk  "
        "· Training data: SFDC_Order__c joined SFDC_Accounts (2020–2026)"
    )

    col_form, col_result = st.columns([1, 1], gap="large")

    with col_form:
        with st.form("score_form"):
            st.markdown("#### Order Details")
            impl_type      = st.selectbox("Implementation Type *",  opts["impl_type"])
            product_family = st.selectbox("Product Family *",        opts["product_family"])
            sales_type     = st.selectbox("Sales Type *",            opts["sales_type"])

            st.markdown("#### PMC (Customer) Profile")
            business_type  = st.selectbox("Business Type *",         opts["business_type"])
            territory      = st.selectbox("Territory *",             opts["territory"])
            csm_model      = st.selectbox("CSM Coverage Model",      opts["csm_model"])

            c1, c2 = st.columns(2)
            pmc_properties = c1.number_input("PMC Total Properties", min_value=0, value=50,   step=1)
            pmc_units      = c2.number_input("PMC Total Units",       min_value=0, value=5000, step=100)

            st.markdown("#### Historical Risk Signals")
            prev_deployed     = st.checkbox("PMC Has Previously Deployed This Product", value=True)
            special_handling  = st.checkbox("Special Handling Required",                value=False)
            dependency_delay  = st.checkbox("Dependency Delay Expected",                value=False)

            c3, c4, c5 = st.columns(3)
            on_hold_days        = c3.number_input("On Hold Days (hist.)",  min_value=0.0, value=0.0, step=1.0)
            referred_sales_days = c4.number_input("Referred to Sales Days", min_value=0.0, value=0.0, step=1.0)
            initial_outreach_days = c5.number_input("Initial Outreach Days", min_value=0.0, value=0.0, step=1.0)

            st.caption(
                "⚠️ **Not available in BigQuery:** DocuSign Hours, CSR Times Scheduled, "
                "Count of Revisions — see data gap note in Dashboard tab."
            )

            submitted = st.form_submit_button("🎯 Calculate Risk Score", type="primary", use_container_width=True)

    with col_result:
        if submitted:
            with st.spinner("Loading training data & fitting XGBoost model…"):
                df_train = load_training_data()
                bundle   = train_model(df_train)

            inputs = {
                "impl_type":            impl_type,
                "product_family":       product_family,
                "sales_type":           sales_type,
                "business_type":        business_type,
                "territory":            territory,
                "csm_model":            csm_model,
                "pmc_properties":       pmc_properties,
                "pmc_units":            pmc_units,
                "prev_deployed":        int(prev_deployed),
                "special_handling":     int(special_handling),
                "dependency_delay":     int(dependency_delay),
                "on_hold_days":         on_hold_days,
                "referred_sales_days":  referred_sales_days,
                "initial_outreach_days":initial_outreach_days,
                "blocked_days":         0.0,
                "sla_violations":       0.0,
            }

            result = score_booking(bundle, inputs)

            # ── Gauge ──────────────────────────────────────────────────────
            fig_gauge = go.Figure(go.Indicator(
                mode="gauge+number+delta",
                value=result["score"],
                delta={"reference": 40, "increasing": {"color": "#c62828"}, "decreasing": {"color": "#2e7d32"}},
                title={"text": f"Risk Score — {result['emoji']} {result['risk_level']}", "font": {"size": 18}},
                gauge={
                    "axis": {"range": [0, 100], "tickwidth": 1},
                    "bar":  {"color": result["color"], "thickness": 0.25},
                    "steps": [
                        {"range": [0,  40], "color": "#e8f5e9"},
                        {"range": [40, 70], "color": "#fff3e0"},
                        {"range": [70,100], "color": "#ffebee"},
                    ],
                    "threshold": {
                        "line":      {"color": "#c62828", "width": 4},
                        "thickness": 0.75,
                        "value":     70,
                    },
                },
            ))
            fig_gauge.update_layout(height=290, margin=dict(t=50, b=0, l=30, r=30))
            st.plotly_chart(fig_gauge, use_container_width=True)

            # ── Predicted MTTI + Model stats ──────────────────────────────
            m1, m2, m3, m4 = st.columns(4)
            m1.metric("Predicted MTTI",      f"{result['pred_mtti']:.0f} days")
            m2.metric("Classifier AUC",      f"{bundle['auc']:.3f}")
            m3.metric("P75 Threshold",       f">{bundle['mtti_p75']:.0f} days")
            m4.metric("Training Rows",       f"{bundle['train_rows']:,}")

            # ── Recommendation ────────────────────────────────────────────
            if result["score"] >= 70:
                st.error(
                    "🔴 **High Risk** — This booking is likely to experience significant "
                    "implementation delays (MTTI above 75th percentile). "
                    "**Recommended actions:** Assign a dedicated Engagement Manager, "
                    "escalate to Platinum Support, validate conversion timeline early."
                )
            elif result["score"] >= 40:
                st.warning(
                    "🟡 **Medium Risk** — Monitor closely. "
                    "**Recommended:** Proactive CSM check-ins, confirm all client deliverables "
                    "are ready before the scheduled start date."
                )
            else:
                st.success(
                    "🟢 **Low Risk** — Smooth implementation expected. "
                    "Standard monitoring is sufficient."
                )

            # ── Feature importance ────────────────────────────────────────
            st.markdown("#### Top Risk Drivers (XGBoost Feature Importance)")
            imp_df = (
                pd.DataFrame(result["importance"].items(), columns=["Feature", "Importance"])
                .sort_values("Importance", ascending=True)
                .tail(12)
            )
            fig_imp = px.bar(
                imp_df, x="Importance", y="Feature", orientation="h",
                color="Importance",
                color_continuous_scale="Reds",
                labels={"Importance": "Importance Score", "Feature": ""},
            )
            fig_imp.update_layout(height=380, showlegend=False, plot_bgcolor="#fafafa")
            st.plotly_chart(fig_imp, use_container_width=True)

        else:
            st.markdown(
                """
                <div style="background:#f0f4ff;border-radius:10px;padding:30px;text-align:center;margin-top:40px;">
                  <h3>👈 Fill in the booking details</h3>
                  <p>Complete the form on the left and click <b>Calculate Risk Score</b>.</p>
                  <p style="color:#666;font-size:.85rem;">
                    The XGBoost model will train on 80,000 historical SFDC orders from BigQuery
                    and score this booking's likelihood of implementation delay.
                  </p>
                </div>
                """,
                unsafe_allow_html=True,
            )

            with st.expander("ℹ️ Model details"):
                st.markdown(
                    f"""
                    **Algorithm:** XGBoost Binary Classifier

                    **Target variable:** `Time_to_Implement_Days__c` — classified as **High Risk**
                    if MTTI > 75th percentile of historical orders.

                    **Feature sources from BigQuery:**
                    | Feature | BQ Column | Table |
                    |---|---|---|
                    | Implementation Type | `Implementation_Type_New__c` | `SFDC_Order__c` |
                    | Product Family | `Product_Family__c` | `SFDC_Order__c` |
                    | Sales Type | `Sales_Type__c` | `SFDC_Order__c` |
                    | On Hold Days | `Total_On_Hold_Days__c` | `SFDC_Order__c` |
                    | Referred to Sales Days | `Total_Referred_to_Sales_Days__c` | `SFDC_Order__c` |
                    | Initial Outreach Days | `Total_Initial_Outreach_Days__c` | `SFDC_Order__c` |
                    | PMC Properties | `Total_PMC_Total_Properties_f__c` | `SFDC_Order__c` |
                    | PMC Units | `Total_PMC_Total_Units_f__c` | `SFDC_Order__c` |
                    | Dependency Delay | `Dependency_Delay__c` | `SFDC_Order__c` |
                    | Business Type | `Business_Type__c` | `SFDC_Accounts` |
                    | Territory | `Territory__c` | `SFDC_Accounts` |
                    | CSM Coverage Model | `CSM_Coverage_Model__c` | `SFDC_Accounts` |

                    **Not available in BigQuery:**
                    - DocuSign Hours to Complete
                    - CSR Times Scheduled / Completed
                    - Count of Revisions (string field in `SFDC_OrderRequests`)
                    """
                )


# ═══════════════════════════════════════════════════════════════════════════════
# TAB 3 — MTTI BENCHMARKS
# ═══════════════════════════════════════════════════════════════════════════════
with tab_mtti:
    st.subheader("📈 MTTI Benchmarks — from `MTTI_Level3`")
    st.caption("Pre-aggregated Mean Time to Implement by product hierarchy and activation month.")

    with st.spinner("Loading MTTI benchmark data…"):
        df_mtti = load_mtti_benchmark()

    if df_mtti.empty:
        st.warning("No MTTI data available.")
    else:
        # Trend of avg MTTI over time
        df_mtti_trend = (
            df_mtti.groupby("ActivationYrMth")
            .agg(avg_mtti=("AVG_MTTI", "mean"), med_mtti=("Median_MTTI", "mean"))
            .reset_index()
            .sort_values("ActivationYrMth")
            .tail(36)
        )

        fig_mtti = go.Figure()
        fig_mtti.add_trace(go.Scatter(
            x=df_mtti_trend["ActivationYrMth"], y=df_mtti_trend["avg_mtti"],
            name="Avg MTTI (days)", line=dict(color="#1565c0", width=2.5),
        ))
        fig_mtti.add_trace(go.Scatter(
            x=df_mtti_trend["ActivationYrMth"], y=df_mtti_trend["med_mtti"],
            name="Median MTTI (days)", line=dict(color="#43a047", width=2, dash="dot"),
        ))
        fig_mtti.update_layout(
            title="MTTI Trend (last 36 months)",
            xaxis_title="Activation Month",
            yaxis_title="Days",
            height=380,
            hovermode="x unified",
            plot_bgcolor="#fafafa",
        )
        st.plotly_chart(fig_mtti, use_container_width=True)

        # By product hierarchy
        df_by_prod = (
            df_mtti.groupby("prodhierarchy")
            .agg(avg_mtti=("AVG_MTTI", "mean"))
            .reset_index()
            .sort_values("avg_mtti", ascending=False)
            .head(20)
        )
        fig_by_prod = px.bar(
            df_by_prod, x="avg_mtti", y="prodhierarchy", orientation="h",
            color="avg_mtti", color_continuous_scale="RdYlGn_r",
            title="Avg MTTI by Product Hierarchy",
            labels={"avg_mtti": "Avg MTTI (days)", "prodhierarchy": "Product Hierarchy"},
        )
        fig_by_prod.update_layout(height=500, yaxis=dict(autorange="reversed"))
        st.plotly_chart(fig_by_prod, use_container_width=True)

        # Raw table
        st.subheader("Raw MTTI_Level3 Data")
        st.dataframe(
            df_mtti.rename(columns={
                "ActivationYrMth": "Month",
                "prodhierarchy":   "Product Hierarchy",
                "Y2SCategory":     "Category",
                "AVG_MTTI":        "Avg MTTI (days)",
                "Median_MTTI":     "Median MTTI (days)",
                "AVG_MTTR":        "Avg MTTR (days)",
                "Median_MTTIR":    "Median MTTR (days)",
            }),
            use_container_width=True,
            hide_index=True,
        )
