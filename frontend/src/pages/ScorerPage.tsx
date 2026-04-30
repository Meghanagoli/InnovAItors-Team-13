import { useState, useEffect, useRef } from 'react';
import type { ScoreFactor, ScoreResult, ScorerInputs } from '../data/mockData';
import { api } from '../api/client';
import type { PMCEntry } from '../api/client';

// ── Semicircle Risk Gauge ──────────────────────────────────────────
function SemicircleGauge({ score, tier }: { score: number; tier: 'High' | 'Medium' | 'Low' }) {
  const cx = 150, cy = 148, r = 95, sw = 28;
  const clamp = Math.max(0, Math.min(100, score));

  // score 0 → angle π (left), score 100 → angle 0 (right)
  const toAngle = (s: number) => Math.PI * (1 - Math.max(0, Math.min(100, s)) / 100);
  const pt = (s: number, radius: number) => {
    const a = toAngle(s);
    return { x: cx + radius * Math.cos(a), y: cy - radius * Math.sin(a) };
  };
  const arcD = (from: number, to: number, radius = r) => {
    const p1 = pt(from, radius), p2 = pt(to, radius);
    const large = (to - from) > 50 ? 1 : 0;
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  };

  const tierColor = tier === 'High' ? '#EF4444' : tier === 'Medium' ? '#F59E0B' : '#22C55E';
  const tierLabel = tier === 'High' ? 'High Risk' : tier === 'Medium' ? 'Medium Risk' : 'Low Risk';
  const needlePt  = pt(clamp, r - sw / 2 - 8);
  const labelPt   = (s: number) => pt(s, r + sw / 2 + 18);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#64748B' }}>
        Risk Score —
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: tierColor, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ color: tierColor }}>{tierLabel}</span>
      </div>
      <svg viewBox="0 0 300 176" style={{ width: '100%', maxWidth: 360, display: 'block', margin: '0 auto' }}>
        {/* Zone background fills */}
        <path d={arcD(0,   35)}  fill="none" stroke="#DCFCE7" strokeWidth={sw} strokeLinecap="butt" />
        <path d={arcD(35,  65)}  fill="none" stroke="#FEF3C7" strokeWidth={sw} strokeLinecap="butt" />
        <path d={arcD(65, 100)}  fill="none" stroke="#FEE2E2" strokeWidth={sw} strokeLinecap="butt" />
        {/* Zone border outlines */}
        <path d={arcD(0,   35)}  fill="none" stroke="#86EFAC" strokeWidth={1.5} strokeLinecap="butt" />
        <path d={arcD(35,  65)}  fill="none" stroke="#FCD34D" strokeWidth={1.5} strokeLinecap="butt" />
        <path d={arcD(65, 100)}  fill="none" stroke="#FCA5A5" strokeWidth={1.5} strokeLinecap="butt" />
        {/* Score fill arc */}
        {clamp > 0 && (
          <path d={arcD(0, Math.min(clamp, 99.9))} fill="none" stroke={tierColor} strokeWidth={sw} strokeLinecap="butt" opacity={0.82} />
        )}
        {/* Tick labels: 0, 50, 100 */}
        {([0, 50, 100] as const).map(s => {
          const lp  = labelPt(s);
          const anchor = s === 0 ? 'end' : s === 100 ? 'start' : 'middle';
          return <text key={s} x={lp.x} y={lp.y} textAnchor={anchor} dominantBaseline="middle" fontSize="11" fill="#94A3B8">{s}</text>;
        })}
        {/* Score number */}
        <text x={cx} y={cy - 30} textAnchor="middle" dominantBaseline="middle" fontSize="44" fontWeight="700" fill="#1E293B" fontFamily="sans-serif">{clamp}</text>
        {/* Needle */}
        <line x1={cx} y1={cy} x2={needlePt.x} y2={needlePt.y} stroke="#374151" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={7} fill="#374151" />
        <circle cx={cx} cy={cy} r={3.5} fill="white" />
      </svg>
    </div>
  );
}

