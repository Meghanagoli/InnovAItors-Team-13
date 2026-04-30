import { HashRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import DashboardPage from './pages/DashboardPage';
import ScorerPage from './pages/ScorerPage';
import CohortPage from './pages/CohortPage';
import AllocationPage from './pages/AllocationPage';
import FinancePage from './pages/FinancePage';

export default function App() {
  return (
    <HashRouter>
      <div className="app-layout">
        <Sidebar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <Header />
          <div className="main-content">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/score" element={<ScorerPage />} />
              <Route path="/cohort" element={<CohortPage />} />
              <Route path="/allocation" element={<AllocationPage />} />
              <Route path="/finance" element={<FinancePage />} />
            </Routes>
          </div>
        </div>
      </div>
    </HashRouter>
  );
}
