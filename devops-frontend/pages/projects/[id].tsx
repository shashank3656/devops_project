import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { ProjectHealthCard, type ProjectHealth } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import DriftFixPanel from '../../components/DriftFixPanel';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProjectServiceOption {
  cloud: string;
  service: string;
}

interface ProjectApprovalRule {
  environment: string;
  require_manager_approval: boolean;
  require_devops_approval: boolean;
}

interface ProjectReadinessCheck {
  key: string;
  label: string;
  complete: boolean;
  detail: string;
}

interface ProjectLifecycleAction {
  action: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface CostRiskSignal {
  severity: 'low' | 'medium' | 'high';
  category: string;
  title: string;
  detail: string;
}

interface ProjectCostRiskSummary {
  overall_risk: 'low' | 'medium' | 'high';
  estimated_band: string;
  estimated_monthly: string;
  estimate_basis: string;
  summary: string;
  request_count: number;
  pending_review_count: number;
  high_risk_count: number;
  medium_risk_count: number;
  signals: CostRiskSignal[];
}

interface ProjectTeamAccess {
  team_id: number;
  team_name?: string;
  team_slug?: string;
  environments: string[];
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  description: string;
  status: string;
  onboarding_stage?: string;
  ready_for_requests?: boolean;
  service_count?: number;
  team_count?: number;
  owner_team?: string;
  next_action?: string;
  readiness_checks?: ProjectReadinessCheck[];
  lifecycle_actions?: ProjectLifecycleAction[];
  cost_risk_summary?: ProjectCostRiskSummary | null;
  environments: string[];
  clouds: string[];
  services: ProjectServiceOption[];
  team_access: ProjectTeamAccess[];
  approval_rules: ProjectApprovalRule[];
}

interface ProjectReleaseSummary {
  total_requests: number;
  completed_requests: number;
  pending_requests: number;
  in_progress_requests: number;
  promotion_ready_count: number;
  open_incident_count: number;
  runbook_count: number;
  active_override_count: number;
  last_release_at?: string;
}

interface ProjectReleaseEnvironmentStatus {
  environment: string;
  latest_request_id?: number;
  latest_status?: string;
  latest_service?: string;
  latest_cloud?: string;
  latest_updated_at?: string;
  pending_count: number;
  completed_count: number;
  incident_count: number;
  health: string;
}

interface ProjectReleaseActivityItem {
  request_id: number;
  team: string;
  environment: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  client_name: string;
  updated_at: string;
  due_date?: string;
  pr_url?: string;
}

interface ProjectReleaseTrendPoint {
  label: string;
  count: number;
}

interface ProjectK8sHealthSummary {
  healthy_deployments: number;
  degraded_deployments: number;
  blocked_deployments: number;
  scaled_down_deployments: number;
  restarting_pods: number;
  non_running_pods: number;
  warning_logs: number;
  unhealthy_namespaces: number;
}

interface ProjectK8sNamespaceWatchItem {
  namespace: string;
  cluster_name: string;
  status: string;
  issue_count: number;
  restarting_pods: number;
  warning_logs: number;
  affected_deployments: number;
}

interface ProjectK8sWorkloadSpotlight {
  name: string;
  namespace: string;
  cluster_name: string;
  status: string;
  ready_replicas: number;
  replicas: number;
  restart_count: number;
  warning_count: number;
}

interface ProjectK8sPreview {
  connection_count: number;
  cluster_count: number;
  namespace_count: number;
  health_summary: ProjectK8sHealthSummary;
  namespace_watchlist: ProjectK8sNamespaceWatchItem[];
  workload_spotlights: ProjectK8sWorkloadSpotlight[];
}

interface ProjectExpirySummary {
  total_items: number;
  credential_items: number;
  secret_items: number;
  certificate_items: number;
  expired_count: number;
  expiring_within_30_days: number;
  expiring_within_60_days: number;
  healthy_count: number;
  actionable_count: number;
  acknowledged_count: number;
  in_progress_count: number;
  rotated_count: number;
}

interface ProjectExpiryItem {
  item_key: string;
  category: string;
  source: string;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  cloud?: string;
  environment?: string;
  cluster_name?: string;
  namespace?: string;
  resource_name: string;
  resource_type: string;
  owner?: string;
  created_at?: string;
  expires_at?: string;
  days_remaining: number;
  status: string;
  recommendation: string;
  workflow_state: string;
  workflow_note?: string;
  workflow_updated_at?: string;
  workflow_updated_by_username?: string;
}

interface ProjectExpiryPreview {
  summary: ProjectExpirySummary;
  priority_items: ProjectExpiryItem[];
}

interface PromotionQueueItem {
  request_id: number;
  environment: string;
  next_environment: string;
  cloud: string;
  service: string;
  status: string;
  client_name: string;
  updated_at: string;
}

interface ReleaseIncidentItem {
  id: number;
  request_id: number;
  severity: string;
  status: string;
  summary: string;
  owner_username?: string;
  updated_at: string;
  request_env?: string;
  request_service?: string;
}

interface ReleaseRunbookItem {
  id: number;
  service: string;
  title: string;
  link_url: string;
  updated_at: string;
}

interface ActiveOverrideItem {
  id: number;
  username: string;
  environments: string[];
  permission: string;
  reason: string;
  expires_at: string;
}

interface ProjectReleaseDashboard {
  summary: ProjectReleaseSummary;
  environment_statuses: ProjectReleaseEnvironmentStatus[];
  recent_activity: ProjectReleaseActivityItem[];
  release_trend: ProjectReleaseTrendPoint[];
  promotion_queue: PromotionQueueItem[];
  incidents: ReleaseIncidentItem[];
  runbooks: ReleaseRunbookItem[];
  active_overrides: ActiveOverrideItem[];
  deployment_gates?: DeploymentGatePolicy | null;
  k8s_preview?: ProjectK8sPreview | null;
  expiry_preview?: ProjectExpiryPreview | null;
}

interface DeploymentGateSummary {
  ready_environments: number;
  attention_environments: number;
  blocked_environments: number;
}

interface DeploymentGateCheck {
  key: string;
  label: string;
  status: string;
  detail: string;
}

interface DeploymentGateEnvironment {
  environment: string;
  status: string;
  summary: string;
  requires_manager_approval: boolean;
  requires_devops_approval: boolean;
  promotion_candidate_count: number;
  incident_count: number;
  active_override_count: number;
  checks: DeploymentGateCheck[];
}

interface DeploymentGatePolicy {
  summary: DeploymentGateSummary;
  environments: DeploymentGateEnvironment[];
}

function stageTone(stage?: string): { background: string; color: string } {
  switch (stage) {
    case 'ready':
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
    case 'configured':
    case 'team_mapped':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    case 'inactive':
    case 'archived':
      return { background: 'rgba(148, 163, 184, 0.14)', color: 'var(--color-text-muted)' };
    default:
      return { background: 'rgba(34, 211, 238, 0.14)', color: 'var(--color-primary)' };
  }
}

function getPreviewRiskClass(level?: string): string {
  switch (level) {
    case 'high':
      return 'portal-preview-risk portal-preview-risk--high';
    case 'medium':
      return 'portal-preview-risk portal-preview-risk--medium';
    default:
      return 'portal-preview-risk portal-preview-risk--low';
  }
}

function getPreviewSignalClass(severity?: string): string {
  switch (severity) {
    case 'high':
      return 'portal-preview-signal portal-preview-signal--high';
    case 'medium':
      return 'portal-preview-signal portal-preview-signal--medium';
    default:
      return 'portal-preview-signal portal-preview-signal--low';
  }
}

function parsePositiveIntParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function releaseHealthTone(health?: string): { background: string; color: string } {
  switch ((health || '').toLowerCase()) {
    case 'healthy':
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
    case 'blocked':
      return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
    case 'degraded':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    default:
      return { background: 'rgba(34, 211, 238, 0.14)', color: 'var(--color-primary)' };
    }
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function buildPortalHref(path: string, query: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    params.set(key, normalized);
  }
  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}

function deploymentGateTone(status?: string): { background: string; color: string } {
  switch ((status || '').toLowerCase()) {
    case 'blocked':
      return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
    case 'attention':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    default:
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
  }
}

function expiryStatusTone(status?: string): { background: string; color: string } {
  switch (status) {
    case 'expired':
      return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
    case 'expiring_30d':
      return { background: 'rgba(250, 204, 21, 0.18)', color: '#facc15' };
    case 'expiring_60d':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    default:
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
  }
}

function expiryWorkflowTone(state?: string): { background: string; color: string } {
  switch (state) {
    case 'acknowledged':
      return { background: 'rgba(59, 130, 246, 0.18)', color: '#93c5fd' };
    case 'in_progress':
      return { background: 'rgba(250, 204, 21, 0.18)', color: '#fde68a' };
    case 'rotated':
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
    default:
      return { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' };
  }
}

function expiryWorkflowLabel(state?: string): string {
  switch (state) {
    case 'acknowledged':
      return 'Acknowledged';
    case 'in_progress':
      return 'In progress';
    case 'rotated':
      return 'Rotated';
    default:
      return 'Open';
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function normalizeProjectServices(value: unknown): ProjectServiceOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .map((item) => ({
      cloud: getString(item.cloud),
      service: getString(item.service),
    }))
    .filter((item) => item.cloud && item.service);
}

function normalizeProjectTeamAccess(value: unknown): ProjectTeamAccess[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      team_id: Number(row.team_id) || 0,
      team_name: getString(row.team_name) || undefined,
      team_slug: getString(row.team_slug) || undefined,
      environments: normalizeStringArray(row.environments),
    };
  });
}

