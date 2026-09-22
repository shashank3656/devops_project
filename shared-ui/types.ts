export type RiskLevel = 'low' | 'medium' | 'high';

export interface QueueItem {
  id: string;
  title: string;
  meta: string;
  href: string;
  tone?: RiskLevel | 'ok' | 'info' | 'danger';
}

export interface PipelineStage {
  env: string;
  status: string;
  summary: string;
  href?: string;
  active?: boolean;
  blocked?: boolean;
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

export interface WorkspacePayload {
  title: string;
  subtitle: string;
  needs_you: QueueItem[];
  pipeline: {
    project_name?: string;
    stages: PipelineStage[];
  };
}
