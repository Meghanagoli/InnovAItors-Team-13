import React, { useState, useEffect } from 'react';
import { api, getCached } from '../api/client';
import type { MonthlyRow, CohortBooking, MetaResponse } from '../api/client';

function RiskBadge({ tier }: { tier: 'High' | 'Medium' | 'Low' }) {
  const cls    = tier === 'High' ? 'badge-high' : tier === 'Medium' ? 'badge-medium' : 'badge-low';
  const dotCls = tier === 'High' ? 'dot-high'   : tier === 'Medium' ? 'dot-medium'   : 'dot-low';
  return <span className={`badge ${cls}`}><span className={`dot ${dotCls}`} />{tier}</span>;
}

function ColorCell({ value, total, tier }: { value: number; total: number; tier: 'low' | 'medium' | 'high' }) {
  const pct    = total > 0 ? ((value / total) * 100).toFixed(0) : '0';
  const colors = { low: '#F0FDF4', medium: '#FFFBEB', high: '#FEF2F2' };
  const text   = { low: '#166534', medium: '#92400E', high: '#B91C1C' };
  return (
    <td style={{ padding: '13px 16px', borderBottom: '1px solid #E2E8F0', background: colors[tier], color: text[tier] }}>
      <div style={{ fontWeight: 600 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{pct}%</div>
    </td>
  );
}

function ExpandedRow({ month, year }: { month: MonthlyRow; year: string }) {
  const [bookings, setBookings] = useState<CohortBooking[] | null>(null);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    setBookings(null);
    setFetchError(false);
    api.cohortBookings(year, month.month)
      .then(data => { setBookings(data); setFetchError(false); })
      .catch(() => { setFetchError(true); setBookings([]); });
  }, [year, month.month]);

  return (
    <tr>
      <td colSpan={7} style={{ padding: 0, background: '#F8FAFC' }}>
        <div style={{ padding: '16px 24px', borderTop: '1px solid #E2E8F0' }}>
          {bookings === null && !fetchError ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading bookings from BigQuery…</div>
          ) : fetchError ? (
            <div style={{ fontSize: 13, color: '#B91C1C' }}>Could not load bookings — backend may need a restart.</div>
          ) : bookings!.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>No bookings found in BigQuery for {month.label} {year}.</div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
                Bookings — {month.label} (highest-risk shown first)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: 'white', borderRadius: 8, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Order ID', 'PMC Name', 'Product', 'Risk Score', 'Est. MTTI', 'Tier'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: '#3B82F6', whiteSpace: 'nowrap' }}>{b.orderId}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.pmcName}</td>
                      <td style={{ padding: '8px 12px', color: '#64748B' }}>{b.product}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 50, background: '#F1F5F9', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                            <div style={{ width: `${b.score}%`, height: '100%', background: b.score >= 65 ? '#EF4444' : b.score >= 35 ? '#F59E0B' : '#22C55E' }} />
                          </div>
                          <span style={{ fontWeight: 600 }}>{b.score}</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px' }}>{b.mtti} days</td>
                      <td style={{ padding: '8px 12px' }}><RiskBadge tier={b.tier} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                Showing {bookings.length} of {month.total.toLocaleString()} bookings in {month.label}. Scored by ML model in real time.
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function CohortPage() {
  const _meta     = getCached<MetaResponse>('/meta');
  const _initYear = _meta?.years[0] ?? '';
  const [monthlyData, setMonthlyData] = useState<MonthlyRow[]>(() =>
    _initYear ? getCached<MonthlyRow[]>(`/cohort?year=${_initYear}&sales_type=&territory=&product=&impl_type=`) ?? [] : []
  );
  const [loading, setLoading]         = useState(() => !_initYear || !getCached<MonthlyRow[]>(`/cohort?year=${_initYear}&sales_type=&territory=&product=&impl_type=`));
  const [year, setYear]               = useState('');   // '' keeps dropdown on placeholder
  const [years, setYears]             = useState<string[]>(_meta?.years ?? []);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // activeYear drives fetching — defaults to first available year (2026) even when dropdown shows placeholder
  const activeYear = year || _initYear || years[0] || '2026';

  useEffect(() => {
    api.meta().then(m => { setYears(m.years); }).catch(() => {});
  }, []);

  useEffect(() => {
    const fetchYear = year || years[0] || '2026';
    const cacheKey = `/cohort?year=${fetchYear}&sales_type=&territory=&product=&impl_type=`;
    if (!getCached(cacheKey)) setLoading(true);
    api.cohort(fetchYear)
      .then(setMonthlyData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [year, years]);

  if (loading) {
    return <div className="page"><div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Loading cohort data from BigQuery…</div></div>;
  }

  const totals = monthlyData.reduce(
    (acc, m) => ({ total: acc.total + m.total, low: acc.low + m.low, medium: acc.medium + m.medium, high: acc.high + m.high }),
    { total: 0, low: 0, medium: 0, high: 0 }
  );
  const overallAvgMtti  = monthlyData.length ? Math.round(monthlyData.reduce((s, m) => s + m.avgMtti, 0) / monthlyData.length) : 0;
  const overallAvgScore = monthlyData.length ? Math.round(monthlyData.reduce((s, m) => s + m.avgScore, 0) / monthlyData.length) : 0;

  const toggle = (label: string) => setExpandedMonth(prev => prev === label ? null : label);


  const pct = (n: number, tot: number) => tot > 0 ? ((n / tot) * 100).toFixed(1) + '%' : '0%';

  const exportCSV = () => {
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push([`Cohort Analysis — ${activeYear}`].map(esc).join(','));
    lines.push([`Exported: ${new Date().toLocaleString()}`].map(esc).join(','));
    lines.push('');

    // Monthly summary
    lines.push(['Month','Total','Low','Low %','Medium','Medium %','High','High %','Avg MTTI','Avg Score'].map(esc).join(','));
    monthlyData.forEach(r => lines.push([
      r.label, r.total,
      r.low, pct(r.low, r.total), r.medium, pct(r.medium, r.total), r.high, pct(r.high, r.total),
      r.avgMtti, r.avgScore,
    ].map(esc).join(',')));
    lines.push(['TOTAL', totals.total,
      totals.low, pct(totals.low, totals.total), totals.medium, pct(totals.medium, totals.total),
      totals.high, pct(totals.high, totals.total), overallAvgMtti, overallAvgScore,
    ].map(esc).join(','));

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `cohort-analysis-${activeYear}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="page-title">Cohort Analysis</div>
          <div className="page-subtitle">Monthly booking cohorts with risk distribution — click any row to drill down</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select value={year} onChange={e => { setYear(e.target.value); setExpandedMonth(null); }}
            style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', cursor: 'pointer', height: '37px' }}>
            <option value="" disabled>Select Year</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <div>
            <button
              onClick={exportCSV}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#1E293B', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ↓ Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Total Bookings</th>
              <th style={{ color: '#166534' }}>Low Risk</th>
              <th style={{ color: '#92400E' }}>Medium Risk</th>
              <th style={{ color: '#B91C1C' }}>High Risk</th>
              <th>Avg MTTI</th>
              <th>Avg Score</th>
            </tr>
          </thead>
          <tbody>
            {monthlyData.map(row => (
              <React.Fragment key={row.label}>
                <tr onClick={() => toggle(row.label)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        display: 'inline-block', width: 16, height: 16, lineHeight: '16px', textAlign: 'center', fontSize: 10,
                        color: expandedMonth === row.label ? '#3B82F6' : 'var(--muted)',
                        transform: expandedMonth === row.label ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
                      }}>▶</span>
                      {row.label}
                      {row.isSpike && (
                        <span title="High risk spike" style={{ fontSize: 10, background: '#FEF2F2', color: '#B91C1C', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>SPIKE</span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontWeight: 500 }}>{row.total.toLocaleString()}</td>
                  <ColorCell value={row.low}    total={row.total} tier="low" />
                  <ColorCell value={row.medium} total={row.total} tier="medium" />
                  <ColorCell value={row.high}   total={row.total} tier="high" />
                  <td>
                    <span style={{ fontWeight: 600, color: row.avgMtti > 42 ? '#B91C1C' : row.avgMtti > 38 ? '#92400E' : '#166534' }}>{row.avgMtti}d</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 44, background: '#F1F5F9', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                        <div style={{ width: `${row.avgScore}%`, height: '100%', background: row.avgScore >= 45 ? '#EF4444' : '#F59E0B' }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{row.avgScore}</span>
                    </div>
                  </td>
                </tr>
                {expandedMonth === row.label && <ExpandedRow month={row} year={activeYear} />}
              </React.Fragment>
            ))}
            <tr style={{ background: '#F8FAFC', fontWeight: 700, borderTop: '2px solid #E2E8F0' }}>
              <td style={{ padding: '13px 16px' }}>TOTAL</td>
              <td style={{ padding: '13px 16px' }}>{totals.total.toLocaleString()}</td>
              <td style={{ padding: '13px 16px', color: '#166534' }}>{totals.low.toLocaleString()}</td>
              <td style={{ padding: '13px 16px', color: '#92400E' }}>{totals.medium.toLocaleString()}</td>
              <td style={{ padding: '13px 16px', color: '#B91C1C' }}>{totals.high.toLocaleString()}</td>
              <td style={{ padding: '13px 16px' }}>{overallAvgMtti}d</td>
              <td style={{ padding: '13px 16px' }}>{overallAvgScore}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
        Spike marks months where High Risk count is 15% above average.
      </div>
    </div>
  );
}
