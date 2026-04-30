import React, { useState, useEffect } from 'react';
import { api, getCached } from '../api/client';
import type { PMCEntry } from '../api/client';
import { getRecommendations } from '../data/mockData';

type Rec = { action: string; urgency: 'immediate' | 'this-week' | 'standard'; owner: string };

async function fetchAIRecs(pmc: PMCEntry): Promise<{ recs: Rec[]; ai: boolean }> {
  const res = await fetch('/api/recommend/pmc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name:        pmc.name,
      territory:   pmc.territory,
      tier:        pmc.tier,
      score:       pmc.score,
      mtti:        pmc.mtti,
      sites:       pmc.sites,
      units:       pmc.units,
      orders:      pmc.orders,
      top_product: pmc.topProduct,
      sales_type:  pmc.salesType,
      factors:     pmc.factors,
    }),
  });
  if (!res.ok) throw new Error('API error');
  const data = await res.json();
  return { recs: data.recommendation, ai: data.ai };
}

function RiskBadge({ tier }: { tier: 'High' | 'Medium' | 'Low' }) {
  const map    = { High: 'badge badge-high', Medium: 'badge badge-medium', Low: 'badge badge-low' };
  const dotMap = { High: 'dot dot-high',     Medium: 'dot dot-medium',     Low: 'dot dot-low' };
  return <span className={map[tier]}><span className={dotMap[tier]} />{tier}</span>;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 65 ? '#EF4444' : score >= 35 ? '#F59E0B' : '#22C55E';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 60, background: '#F1F5F9', borderRadius: 3, height: 6, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color }}>{score}</span>
    </div>
  );
}