function TierBadge({ tier }: { tier: 'High' | 'Medium' | 'Low' }) {
  const map = {
    High:   { bg: '#FEF2F2', color: '#B91C1C', label: 'HIGH RISK' },
    Medium: { bg: '#FFFBEB', color: '#92400E', label: 'MEDIUM RISK' },
    Low:    { bg: '#F0FDF4', color: '#166534', label: 'LOW RISK' },
  };
  const s = map[tier];
  return (
    <div style={{ background: s.bg, color: s.color, borderRadius: 8, padding: '8px 20px', fontWeight: 700, fontSize: 15, textAlign: 'center', letterSpacing: '0.05em' }}>
      {s.label}
    </div>
  );
}

function FactorBar({ factor, maxPts }: { factor: ScoreFactor; maxPts: number }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{factor.name}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#EF4444', flexShrink: 0, marginLeft: 8 }}>+{factor.points} pts</span>
      </div>
      <div className="progress-wrap">
        <div className="progress-fill" style={{ width: `${(factor.points / maxPts) * 100}%`, background: '#EF4444', opacity: 0.7 }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{factor.description}</div>
    </div>
  );
}

function groupSolutions(names: string[]): { group: string; items: string[] }[] {
  const groups: { group: string; items: string[] }[] = [
    { group: 'Property Management', items: [] },
    { group: 'Screening & Leasing', items: [] },
    { group: 'Accounting & Finance', items: [] },
    { group: 'Revenue & Analytics', items: [] },
    { group: 'Other', items: [] },
  ];
  const keywords: [string, string][] = [
    ['Yardi', 'Property Management'], ['MRI', 'Property Management'],
    ['AppFolio', 'Property Management'], ['Entrata', 'Property Management'],
    ['OneSite', 'Property Management'], ['RealPage One', 'Property Management'],
    ['Portals', 'Screening & Leasing'], ['Leasing', 'Screening & Leasing'],
    ['Screening', 'Screening & Leasing'],
    ['Accounting', 'Accounting & Finance'], ['Utility', 'Accounting & Finance'],
    ['GL', 'Accounting & Finance'], ['Payable', 'Accounting & Finance'],
    ['Yield', 'Revenue & Analytics'], ['Rainmaker', 'Revenue & Analytics'],
    ['Analytics', 'Revenue & Analytics'], ['Intelligence', 'Revenue & Analytics'],
  ];
  for (const name of names) {
    const match = keywords.find(([kw]) => name.toLowerCase().includes(kw.toLowerCase()));
    const groupName = match ? match[1] : 'Other';
    const g = groups.find(g => g.group === groupName) ?? groups[groups.length - 1];
    g.items.push(name);
  }
  return groups.filter(g => g.items.length > 0);
}

