import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { api, getCached } from '../api/client';
import type { FinanceResponse, MetaResponse } from '../api/client';

const QUARTERS = ['Full Year', 'Q1', 'Q2', 'Q3', 'Q4'] as const;

function fmt(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(0) + 'K';
  return '$' + n;
}

export default function FinancePage() {
  const _meta     = getCached<MetaResponse>('/meta');
  const _initYear = _meta?.years[0] ?? '';
  const _initData = _initYear ? getCached<FinanceResponse>(`/finance?quarter=Full%20Year&year=${_initYear}`) ?? null : null;
  const [year, setYear]                   = useState<string>(_initYear);
  const [years, setYears]                 = useState<string[]>(_meta?.years ?? []);
  const [quarter, setQuarter]             = useState<string>('Full Year');
  const [data, setData]                   = useState<FinanceResponse | null>(_initData);
  const [loading, setLoading]             = useState(!_initData);

  useEffect(() => {
    api.meta().then(m => {
      setYears(m.years);
      if (!year && m.years.length > 0) setYear(m.years[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const activeYear = year || years[0] || '2025';
    if (!getCached(`/finance?quarter=${encodeURIComponent(quarter)}&year=${activeYear}`)) setLoading(true);
    api.finance(quarter, activeYear)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [quarter, year, years]);

  if (loading || !data) {
    return <div className="page"><div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Loading finance data…</div></div>;
  }

  const { rows, totals } = data;
  const activeYear = year || years[0] || '';
  const period = quarter === 'Full Year' ? activeYear : `${quarter} ${activeYear}`;

  function exportCSV() {
    const headers = ['Month', 'Bookings', 'Est. Total Value ($)', 'High Risk Bookings', 'High Risk %', 'High Risk Value ($)', 'Projected Leakage ($)', 'Avg MTTI (days)'];
    const dataRows = rows.map(r => [
      r.label,
      r.total,
      r.estValue.toFixed(2),
      r.high,
      r.total > 0 ? ((r.high / r.total) * 100).toFixed(1) + '%' : '0.0%',
      r.highRiskValue.toFixed(2),
      r.leakageRisk.toFixed(2),
      r.avgMtti,
    ]);
    const totalRow = [
      `TOTAL (${period})`,
      totals.bookings,
      totals.estValue.toFixed(2),
      rows.reduce((s, r) => s + r.high, 0),
      totals.estValue > 0 ? ((totals.highValue / totals.estValue) * 100).toFixed(1) + '%' : '0.0%',
      totals.highValue.toFixed(2),
      totals.leakage.toFixed(2),
      totals.avgMtti,
    ];
    const csv = [headers, ...dataRows, totalRow]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance_forecast_${period.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const safeValue      = totals.estValue - totals.highValue;
  const recoverableVal = totals.highValue - totals.leakage;
  const donutData = [
    { name: 'Safe Revenue',          value: safeValue,      color: '#0079C2' },
    { name: 'At-Risk (Recoverable)', value: recoverableVal, color: '#E8901A' },
    { name: 'Projected Leakage',     value: totals.leakage, color: '#D93025' },
  ];
  const atRiskPct    = totals.estValue > 0 ? ((totals.highValue / totals.estValue) * 100).toFixed(1) : '0.0';
  const recoveryRate = totals.highValue > 0 ? (((totals.highValue - totals.leakage) / totals.highValue) * 100).toFixed(0) : '0';
  const savingsAt25  = totals.leakage * 0.25;

  const DonutTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0];
    const pct = totals.estValue > 0 ? ((p.value / totals.estValue) * 100).toFixed(1) : '0.0';
    return (
      <div style={{ background: 'white', border: '1px solid #DDE3EA', borderRadius: 4, padding: '9px 13px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.payload.color, display: 'inline-block' }}/>
          <span style={{ fontWeight: 600, color: '#1E3048' }}>{p.name}</span>
        </div>
        <div style={{ color: p.payload.color, fontWeight: 700, fontSize: 14 }}>{fmt(p.value)}</div>
        <div style={{ color: '#6B7E94', marginTop: 2 }}>{pct}% of total</div>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Finance Forecast</div>
          <div className="page-subtitle">Revenue recognition risk based on implementation risk scores</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={year} onChange={e => setYear(e.target.value)} style={{ padding: '8px 14px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, background: 'white', cursor: 'pointer', height: 37 }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={quarter} onChange={e => setQuarter(e.target.value)} style={{ padding: '8px 14px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, background: 'white', cursor: 'pointer', height: 37 }}>
            <option value="" disabled>Select Period</option>
            {QUARTERS.map(q => <option key={q}>{q}</option>)}
          </select>
          <button onClick={exportCSV} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#1E293B', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Bookings Value</div>
          <div className="kpi-value">{fmt(totals.estValue)}</div>
          <div className="kpi-sub">{period} · est. from actual ARR</div>
          <div className="kpi-trend neutral">{totals.bookings.toLocaleString()} bookings</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">High Risk Exposure</div>
          <div className="kpi-value" style={{ color: '#EF4444' }}>{fmt(totals.highValue)}</div>
          <div className="kpi-sub">{totals.estValue > 0 ? ((totals.highValue / totals.estValue) * 100).toFixed(1) : '0.0'}% of total value</div>
          <div className="kpi-trend bad">MTTI &gt; 60 days threshold</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Projected Revenue Leakage</div>
          <div className="kpi-value" style={{ color: '#EF4444' }}>{fmt(totals.leakage)}</div>
          <div className="kpi-sub">{totals.estValue > 0 ? ((totals.leakage / totals.estValue) * 100).toFixed(1) : '0.0'}% of total booking value</div>
          <div className="kpi-trend bad">Finance reforecast recommended</div>
        </div>
      </div>

      {/* Revenue At-Risk Donut + Forward-Looking KPIs */}
      <div className="card" style={{ marginBottom: 20, padding: '20px 24px' }}>
        <div style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 2 }}>Revenue At-Risk Breakdown</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            How {period} booking value splits across safe, recoverable, and projected-lost revenue
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>

          {/* Donut */}
          <div style={{ position: 'relative', flexShrink: 0, width: 220, height: 220 }}>
            <ResponsiveContainer width={220} height={220}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%" cy="50%"
                  innerRadius={68} outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {donutData.map((d, i) => <Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip content={<DonutTooltip />}/>
              </PieChart>
            </ResponsiveContainer>
            {/* Centre label */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center', pointerEvents: 'none',
            }}>
              <div style={{ fontSize: 11, color: '#6B7E94', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>At Risk</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#D93025', lineHeight: 1.2 }}>{atRiskPct}%</div>
              <div style={{ fontSize: 10, color: '#6B7E94' }}>of total value</div>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
            {donutData.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: d.color, flexShrink: 0, display: 'inline-block' }}/>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1E3048' }}>{fmt(d.value)}</div>
                  <div style={{ fontSize: 11, color: '#6B7E94' }}>{d.name}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 180, background: '#EEF2F7', flexShrink: 0 }}/>

          {/* Forward-looking KPIs */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 28px' }}>
            {[
              {
                label: 'Net Expected Revenue',
                value: fmt(totals.estValue - totals.leakage),
                sub:   'After projected leakage deducted',
                color: '#1F8A4C',
              },
              {
                label: 'Recovery Opportunity',
                value: fmt(recoverableVal),
                sub:   `${recoveryRate}% of at-risk value is saveable`,
                color: '#E8901A',
              },
              {
                label: 'If High-Risk ↓ 25%',
                value: `+${fmt(savingsAt25)} saved`,
                sub:   'Projected leakage reduction',
                color: '#0079C2',
              },
              {
                label: 'Leakage as % of Total',
                value: `${totals.estValue > 0 ? ((totals.leakage / totals.estValue) * 100).toFixed(1) : '0.0'}%`,
                sub:   'Finance reforecast threshold: 10%',
                color: totals.estValue > 0 && (totals.leakage / totals.estValue) > 0.1 ? '#D93025' : '#1F8A4C',
              },
            ].map(k => (
              <div key={k.label} style={{ borderLeft: `3px solid ${k.color}`, paddingLeft: 12 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7E94', marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: k.color, lineHeight: 1.1 }}>{k.value}</div>
                <div style={{ fontSize: 11, color: '#6B7E94', marginTop: 3 }}>{k.sub}</div>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Revenue Table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0' }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Monthly Revenue Risk Breakdown</div>
        </div>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Bookings</th>
                <th>Est. Total Value</th>
                <th>High Risk Bookings</th>
                <th>High Risk Value</th>
                <th>Projected Leakage</th>
                <th>Avg MTTI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.label}>
                  <td style={{ fontWeight: 600 }}>{row.label}</td>
                  <td>{row.total.toLocaleString()}</td>
                  <td style={{ fontWeight: 500 }}>{fmt(row.estValue)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#B91C1C', fontWeight: 600 }}>{row.high.toLocaleString()}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>({row.total > 0 ? ((row.high / row.total) * 100).toFixed(1) : '0.0'}%)</span>
                    </div>
                  </td>
                  <td style={{ color: '#B91C1C', fontWeight: 600 }}>{fmt(row.highRiskValue)}</td>
                  <td>
                    <div style={{ display: 'inline-block', background: '#FEF2F2', color: '#B91C1C', borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
                      {fmt(row.leakageRisk)}
                    </div>
                  </td>
                  <td style={{ fontWeight: 600, color: row.avgMtti > 25 ? '#B91C1C' : row.avgMtti > 15 ? '#92400E' : '#166534' }}>{row.avgMtti}d</td>
                </tr>
              ))}
              <tr style={{ background: '#F8FAFC', fontWeight: 700, borderTop: '2px solid #E2E8F0' }}>
                <td style={{ padding: '13px 16px' }}>TOTAL ({period})</td>
                <td style={{ padding: '13px 16px' }}>{totals.bookings.toLocaleString()}</td>
                <td style={{ padding: '13px 16px' }}>{fmt(totals.estValue)}</td>
                <td style={{ padding: '13px 16px', color: '#B91C1C' }}>{rows.reduce((s, r) => s + r.high, 0).toLocaleString()}</td>
                <td style={{ padding: '13px 16px', color: '#B91C1C' }}>{fmt(totals.highValue)}</td>
                <td style={{ padding: '13px 16px', color: '#B91C1C' }}>{fmt(totals.leakage)}</td>
                <td style={{ padding: '13px 16px' }}>{totals.avgMtti}d</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
        Leakage = {totals.estValue > 0 ? ((totals.leakage / totals.estValue) * 100).toFixed(1) : '0.0'}% of total booking value — {totals.leakageRate ? (totals.leakageRate * 100).toFixed(0) : '—'}% non-conversion rate applied to {totals.estValue > 0 ? ((totals.highValue / totals.estValue) * 100).toFixed(1) : '0.0'}% high-risk share.
      </div>
    </div>
  );
}