function normalizeProjectApprovalRules(value: unknown): ProjectApprovalRule[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      environment: getString(row.environment),
      require_manager_approval: Boolean(row.require_manager_approval),
      require_devops_approval: Boolean(row.require_devops_approval),
    };
  }).filter((item) => item.environment);
}

function normalizeReadinessChecks(value: unknown): ProjectReadinessCheck[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      key: getString(row.key),
      label: getString(row.label),
      complete: Boolean(row.complete),
      detail: getString(row.detail),
    };
  }).filter((item) => item.key || item.label || item.detail);
}

function normalizeLifecycleActions(value: unknown): ProjectLifecycleAction[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      action: getString(row.action),
      label: getString(row.label),
      description: getString(row.description),
      enabled: Boolean(row.enabled),
    };
  }).filter((item) => item.action && item.label);
}

function normalizeCostRiskSummary(value: unknown): ProjectCostRiskSummary | null {
  const row = asRecord(value);
  if (!Object.keys(row).length) return null;
  const signals = Array.isArray(row.signals)
    ? row.signals.map((item) => {
        const signal = asRecord(item);
        return {
          severity: (getString(signal.severity) as 'low' | 'medium' | 'high') || 'low',
          category: getString(signal.category),
          title: getString(signal.title),
          detail: getString(signal.detail),
        };
      }).filter((item) => item.title || item.detail)
    : [];
  return {
    overall_risk: (getString(row.overall_risk) as 'low' | 'medium' | 'high') || 'low',
    estimated_band: getString(row.estimated_band),
    estimated_monthly: getString(row.estimated_monthly),
    estimate_basis: getString(row.estimate_basis),
    summary: getString(row.summary),
    request_count: Number(row.request_count) || 0,
    pending_review_count: Number(row.pending_review_count) || 0,
    high_risk_count: Number(row.high_risk_count) || 0,
    medium_risk_count: Number(row.medium_risk_count) || 0,
    signals,
  };
}

function normalizeProject(rawValue: unknown): ProjectOption | null {
  const raw = asRecord(rawValue);
  if (!Object.keys(raw).length) return null;
  return {
    id: Number(raw.id) || 0,
    name: getString(raw.name),
    code: getString(raw.code),
    description: getString(raw.description),
    status: getString(raw.status),
    onboarding_stage: getString(raw.onboarding_stage) || undefined,
    ready_for_requests: raw.ready_for_requests == null ? undefined : Boolean(raw.ready_for_requests),
    service_count: raw.service_count == null ? undefined : Number(raw.service_count) || 0,
    team_count: raw.team_count == null ? undefined : Number(raw.team_count) || 0,
    owner_team: getString(raw.owner_team) || undefined,
    next_action: getString(raw.next_action) || undefined,
    readiness_checks: normalizeReadinessChecks(raw.readiness_checks),
    lifecycle_actions: normalizeLifecycleActions(raw.lifecycle_actions),
    cost_risk_summary: normalizeCostRiskSummary(raw.cost_risk_summary),
    environments: normalizeStringArray(raw.environments),
    clouds: normalizeStringArray(raw.clouds),
    services: normalizeProjectServices(raw.services),
    team_access: normalizeProjectTeamAccess(raw.team_access),
    approval_rules: normalizeProjectApprovalRules(raw.approval_rules),
  };
}