function ExpandedPMC({ pmc, onClose }: { pmc: PMCEntry; onClose: () => void }) {
  const tierColor = pmc.tier === 'High' ? '#EF4444' : pmc.tier === 'Medium' ? '#F59E0B' : '#22C55E';
  const maxPts    = pmc.factors.length ? Math.max(...pmc.factors.map(f => f.points)) : 1;

  const fallbackRecs: Rec[] = getRecommendations(pmc.factors, pmc.score, pmc.mtti).map(r => ({
    action: r.action, urgency: r.urgency, owner: r.owner,
  }));
  const [recs, setRecs]     = useState<Rec[]>(fallbackRecs);
  const [aiUsed, setAiUsed] = useState(false);
  const [recLoading, setRecLoading] = useState(true);

  useEffect(() => {
    fetchAIRecs(pmc)
      .then(({ recs: r, ai }) => { setRecs(r); setAiUsed(ai); })
      .catch(() => {})
      .finally(() => setRecLoading(false));
  }, [pmc.id]);

  const urgencyColor = { immediate: '#EF4444', 'this-week': '#F59E0B', standard: '#22C55E' };
  const urgencyLabel = { immediate: 'Now', 'this-week': 'This week', standard: 'Routine' };

  return (
    <tr>
      <td colSpan={8} style={{ padding: 0 }}>
        <div style={{ background: '#F8FAFC', padding: '20px 24px', borderTop: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{pmc.name}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{pmc.territory} · {pmc.sites.toLocaleString()} sites · {pmc.units.toLocaleString()} units</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: tierColor, lineHeight: 1 }}>{pmc.score}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Risk Score</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: tierColor, lineHeight: 1 }}>{pmc.mtti}d</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Est. MTTI</div>
              </div>
              <button onClick={onClose} style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 18, color: '#64748B' }}>✕</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 10 }}>Top Risk Factors</div>
              {pmc.factors.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No significant risk factors identified.</div>}
              {pmc.factors.map(f => (
                <div key={f.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span>{f.name}</span>
                    <span style={{ fontWeight: 700, color: '#EF4444' }}>+{f.points}</span>
                  </div>
                  <div style={{ background: '#E2E8F0', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${(f.points / maxPts) * 100}%`, height: '100%', background: '#EF4444', opacity: 0.7 }} />
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 10 }}>
                Active Orders ({pmc.activeOrders.length})
              </div>
              {pmc.activeOrders.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No pending orders.</div>}
              {pmc.activeOrders.map(o => (
                <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #E2E8F0', fontSize: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'monospace', color: '#3B82F6', fontSize: 11 }}>{o.id}</div>
                    <div style={{ color: '#64748B', marginTop: 1 }}>{o.product}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: o.score >= 65 ? '#EF4444' : o.score >= 35 ? '#F59E0B' : '#22C55E' }}>{o.score}</div>
                    <div style={{ color: '#64748B', fontSize: 11 }}>{o.mtti}d</div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Recommended Actions</div>
                {aiUsed && !recLoading && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 600, color: '#166534' }}>
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#22C55E" strokeWidth="1.5"/><path d="M4 6l1.5 1.5L8 4" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    AI
                  </span>
                )}
              </div>
              {recLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[1,2,3].map(i => (
                    <div key={i} style={{ height: 44, borderRadius: 6, background: 'linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s infinite' }} />
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {recs.map((r, i) => (
                    <div key={i} style={{ borderLeft: `3px solid ${urgencyColor[r.urgency]}`, paddingLeft: 10 }}>
                      <div style={{ fontSize: 12, lineHeight: 1.5 }}>{r.action}</div>
                      <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                        <span style={{ fontSize: 10, background: urgencyColor[r.urgency] + '22', color: urgencyColor[r.urgency], padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>{urgencyLabel[r.urgency]}</span>
                        <span style={{ fontSize: 10, background: '#F1F5F9', color: '#475569', padding: '1px 6px', borderRadius: 4 }}>Owner: {r.owner}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function AllocationPage() {
  const [pmcList, setPmcList]             = useState<PMCEntry[]>(() => getCached<PMCEntry[]>('/allocation?limit=200') ?? []);
  const [loading, setLoading]             = useState(() => !getCached<PMCEntry[]>('/allocation?limit=200'));
  const [expandedId, setExpandedId]       = useState<number | null>(null);
  const [tierFilter, setTierFilter]       = useState('All');
  const [territoryFilter, setTerritoryFilter] = useState('All');
  const [search, setSearch]               = useState('');
  const [currentPage, setCurrentPage]     = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    api.allocation(200)
      .then(setPmcList)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { setCurrentPage(1); }, [tierFilter, territoryFilter, search]);

  if (loading) {
    return <div className="page"><div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Loading PMC data from BigQuery…</div></div>;
  }

  const territories = [...new Set(pmcList.map(p => p.territory).filter(Boolean))].sort();

  const filtered = pmcList.filter(p => {
    if (tierFilter !== 'All' && p.tier !== tierFilter) return false;
    if (territoryFilter !== 'All' && p.territory !== territoryFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage    = Math.min(currentPage, totalPages);
  const paginated   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggle = (id: number) => setExpandedId(prev => prev === id ? null : id);

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Resource Allocation</div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total PMCs',  value: pmcList.length,                                 color: '#3B82F6', bg: '#EFF6FF', activeBg: '#DBEAFE', filter: 'All' },
          { label: 'High Risk',   value: pmcList.filter(p => p.tier === 'High').length,   color: '#B91C1C', bg: '#FEF2F2', activeBg: '#FECACA', filter: 'High' },
          { label: 'Medium Risk', value: pmcList.filter(p => p.tier === 'Medium').length, color: '#92400E', bg: '#FFFBEB', activeBg: '#FDE68A', filter: 'Medium' },
          { label: 'Low Risk',    value: pmcList.filter(p => p.tier === 'Low').length,    color: '#166534', bg: '#F0FDF4', activeBg: '#BBF7D0', filter: 'Low' },
        ].map(s => {
          const active = tierFilter === s.filter;
          return (
            <div key={s.label}
              onClick={() => setTierFilter(active ? 'All' : s.filter)}
              style={{
                flex: 1,
                background: active ? s.activeBg : s.bg,
                borderRadius: 10, padding: '18px 24px',
                display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start',
                cursor: 'pointer',
                border: `2px solid ${active ? s.color : 'transparent'}`,
                boxShadow: active ? `0 0 0 1px ${s.color}22` : 'none',
                transition: 'all 0.15s',
                userSelect: 'none' as const,
              }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, color: s.color, fontWeight: active ? 700 : 500 }}>{s.label}</span>
                {active && s.filter !== 'All' && (
                  <span style={{ fontSize: 11, color: s.color, opacity: 0.7 }}>✕</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="filter-bar">
        <select value={territoryFilter} onChange={e => setTerritoryFilter(e.target.value)}>
          <option value="All">All Territories</option>
          {territories.map(t => <option key={t}>{t}</option>)}
        </select>
        <input className="filter-search" placeholder="Search PMC name…" value={search} onChange={e => setSearch(e.target.value)} />
        {(tierFilter !== 'All' || territoryFilter !== 'All' || search) && (
          <button className="btn btn-outline btn-sm" onClick={() => { setTierFilter('All'); setTerritoryFilter('All'); setSearch(''); }}>Clear</button>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>PMC Name</th>
              <th>Territory</th>
              <th>Sites</th>
              <th>Units</th>
              <th>Risk Score</th>
              <th>Tier</th>
              <th>Est. MTTI</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((pmc, i) => (
              <React.Fragment key={pmc.id}>
                <tr onClick={() => toggle(pmc.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--muted)', fontWeight: 600 }}>{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: expandedId === pmc.id ? '#3B82F6' : 'var(--muted)', transform: expandedId === pmc.id ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
                      {pmc.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, paddingLeft: 18 }}>{pmc.salesType} · {pmc.orders} pending order{pmc.orders !== 1 ? 's' : ''}</div>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{pmc.territory}</td>
                  <td>{pmc.sites.toLocaleString()}</td>
                  <td style={{ color: 'var(--muted)' }}>{pmc.units.toLocaleString()}</td>
                  <td><ScoreBar score={pmc.score} /></td>
                  <td><RiskBadge tier={pmc.tier} /></td>
                  <td style={{ fontWeight: 600, color: pmc.mtti > 70 ? '#EF4444' : pmc.mtti > 40 ? '#F59E0B' : '#22C55E' }}>{pmc.mtti}d</td>
                </tr>
                {expandedId === pmc.id && <ExpandedPMC pmc={pmc} onClose={() => setExpandedId(null)} />}
              </React.Fragment>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>No PMCs match the current filters</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16, gap: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--muted)', marginRight: 4 }}>
          {filtered.length === 0 ? '0' : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)}`} of {filtered.length}
        </span>
        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
          style={{ padding: '4px 10px', borderRadius: 6, border: '1.5px solid #E2E8F0', background: 'white', cursor: safePage === 1 ? 'default' : 'pointer', color: safePage === 1 ? '#CBD5E1' : '#1E293B', fontWeight: 600 }}>
          ←
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
          .reduce<(number | '…')[]>((acc, p, idx, arr) => {
            if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push('…');
            acc.push(p);
            return acc;
          }, [])
          .map((p, idx) => p === '…'
            ? <span key={`ellipsis-${idx}`} style={{ padding: '4px 6px', color: 'var(--muted)' }}>…</span>
            : <button key={p} onClick={() => setCurrentPage(p as number)}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1.5px solid', fontWeight: 600, cursor: 'pointer', fontSize: 13,
                  borderColor: safePage === p ? '#1E293B' : '#E2E8F0',
                  background:  safePage === p ? '#1E293B' : 'white',
                  color:       safePage === p ? 'white'   : '#1E293B',
                }}>{p}</button>
          )}
        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
          style={{ padding: '4px 10px', borderRadius: 6, border: '1.5px solid #E2E8F0', background: 'white', cursor: safePage === totalPages ? 'default' : 'pointer', color: safePage === totalPages ? '#CBD5E1' : '#1E293B', fontWeight: 600 }}>
          →
        </button>
      </div>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  );
}
