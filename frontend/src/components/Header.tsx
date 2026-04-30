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

    </header>
  );
}
