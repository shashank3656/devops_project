export const JIRA_RELATIONSHIPS = [
  { value: 'implements', label: 'Implements' },
  { value: 'remediates', label: 'Remediates' },
  { value: 'caused_by', label: 'Caused by' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'related', label: 'Related' },
] as const;

export type JiraRelationship = (typeof JIRA_RELATIONSHIPS)[number]['value'];

export type JiraHealth =
  | 'connected'
  | 'synced'
  | 'syncing'
  | 'queued'
  | 'partial'
  | 'delayed'
  | 'configuration_needed'
  | 'failed'
  | 'reauthorization_required'
  | 'paused'
  | 'unknown'
  | 'not_configured';

export type JiraConnection = {
  id: number;
  name: string;
  provider: string;
  cloud_id?: string;
  site_url?: string;
  site_name?: string;
  owner_user_id?: number;
  owner_username?: string;
  scopes?: string;
  state: string;
  auth_health: JiraHealth | string;
  sync_health: JiraHealth | string;
  enabled: boolean;
  connected_space_count: number;
  last_success_at?: string | null;
  last_error?: string;
  oauth_ready?: boolean;
};

export type JiraSpace = {
  id: number;
  connection_id: number;
  connection_name?: string;
  site_name?: string;
  cloud_id?: string;
  jira_project_id: string;
  jira_project_key: string;
  name: string;
  enabled: boolean;
  sync_health: JiraHealth | string;
  last_success_at?: string | null;
  last_error?: string;
  mapped_portal_projects?: string[];
  permitted_teams?: string[];
  can_view?: boolean;
  can_link?: boolean;
  can_create?: boolean;
  can_administer?: boolean;
  default_issue_type_id?: string;
  default_issue_type_name?: string;
  default_relationship?: string;
  field_defaults_json?: string;
};

export type JiraIssue = {
  cloud_id: string;
  issue_id: string;
  issue_key: string;
  summary: string;
  status: string;
  status_category?: string;
  priority?: string;
  assignee_account_id?: string;
  assignee?: string;
  issue_type?: string;
  restricted?: boolean;
  browse_url?: string;
  site_name?: string;
  space_name?: string;
  space_key?: string;
  last_success_at?: string | null;
  freshness?: string;
  stale?: boolean;
};

export type JiraLink = {
  id: number;
  source_type: string;
  source_id?: number;
  source_key?: string;
  relationship: string;
  issue: JiraIssue;
  can_unlink?: boolean;
};

export type JiraOperation = {
  id: number;
  operation_id: string;
  kind: string;
  source_type?: string;
  source_id?: number;
  source_key?: string;
  issue_key?: string;
  state: string;
  attempts: number;
  last_error?: string;
  retryable?: boolean;
  created_at: string;
  updated_at: string;
};

export type JiraSource = {
  sourceType: string;
  sourceId?: number;
  sourceKey?: string;
  defaultSummary?: string;
  defaultDescription?: string;
  suggestTitle?: string;
  suggestBranch?: string;
  suggestBody?: string;
};

export type JiraSuggestion = {
  key: string;
  reason: string;
  validated: boolean;
  space_id: number;
  relationship: string;
  issue: JiraIssue;
  note?: string;
};

export type JiraSyncPolicy = {
  configured?: boolean;
  create_issues: boolean;
  link_issues: boolean;
  read_status: boolean;
  read_assignee: boolean;
  read_priority: boolean;
  publish_comments: boolean;
  apply_transitions: boolean;
  send_attachments: boolean;
};

export type JiraFieldOwnership = {
  field: string;
  owner: string;
  direction: string;
};

export type JiraRemediationRule = {
  id: number;
  space_id: number;
  space_name?: string;
  space_key?: string;
  site_name?: string;
  source_type: string;
  match_text?: string;
  issue_type_id: string;
  issue_type_name: string;
  relationship: string;
  enabled: boolean;
  auto_create: boolean;
  daily_limit: number;
};

export function jiraHealthTone(health?: string): 'ok' | 'info' | 'warn' | 'danger' | 'muted' {
  switch ((health || '').toLowerCase()) {
    case 'connected':
    case 'synced':
    case 'succeeded':
      return 'ok';
    case 'syncing':
    case 'queued':
    case 'running':
      return 'info';
    case 'partial':
    case 'delayed':
    case 'configuration_needed':
    case 'stale':
      return 'warn';
    case 'failed':
    case 'reauthorization_required':
      return 'danger';
    default:
      return 'muted';
  }
}

export function jiraHealthLabel(health?: string): string {
  switch ((health || '').toLowerCase()) {
    case 'connected': return 'Connected';
    case 'synced': return 'Synced';
    case 'syncing': return 'Syncing';
    case 'queued': return 'Queued';
    case 'running': return 'Running';
    case 'partial': return 'Partial access';
    case 'delayed': return 'Delayed';
    case 'configuration_needed': return 'Configuration needed';
    case 'failed': return 'Failed';
    case 'reauthorization_required': return 'Reauthorization required';
    case 'paused': return 'Paused';
    case 'not_configured': return 'Not configured';
    case 'succeeded': return 'Succeeded';
    case 'retrying': return 'Retrying';
    case 'reconcile': return 'Reconciling';
    default: return 'Unknown';
  }
}

export function jiraRelationshipLabel(value?: string): string {
  return JIRA_RELATIONSHIPS.find((item) => item.value === value)?.label || 'Related';
}

export function jiraIssueIdentity(cloudId?: string, issueId?: string): string {
  return `${(cloudId || '').trim()}:${(issueId || '').trim()}`;
}
