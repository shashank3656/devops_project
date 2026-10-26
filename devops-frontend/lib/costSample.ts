import type { CostGraphBar, CostLine, CostRecommendation } from './cost';

function day(date: string, amount: number): CostGraphBar {
  return {
    date,
    label: date.slice(-2).replace(/^0/, '') || date.slice(-2),
    display: `$${amount.toLocaleString()}`,
    percent: Math.round((amount / 800) * 100),
  };
}

const CURRENT_AMOUNTS = [380, 410, 395, 440, 455, 420, 390, 470, 485, 460, 490, 510, 495, 470, 530, 545, 520, 560, 575, 550, 590, 610, 580, 540, 620, 640, 615, 600, 630, 650];
const PRIOR_AMOUNTS = CURRENT_AMOUNTS.map((amount) => Math.round(amount * 0.9));

export const COST_SAMPLE_DAYS: CostGraphBar[] = CURRENT_AMOUNTS.map((amount, index) => (
  day(`2026-10-${String(index + 1).padStart(2, '0')}`, amount)
));
export const COST_SAMPLE_PRIOR_DAYS: CostGraphBar[] = PRIOR_AMOUNTS.map((amount, index) => (
  day(`2026-09-${String(index + 1).padStart(2, '0')}`, amount)
));

export const COST_SAMPLE = {
  spend: '$12,480',
  forecastLow: '$16,400',
  forecastHigh: '$18,200',
  forecast: '$16,400 – $18,200',
  budgetRemaining: '$3,120',
  budgetPercent: 78,
  savings: '$640',
  opportunityCount: 3,
  billedThrough: '25 Oct 2026',
  comparison: '+8.4% vs last month',
  drivers: [
    { label: 'Compute', display: '$7,200' },
    { label: 'Database', display: '$3,100' },
    { label: 'Storage', display: '$1,480' },
    { label: 'Other', display: '$700' },
  ],
  opportunities: [
    { calc_id: 'sample-1', finding_type: 'Review idle compute', savings_high: { coverage: 'complete' as const, currency: 'USD', basis: 'actual', display: '$320' } },
    { calc_id: 'sample-2', finding_type: 'Rightsize database', savings_high: { coverage: 'complete' as const, currency: 'USD', basis: 'actual', display: '$210' } },
    { calc_id: 'sample-3', finding_type: 'Release unused storage', savings_high: { coverage: 'complete' as const, currency: 'USD', basis: 'actual', display: '$110' } },
  ],
  attention: [
    { title: 'Platform budget is near the warn threshold', detail: '78% of the monthly budget used', tone: 'alert' as const },
    { title: 'Compute increased versus last month', detail: '+$840 on the like-for-like window', tone: 'alert' as const },
  ],
};

export const COST_SAMPLE_LINES: CostLine[] = [
  { service: 'Compute', region: 'us-east-1', account_id: 'Sample account', resource_id: 'sample-compute', team_slug: 'platform', project_code: 'SAMPLE', usage_date: '2026-10-01', actual_amount: '7200', amortized_amount: '7200', currency: 'USD', amount: '7200' },
  { service: 'Database', region: 'us-east-1', account_id: 'Sample account', resource_id: 'sample-db', team_slug: 'payments', project_code: 'SAMPLE', usage_date: '2026-10-01', actual_amount: '3100', amortized_amount: '3100', currency: 'USD', amount: '3100' },
  { service: 'Storage', region: 'us-east-1', account_id: 'Sample account', resource_id: 'sample-disk', team_slug: 'unallocated', project_code: 'SAMPLE', usage_date: '2026-10-01', actual_amount: '1480', amortized_amount: '1480', currency: 'USD', amount: '1480' },
  { service: 'Other', region: 'us-west-2', account_id: 'Sample account', resource_id: 'sample-other', team_slug: 'platform', project_code: 'SAMPLE', usage_date: '2026-10-01', actual_amount: '700', amortized_amount: '700', currency: 'USD', amount: '700' },
];

export const COST_SAMPLE_RECS: CostRecommendation[] = [
  {
    calc_id: 'sample-1',
    group_id: 'sample-g1',
    resource_id: 'sample-compute',
    service: 'Compute',
    finding_type: 'Review idle compute',
    status: 'detected',
    impact: 'medium',
    risk: 'low',
    effort: 'low',
    confidence: 'medium',
    savings_low: { coverage: 'complete', currency: 'USD', basis: 'actual', display: '$240' },
    savings_high: { coverage: 'complete', currency: 'USD', basis: 'actual', display: '$320' },
    metrics_ready: true,
    has_utilization: true,
    evidence: 'Utilization stayed below 20% for 14 days in the sample window.',
    calculation: 'Sample only. Not a billed CALC-COST result.',
    proposed_action: 'Review the instance size. Approval does not execute the change.',
    verification: 'Not measured',
    executes: false,
    pauses_workloads: false,
    lifecycle: 'new',
  },
];
