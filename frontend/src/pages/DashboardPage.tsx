import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer
} from 'recharts';
import { api, getCached } from '../api/client';
import type { MonthlyRow, ProductRow, TerritoryRow, ReasonRow, MetaResponse, ReasonsResponse, FinanceResponse } from '../api/client';

const COLORS = { low: '#22C55E', medium: '#F59E0B', high: '#EF4444' };

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;
  const total = payload.reduce((s: number, p: any) => s + p.value, 0);
  return (
    <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.fill }}>
          <span>{p.name}</span><span style={{ fontWeight: 600 }}>{p.value.toLocaleString()}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #E2E8F0', marginTop: 6, paddingTop: 6, color: '#1E293B', fontWeight: 600 }}>
        Total: {total.toLocaleString()}
      </div>
    </div>
  );
};

export default function DashboardPage() {
  const [filter, setFilter] = useState({ product: '', territory: '' });
  const _meta     = getCached<MetaResponse>('/meta');
  const _initYear = _meta?.years[0] ?? '';
  // '' = rolling 12-month view (default); a year string = calendar-year view
  const [year, setYear]               = useState('');
  const [years, setYears]             = useState<string[]>(_meta?.years ?? []);
  const [products, setProducts]         = useState<ProductRow[]>(() => getCached<ProductRow[]>('/products') ?? []);
  const [territories, setTerritories]   = useState<TerritoryRow[]>(() => getCached<TerritoryRow[]>('/territories') ?? []);
  const [monthlyData, setMonthlyData]   = useState<MonthlyRow[]>(() =>
    getCached<MonthlyRow[]>('/cohort/rolling12') ?? []
  );
  const [backlogReasons, setBacklog]    = useState<ReasonRow[]>(() =>
    _initYear ? getCached<ReasonsResponse>(`/reasons?year=${_initYear}`)?.backlog ?? [] : []
  );
  const [cancelReasons, setCancel]      = useState<ReasonRow[]>(() =>
    _initYear ? getCached<ReasonsResponse>(`/reasons?year=${_initYear}`)?.cancellation ?? [] : []
  );
  const [finData, setFinData]           = useState<FinanceResponse | null>(() =>
    _initYear ? getCached<FinanceResponse>(`/finance?quarter=Full%20Year&year=${_initYear}`) ?? null : null
  );
  const [loading, setLoading]           = useState(() => !getCached<ProductRow[]>('/products'));

  const isRolling = year === '' || year === 'rolling';

  useEffect(() => {
    api.meta().then(m => { setYears(m.years); }).catch(() => {});
  }, []);

  useEffect(() => {
    const ctxYear = isRolling ? (_initYear || years[0] || '2026') : year;
    if (isRolling ? !getCached('/cohort/rolling12') : !getCached(`/cohort?year=${ctxYear}&sales_type=&territory=&product=&impl_type=`))
      setLoading(true);
    const cohortPromise = isRolling ? api.cohortRolling() : api.cohort(ctxYear);
    Promise.all([cohortPromise, api.products(), api.territories(), api.reasons(ctxYear), api.finance('Full Year', ctxYear)])
      .then(([c, p, t, r, f]) => { setMonthlyData(c); setProducts(p); setTerritories(t); setBacklog(r.backlog); setCancel(r.cancellation); setFinData(f); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [year, years]);

  if (loading) {
    return <div className="page"><div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Loading data from BigQuery…</div></div>;
  }

  const selectedProduct   = filter.product   !== '' ? products.find(p => p.name === filter.product)     : null;
  const selectedTerritory = filter.territory !== '' ? territories.find(t => t.name === filter.territory) : null;

  const totals = monthlyData.reduce(
    (acc, m) => ({ low: acc.low + m.low, medium: acc.medium + m.medium, high: acc.high + m.high }),
    { low: 0, medium: 0, high: 0 }
  );
  const grandTotal = totals.low + totals.medium + totals.high;

  const avgMtti = (() => {
    if (selectedProduct && selectedTerritory)
      return Math.round((selectedProduct.avgMtti + selectedTerritory.avgMtti) / 2);
    if (selectedProduct)   return selectedProduct.avgMtti;
    if (selectedTerritory) return selectedTerritory.avgMtti;
    return monthlyData.length ? Math.round(monthlyData.reduce((s, m) => s + m.avgMtti, 0) / monthlyData.length) : 0;
  })();

  const highPct    = grandTotal > 0 ? ((totals.high / grandTotal) * 100).toFixed(1) : '0.0';

  const donutData = [
    { name: 'Low',    value: totals.low },
    { name: 'Medium', value: totals.medium },
    { name: 'High',   value: totals.high },
  ];

  const totalBookings = (() => {
    if (selectedTerritory) return selectedTerritory.bookings;
    return monthlyData.reduce((s, m) => s + m.total, 0);
  })();

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Overview</div>
          <div className="page-subtitle">{isRolling ? 'Latest 12 months' : year} — implementation bookings, risk distribution and trends</div>
        </div>
        <div className="filter-bar" style={{ marginBottom: 0 }}>
          <select value={year} onChange={e => setYear(e.target.value)}>
            <option value="" disabled>Year</option>
            <option value="rolling">Latest 12 months</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filter.product} onChange={e => setFilter(f => ({ ...f, product: e.target.value }))}>
            <option value="" disabled>Product</option>
            {products.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <select value={filter.territory} onChange={e => setFilter(f => ({ ...f, territory: e.target.value }))}>
            <option value="" disabled>Territory</option>
            {territories.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      {(() => {
        const highRiskPct   = parseFloat(highPct);
        const mtti          = typeof avgMtti === 'number' ? Math.round(avgMtti) : 0;
        const revenueAtRisk = finData ? Math.round(finData.totals.leakage / 1_000_000) : Math.round(totals.high * 30000 / 1_000_000);

        // thresholds → color tokens
        const bookingColor = '#3B82F6';  // always neutral blue (raw count, no good/bad threshold)

        const highRiskColor = highRiskPct >= 5 ? '#EF4444' : highRiskPct >= 2 ? '#F59E0B' : '#22C55E';
        const highRiskBg    = highRiskPct >= 5 ? '#FEF2F2' : highRiskPct >= 2 ? '#FFFBEB' : '#F0FDF4';
        const highRiskBorder= highRiskPct >= 5 ? '#FECACA' : highRiskPct >= 2 ? '#FDE68A' : '#BBF7D0';
        const highRiskLabel = highRiskPct >= 5 ? '⚠ Above threshold' : highRiskPct >= 2 ? '↗ Approaching limit' : '✓ Within target';

        // revenue always red — any non-zero exposure warrants attention
        const revColor  = revenueAtRisk > 0 ? '#EF4444' : '#22C55E';
        const revBg     = revenueAtRisk > 0 ? '#FEF2F2' : '#F0FDF4';
        const revBorder = revenueAtRisk > 0 ? '#FECACA' : '#BBF7D0';
        const revLabel  = revenueAtRisk > 0 ? '⚠ Reforecast recommended' : '✓ No exposure';

        const mttiColor  = mtti > 30 ? '#EF4444' : mtti > 20 ? '#F59E0B' : '#22C55E';
        const mttiBg     = mtti > 30 ? '#FEF2F2' : mtti > 20 ? '#FFFBEB' : '#F0FDF4';
        const mttiBorder = mtti > 30 ? '#FECACA' : mtti > 20 ? '#FDE68A' : '#BBF7D0';
        const mttiLabel  = mtti > 30 ? '⚠ Exceeds 30d target' : mtti > 20 ? '↗ Nearing target' : '✓ On track';

        const cardStyle = (bg: string, border: string): React.CSSProperties => ({
          background: bg,
          border: `1.5px solid ${border}`,
          borderRadius: 12,
          padding: '18px 20px',
        });

        return (
          <div className="kpi-grid">
            {/* Total Bookings — neutral blue */}
            <div className="kpi-card" style={{ border: `1.5px solid #BFDBFE`, background: '#EFF6FF', borderRadius: 12, padding: '18px 20px' }}>
              <div className="kpi-label">Total Bookings</div>
              <div className="kpi-value" style={{ color: bookingColor }}>{totalBookings.toLocaleString()}</div>
              <div className="kpi-sub">{selectedTerritory ? selectedTerritory.name : isRolling ? 'Latest 12 months' : `${year} YTD`}</div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#1D4ED8', fontWeight: 500 }}>{isRolling ? 'Rolling 12 months · BigQuery' : `${year} YTD · BigQuery`}</div>
            </div>

            {/* High Risk Bookings */}
            <div className="kpi-card" style={cardStyle(highRiskBg, highRiskBorder)}>
              <div className="kpi-label">High Risk Bookings</div>
              <div className="kpi-value" style={{ color: highRiskColor }}>{totals.high.toLocaleString()}</div>
              <div className="kpi-sub">{highPct}% of scored orders</div>
              <div style={{ marginTop: 8, fontSize: 12, color: highRiskColor, fontWeight: 600 }}>{highRiskLabel}</div>
            </div>

            {/* Revenue at Risk — always red when non-zero */}
            <div className="kpi-card" style={cardStyle(revBg, revBorder)}>
              <div className="kpi-label">Revenue at Risk (Est.)</div>
              <div className="kpi-value" style={{ color: revColor }}>${revenueAtRisk.toLocaleString()}M</div>
              <div className="kpi-sub">{finData && finData.totals.estValue > 0 ? `${(finData.totals.leakage / finData.totals.estValue * 100).toFixed(1)}% of total booking value` : 'Projected revenue leakage'}</div>
              <div style={{ marginTop: 8, fontSize: 12, color: revColor, fontWeight: 600 }}>{revLabel}</div>
            </div>

            {/* Avg MTTI */}
            <div className="kpi-card" style={cardStyle(mttiBg, mttiBorder)}>
              <div className="kpi-label">Avg MTTI</div>
              <div className="kpi-value" style={{ color: mttiColor }}>{mtti}<span style={{ fontSize: 16, fontWeight: 400 }}> days</span></div>
              <div className="kpi-sub">{selectedProduct && selectedTerritory ? `${selectedProduct.name} · ${selectedTerritory.name}` : selectedProduct ? selectedProduct.name : selectedTerritory ? selectedTerritory.name : 'Mean Time to Implement'}</div>
              <div style={{ marginTop: 8, fontSize: 12, color: mttiColor, fontWeight: 600 }}>{mttiLabel}</div>
            </div>
          </div>
        );
      })()}

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, marginBottom: 20 }}>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 4 }}>Monthly Bookings — Risk Distribution</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            {isRolling ? 'Last 12 months — stacked by risk tier' : `${year} by month — stacked by risk tier`}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis
                dataKey="label"
                tickFormatter={(lbl: string) => {
                  if (isRolling) return lbl; // already "May '25"
                  const ABBR: Record<string,string> = { January:'Jan',February:'Feb',March:'Mar',April:'Apr',May:'May',June:'Jun',July:'Jul',August:'Aug',September:'Sep',October:'Oct',November:'Nov',December:'Dec' };
                  return `${ABBR[lbl] || lbl} ${year}`;
                }}
                tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="low"    name="Low"    stackId="a" fill={COLORS.low} />
              <Bar dataKey="medium" name="Medium" stackId="a" fill={COLORS.medium} />
              <Bar dataKey="high"   name="High"   stackId="a" fill={COLORS.high} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 20, marginTop: 8, justifyContent: 'center' }}>
            {(['Low', 'Medium', 'High'] as const).map(label => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[label.toLowerCase() as keyof typeof COLORS] }} />
                {label} Risk
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="card-title" style={{ alignSelf: 'flex-start' }}>Overall Risk Breakdown</div>
          <PieChart width={220} height={180}>
            <Pie data={donutData} cx={110} cy={90} innerRadius={55} outerRadius={82} dataKey="value" paddingAngle={2}>
              {donutData.map((_, i) => (
                <Cell key={i} fill={[COLORS.low, COLORS.medium, COLORS.high][i]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: any) => [Number(v).toLocaleString(), '']} />
          </PieChart>
          <div style={{ width: '100%', marginTop: 4 }}>
            {[
              { label: 'Low Risk',    value: totals.low,    color: COLORS.low,    pct: grandTotal > 0 ? ((totals.low / grandTotal) * 100).toFixed(0) : '0' },
              { label: 'Medium Risk', value: totals.medium, color: COLORS.medium, pct: grandTotal > 0 ? ((totals.medium / grandTotal) * 100).toFixed(0) : '0' },
              { label: 'High Risk',   value: totals.high,   color: COLORS.high,   pct: highPct },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.color }} />
                  {row.label}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{row.pct}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Backlog & Cancellation Reasons */}
      {(backlogReasons.length > 0 || cancelReasons.length > 0) && (
        <div className="grid-2" style={{ marginBottom: 20 }}>
          <BacklogReasonChart rows={backlogReasons} />
          <CancellationReasonChart rows={cancelReasons} />
        </div>
      )}

      {/* Bottom Row */}
      <div className="grid-2">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Product Family Risk</div>
            {filter.product !== '' && (
              <button onClick={() => setFilter(f => ({ ...f, product: '' }))} style={{ fontSize: 11, color: '#3B82F6', background: '#EFF6FF', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>Clear</button>
            )}
          </div>
          {products
            .filter(p => filter.product === '' || p.name === filter.product)
            .map(p => {
              const isSelected = filter.product === p.name;
              return (
                <div key={p.name} onClick={() => setFilter(f => ({ ...f, product: f.product === p.name ? '' : p.name }))}
                  style={{ marginBottom: 12, cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: isSelected ? '#EFF6FF' : 'transparent', border: isSelected ? '1px solid #BFDBFE' : '1px solid transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400 }}>{p.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Avg MTTI {p.avgMtti}d</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: p.avgScore >= 65 ? '#EF4444' : p.avgScore >= 35 ? '#B45309' : '#166534' }}>{p.avgScore}</span>
                    </div>
                  </div>
                  <div className="progress-wrap">
                    <div className="progress-fill" style={{ width: `${p.avgScore}%`, background: p.avgScore >= 65 ? '#EF4444' : p.avgScore >= 35 ? '#F59E0B' : '#22C55E' }} />
                  </div>
                </div>
              );
            })}
          {filter.product !== '' && products.filter(p => p.name === filter.product).length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 0' }}>No data for selected product.</div>
          )}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Territory Risk</div>
            {filter.territory !== '' && (
              <button onClick={() => setFilter(f => ({ ...f, territory: '' }))} style={{ fontSize: 11, color: '#3B82F6', background: '#EFF6FF', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>Clear</button>
            )}
          </div>
          {territories
            .filter(t => filter.territory === '' || t.name === filter.territory)
            .map(t => {
              const isSelected = filter.territory === t.name;
              return (
                <div key={t.name} onClick={() => setFilter(f => ({ ...f, territory: f.territory === t.name ? '' : t.name }))}
                  style={{ marginBottom: 12, cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: isSelected ? '#EFF6FF' : 'transparent', border: isSelected ? '1px solid #BFDBFE' : '1px solid transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400 }}>{t.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.bookings.toLocaleString()} bookings</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: t.avgScore >= 65 ? '#EF4444' : t.avgScore >= 35 ? '#B45309' : '#166534' }}>{t.avgScore}</span>
                    </div>
                  </div>
                  <div className="progress-wrap">
                    <div className="progress-fill" style={{ width: `${t.avgScore}%`, background: t.avgScore >= 65 ? '#EF4444' : t.avgScore >= 35 ? '#F59E0B' : '#22C55E' }} />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

    </div>
  );
}

const REASON_PALETTE = [
  '#F59E0B','#FB923C','#F87171','#A78BFA','#34D399','#60A5FA','#FBBF24','#4ADE80','#818CF8','#F472B6',
];

function BacklogReasonChart({ rows }: { rows: ReasonRow[] }) {
  const data = rows.slice(0, 8).map(r => ({
    reason: r.reason.length > 26 ? r.reason.slice(0, 24) + '…' : r.reason,
    fullReason: r.reason,
    count: r.count,
  }));
  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 4 }}>Backlog Reasons</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Top {data.length} reasons orders remain in backlog</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
          <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
            tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)} />
          <YAxis type="category" dataKey="reason" width={148} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v: any, _: any, props: any) => [Number(v).toLocaleString(), props.payload.fullReason]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {data.map((_, i) => <Cell key={i} fill={REASON_PALETTE[i % REASON_PALETTE.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CancellationReasonChart({ rows }: { rows: ReasonRow[] }) {
  const top    = rows.slice(0, 7);
  const other  = rows.slice(7).reduce((s, r) => s + r.count, 0);
  const data   = [...top, ...(other > 0 ? [{ reason: 'Other', count: other }] : [])];
  const total  = data.reduce((s, r) => s + r.count, 0);
  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 4 }}>Cancellation Reasons</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Proportion of cancelled bookings by reason</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <PieChart width={180} height={180}>
          <Pie data={data} cx={90} cy={90} innerRadius={52} outerRadius={80} dataKey="count" paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={REASON_PALETTE[i % REASON_PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v: any, _: any, props: any) => [
            `${Number(v).toLocaleString()} (${total > 0 ? ((Number(v) / total) * 100).toFixed(1) : 0}%)`,
            props.payload.reason,
          ]} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
        </PieChart>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.map((r, i) => (
            <div key={r.reason} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: REASON_PALETTE[i % REASON_PALETTE.length] }} />
              <span style={{ fontSize: 11, color: '#475569', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#1E293B', flexShrink: 0 }}>
                {total > 0 ? ((r.count / total) * 100).toFixed(0) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
