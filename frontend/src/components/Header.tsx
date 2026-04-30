import { useLocation } from 'react-router-dom';

const PAGE_TITLES: Record<string, string> = {
  '/':           'Dashboard',
  '/score':      'Score a Booking',
  '/cohort':     'Cohort Analysis',
  '/allocation': 'Resource Allocation',
  '/finance':    'Finance Forecast',
};

export default function Header() {
  const { pathname } = useLocation();
  const title = PAGE_TITLES[pathname] ?? 'RealInsight';

  return (
    <header style={{
      height: 48,
      background: '#1B2D42',
      borderBottom: '1px solid #243D57',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 28px',
      flexShrink: 0,
    }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#F47920', fontWeight: 700, letterSpacing: '-0.01em' }}>RealInsight</span>
        <span style={{ fontSize: 12, color: '#2A4060' }}>/</span>
        <span style={{ fontSize: 12, color: '#FFFFFF', fontWeight: 600 }}>{title}</span>
      </div>

      {/* Help link — downloads user guide PDF */}
      <a
        href="/RealInsight_UserGuide.pdf"
        download="RealInsight_UserGuide.pdf"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          textDecoration: 'none', color: '#CBD5E1',
          fontSize: 13, fontWeight: 500,
          padding: '4px 10px', borderRadius: 6,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#243D57')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        title="Download User Guide"
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: '50%',
          border: '1.5px solid #CBD5E1',
          fontSize: 11, fontWeight: 700, lineHeight: 1,
          flexShrink: 0,
        }}>?</span>
        Help
      </a>
    </header>
  );
}
