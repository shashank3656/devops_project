export type RiskLevel = 'low' | 'medium' | 'high';

export interface RequestOperation {
  operation: 'resize' | 'decommission';
  source_request_id: number;
  reason?: string;
  created_at: string;
}

export interface RequestLifetime {
  expires_at?: string;
  days_left: number;
  extended_count: number;
  can_set_lifetime: boolean;
  decommission_request_id?: number;
  operation?: RequestOperation;
}

export interface PolicyFinding {
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown';
  resource?: string;
  message: string;
  file?: string;
}

export interface PolicyToolResult {
  tool: string;
  passed: number;
  failed: number;
  blocking: number;
  findings: PolicyFinding[];
  truncated: boolean;
  updated_at?: string;
}

export interface PolicyCheckSummary {
  state: 'none' | 'pass' | 'warn' | 'fail';
  passed: number;
  failed: number;
  blocking: number;
  tools: PolicyToolResult[];
}

export type DoraBand = 'elite' | 'high' | 'medium' | 'low' | 'none';

export interface DoraMetric {
  key: 'deploy_frequency' | 'lead_time' | 'change_failure_rate' | 'time_to_restore';
  label: string;
  value: number;
  previous: number;
  unit: 'per_week' | 'hours' | 'percent';
  band: DoraBand;
  samples: number;
  lower_is_better: boolean;
}

export interface ScorecardCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
  href?: string;
}

export interface RequestCostCheck {
  has_infracost: boolean;
  currency: string;
  monthly_cost: number;
  past_monthly_cost: number;
  diff_monthly_cost: number;
  estimate: number;
  estimate_low: number;
  estimate_high: number;
  estimate_basis: string;
  variance: 'within' | 'above' | 'below' | 'unknown';
  updated_at?: string;
}

export interface IdleCandidate {
  request_id: number;
  environment: string;
  service: string;
  monthly_cost: number;
  days_idle: number;
}

export interface ProjectCostSummary {
  currency: string;
  budget_monthly: number;
  committed_monthly: number;
  pending_monthly: number;
  projected_monthly: number;
  percent_used: number;
  projected_percent: number;
  alert_level: 'none' | 'warn' | 'over';
  tracked_requests: number;
  idle_candidates: IdleCandidate[];
}

export interface ProjectInfraSettings {
  monthly_budget_usd: number;
  default_temp_env_days: number;
}

export interface ProjectHealth {
  window_days: number;
  metrics: DoraMetric[];
  scorecard: ScorecardCheck[];
  score: number;
  cost?: ProjectCostSummary;
  settings?: ProjectInfraSettings;
}

export interface PlanChange {
  address: string;
  action: 'create' | 'update' | 'destroy' | 'replace' | 'read';
}

export interface PlanReview {
  has_plan: boolean;
  no_changes: boolean;
  import: number;
  add: number;
  change: number;
  destroy: number;
  replace: number;
  destroy_only: number;
  changes: PlanChange[];
  truncated: boolean;
  plan_hash?: string;
  requires_ack: boolean;
  acknowledged: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
  ack_note?: string;
}

export type Tone = RiskLevel | 'ok' | 'info' | 'danger';

export type QueueKind = 'approval' | 'incident' | 'pr_risk' | 'freeze' | 'rejected' | 'draft' | 'waiting' | 'change' | 'failed' | 'blocked';

export interface QueueItem {
  id: string;
  kind?: QueueKind | string;
  title: string;
  meta: string;
  ref?: string;
  href: string;
  action?: string;
  tone?: Tone;
  at?: string;
}

export interface PipelineStage {
  env: string;
  status: string;
  summary: string;
  href?: string;
  active?: boolean;
  blocked?: boolean;
  updated_at?: string;
}

export interface ActivityItem {
  id: string;
  actor?: string;
  summary: string;
  detail?: string;
  href?: string;
  tone?: Tone;
  at?: string;
}

export interface SearchHit {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  href: string;
}

export interface PaletteCommand {
  id: string;
  label: string;
  href: string;
  hint?: string;
}

export interface PRImpactFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  category: string;
}

export interface PRImpactCommit {
  sha: string;
  message: string;
  author: string;
}

export interface PRImpactFactor {
  key: string;
  label: string;
  severity: RiskLevel;
  weight: number;
  detail: string;
}

export interface DeployIntelChangingGroup {
  key: string;
  label: string;
  count: number;
}

export interface DeployIntelChangeBrief {
  headline: string;
  changing: DeployIntelChangingGroup[];
  environments?: string[];
  multi_env?: boolean;
  risk_because: string[];
}

export interface DeployIntelPlanDelta {
  has_plan: boolean;
  add: number;
  change: number;
  destroy: number;
  replace?: number;
  plan_resource_count: number;
  pr_file_count: number;
  terraform_files?: number;
  has_destroy: boolean;
  mismatch: boolean;
  summary: string;
  flags?: string[];
}

export interface PRImpactBriefData {
  request_id?: number;
  pr_number?: number;
  pr_url?: string;
  title?: string;
  author?: string;
  base_branch?: string;
  head_branch?: string;
  merge_state?: string;
  deploy_status?: string;
  commit_count: number;
  file_count: number;
  additions: number;
  deletions: number;
  environment?: string;
  next_environment?: string;
  blast_radius: string[];
  score: number;
  risk_level: RiskLevel;
  summary: string;
  recommended_action: string;
  factors: PRImpactFactor[];
  commits?: PRImpactCommit[];
  files?: PRImpactFile[];
  acknowledged?: boolean;
  change_brief?: DeployIntelChangeBrief;
  plan_delta?: DeployIntelPlanDelta;
  similar_merges?: DeployIntelSimilarMerge[];
}

export interface DeployIntelRevertRef {
  pr_number: number;
  title: string;
  pr_url?: string;
  merged_at?: string;
}

export interface DeployIntelSimilarMerge {
  pr_number: number;
  title: string;
  headline?: string;
  risk_level?: string;
  score?: number;
  merged_at?: string;
  pr_url?: string;
  overlap?: string[];
  later_revert?: DeployIntelRevertRef;
}

export interface DeployIntelAck {
  id?: number;
  repo_owner?: string;
  repo_name?: string;
  pr_number?: number;
  user_id?: number;
  username?: string;
  reasons?: string[];
  created_at?: string;
}

export interface CostEstimate {
  estimated_monthly: number;
  estimate_low?: number;
  estimate_high?: number;
  estimate_basis?: string;
  estimate_exact?: boolean;
  currency?: string;
  budget_monthly?: number;
  budget_used_pct?: number;
  allowed?: boolean;
  warning?: string;
  risk_level?: RiskLevel;
  impact_notes?: string[];
  approval_path?: string[];
  calculator_url?: string;
}

export interface GoldenPath {
  id: string;
  title: string;
  summary: string;
  cloud?: string;
  service?: string;
  href: string;
  icon?: string;
  review?: string;
  advanced?: boolean;
}

export interface WorkspacePayload {
  title: string;
  subtitle: string;
  viewer?: string;
  needs_you: QueueItem[];
  failed?: QueueItem[];
  pipeline: {
    project_name?: string;
    stages: PipelineStage[];
  };
  activity?: ActivityItem[];
}
