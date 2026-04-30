// Type definitions and helpers shared by ScorerPage and AllocationPage.
// Data is fetched live from the FastAPI backend — no mock data here.

export interface ScoreFactor {
  name: string;
  points: number;
  description: string;
}

export interface ScoreResult {
  score: number;
  tier: 'High' | 'Medium' | 'Low';
  mtti: number;
  factors: ScoreFactor[];
  recommendation: string;
  aiRecommendation?: boolean;
}

export interface ScorerInputs {
  salesType: string;
  implementationType: string;
  productFamily: string;
  businessType: string;
  territory: string;
  omsSites: number;
  omsUnits: number;
  totalOrders: number;
  selectedSolutions: string[];
  numSolutions: number;
}

// ── Recommendation engine ─────────────────────────────────────────────────────

type Urgency = 'immediate' | 'this-week' | 'standard';

interface Recommendation {
  action: string;
  urgency: Urgency;
  owner: string;
}

const FACTOR_ACTIONS: Record<string, { action: string; owner: string }> = {
  'Implementation Type':        { action: 'Verify implementation type matches scope; reassign EM if needed', owner: 'Impl Manager' },
  'Product Family':             { action: 'Assign product-specialist EM and schedule kickoff for this product family', owner: 'Product EM' },
  'Sales Type':                 { action: 'Review sales commitment and validate scope with Sales before kickoff', owner: 'Sales Ops' },
  'Business Type':              { action: 'Tailor onboarding checklist and SLA expectations for this business type', owner: 'CSM' },
  'Territory':                  { action: 'Coordinate regional resource availability and scheduling', owner: 'Regional Lead' },
  'CSM Coverage Model':         { action: 'Confirm CSM assignment and schedule recurring check-ins', owner: 'CSM Manager' },
  'On Hold Days (historical)':  { action: 'Review historical hold patterns; create hold-mitigation plan upfront', owner: 'Impl Manager' },
  'Referred to Sales Days':     { action: 'Expedite sales-to-implementation handoff to reduce ramp time', owner: 'Sales Ops' },
  'Initial Outreach Days':      { action: 'Initiate client contact within 24 h and log first touchpoint', owner: 'Impl Manager' },
  'PMC Total Properties':       { action: 'Scale implementation team to match property count; consider phased rollout', owner: 'Resource Mgr' },
  'PMC Total Units':            { action: 'Allocate additional capacity for large unit count', owner: 'Resource Mgr' },
  'Dependency Delay':           { action: 'Identify all upstream dependencies now and create a resolution timeline', owner: 'Impl Manager' },
  'Total Blocked Days':         { action: 'Escalate current blockers and assign daily status owner until cleared', owner: 'Escalation Team' },
  'Previously Deployed Product':{ action: 'Leverage prior deployment contacts to accelerate data migration', owner: 'Impl Manager' },
  'Special Handling':           { action: 'Assign senior EM experienced with special-handling accounts', owner: 'Sr. EM' },
  'SLA Violation Count':        { action: 'Open priority SLA remediation plan and flag account in CRM', owner: 'CSM + Finance' },
};

const DEFAULT_HIGH   = { action: 'Escalate to senior implementation leadership for immediate triage', owner: 'Sr. EM' };
const DEFAULT_MEDIUM = { action: 'Schedule a risk-review call within the next 5 business days', owner: 'Impl Manager' };
const DEFAULT_LOW    = { action: 'Proceed with standard implementation process and monitor milestones', owner: 'Impl Manager' };

export function getRecommendations(
  factors: { name: string; points: number }[],
  score: number,
  mtti: number,
): Recommendation[] {
  const urgency: Urgency =
    score >= 65 || mtti > 55 ? 'immediate' :
    score >= 35 || mtti > 21 ? 'this-week' :
    'standard';

  const recs: Recommendation[] = factors
    .filter(f => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map(f => {
      const lookup = FACTOR_ACTIONS[f.name];
      return {
        action:  lookup?.action  ?? `Address elevated ${f.name.toLowerCase()} risk`,
        urgency,
        owner:   lookup?.owner   ?? 'Impl Manager',
      };
    });

  if (recs.length === 0) {
    const fallback = score >= 65 ? DEFAULT_HIGH : score >= 35 ? DEFAULT_MEDIUM : DEFAULT_LOW;
    recs.push({ ...fallback, urgency });
  }

  return recs;
}