function normalizeReleaseDashboard(rawValue: unknown): ProjectReleaseDashboard | null {
  const raw = asRecord(rawValue);
  if (!Object.keys(raw).length) return null;
  const summaryRaw = asRecord(raw.summary);
  const k8sRaw = asRecord(raw.k8s_preview);
  const expiryRaw = asRecord(raw.expiry_preview);
  const gatesRaw = asRecord(raw.deployment_gates);

  return {
    summary: {
      total_requests: Number(summaryRaw.total_requests) || 0,
      completed_requests: Number(summaryRaw.completed_requests) || 0,
      pending_requests: Number(summaryRaw.pending_requests) || 0,
      in_progress_requests: Number(summaryRaw.in_progress_requests) || 0,
      promotion_ready_count: Number(summaryRaw.promotion_ready_count) || 0,
      open_incident_count: Number(summaryRaw.open_incident_count) || 0,
      runbook_count: Number(summaryRaw.runbook_count) || 0,
      active_override_count: Number(summaryRaw.active_override_count) || 0,
      last_release_at: getString(summaryRaw.last_release_at) || undefined,
    },
    environment_statuses: Array.isArray(raw.environment_statuses)
      ? raw.environment_statuses.map((item) => {
          const row = asRecord(item);
          return {
            environment: getString(row.environment),
            latest_request_id: row.latest_request_id == null ? undefined : Number(row.latest_request_id) || undefined,
            latest_status: getString(row.latest_status) || undefined,
            latest_service: getString(row.latest_service) || undefined,
            latest_cloud: getString(row.latest_cloud) || undefined,
            latest_updated_at: getString(row.latest_updated_at) || undefined,
            pending_count: Number(row.pending_count) || 0,
            completed_count: Number(row.completed_count) || 0,
            incident_count: Number(row.incident_count) || 0,
            health: getString(row.health),
          };
        }).filter((item) => item.environment)
      : [],
    recent_activity: Array.isArray(raw.recent_activity)
      ? raw.recent_activity.map((item) => {
          const row = asRecord(item);
          return {
            request_id: Number(row.request_id) || 0,
            team: getString(row.team),
            environment: getString(row.environment),
            cloud: getString(row.cloud),
            service: getString(row.service),
            status: getString(row.status),
            priority: getString(row.priority),
            client_name: getString(row.client_name),
            updated_at: getString(row.updated_at),
            due_date: getString(row.due_date) || undefined,
            pr_url: getString(row.pr_url) || undefined,
          };
        }).filter((item) => item.request_id > 0)
      : [],
    release_trend: Array.isArray(raw.release_trend)
      ? raw.release_trend.map((item) => {
          const row = asRecord(item);
          return {
            label: getString(row.label),
            count: Number(row.count) || 0,
          };
        }).filter((item) => item.label)
      : [],
    promotion_queue: Array.isArray(raw.promotion_queue)
      ? raw.promotion_queue.map((item) => {
          const row = asRecord(item);
          return {
            request_id: Number(row.request_id) || 0,
            environment: getString(row.environment),
            next_environment: getString(row.next_environment),
            cloud: getString(row.cloud),
            service: getString(row.service),
            status: getString(row.status),
            client_name: getString(row.client_name),
            updated_at: getString(row.updated_at),
          };
        }).filter((item) => item.request_id > 0)
      : [],
    incidents: Array.isArray(raw.incidents)
      ? raw.incidents.map((item) => {
          const row = asRecord(item);
          return {
            id: Number(row.id) || 0,
            request_id: Number(row.request_id) || 0,
            severity: getString(row.severity),
            status: getString(row.status),
            summary: getString(row.summary),
            owner_username: getString(row.owner_username) || undefined,
            updated_at: getString(row.updated_at),
            request_env: getString(row.request_env) || undefined,
            request_service: getString(row.request_service) || undefined,
          };
        }).filter((item) => item.id > 0)
      : [],
    runbooks: Array.isArray(raw.runbooks)
      ? raw.runbooks.map((item) => {
          const row = asRecord(item);
          return {
            id: Number(row.id) || 0,
            service: getString(row.service),
            title: getString(row.title),
            link_url: getString(row.link_url),
            updated_at: getString(row.updated_at),
          };
        }).filter((item) => item.id > 0)
      : [],
    active_overrides: Array.isArray(raw.active_overrides)
      ? raw.active_overrides.map((item) => {
          const row = asRecord(item);
          return {
            id: Number(row.id) || 0,
            username: getString(row.username),
            environments: normalizeStringArray(row.environments),
            permission: getString(row.permission),
            reason: getString(row.reason),
            expires_at: getString(row.expires_at),
          };
        }).filter((item) => item.id > 0)
      : [],
    deployment_gates: Object.keys(gatesRaw).length
      ? {
          summary: {
            ready_environments: Number(asRecord(gatesRaw.summary).ready_environments) || 0,
            attention_environments: Number(asRecord(gatesRaw.summary).attention_environments) || 0,
            blocked_environments: Number(asRecord(gatesRaw.summary).blocked_environments) || 0,
          },
          environments: Array.isArray(gatesRaw.environments)
            ? gatesRaw.environments.map((item) => {
                const row = asRecord(item);
                return {
                  environment: getString(row.environment),
                  status: getString(row.status),
                  summary: getString(row.summary),
                  requires_manager_approval: Boolean(row.requires_manager_approval),
                  requires_devops_approval: Boolean(row.requires_devops_approval),
                  promotion_candidate_count: Number(row.promotion_candidate_count) || 0,
                  incident_count: Number(row.incident_count) || 0,
                  active_override_count: Number(row.active_override_count) || 0,
                  checks: Array.isArray(row.checks)
                    ? row.checks.map((check) => {
                        const checkRow = asRecord(check);
                        return {
                          key: getString(checkRow.key),
                          label: getString(checkRow.label),
                          status: getString(checkRow.status),
                          detail: getString(checkRow.detail),
                        };
                      }).filter((check) => check.key || check.label || check.detail)
                    : [],
                };
              }).filter((item) => item.environment)
            : [],
        }
      : null,
    k8s_preview: Object.keys(k8sRaw).length
      ? {
          connection_count: Number(k8sRaw.connection_count) || 0,
          cluster_count: Number(k8sRaw.cluster_count) || 0,
          namespace_count: Number(k8sRaw.namespace_count) || 0,
          health_summary: {
            healthy_deployments: Number(asRecord(k8sRaw.health_summary).healthy_deployments) || 0,
            degraded_deployments: Number(asRecord(k8sRaw.health_summary).degraded_deployments) || 0,
            blocked_deployments: Number(asRecord(k8sRaw.health_summary).blocked_deployments) || 0,
            scaled_down_deployments: Number(asRecord(k8sRaw.health_summary).scaled_down_deployments) || 0,
            restarting_pods: Number(asRecord(k8sRaw.health_summary).restarting_pods) || 0,
            non_running_pods: Number(asRecord(k8sRaw.health_summary).non_running_pods) || 0,
            warning_logs: Number(asRecord(k8sRaw.health_summary).warning_logs) || 0,
            unhealthy_namespaces: Number(asRecord(k8sRaw.health_summary).unhealthy_namespaces) || 0,
          },
          namespace_watchlist: Array.isArray(k8sRaw.namespace_watchlist)
            ? k8sRaw.namespace_watchlist.map((item) => {
                const row = asRecord(item);
                return {
                  namespace: getString(row.namespace),
                  cluster_name: getString(row.cluster_name),
                  status: getString(row.status),
                  issue_count: Number(row.issue_count) || 0,
                  restarting_pods: Number(row.restarting_pods) || 0,
                  warning_logs: Number(row.warning_logs) || 0,
                  affected_deployments: Number(row.affected_deployments) || 0,
                };
              }).filter((item) => item.namespace || item.cluster_name)
            : [],
          workload_spotlights: Array.isArray(k8sRaw.workload_spotlights)
            ? k8sRaw.workload_spotlights.map((item) => {
                const row = asRecord(item);
                return {
                  name: getString(row.name),
                  namespace: getString(row.namespace),
                  cluster_name: getString(row.cluster_name),
                  status: getString(row.status),
                  ready_replicas: Number(row.ready_replicas) || 0,
                  replicas: Number(row.replicas) || 0,
                  restart_count: Number(row.restart_count) || 0,
                  warning_count: Number(row.warning_count) || 0,
                };
              }).filter((item) => item.name)
            : [],
        }
      : null,
    expiry_preview: Object.keys(expiryRaw).length
      ? {
          summary: {
            total_items: Number(asRecord(expiryRaw.summary).total_items) || 0,
            credential_items: Number(asRecord(expiryRaw.summary).credential_items) || 0,
            secret_items: Number(asRecord(expiryRaw.summary).secret_items) || 0,
            certificate_items: Number(asRecord(expiryRaw.summary).certificate_items) || 0,
            expired_count: Number(asRecord(expiryRaw.summary).expired_count) || 0,
            expiring_within_30_days: Number(asRecord(expiryRaw.summary).expiring_within_30_days) || 0,
            expiring_within_60_days: Number(asRecord(expiryRaw.summary).expiring_within_60_days) || 0,
            healthy_count: Number(asRecord(expiryRaw.summary).healthy_count) || 0,
            actionable_count: Number(asRecord(expiryRaw.summary).actionable_count) || 0,
            acknowledged_count: Number(asRecord(expiryRaw.summary).acknowledged_count) || 0,
            in_progress_count: Number(asRecord(expiryRaw.summary).in_progress_count) || 0,
            rotated_count: Number(asRecord(expiryRaw.summary).rotated_count) || 0,
          },
          priority_items: Array.isArray(expiryRaw.priority_items)
            ? expiryRaw.priority_items.map((item) => {
                const row = asRecord(item);
                return {
                  item_key: getString(row.item_key),
                  category: getString(row.category),
                  source: getString(row.source),
                  project_id: row.project_id == null ? undefined : Number(row.project_id) || undefined,
                  project_name: getString(row.project_name) || undefined,
                  project_code: getString(row.project_code) || undefined,
                  cloud: getString(row.cloud) || undefined,
                  environment: getString(row.environment) || undefined,
                  cluster_name: getString(row.cluster_name) || undefined,
                  namespace: getString(row.namespace) || undefined,
                  resource_name: getString(row.resource_name),
                  resource_type: getString(row.resource_type),
                  owner: getString(row.owner) || undefined,
                  created_at: getString(row.created_at) || undefined,
                  expires_at: getString(row.expires_at) || undefined,
                  days_remaining: Number(row.days_remaining) || 0,
                  status: getString(row.status),
                  recommendation: getString(row.recommendation),
                  workflow_state: getString(row.workflow_state),
                  workflow_note: getString(row.workflow_note) || undefined,
                  workflow_updated_at: getString(row.workflow_updated_at) || undefined,
                  workflow_updated_by_username: getString(row.workflow_updated_by_username) || undefined,
                };
              }).filter((item) => item.item_key || item.resource_name)
            : [],
        }
      : null,
  };
}

