import os
import streamlit as st
from google.cloud import bigquery
import pandas as pd

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = r"c:\IRP\credentials.json"

PROJECT = "hck-dev-2876"
DATASET = "hck_data"


@st.cache_resource
def get_client():
    return bigquery.Client(project=PROJECT)


def _q(sql: str) -> pd.DataFrame:
    return get_client().query(sql).to_dataframe()


# ---------------------------------------------------------------------------
# Dropdown options (all from real BQ data)
# ---------------------------------------------------------------------------
@st.cache_data(ttl=7200)
def load_dropdown_options() -> dict:
    opts = {}

    opts["category"] = (
        ["All"]
        + _q(
            f"SELECT DISTINCT Y2SCategory v FROM `{PROJECT}.{DATASET}.BBACVCombinedBookings` "
            "WHERE Y2SCategory IS NOT NULL ORDER BY 1"
        )["v"]
        .dropna()
        .tolist()
    )

    opts["product_name"] = (
        ["All"]
        + _q(
            f"SELECT DISTINCT Y2SProductName v, COUNT(*) c "
            f"FROM `{PROJECT}.{DATASET}.BBACVCombinedBookings` "
            "WHERE Y2SProductName IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 80"
        )["v"]
        .dropna()
        .tolist()
    )

    opts["backlog_reason"] = (
        ["All"]
        + _q(
            f"SELECT DISTINCT BacklogReason v FROM `{PROJECT}.{DATASET}.BBACVCombinedBookings` "
            "WHERE BacklogReason IS NOT NULL ORDER BY 1"
        )["v"]
        .dropna()
        .tolist()
    )

    opts["cancel_reason"] = (
        ["All"]
        + _q(
            f"SELECT DISTINCT Y2SCancelationReason v FROM `{PROJECT}.{DATASET}.BBACVCombinedBookings` "
            "WHERE Y2SCancelationReason IS NOT NULL ORDER BY 1"
        )["v"]
        .dropna()
        .tolist()
    )

    # --- SFDC_Order__c dropdowns ---
    opts["impl_type"] = (
        _q(
            f"SELECT DISTINCT Implementation_Type_New__c v FROM `{PROJECT}.{DATASET}.SFDC_Order__c` "
            "WHERE Implementation_Type_New__c IS NOT NULL AND IsDeleted=false ORDER BY 1"
        )["v"]
        .dropna()
        .tolist()
    )

    opts["product_family"] = (
        _q(
            f"SELECT DISTINCT Product_Family__c v, COUNT(*) c FROM `{PROJECT}.{DATASET}.SFDC_Order__c` "
            "WHERE Product_Family__c IS NOT NULL AND TRIM(Product_Family__c)!='' AND IsDeleted=false "
            "GROUP BY 1 ORDER BY 2 DESC LIMIT 25"
        )["v"]
        .dropna()
        .tolist()
    )

    opts["sales_type"] = (
        _q(
            f"SELECT DISTINCT Sales_Type__c v FROM `{PROJECT}.{DATASET}.SFDC_Order__c` "
            "WHERE Sales_Type__c IS NOT NULL AND TRIM(Sales_Type__c)!='' AND IsDeleted=false ORDER BY 1"
        )["v"]
        .dropna()
        .tolist()
    )

    # --- SFDC_Accounts dropdowns ---
    opts["business_type"] = (
        _q(
            f"SELECT DISTINCT Business_Type__c v, COUNT(*) c FROM `{PROJECT}.{DATASET}.SFDC_Accounts` "
            "WHERE Business_Type__c IS NOT NULL AND IsDeleted=false GROUP BY 1 ORDER BY 2 DESC LIMIT 25"
        )["v"]
        .dropna()
        .tolist()
    )

    opts["territory"] = (
        _q(
            f"SELECT DISTINCT Territory__c v, COUNT(*) c FROM `{PROJECT}.{DATASET}.SFDC_Accounts` "
            "WHERE Territory__c IS NOT NULL AND IsDeleted=false GROUP BY 1 ORDER BY 2 DESC LIMIT 30"
        )["v"]
        .dropna()
        .tolist()
    )

    opts["csm_model"] = (
        _q(
            f"SELECT DISTINCT CSM_Coverage_Model__c v FROM `{PROJECT}.{DATASET}.SFDC_Accounts` "
            "WHERE CSM_Coverage_Model__c IS NOT NULL AND IsDeleted=false ORDER BY 1"
        )["v"]
        .dropna()
        .tolist()
    )

    opts["impl_status"] = (
        _q(
            f"SELECT DISTINCT Implementation_Status__c v FROM `{PROJECT}.{DATASET}.SFDC_Order__c` "
            "WHERE Implementation_Status__c IS NOT NULL AND IsDeleted=false ORDER BY 1"
        )["v"]
        .dropna()
        .tolist()
    )

    return opts


# ---------------------------------------------------------------------------
# Bookings Cohort Dashboard data
# ---------------------------------------------------------------------------
@st.cache_data(ttl=3600)
def load_bookings_cohort(
    start_date: str,
    end_date: str,
    category: str = "All",
    product: str = "All",
) -> pd.DataFrame:
    where = [
        f"OrderCreatedDate >= '{start_date}'",
        f"OrderCreatedDate <= '{end_date}'",
    ]
    if category != "All":
        safe = category.replace("'", "\\'")
        where.append(f"Y2SCategory = '{safe}'")
    if product != "All":
        safe = product.replace("'", "\\'")
        where.append(f"Y2SProductName = '{safe}'")

    sql = f"""
    SELECT
        FORMAT_TIMESTAMP('%Y-%m', OrderCreatedDate)   AS cohort_month,
        Y2SCategory                                    AS category,
        Y2SProductName                                 AS product_name,
        Y2SPMCID                                       AS pmc_id,
        Y2SPMCName                                     AS pmc_name,
        BacklogReason                                  AS backlog_reason,
        Y2SCancelationReason                           AS cancel_reason,
        COUNT(*)                                       AS total_bookings,
        SUM(Y2SActivationFlag)                         AS activated,
        SUM(Y2SBacklogFlag)                            AS backlog,
        SUM(Y2SCancelbookingsFlag)                     AS cancelled,
        SUM(Y2SChurnFlag)                              AS churned,
        COALESCE(SUM(CAST(Y2SUnits AS INT64)), 0)      AS total_units
    FROM `{PROJECT}.{DATASET}.BBACVCombinedBookings`
    WHERE {" AND ".join(where)}
    GROUP BY 1,2,3,4,5,6,7
    ORDER BY 1 DESC
    """
    return _q(sql)


# ---------------------------------------------------------------------------
# MTTI benchmark (MTTI_Level3 pre-aggregated)
# ---------------------------------------------------------------------------
@st.cache_data(ttl=7200)
def load_mtti_benchmark() -> pd.DataFrame:
    sql = f"""
    SELECT
        ActivationYrMth,
        prodhierarchy,
        Y2SCategory,
        AVG_MTTI,
        Median_MTTI,
        AVG_MTTR,
        Median_MTTIR
    FROM `{PROJECT}.{DATASET}.MTTI_Level3`
    ORDER BY ActivationYrMth DESC
    """
    return _q(sql)


# ---------------------------------------------------------------------------
# Training data for XGBoost  (SFDC_Order__c + SFDC_Accounts join)
# ---------------------------------------------------------------------------
@st.cache_data(ttl=7200)
def load_training_data() -> pd.DataFrame:
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
        IF(o.Dependency_Delay__c  IS TRUE, 1, 0)                   AS dependency_delay,
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
    return _q(sql)