// ── Solution Suite Checkboxes ──────────────────────────────────────
function SolutionCheckboxes({ selected, onChange, options }: { selected: string[]; onChange: (v: string[]) => void; options: string[] }) {
  const grouped = groupSolutions(options);
  const toggle = (name: string) => {
    if (selected.includes(name)) {
      onChange(selected.filter(s => s !== name));
    } else {
      onChange([...selected, name]);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {grouped.map(({ group, items }) => (
        <div key={group}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', marginBottom: 5 }}>{group}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {items.map(name => {
              const checked = selected.includes(name);
              return (
                <label key={name} style={{
                  display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                  padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                  background: checked ? '#EFF6FF' : '#F8FAFC',
                  border: `1.5px solid ${checked ? '#3B82F6' : '#E2E8F0'}`,
                  color: checked ? '#1D4ED8' : '#475569',
                  transition: 'all 0.12s',
                }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(name)}
                    style={{ accentColor: '#3B82F6', width: 13, height: 13 }} />
                  {name}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Default form values ────────────────────────────────────────────
const defaultInputs: ScorerInputs = {
  salesType:          '',
  implementationType: '',
  productFamily:      '',
  businessType:       '',
  territory:          '',
  omsSites:           0,
  omsUnits:           0,
  totalOrders:        0,
  selectedSolutions:  [],
  numSolutions:       0,
};

export default function ScorerPage() {
  const [inputs, setInputs]   = useState<ScorerInputs>(defaultInputs);
  const [result, setResult]   = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState<Set<string>>(new Set());

  const [pmcList, setPmcList]               = useState<PMCEntry[]>([]);
  const [clientSearch, setClientSearch]     = useState('');
  const [selectedClient, setSelectedClient] = useState<PMCEntry | null>(null);
  const [showClientList, setShowClientList] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [salesTypeOpts, setSalesTypeOpts]         = useState<string[]>([]);
  const [implTypeOpts, setImplTypeOpts]           = useState<string[]>([]);
  const [productFamilyOpts, setProductFamilyOpts] = useState<string[]>([]);
  const [businessTypeOpts, setBusinessTypeOpts]   = useState<string[]>([]);
  const [territoryOpts, setTerritoryOpts]         = useState<string[]>([]);
  const [solutionOpts, setSolutionOpts]           = useState<string[]>([]);

  useEffect(() => {
    api.allocation(200).then(setPmcList).catch(() => {});
    api.options().then(opts => {
      if (opts.sales_type?.length)        setSalesTypeOpts(opts.sales_type);
      if (opts.implementation_type?.length) setImplTypeOpts(opts.implementation_type);
      if (opts.business_type?.length)     setBusinessTypeOpts(opts.business_type);
      if (opts.sol_pm_primary?.length)    setSolutionOpts(opts.sol_pm_primary);
    }).catch(() => {});
    api.products().then(p => {
      const names = p.map(r => r.name).filter(Boolean);
      if (names.length) setProductFamilyOpts(names);
    }).catch(() => {});
    api.territories().then(t => {
      const names = t.map(r => r.name).filter(Boolean);
      if (names.length) setTerritoryOpts(names);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowClientList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredClients = clientSearch.trim().length >= 2
    ? pmcList.filter(p => p.name.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 8)
    : [];

  const selectClient = (pmc: PMCEntry) => {
    setSelectedClient(pmc);
    setClientSearch(pmc.name);
    setShowClientList(false);
    setInputs(prev => ({
      ...prev,
      territory: territoryOpts.includes(pmc.territory) ? pmc.territory : prev.territory,
      omsSites:  pmc.sites  > 0 ? pmc.sites  : prev.omsSites,
      omsUnits:  pmc.units  > 0 ? pmc.units  : prev.omsUnits,
      salesType: pmc.salesType && salesTypeOpts.includes(pmc.salesType) ? pmc.salesType : prev.salesType,
    }));
    setResult(null);
  };

  const handleSolutionsChange = (newSolutions: string[]) => {
    setInputs(prev => ({ ...prev, selectedSolutions: newSolutions, numSolutions: newSolutions.length }));
    setErrors(prev => { const next = new Set(prev); next.delete('selectedSolutions'); return next; });
    setResult(null);
  };

  const set = (field: keyof ScorerInputs) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const numFields = ['omsSites', 'omsUnits', 'totalOrders', 'numSolutions'];
    const val = numFields.includes(field) ? Number(e.target.value) : e.target.value;
    setInputs(prev => ({ ...prev, [field]: val }));
    setErrors(prev => { const next = new Set(prev); next.delete(field); return next; });
    setResult(null);
  };

  const handleScore = async () => {
    const missing = new Set<string>();
    if (!inputs.salesType)                     missing.add('salesType');
    if (!inputs.implementationType)            missing.add('implementationType');
    if (!inputs.productFamily)                 missing.add('productFamily');
    if (!inputs.businessType)                  missing.add('businessType');
    if (!inputs.territory)                     missing.add('territory');
    if (inputs.selectedSolutions.length === 0) missing.add('selectedSolutions');
    if (missing.size > 0) {
      setErrors(missing);
      return;
    }
    setErrors(new Set());
    setLoading(true);
    setResult(null);
    try {
      const primarySolution = inputs.selectedSolutions[0] ?? 'Other';
      const res = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales_type:             inputs.salesType,
          implementation_type:    inputs.implementationType,
          product_family:         inputs.productFamily,
          business_type:          inputs.businessType,
          territory:              inputs.territory,
          total_sites:            inputs.omsSites,
          total_units:            inputs.omsUnits,
          pmc_total_units:        inputs.omsUnits,
          num_existing_solutions: inputs.numSolutions,
          sol_pm_primary:         primarySolution,
          net_ext_year1_charge:   0,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult({
        score:             data.risk_score,
        tier:              data.risk_tier as 'High' | 'Medium' | 'Low',
        mtti:              data.mtti_pred,
        factors:           data.top_factors.map((f: { name: string; points: number; description: string }) => f as ScoreFactor),
        recommendation:    data.recommendation,
        aiRecommendation:  data.ai_recommendation ?? false,
      });
    } catch (err) {
      alert('API error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  const maxPts = result ? Math.max(...result.factors.map(f => f.points)) : 1;

  const tierColor = result ? (result.tier === 'High' ? '#EF4444' : result.tier === 'Medium' ? '#F59E0B' : '#22C55E') : '#3B82F6';

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8', marginBottom: 10, marginTop: 4 }}>{children}</div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Score a Booking</div>
        <div className="page-subtitle">Enter booking details to get an instant AI risk assessment</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '440px 1fr', gap: 24, alignItems: 'start' }}>

        {/* ── Form ── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>

          {/* Card header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h8M2 12h5" stroke="#3B82F6" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1E293B' }}>Booking Details</div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>All fields marked * are required</div>
            </div>
          </div>

          <div style={{ padding: '18px 20px' }}>

            {/* Client search */}
            <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid #F1F5F9' }} ref={dropdownRef}>
              <SectionLabel>Quick Fill from Existing Client</SectionLabel>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  placeholder="Search client name to pre-fill fields…"
                  value={clientSearch}
                  onChange={e => { setClientSearch(e.target.value); setShowClientList(true); if (!e.target.value) setSelectedClient(null); }}
                  onFocus={() => setShowClientList(true)}
                  style={{ paddingLeft: 34, paddingRight: selectedClient ? 32 : undefined }}
                />
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                  <circle cx="6.5" cy="6.5" r="5" stroke="#94A3B8" strokeWidth="1.5"/>
                  <path d="M10 10l3.5 3.5" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {selectedClient && (
                  <button onClick={() => { setSelectedClient(null); setClientSearch(''); }}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 18, lineHeight: 1 }}>×</button>
                )}
                {showClientList && filteredClients.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'white', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', marginTop: 3, maxHeight: 220, overflowY: 'auto' }}>
                    {filteredClients.map(pmc => (
                      <div key={pmc.id} onMouseDown={() => selectClient(pmc)}
                        style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid #F8FAFC', fontSize: 13 }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                        <div style={{ fontWeight: 600 }}>{pmc.name}</div>
                        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1, display: 'flex', gap: 8 }}>
                          <span>{pmc.territory}</span>
                          <span>·</span>
                          <span>{pmc.sites.toLocaleString()} sites</span>
                          <span>·</span>
                          <span>{pmc.units.toLocaleString()} units</span>
                          <span style={{ color: pmc.tier === 'High' ? '#EF4444' : pmc.tier === 'Medium' ? '#F59E0B' : '#22C55E', fontWeight: 600 }}>{pmc.tier} risk</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedClient && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#3B82F6', background: '#EFF6FF', borderRadius: 6, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>✓</span>
                  {selectedClient.name} — {selectedClient.territory} · {selectedClient.sites.toLocaleString()} sites · {selectedClient.units.toLocaleString()} units
                </div>
              )}
            </div>

            {/* Booking info */}
            <SectionLabel>Booking Information *</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
              <div className="form-group">
                <label className="form-label" style={{ color: errors.has('salesType') ? '#EF4444' : undefined }}>Sales Type</label>
                <select className="form-select" value={inputs.salesType} onChange={set('salesType')} style={{ borderColor: errors.has('salesType') ? '#EF4444' : undefined }}>
                  <option value="" disabled>Select…</option>
                  {salesTypeOpts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: errors.has('implementationType') ? '#EF4444' : undefined }}>Implementation Type</label>
                <select className="form-select" value={inputs.implementationType} onChange={set('implementationType')} style={{ borderColor: errors.has('implementationType') ? '#EF4444' : undefined }}>
                  <option value="" disabled>Select…</option>
                  {implTypeOpts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" style={{ color: errors.has('productFamily') ? '#EF4444' : undefined }}>Product Family</label>
              <select className="form-select" value={inputs.productFamily} onChange={set('productFamily')} style={{ borderColor: errors.has('productFamily') ? '#EF4444' : undefined }}>
                <option value="" disabled>Select product family…</option>
                {productFamilyOpts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            {/* Account info */}
            <SectionLabel>Account Details *</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
              <div className="form-group">
                <label className="form-label" style={{ color: errors.has('businessType') ? '#EF4444' : undefined }}>Business Type</label>
                <select className="form-select" value={inputs.businessType} onChange={set('businessType')} style={{ borderColor: errors.has('businessType') ? '#EF4444' : undefined }}>
                  <option value="" disabled>Select…</option>
                  {businessTypeOpts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: errors.has('territory') ? '#EF4444' : undefined }}>Territory</label>
                <select className="form-select" value={inputs.territory} onChange={set('territory')} style={{ borderColor: errors.has('territory') ? '#EF4444' : undefined }}>
                  <option value="" disabled>Select…</option>
                  {territoryOpts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            {/* Scale */}
            <SectionLabel>Scale</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 4 }}>
              <div className="form-group">
                <label className="form-label">Total Sites</label>
                <input className="form-input" type="number" value={inputs.omsSites} onChange={set('omsSites')} min={0} />
              </div>
              <div className="form-group">
                <label className="form-label">Total Units</label>
                <input className="form-input" type="number" value={inputs.omsUnits} onChange={set('omsUnits')} min={0} />
              </div>
              <div className="form-group">
                <label className="form-label">Order Requests</label>
                <input className="form-input" type="number" value={inputs.totalOrders} onChange={set('totalOrders')} min={1} max={20} />
              </div>
            </div>

            {/* Solutions */}
            <SectionLabel>Existing Solutions / Suite *</SectionLabel>
            <div style={{ border: `1.5px solid ${errors.has('selectedSolutions') ? '#EF4444' : '#E2E8F0'}`, borderRadius: 8, padding: '12px', background: '#FAFAFA', marginBottom: 4 }}>
              <SolutionCheckboxes selected={inputs.selectedSolutions} onChange={handleSolutionsChange} options={solutionOpts} />
            </div>
            {inputs.selectedSolutions.length > 0 && (
              <div style={{ fontSize: 11, color: '#3B82F6', marginBottom: 8 }}>
                {inputs.selectedSolutions.length} solution{inputs.selectedSolutions.length > 1 ? 's' : ''} selected
              </div>
            )}

            {errors.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#B91C1C' }}>
                <span>⚠</span> Please fill in all required fields before scoring.
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 14, fontWeight: 700, borderRadius: 10, marginTop: 4 }}
              onClick={handleScore}
              disabled={loading}>
              {loading
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" style={{ animation: 'spin 1s linear infinite' }}><circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" fill="none"/><path d="M8 2a6 6 0 0 1 6 6" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none"/></svg>
                    Calculating…
                  </span>
                : '▶  Score This Booking'}
            </button>
          </div>
        </div>

        {/* ── Results Panel ── */}
        <div>
          {!result && !loading && (
            <div className="card" style={{ padding: '40px 32px', textAlign: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M14 4l-8 3.6v6.4c0 4.4 3.4 8.6 8 9.6 4.6-1 8-5.2 8-9.6V7.6L14 4z" fill="#3B82F6" opacity="0.15" stroke="#3B82F6" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M10 14l3 3 5-5" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', marginBottom: 8 }}>Ready to Score</div>
              <div style={{ fontSize: 13, color: '#64748B', maxWidth: 280, margin: '0 auto 28px', lineHeight: 1.6 }}>
                Complete the form on the left and click <strong>Score This Booking</strong> to get your risk assessment.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, textAlign: 'left' }}>
                {[
                  { icon: '📊', label: 'Risk Score', desc: 'Implementation delay probability (0–100)' },
                  { icon: '⏱', label: 'Predicted MTTI', desc: 'Expected days from booking to go-live' },
                  { icon: '⚠', label: 'Risk Factors', desc: 'Top attributes driving the risk score' },
                  { icon: '✅', label: 'Recommended Actions', desc: 'Next steps based on risk tier' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: 18, marginBottom: 6 }}>{s.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B', marginBottom: 3 }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: '#64748B', lineHeight: 1.5 }}>{s.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="card" style={{ textAlign: 'center', padding: '70px 40px' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid #E2E8F0', borderTopColor: '#3B82F6', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1E293B', marginBottom: 4 }}>Analyzing booking…</div>
              <div style={{ fontSize: 12, color: '#94A3B8' }}>Running risk model on booking features</div>
            </div>
          )}

          {result && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Gauge + MTTI side by side */}
              <div className="card" style={{ padding: '20px 24px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
                  <SemicircleGauge score={result.score} tier={result.tier} />
                  <div style={{ textAlign: 'center', paddingLeft: 16, borderLeft: '1px solid #F1F5F9', minWidth: 130 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94A3B8', marginBottom: 6 }}>Est. Time to Implement</div>
                    <div style={{ fontSize: 38, fontWeight: 800, color: tierColor, lineHeight: 1 }}>{result.mtti}</div>
                    <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>days</div>
                    {inputs.selectedSolutions.length > 0 && (
                      <div style={{ marginTop: 10, fontSize: 11, color: '#94A3B8', background: '#F8FAFC', borderRadius: 6, padding: '4px 8px', lineHeight: 1.4 }}>
                        {inputs.selectedSolutions.length === 1 ? inputs.selectedSolutions[0] : `${inputs.selectedSolutions.length} solutions`}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Risk factors */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <div style={{ width: 4, height: 16, borderRadius: 2, background: tierColor }} />
                  <div className="card-title" style={{ margin: 0 }}>Top Risk Factors</div>
                </div>
                {result.factors.map(f => <FactorBar key={f.name} factor={f} maxPts={maxPts} />)}
              </div>

              {/* Recommendation */}
              <div className="card" style={{ borderTop: `3px solid ${tierColor}`, borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: result.tier === 'High' ? '#FEF2F2' : result.tier === 'Medium' ? '#FFFBEB' : '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                    {result.tier === 'High' ? '🚨' : result.tier === 'Medium' ? '⚠️' : '✅'}
                  </div>
                  <div className="card-title" style={{ margin: 0 }}>Recommended Action</div>
                  {result.aiRecommendation && (
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600, color: '#166534' }}>
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#22C55E" strokeWidth="1.5"/><path d="M4 6l1.5 1.5L8 4" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      AI Generated
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, marginBottom: 14 }}>{result.recommendation}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {result.tier === 'High' && (
                    <>
                      <span style={{ background: '#FEF2F2', color: '#B91C1C', padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Assign Senior EM</span>
                      <span style={{ background: '#FEF2F2', color: '#B91C1C', padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Flag Finance</span>
                      <span style={{ background: '#FEF2F2', color: '#B91C1C', padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Weekly CSM</span>
                    </>
                  )}
                  {result.tier === 'Medium' && (
                    <>
                      <span style={{ background: '#FFFBEB', color: '#92400E', padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Assign CSM</span>
                      <span style={{ background: '#FFFBEB', color: '#92400E', padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>30-day check-in</span>
                    </>
                  )}
                  {result.tier === 'Low' && (
                    <span style={{ background: '#F0FDF4', color: '#166534', padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Standard process</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
