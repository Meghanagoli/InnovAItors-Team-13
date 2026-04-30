import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api/client';

const navItems = [
  { path: '/', label: 'Dashboard', exact: true, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/>
      <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/>
      <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/>
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/>
    </svg>
  )},
  { path: '/score', label: 'Score a Booking', exact: false, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 8.5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )},
  { path: '/cohort', label: 'Cohort Analysis', exact: false, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="9" width="3" height="6" rx="1" fill="currentColor"/>
      <rect x="6" y="5" width="3" height="10" rx="1" fill="currentColor"/>
      <rect x="11" y="1" width="3" height="14" rx="1" fill="currentColor"/>
    </svg>
  )},
  { path: '/allocation', label: 'Resource Allocation', exact: false, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="11" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M1 14c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M11 10c1.1 0 2 .9 2 2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
  { path: '/finance', label: 'Finance Forecast', exact: false, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 12l3.5-4 3 3 3-5 2.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )},
];

function fmtFetchedAt(d: Date): string {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function Sidebar() {
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  useEffect(() => {
    api.meta().then(() => setFetchedAt(new Date())).catch(() => {});
  }, []);

  return (
    <aside style={{
      width: 250,
      background: '#0F1B2E',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      height: '100vh',
      borderRight: '1px solid #1A2D45',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #1A2D45' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Orange dots mark — RealPage logo: 1 top-center, 2 bottom */}
          <svg width="30" height="26" viewBox="0 0 30 26" fill="none">
            <circle cx="15" cy="6"  r="5.5" fill="#F47920"/>
            <circle cx="7"  cy="20" r="5.5" fill="#F47920"/>
            <circle cx="23" cy="20" r="5.5" fill="#F47920"/>
          </svg>
          <div>
            <div style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 15, lineHeight: 1.2, letterSpacing: '-0.01em' }}>RealInsight</div>
            <div style={{ color: '#FFFFFF', fontSize: 9.5, letterSpacing: '0.01em', fontWeight: 400, opacity: 0.55, marginTop: 2, fontStyle: 'italic' }}>Turning Uncertainty into Insight.</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 0', overflowY: 'auto' }}>
        <div style={{
          fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: '#FFFFFF', opacity: 0.4,
          padding: '10px 20px 6px',
        }}>
          Menu
        </div>
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.exact}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 20px',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: '#FFFFFF',
              background: isActive ? 'rgba(244,121,32,0.08)' : 'transparent',
              borderLeft: isActive ? '3px solid #F47920' : '3px solid transparent',
              transition: 'all 0.12s',
              marginBottom: 1,
              lineHeight: 1.4,
            })}
            onMouseEnter={e => {
              const el = e.currentTarget;
              if (!el.style.borderLeft.includes('#F47920')) {
                el.style.background = 'rgba(255,255,255,0.04)';
                el.style.color = '#AECDE8';
              }
            }}
            onMouseLeave={e => {
              const el = e.currentTarget;
              if (!el.style.borderLeft.includes('#F47920')) {
                el.style.background = 'transparent';
                el.style.color = '#FFFFFF';
              }
            }}
          >
            <span style={{ flexShrink: 0, opacity: 0.85 }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '14px 20px 18px', borderTop: '1px solid #1A2D45' }}>
        <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FFFFFF', opacity: 0.45, marginBottom: 4 }}>
          Data last fetched
        </div>
        <div style={{ fontSize: 12, color: '#FFFFFF', fontWeight: 500 }}>
          {fetchedAt ? fmtFetchedAt(fetchedAt) : '—'}
        </div>
        <div style={{ fontSize: 10, color: '#FFFFFF', opacity: 0.45, marginTop: 3 }}>Refreshes every 30 min</div>
      </div>
    </aside>
  );
}
