// Typed API client — all requests go through Vite proxy /api → localhost:8000

export interface MonthlyRow {
  month: string;
  label: string;
  total: number;
  low: number;
  medium: number;
  high: number;
  avgMtti: number;
  avgScore: number;
  isSpike?: boolean;
}

export interface ProductRow {
  name: string;
  avgMtti: number;
  avgScore: number;
  bookings: number;
}

export interface TerritoryRow {
  name: string;
  bookings: number;
  avgMtti: number;
  avgScore: number;
}

export interface PMCEntry {
  id: number;
  name: string;
  territory: string;
  sites: number;
  units: number;
  score: number;
  tier: 'High' | 'Medium' | 'Low';
  topProduct: string;
  orders: number;
  mtti: number;
  salesType: string;
  factors: { name: string; points: number }[];
  activeOrders: { id: string; product: string; score: number; mtti: number }[];
}

export interface FinanceRow {
  month: string;
  label: string;
  total: number;
  high: number;
  avgMtti: number;
  estValue: number;
  highRiskValue: number;
  leakageRisk: number;
}

export interface FinanceResponse {
  rows: FinanceRow[];
  totals: {
    bookings: number;
    estValue: number;
    highValue: number;
    leakage: number;
    avgMtti: number;
  };
}

export interface MetaResponse {
  years: string[];
  totalBookings: number;
  lastMonth: string;
}

export interface ReasonRow { reason: string; count: number; }
export interface ReasonsResponse { backlog: ReasonRow[]; cancellation: ReasonRow[]; }

export interface OptionsResponse {
  sales_type: string[];
  implementation_type: string[];
  business_type: string[];
  sol_pm_primary: string[];
  product_family: string[];
}

const _cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

export function getCached<T>(path: string): T | undefined {
  const hit = _cache.get(path);
  return hit && Date.now() - hit.ts < CACHE_TTL ? hit.data as T : undefined;
}

async function get<T>(path: string): Promise<T> {
  const hit = _cache.get(path);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data as T;
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  const data = await res.json() as T;
  _cache.set(path, { data, ts: Date.now() });
  return data;
}

export const api = {
  cohort: (year = '2025', salesType = '', territory = '', product = '', implType = '') =>
    get<MonthlyRow[]>(`/cohort?year=${year}&sales_type=${encodeURIComponent(salesType)}&territory=${encodeURIComponent(territory)}&product=${encodeURIComponent(product)}&impl_type=${encodeURIComponent(implType)}`),
  allocation:  (limit = 50)           => get<PMCEntry[]>(`/allocation?limit=${limit}`),
  finance:     (quarter = 'Full Year', year = '2025') => get<FinanceResponse>(`/finance?quarter=${encodeURIComponent(quarter)}&year=${year}`),
  products:    ()                     => get<ProductRow[]>('/products'),
  territories: ()                     => get<TerritoryRow[]>('/territories'),
  options:     ()                     => get<OptionsResponse>('/options'),
  meta:        ()                     => get<MetaResponse>('/meta'),
  reasons:     (year = '2025')         => get<ReasonsResponse>(`/reasons?year=${year}`),
};
