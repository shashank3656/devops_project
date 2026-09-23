export type RiskLevel = 'low' | 'medium' | 'high';

export type Tone = RiskLevel | 'ok' | 'info' | 'danger';

export type QueueKind = 'approval' | 'incident' | 'pr_risk' | 'freeze' | 'rejected' | 'draft' | 'waiting';

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
  pipeline: {
    project_name?: string;
    stages: PipelineStage[];
  };
  activity?: ActivityItem[];
}