export default function DevOpsProjectDetailPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [releaseDashboard, setReleaseDashboard] = useState<ProjectReleaseDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [lifecycleAction, setLifecycleAction] = useState('');
  const [health, setHealth] = useState<ProjectHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState('');
  const [budgetUsd, setBudgetUsd] = useState('');
  const [defaultTtlDays, setDefaultTtlDays] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const projectId = parsePositiveIntParam(router.query.id);
    if (!token || !projectId) return;
    let cancelled = false;
    setHealthLoading(true);
    setHealthError('');
    fetch(`${apiUrl}/api/devops/projects/${projectId}/health`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) throw new Error(getString(data.error, 'Could not load delivery health'));
        if (!cancelled) {
          const next = (data.health as ProjectHealth) || null;
          setHealth(next);
          if (next?.settings) {
            setBudgetUsd(String(next.settings.monthly_budget_usd || ''));
            setDefaultTtlDays(String(next.settings.default_temp_env_days || ''));
          }
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setHealth(null);
          setHealthError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setHealthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, router.isReady, router.query.id]);

  useEffect(() => {
    if (!router.isReady) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    const projectId = parsePositiveIntParam(router.query.id);
    if (!projectId) {
      setLoading(false);
      setProject(null);
      setError('Project not found');
      return;
    }

    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/devops/projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(data.error, 'Failed to load project'));
        }
        if (!data.project) {
          throw new Error('Project not found');
        }
        setProject(normalizeProject(data.project));
        setReleaseDashboard(normalizeReleaseDashboard(data.release_dashboard));
      })
      .catch((err: Error) => {
        setProject(null);
        setReleaseDashboard(null);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router, router.isReady, router.query.id]);

  const servicesByCloud = useMemo(() => {
    if (!project) return [];
    return project.clouds.map((cloud) => ({
      cloud,
      services: project.services.filter((service) => service.cloud === cloud).map((service) => service.service),
    }));
  }, [project]);

  const stageStyle = stageTone(project?.onboarding_stage);

  const handleLifecycleAction = async (action: ProjectLifecycleAction) => {
    if (!project || !action.enabled || lifecycleAction) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    const confirmed = window.confirm(`${action.label} this project?`);
    if (!confirmed) return;
    setLifecycleAction(action.action);
    setActionError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/projects/${project.id}/lifecycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: action.action }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) {
        throw new Error(getString(data.error, `Failed to ${action.action} project`));
      }
      setProject(normalizeProject(data.project));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update project lifecycle');
    } finally {
      setLifecycleAction('');
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>{project ? `${project.name} - Projects` : 'Project Details - DevOps Portal'}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Onboarding</span>
            <h1 className="portal-page__title">{project ? project.name : 'Project Details'}</h1>
            <p className="portal-page__subtitle">
              Review the project contract DevOps is enforcing for user requests: scope, services, access, and approval path.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/projects" className="btn btn-secondary">Back to Projects</Link>
            <Link href={project ? buildPortalHref('/runbooks', { project_id: project.id }) : '/runbooks'} className="btn btn-secondary">Runbooks</Link>
            <Link href="/access-overrides" className="btn btn-secondary">Access Overrides</Link>
            <Link href={project ? buildPortalHref('/promotions', { project_id: project.id }) : '/promotions'} className="btn btn-secondary">Promotion Center</Link>
          </div>
        </div>

        {loading ? (
          <div className="portal-surface"><div className="empty-state">Loading project...</div></div>
        ) : error ? (
          <div className="portal-surface"><div className="empty-state">{error}</div></div>
        ) : !project ? (
          <div className="portal-surface"><div className="empty-state">Project not found.</div></div>
        ) : (
          <>
            {actionError ? (
              <section className="portal-surface">
                <div className="alert alert-error" role="alert">
                  {actionError}
                </div>
              </section>
            ) : null}
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Lifecycle</span>
                <span className="portal-stat-card__value">{project.onboarding_stage || 'configured'}</span>
                <p className="portal-stat-card__copy">
                  {project.ready_for_requests ? 'Users can request from this project now.' : 'More mapping is needed before the catalog is usable.'}
                </p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Service coverage</span>
                <span className="portal-stat-card__value">{project.service_count ?? project.services.length}</span>
                <p className="portal-stat-card__copy">{project.clouds.join(', ') || 'No clouds configured'}</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Team mappings</span>
                <span className="portal-stat-card__value">{project.team_count ?? project.team_access.length}</span>
                <p className="portal-stat-card__copy">{project.owner_team || 'Owner team not set yet'}</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Environments</span>
                <span className="portal-stat-card__value">{project.environments.length}</span>
                <p className="portal-stat-card__copy">{project.environments.join(', ')}</p>
              </article>
            </section>

            <ProjectHealthCard
              health={health}
              loading={healthLoading}
              error={healthError}
              renderLink={(href, children) => (
                <Link href={href} className="ig-health__fix">
                  {children}
                </Link>
              )}
            />

            {project ? (
              <section className="portal-surface" style={{ marginBottom: 24 }}>
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Infra defaults</span>
                    <h2 className="portal-surface__title">Budget, TTL, and DORA export</h2>
                    <p className="portal-surface__subtitle">
                      Non-prod requests inherit the default temporary-environment TTL when no expiry is set. Budget drives cost alerts and the weekly idle digest.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                      if (!token) return;
                      try {
                        const res = await fetch(`${apiUrl}/api/devops/projects/${project.id}/health/export`, {
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        if (!res.ok) throw new Error('Export failed');
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement('a');
                        anchor.href = url;
                        anchor.download = `dora-${project.code || project.id}.csv`;
                        anchor.click();
                        URL.revokeObjectURL(url);
                      } catch {
                        setSettingsNotice('Could not export DORA CSV.');
                      }
                    }}
                  >
                    Export DORA CSV
                  </button>
                </div>
                {settingsNotice ? <p className="portal-surface__subtitle">{settingsNotice}</p> : null}
                <form
                  className="portal-toolbar"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                    if (!token) return;
                    setSettingsSaving(true);
                    setSettingsNotice('');
                    try {
                      const res = await fetch(`${apiUrl}/api/devops/projects/${project.id}/infra-settings`, {
                        method: 'PATCH',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          monthly_budget_usd: parseInt(budgetUsd, 10) || 0,
                          default_temp_env_days: parseInt(defaultTtlDays, 10) || 0,
                        }),
                      });
                      const data = asRecord(await res.json().catch(() => ({})));
                      if (!res.ok) throw new Error(getString(data.error, 'Failed to save'));
                      setSettingsNotice('Infra settings saved.');
                    } catch (err) {
                      setSettingsNotice(err instanceof Error ? err.message : 'Failed to save');
                    } finally {
                      setSettingsSaving(false);
                    }
                  }}
                >
                  <label className="portal-toolbar__item">
                    <span className="credential-audit-label">Monthly budget (USD)</span>
                    <input className="input" type="number" min={0} value={budgetUsd} onChange={(e) => setBudgetUsd(e.target.value)} />
                  </label>
                  <label className="portal-toolbar__item">
                    <span className="credential-audit-label">Default temp env TTL (days, 0=off)</span>
                    <input className="input" type="number" min={0} max={90} value={defaultTtlDays} onChange={(e) => setDefaultTtlDays(e.target.value)} />
                  </label>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={settingsSaving}>
                    {settingsSaving ? 'Saving…' : 'Save settings'}
                  </button>
                </form>
              </section>
            ) : null}

            <DriftFixPanel projectId={project.id} />

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">{project.code}</span>
                  <h2 className="portal-surface__title">Project Contract</h2>
                  <p className="portal-surface__subtitle">{project.description || 'This project is managed by the DevOps catalog.'}</p>
                </div>
                <span className="project-detail__stage-chip" style={stageStyle}>
                  {project.onboarding_stage || 'configured'}
                </span>
              </div>

              <div className="portal-detail-grid project-detail__summary-grid">
                <article className="portal-detail-card">
                  <span className="portal-surface__eyebrow">Status</span>
                  <div className="portal-detail-card__value">{project.status}</div>
                </article>
                <article className="portal-detail-card">
                  <span className="portal-surface__eyebrow">Owner team</span>
                  <div className="portal-detail-card__value">{project.owner_team || 'Not set'}</div>
                </article>
                <article className="portal-detail-card">
                  <span className="portal-surface__eyebrow">Request readiness</span>
                  <div className="portal-detail-card__value">{project.ready_for_requests ? 'Ready' : 'Pending'}</div>
                </article>
                <article className="portal-detail-card">
                  <span className="portal-surface__eyebrow">Project code</span>
                  <div className="portal-detail-card__value">{project.code}</div>
                </article>
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Readiness Workflow</span>
                  <h2 className="portal-surface__title">Lifecycle and Checklist</h2>
                  <p className="portal-surface__subtitle">{project.next_action || 'Use lifecycle actions to control whether this catalog can accept new requests.'}</p>
                  </div>
                  <div className="portal-page__actions">
                    {(project.lifecycle_actions || []).map((action) => (
                    <button
                      key={action.action}
                      type="button"
                      className={action.action === 'archive' ? 'btn btn-secondary' : 'btn btn-primary'}
                      disabled={!action.enabled || lifecycleAction === action.action}
                      onClick={() => void handleLifecycleAction(action)}
                    >
                      {lifecycleAction === action.action ? `${action.label}...` : action.label}
                    </button>
                  ))}
                  </div>
                </div>
              <div className="portal-preview-signals project-detail__signals project-detail__signals--flush">
                {(project.readiness_checks || []).map((check) => (
                  <article key={`${project.id}-${check.key}`} className={check.complete ? 'portal-preview-signal portal-preview-signal--low' : 'portal-preview-signal portal-preview-signal--medium'}>
                    <div className="portal-preview-signal__top">
                      <strong className="portal-preview-signal__title">{check.label}</strong>
                      <span>{check.complete ? 'complete' : 'pending'}</span>
                    </div>
                    <p className="portal-preview-signal__detail">{check.detail}</p>
                  </article>
                ))}
              </div>
            </section>

            {project.cost_risk_summary ? (
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Cost and Risk</span>
                    <h2 className="portal-surface__title">Project Summary</h2>
                    <p className="portal-surface__subtitle">This rolls up request-level heuristics into one project view so DevOps can see workload pressure and exposure patterns quickly.</p>
                  </div>
                  <span className={getPreviewRiskClass(project.cost_risk_summary.overall_risk)}>
                    {project.cost_risk_summary.overall_risk} risk
                  </span>
                </div>
                <div className="portal-preview-grid project-detail__preview-grid project-detail__preview-grid--flush">
                  <article className="portal-detail-card">
                    <span className="portal-preview-eyebrow">Estimated monthly</span>
                    <strong className="portal-preview-value">{project.cost_risk_summary.estimated_monthly}</strong>
                    <p className="portal-preview-copy">
                      {project.cost_risk_summary.estimated_band} footprint. {project.cost_risk_summary.estimate_basis}
                    </p>
                  </article>
                  <article className="portal-detail-card">
                    <span className="portal-preview-eyebrow">Signals tracked</span>
                    <strong className="portal-preview-value">{project.cost_risk_summary.signals.length}</strong>
                    <p className="portal-preview-copy">{project.cost_risk_summary.summary}</p>
                  </article>
                  <article className="portal-detail-card">
                    <span className="portal-preview-eyebrow">Pending review</span>
                    <strong className="portal-preview-value">{project.cost_risk_summary.pending_review_count}</strong>
                    <p className="portal-preview-copy">High risk: {project.cost_risk_summary.high_risk_count} · Medium risk: {project.cost_risk_summary.medium_risk_count}</p>
                  </article>
                </div>
                <div className="portal-preview-signals project-detail__signals">
                  {project.cost_risk_summary.signals.map((signal) => (
                    <article key={`${signal.category}-${signal.title}`} className={getPreviewSignalClass(signal.severity)}>
                      <div className="portal-preview-signal__top">
                        <strong className="portal-preview-signal__title">{signal.title}</strong>
                        <span>{signal.severity}</span>
                      </div>
                      <p className="portal-preview-signal__detail">{signal.detail}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {releaseDashboard ? (
              <>
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Release Dashboard</span>
                      <h2 className="portal-surface__title">Project Delivery Health</h2>
                      <p className="portal-surface__subtitle">
                        Release readiness, current queue pressure, and operational support signals for this project.
                      </p>
                    </div>
                  </div>
                  <div className="portal-stat-grid">
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">Total requests</span>
                      <span className="portal-stat-card__value">{releaseDashboard.summary.total_requests}</span>
                      <p className="portal-stat-card__copy">Completed {releaseDashboard.summary.completed_requests} · Pending {releaseDashboard.summary.pending_requests}</p>
                    </article>
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">In progress</span>
                      <span className="portal-stat-card__value">{releaseDashboard.summary.in_progress_requests}</span>
                      <p className="portal-stat-card__copy">Requests actively moving through delivery or approval.</p>
                    </article>
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">Promotion queue</span>
                      <span className="portal-stat-card__value">{releaseDashboard.summary.promotion_ready_count}</span>
                      <p className="portal-stat-card__copy">Requests ready for the next environment promotion.</p>
                      <Link href={buildPortalHref('/promotions', { project_id: project.id })} className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
                        Open queue
                      </Link>
                    </article>
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">Open incidents</span>
                      <span className="portal-stat-card__value">{releaseDashboard.summary.open_incident_count}</span>
                      <p className="portal-stat-card__copy">Linked incidents currently affecting this project.</p>
                      <Link href={buildPortalHref('/incidents', { project_id: project.id })} className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
                        View incidents
                      </Link>
                    </article>
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">Runbooks</span>
                      <span className="portal-stat-card__value">{releaseDashboard.summary.runbook_count}</span>
                      <p className="portal-stat-card__copy">Operational recovery references available from the portal.</p>
                      <Link href={buildPortalHref('/runbooks', { project_id: project.id })} className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
                        Open runbooks
                      </Link>
                    </article>
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">Last release</span>
                      <span className="portal-stat-card__value" style={{ fontSize: 18 }}>
                        {formatDateTime(releaseDashboard.summary.last_release_at)}
                      </span>
                      <p className="portal-stat-card__copy">Most recent completed release tracked for this project.</p>
                    </article>
                  </div>
                </section>

                {releaseDashboard.k8s_preview ? (
                  <section className="portal-surface">
                    <div className="portal-surface__header">
                      <div>
                        <span className="portal-surface__eyebrow">Kubernetes Health</span>
                        <h2 className="portal-surface__title">Project workload health summary</h2>
                        <p className="portal-surface__subtitle">
                          Surface cluster pressure, unstable namespaces, and degraded workloads for this project without leaving the release view.
                        </p>
                      </div>
                      <Link
                        href={buildPortalHref('/k8s', { project_id: project.id })}
                        className="btn btn-secondary"
                      >
                        Open K8s dashboard
                      </Link>
                    </div>
                    <div className="portal-stat-grid">
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Connections</span>
                        <span className="portal-stat-card__value">{releaseDashboard.k8s_preview.connection_count}</span>
                        <p className="portal-stat-card__copy">
                          Clusters {releaseDashboard.k8s_preview.cluster_count} · Namespaces {releaseDashboard.k8s_preview.namespace_count}
                        </p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Restarting pods</span>
                        <span className="portal-stat-card__value">{releaseDashboard.k8s_preview.health_summary.restarting_pods}</span>
                        <p className="portal-stat-card__copy">Pods restarting often enough to warrant follow-up.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Non-running pods</span>
                        <span className="portal-stat-card__value">{releaseDashboard.k8s_preview.health_summary.non_running_pods}</span>
                        <p className="portal-stat-card__copy">Pods not currently in a stable running state.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Warning logs</span>
                        <span className="portal-stat-card__value">{releaseDashboard.k8s_preview.health_summary.warning_logs}</span>
                        <p className="portal-stat-card__copy">Visible log events above info severity for this project.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Unhealthy namespaces</span>
                        <span className="portal-stat-card__value">{releaseDashboard.k8s_preview.health_summary.unhealthy_namespaces}</span>
                        <p className="portal-stat-card__copy">Namespaces currently showing workload or signal issues.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Blocked deployments</span>
                        <span className="portal-stat-card__value">{releaseDashboard.k8s_preview.health_summary.blocked_deployments}</span>
                        <p className="portal-stat-card__copy">Deployments with no ready path forward until remediation.</p>
                      </article>
                    </div>
                    <div className="project-detail__watch-grid">
                      <article className="portal-detail-card">
                        <span className="portal-surface__eyebrow">Namespace Watchlist</span>
                        <div className="project-detail__watch-stack">
                          {releaseDashboard.k8s_preview.namespace_watchlist.length > 0 ? (
                            releaseDashboard.k8s_preview.namespace_watchlist.map((item) => {
                              const tone = releaseHealthTone(item.status);
                              return (
                                <div key={`${item.cluster_name}-${item.namespace}`} className="project-detail__watch-card">
                                  <div className="project-detail__watch-head">
                                    <strong>{item.namespace}</strong>
                                    <span className="project-detail__tone-chip project-detail__tone-chip--sm" style={tone}>
                                      {item.status}
                                    </span>
                                  </div>
                                  <p className="project-detail__watch-meta">
                                    {item.cluster_name} · Issues {item.issue_count} · Deployments {item.affected_deployments}
                                  </p>
                                  <p className="project-detail__watch-meta project-detail__watch-meta--secondary">
                                    Restarts {item.restarting_pods} · Warning logs {item.warning_logs}
                                  </p>
                                </div>
                              );
                            })
                          ) : (
                            <div className="empty-state">No unhealthy namespaces surfaced for this project.</div>
                          )}
                        </div>
                      </article>
                      <article className="portal-detail-card">
                        <span className="portal-surface__eyebrow">Workload Spotlight</span>
                        <div className="project-detail__watch-stack">
                          {releaseDashboard.k8s_preview.workload_spotlights.length > 0 ? (
                            releaseDashboard.k8s_preview.workload_spotlights.map((item) => {
                              const tone = releaseHealthTone(item.status);
                              return (
                                <div key={`${item.cluster_name}-${item.namespace}-${item.name}`} className="project-detail__watch-card">
                                  <div className="project-detail__watch-head">
                                    <strong>{item.name}</strong>
                                    <span className="project-detail__tone-chip project-detail__tone-chip--sm" style={tone}>
                                      {item.status}
                                    </span>
                                  </div>
                                  <p className="project-detail__watch-meta">
                                    {item.cluster_name} · {item.namespace} · Ready {item.ready_replicas}/{item.replicas}
                                  </p>
                                  <p className="project-detail__watch-meta project-detail__watch-meta--secondary">
                                    Restarts {item.restart_count} · Warning logs {item.warning_count}
                                  </p>
                                </div>
                              );
                            })
                          ) : (
                            <div className="empty-state">No degraded workloads surfaced for this project.</div>
                          )}
                        </div>
                      </article>
                    </div>
                  </section>
                ) : null}

                {releaseDashboard.expiry_preview ? (
                  <section className="portal-surface">
                    <div className="portal-surface__header">
                      <div>
                        <span className="portal-surface__eyebrow">Expiry Tracker</span>
                        <h2 className="portal-surface__title">Secrets and certificate review windows</h2>
                        <p className="portal-surface__subtitle">
                          Highlight the highest-priority rotation and review items for this project directly from the delivery view.
                        </p>
                      </div>
                      <Link
                        href={buildPortalHref('/credential-audit', { project_id: project.id })}
                        className="btn btn-secondary"
                      >
                        Open credential audit
                      </Link>
                    </div>
                    <div className="portal-stat-grid">
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Tracked items</span>
                        <span className="portal-stat-card__value">{releaseDashboard.expiry_preview.summary.total_items}</span>
                        <p className="portal-stat-card__copy">
                          Credentials {releaseDashboard.expiry_preview.summary.credential_items} · Secrets {releaseDashboard.expiry_preview.summary.secret_items} · Certificates {releaseDashboard.expiry_preview.summary.certificate_items}
                        </p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Expired</span>
                        <span className="portal-stat-card__value">{releaseDashboard.expiry_preview.summary.expired_count}</span>
                        <p className="portal-stat-card__copy">Items already outside the safe review or rotation window.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Next 30 days</span>
                        <span className="portal-stat-card__value">{releaseDashboard.expiry_preview.summary.expiring_within_30_days}</span>
                        <p className="portal-stat-card__copy">Immediate review or rotation attention required.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Actionable</span>
                        <span className="portal-stat-card__value">{releaseDashboard.expiry_preview.summary.actionable_count}</span>
                        <p className="portal-stat-card__copy">Non-healthy items still waiting for completion.</p>
                      </article>
                    </div>
                    <div className="project-detail__priority-list">
                      {releaseDashboard.expiry_preview.priority_items.length > 0 ? (
                        releaseDashboard.expiry_preview.priority_items.map((item) => {
                          const statusTone = expiryStatusTone(item.status);
                          const workflowTone = expiryWorkflowTone(item.workflow_state);
                          return (
                            <article key={item.item_key} className="portal-detail-card project-detail__priority-card">
                              <div className="project-detail__priority-head">
                                <div>
                                  <strong>{item.resource_name}</strong>
                                  <p className="project-detail__priority-copy">
                                    {item.category} · {item.resource_type}
                                  </p>
                                  <p className="project-detail__priority-copy project-detail__priority-copy--minor">
                                    {[item.cloud, item.environment, item.namespace || item.cluster_name].filter(Boolean).join(' · ') || 'General scope'}
                                  </p>
                                </div>
                                <div className="project-detail__priority-badges">
                                  <span className="project-detail__tone-chip" style={statusTone}>
                                    {item.status}
                                  </span>
                                  <span className="project-detail__tone-chip" style={workflowTone}>
                                    {expiryWorkflowLabel(item.workflow_state)}
                                  </span>
                                </div>
                              </div>
                              <p className="project-detail__priority-copy project-detail__priority-copy--body">
                                {item.recommendation}
                              </p>
                              <div className="project-detail__priority-meta">
                                <span>Days left: {item.days_remaining}</span>
                                <span>Expires: {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '—'}</span>
                                <span>Owner: {item.owner || 'Unassigned'}</span>
                              </div>
                              {item.workflow_note ? (
                                <p className="project-detail__priority-copy project-detail__priority-copy--minor">
                                  Note: {item.workflow_note}
                                </p>
                              ) : null}
                            </article>
                          );
                        })
                      ) : (
                        <div className="empty-state">No expiry watchlist items for this project right now.</div>
                      )}
                    </div>
                  </section>
                ) : null}

                {releaseDashboard.deployment_gates ? (
                  <section className="portal-surface">
                    <div className="portal-surface__header">
                      <div>
                        <span className="portal-surface__eyebrow">Deployment Controls</span>
                        <h2 className="portal-surface__title">Deployment Gate Policy Engine</h2>
                        <p className="portal-surface__subtitle">
                          Evaluate whether each environment is ready for promotion based on approval policy, incidents, rollback coverage, and temporary override signals.
                        </p>
                      </div>
                    </div>
                    <div className="portal-stat-grid">
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Ready environments</span>
                        <span className="portal-stat-card__value">{releaseDashboard.deployment_gates.summary.ready_environments}</span>
                        <p className="portal-stat-card__copy">No active blockers based on the current project policy.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Needs review</span>
                        <span className="portal-stat-card__value">{releaseDashboard.deployment_gates.summary.attention_environments}</span>
                        <p className="portal-stat-card__copy">Operational follow-up is recommended before promotion.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Blocked</span>
                        <span className="portal-stat-card__value">{releaseDashboard.deployment_gates.summary.blocked_environments}</span>
                        <p className="portal-stat-card__copy">Promotion is currently gated by incidents or missing rollback coverage.</p>
                      </article>
                    </div>
                    <div className="project-detail__gate-grid">
                      {releaseDashboard.deployment_gates.environments.map((gate) => {
                        const tone = deploymentGateTone(gate.status);
                        return (
                          <article key={`${project.id}-${gate.environment}-gate`} className="portal-detail-card project-detail__gate-card">
                            <div className="project-detail__gate-head">
                              <strong>{gate.environment.toUpperCase()}</strong>
                              <span className="project-detail__tone-chip" style={tone}>
                                {gate.status}
                              </span>
                            </div>
                            <p className="project-detail__gate-summary">{gate.summary}</p>
                            <div className="project-detail__gate-checks">
                              {gate.checks.map((check) => {
                                const checkTone = deploymentGateTone(check.status);
                                return (
                                  <div key={`${gate.environment}-${check.key}`} className="project-detail__gate-check">
                                    <div className="project-detail__gate-check-head">
                                      <strong className="project-detail__gate-check-title">{check.label}</strong>
                                      <span className="project-detail__tone-chip project-detail__tone-chip--sm" style={checkTone}>
                                        {check.status}
                                      </span>
                                    </div>
                                    <p className="project-detail__watch-meta project-detail__watch-meta--secondary">{check.detail}</p>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="project-detail__gate-actions">
                              <Link
                                href={buildPortalHref('/promotions', { project_id: project.id, next_environment: gate.environment })}
                                className="btn btn-secondary btn-sm"
                              >
                                Promotions
                              </Link>
                              <Link
                                href={buildPortalHref('/incidents', { project_id: project.id, environment: gate.environment })}
                                className="btn btn-secondary btn-sm"
                              >
                                Incidents
                              </Link>
                              <Link href={buildPortalHref('/runbooks', { project_id: project.id })} className="btn btn-secondary btn-sm">
                                Runbooks
                              </Link>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Environment Status</span>
                      <h2 className="portal-surface__title">Release posture by environment</h2>
                    </div>
                  </div>
                  <div className="project-detail__table-wrap">
                    <table className="templates-table">
                      <thead>
                        <tr>
                          <th>Environment</th>
                          <th>Health</th>
                          <th>Latest request</th>
                          <th>Latest service</th>
                          <th>Pending</th>
                          <th>Completed</th>
                          <th>Incidents</th>
                          <th>Last update</th>
                        </tr>
                      </thead>
                      <tbody>
                        {releaseDashboard.environment_statuses.map((item) => {
                          const tone = releaseHealthTone(item.health);
                          return (
                            <tr key={`${project.id}-${item.environment}`}>
                              <td>{item.environment.toUpperCase()}</td>
                              <td>
                                <span className="project-detail__tone-chip" style={tone}>
                                  {item.health}
                                </span>
                              </td>
                              <td>{item.latest_request_id ? `#${item.latest_request_id}` : '—'}</td>
                              <td>{item.latest_service ? `${item.latest_service} (${item.latest_cloud || 'n/a'})` : '—'}</td>
                              <td>{item.pending_count}</td>
                              <td>{item.completed_count}</td>
                              <td>{item.incident_count}</td>
                              <td>{formatDateTime(item.latest_updated_at)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Activity</span>
                      <h2 className="portal-surface__title">Recent release activity and support queue</h2>
                    </div>
                  </div>
                  <div className="project-detail__activity-grid">
                    <article className="portal-detail-card">
                      <span className="portal-surface__eyebrow">Recent activity</span>
                      <div className="project-detail__activity-stack">
                        {releaseDashboard.recent_activity.length > 0 ? releaseDashboard.recent_activity.slice(0, 5).map((item) => (
                          <div key={item.request_id} className="project-detail__activity-card">
                            <div className="project-detail__activity-head">
                              <strong>#{item.request_id} · {item.service}</strong>
                              <span className="project-detail__activity-status">{item.status}</span>
                            </div>
                            <p className="project-detail__activity-meta">
                              {item.environment.toUpperCase()} · {item.cloud} · {item.team || item.client_name || 'Unassigned'}
                            </p>
                            <p className="project-detail__activity-meta project-detail__activity-meta--minor">
                              Updated {formatDateTime(item.updated_at)}
                            </p>
                            <Link
                              href={buildPortalHref('/promotions', { project_id: project.id, request_id: item.request_id })}
                              className="btn btn-secondary btn-sm"
                            >
                              Open request context
                            </Link>
                          </div>
                        )) : <div className="empty-state">No recent activity yet.</div>}
                      </div>
                    </article>

                    <article className="portal-detail-card">
                      <span className="portal-surface__eyebrow">Promotion queue</span>
                      <div className="project-detail__activity-stack">
                        {releaseDashboard.promotion_queue.length > 0 ? releaseDashboard.promotion_queue.map((item) => (
                          <div key={item.request_id} className="project-detail__activity-card">
                            <strong>#{item.request_id} · {item.environment.toUpperCase()} to {item.next_environment.toUpperCase()}</strong>
                            <p className="project-detail__activity-meta">
                              {item.service} · {item.cloud} · {item.status}
                            </p>
                            <Link
                              href={buildPortalHref('/promotions', { project_id: project.id, request_id: item.request_id, next_environment: item.next_environment })}
                              className="btn btn-secondary btn-sm"
                            >
                              Open promotion
                            </Link>
                          </div>
                        )) : <div className="empty-state">Promotion queue is clear.</div>}
                      </div>
                    </article>

                    <article className="portal-detail-card">
                      <span className="portal-surface__eyebrow">Incidents and runbooks</span>
                      <div className="project-detail__activity-stack">
                        {releaseDashboard.incidents.length > 0 ? releaseDashboard.incidents.slice(0, 3).map((item) => (
                          <div key={item.id} className="project-detail__activity-card">
                            <strong>Incident #{item.request_id} · {item.severity}</strong>
                            <p className="project-detail__activity-meta">{item.summary}</p>
                            <Link
                              href={buildPortalHref('/incidents', { project_id: project.id, request_id: item.request_id, severity: item.severity })}
                              className="btn btn-secondary btn-sm"
                            >
                              Open incident
                            </Link>
                          </div>
                        )) : <div className="empty-state">No linked incidents right now.</div>}
                        {releaseDashboard.runbooks.length > 0 ? releaseDashboard.runbooks.slice(0, 3).map((item) => (
                          <div key={item.id} className="project-detail__activity-card">
                            <strong>{item.title}</strong>
                            <p className="project-detail__activity-meta">
                              {item.service || 'General'} · {item.link_url ? 'Linked' : 'Inline'}
                            </p>
                            <Link
                              href={buildPortalHref('/runbooks', { project_id: project.id, service: item.service || undefined })}
                              className="btn btn-secondary btn-sm"
                            >
                              Open runbook
                            </Link>
                          </div>
                        )) : <div className="empty-state">No runbooks linked yet.</div>}
                      </div>
                    </article>

                    <article className="portal-detail-card">
                      <span className="portal-surface__eyebrow">Active overrides</span>
                      <div className="project-detail__activity-stack">
                        {releaseDashboard.active_overrides.length > 0 ? releaseDashboard.active_overrides.map((item) => (
                          <div key={item.id} className="project-detail__activity-card">
                            <strong>{item.username} · {item.permission}</strong>
                            <p className="project-detail__activity-meta">
                              {item.environments.join(', ') || 'all envs'} · Expires {formatDateTime(item.expires_at)}
                            </p>
                          </div>
                        )) : <div className="empty-state">No active overrides for this project.</div>}
                      </div>
                    </article>
                  </div>

                  <div className="project-detail__trend">
                    <span className="portal-surface__eyebrow">Release trend</span>
                    <div className="project-detail__trend-chart">
                      {releaseDashboard.release_trend.map((point) => (
                        <div key={point.label} className="project-detail__trend-point">
                          <span className="project-detail__trend-value">{point.count}</span>
                          <span
                            className="project-detail__trend-bar"
                            style={{ height: `${Math.max(12, point.count * 18)}px` }}
                          />
                          <span className="project-detail__trend-label">{point.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Service Catalog</span>
                  <h2 className="portal-surface__title">Cloud-Service Matrix</h2>
                  <p className="portal-surface__subtitle">Users only see these services after they select this project in the request flow.</p>
                </div>
              </div>
              <div className="project-detail__catalog-grid">
                {servicesByCloud.map((entry) => (
                  <article key={`${project.id}-${entry.cloud}`} className="request-choice-card">
                    <strong>{entry.cloud.toUpperCase()}</strong>
                    <p className="project-detail__catalog-copy">{entry.services.join(', ') || 'No services configured'}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Team Access</span>
                  <h2 className="portal-surface__title">Portal Team Mappings</h2>
                  <p className="portal-surface__subtitle">Each mapped team gets environment-level scope inside the user portal.</p>
                </div>
              </div>
              {project.team_access.length === 0 ? (
                <div className="empty-state">No portal teams are mapped yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>Slug</th>
                        <th>Allowed environments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.team_access.map((access) => (
                        <tr key={`${project.id}-${access.team_id}`}>
                          <td>{access.team_name || 'Unknown team'}</td>
                          <td>{access.team_slug || '—'}</td>
                          <td>{access.environments.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Approval Path</span>
                  <h2 className="portal-surface__title">Environment Approval Rules</h2>
                  <p className="portal-surface__subtitle">These rules control whether a request waits on manager approval, DevOps approval, or both.</p>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>Environment</th>
                      <th>Manager approval</th>
                      <th>DevOps approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.approval_rules.map((rule) => (
                      <tr key={`${project.id}-${rule.environment}`}>
                        <td>{rule.environment.toUpperCase()}</td>
                        <td>{rule.require_manager_approval ? 'Required' : 'Not required'}</td>
                        <td>{rule.require_devops_approval ? 'Required' : 'Bypass to approval queue'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </DevOpsLayout>
  );
}
