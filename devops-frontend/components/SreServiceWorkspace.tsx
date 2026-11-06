import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { InspectorDrawer, buildPortalApiUrl, formatOperationalTime } from '@infragate/ui';
import { useUnsavedChanges } from '../lib/useUnsavedChanges';
import { CONNECTOR_SOURCES, MEASUREMENT_TYPES, SERVICE_CLASSES, budgetDisplay, formatBps, measurementTypeLabel, previewFindingRule, qualityLabel, scheduleModeCopy, scoreDisplay, serviceClassLabel, sparklineHeights, validSecretRefName, type ServiceWorkspaceTab, workspaceTab } from '../lib/sreMonitoring';
import ServiceActivityTimeline from './ServiceActivityTimeline';
import ServiceEnvironmentMatrix from './ServiceEnvironmentMatrix';
import { serviceTicketHref } from '../lib/scopeHref';
import { recordReference } from '../lib/recordRef';
import CollectionStatus, { collectionStateFromSync } from './CollectionStatus';

type Monitor = {
  id: number;
  name: string;
  measurement_type: string;
  enabled: boolean;
  current_version: number;
  last_known_good_version?: number;
  source_type?: string;
  connector_id?: number;
  query_text: string;
  good_field: string;
  total_field: string;
  target_bps: number;
  window_minutes: number;
  latency_threshold_ms?: number;
  min_samples: number;
  min_coverage_bps: number;
  schedule_minutes?: number;
  warning_rule?: { comparator?: string; threshold?: number; title?: string; description?: string };
  critical_rule?: { comparator?: string; threshold?: number; title?: string; description?: string };
  latest?: {
    state: string;
    quality?: string;
    measurement?: {
      state: string;
      quality: string;
      availability_bps?: number;
      budget_remaining_bps?: number;
      burn_rate_milli?: number;
      reason?: string;
      observed_at?: string;
      coverage_bps?: number;
      good?: number;
      total?: number;
      window_minutes?: number;
      target_bps?: number;
    };
    evaluated_at?: string;
    source_error?: string;
  };
};

type Finding = {
  id: number;
  monitor_id: number;
  severity: string;
  lifecycle: string;
  title: string;
  explanation: string;
  observed: string;
  expected: string;
  source_type: string;
  last_seen_at: string;
  owner?: string;
  incident_id?: number;
};

type Connector = { id: number; name: string; source_type: string; status: string; has_credential: boolean; enabled?: boolean; base_url?: string; grafana_datasource_uid?: string; ingest_delay_minutes?: number; timeout_seconds?: number };
type Template = { id: string; name: string; source_type: string; measurement_type: string; query: string; good_field: string; total_field: string; help: string };

const TABS: { id: ServiceWorkspaceTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'environments', label: 'Environments' },
  { id: 'activity', label: 'Activity' },
  { id: 'observability', label: 'Observability' },
  { id: 'findings', label: 'Findings' },
  { id: 'configuration', label: 'Configuration' },
];

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const EMPTY_CONNECTOR_FORM = { name: '', source_type: 'grafana', base_url: '', secret_ref: '', grafana_datasource_uid: '', ingest_delay_minutes: 0 };
const EMPTY_MONITOR_FORM = {
  name: '', measurement_type: 'availability_sli', connector_id: 0, query_text: '', good_field: 'good', total_field: 'total',
  target_bps: 9990, window_minutes: 43200, min_samples: 1, min_coverage_bps: 8000, enable: false,
  warning_below: 20, critical_below: 5, schedule_minutes: 0,
};

function secretRefPlaceholder(source: string): string {
  if (source === 'splunk') return 'SPLUNK_TOKEN';
  if (source === 'private') return 'PRIVATE_SAMPLE_SECRET';
  if (source === 'datadog') return 'DATADOG_API_KEY';
  if (source === 'prometheus') return 'PROMETHEUS_TOKEN';
  return 'GRAFANA_TOKEN';
}

function stateLabel(state?: string): string {
  switch (state) {
    case 'healthy': return 'Healthy';
    case 'at_risk': return 'At risk';
    case 'breached': return 'Breached';
    case 'no_traffic': return 'No traffic';
    case 'stale': return 'Stale';
    case 'query_failed': return 'Query failed';
    case 'disabled': return 'Disabled';
    default: return 'Unknown';
  }
}

export default function SreServiceWorkspace({
  apiUrl,
  token,
  serviceId,
  projectId,
  environment,
  isManager,
  overview,
  evidenceUrl,
  onConfigure,
  configurationLead,
  serviceName,
}: {
  apiUrl: string;
  token: string;
  serviceId: number;
  projectId?: number;
  environment: string;
  isManager: boolean;
  overview: ReactNode;
  evidenceUrl?: string;
  onConfigure?: () => void;
  configurationLead?: ReactNode;
  serviceName?: string;
}) {
  const router = useRouter();
  const tab = workspaceTab(router.query.tab);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingMonitorId, setEditingMonitorId] = useState(0);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [editingConnectorId, setEditingConnectorId] = useState(0);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [guardrailOpen, setGuardrailOpen] = useState(false);
  const [formStep, setFormStep] = useState(1);
  const [findingFilter, setFindingFilter] = useState({ severity: '', lifecycle: '', source: '', monitor: '' });
  const [trendMonitorId, setTrendMonitorId] = useState(0);
  const [testNote, setTestNote] = useState('');
  const [routing, setRouting] = useState({ observation_only: true, create_incidents: false, page_oncall: false });
  const [guardrail, setGuardrail] = useState({ mode: 'observation', block_on_critical: true, min_budget_bps: 2000, freshness_minutes: 1440 });
  const [history, setHistory] = useState<{ evaluated_at?: string; measurement?: { availability_bps?: number; state?: string }; version?: number }[]>([]);
  const [versions, setVersions] = useState<{ version: number; created_at?: string }[]>([]);
  const [versionDiff, setVersionDiff] = useState<string[]>([]);
  const [versionMonitorId, setVersionMonitorId] = useState(0);
  const [changes, setChanges] = useState<{ id: number; change_number?: string; title?: string; sha?: string; created_at?: string }[]>([]);
  const [connectorForm, setConnectorForm] = useState(EMPTY_CONNECTOR_FORM);
  const [episodes, setEpisodes] = useState<{ id: number; title?: string; status?: string; severity?: string; sequence?: number; incident_id?: number }[]>([]);
  const [simulation, setSimulation] = useState('');
  const [findingOwner, setFindingOwner] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [guardrailDecision, setGuardrailDecision] = useState<{ id?: number; outcome?: string; reason?: string; mode?: string; artifact_sha?: string; expires_at?: string } | null>(null);
  const [lastBatchId, setLastBatchId] = useState(0);
  const [form, setForm] = useState(EMPTY_MONITOR_FORM);
  useUnsavedChanges(formOpen || connectorOpen);

  const setTab = (next: ServiceWorkspaceTab) => {
    const query = { ...router.query };
    if (next === 'overview') delete query.tab;
    else query.tab = next;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  const load = useCallback(() => {
    if (!token || !serviceId) return;
    setLoading(true);
    const envQ = environment ? `?environment=${encodeURIComponent(environment)}` : '';
    Promise.all([
      fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitors${envQ}`), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({}))),
      fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitoring/findings${envQ}`), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({}))),
      fetch(buildPortalApiUrl(apiUrl, '/api/devops/observability/connectors'), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({}))),
      fetch(buildPortalApiUrl(apiUrl, '/api/devops/monitoring/templates'), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({}))),
      fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/routing`), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({}))),
      fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/guardrail`), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({}))),
    ])
      .then(([monitorData, findingData, connectorData, templateData, routingData, guardrailData]) => {
        setMonitors(Array.isArray(monitorData.monitors) ? monitorData.monitors : []);
        setFindings(Array.isArray(findingData.findings) ? findingData.findings : []);
        setConnectors(Array.isArray(connectorData.connectors) ? connectorData.connectors : []);
        setTemplates(Array.isArray(templateData.templates) ? templateData.templates : []);
        if (routingData.routing) {
          setRouting({
            observation_only: routingData.routing.observation_only !== false,
            create_incidents: Boolean(routingData.routing.create_incidents),
            page_oncall: Boolean(routingData.routing.page_oncall),
          });
        }
        if (guardrailData.policy) setGuardrail(guardrailData.policy);
        if (guardrailData.latest || guardrailData.preview) setGuardrailDecision(guardrailData.latest || guardrailData.preview);
      })
      .catch(() => setError('Failed to load monitoring'))
      .finally(() => setLoading(false));
  }, [apiUrl, environment, serviceId, token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!token || !serviceId) return;
    const monitor = monitors.find((item) => item.measurement_type === 'availability_sli') || monitors[0];
    if (!monitor) return;
    void Promise.all([
      fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitors/${monitor.id}/versions`), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({}))),
      fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitoring/context`), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({}))),
      fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitoring/episodes?environment=${encodeURIComponent(environment)}`), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({}))),
    ]).then(([versionData, contextData, episodeData]) => {
      setVersions(Array.isArray(versionData.versions) ? versionData.versions : []);
      setVersionDiff(Array.isArray(versionData.diff) ? versionData.diff : []);
      setVersionMonitorId(monitor.id);
      setChanges(Array.isArray(contextData.changes) ? contextData.changes : []);
      setEpisodes(Array.isArray(episodeData.episodes) ? episodeData.episodes : []);
    });
  }, [apiUrl, environment, monitors, serviceId, token]);

  useEffect(() => {
    if (!token || !serviceId) return;
    const monitor = monitors.find((item) => item.id === trendMonitorId) || monitors.find((item) => item.measurement_type === 'availability_sli') || monitors[0];
    if (!monitor) {
      setHistory([]);
      return;
    }
    void fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitors/${monitor.id}/history`), { headers: authHeaders(token) })
      .then((res) => res.json().catch(() => ({})))
      .then((historyData) => setHistory(Array.isArray(historyData.history) ? historyData.history : []));
  }, [apiUrl, monitors, serviceId, token, trendMonitorId]);

  useEffect(() => {
    const wanted = Number(Array.isArray(router.query.finding_id) ? router.query.finding_id[0] : router.query.finding_id);
    if (!wanted) return;
    const found = findings.find((item) => item.id === wanted);
    if (found) setSelectedFinding(found);
  }, [findings, router.query.finding_id]);

  useEffect(() => {
    setFindingOwner(selectedFinding?.owner || '');
  }, [selectedFinding]);

  const openFinding = (finding: Finding) => {
    setSelectedFinding(finding);
    const query = { ...router.query, finding_id: String(finding.id), tab: 'findings' };
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  const closeFinding = () => {
    setSelectedFinding(null);
    const query = { ...router.query };
    delete query.finding_id;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  const availability = monitors.find((item) => item.measurement_type === 'availability_sli');
  const latency = monitors.find((item) => item.measurement_type === 'latency_sli');
  const trendMonitor = monitors.find((item) => item.id === trendMonitorId) || availability || monitors[0];
  const openFindings = findings.filter((item) => item.lifecycle !== 'resolved');
  const lastEval = monitors.map((item) => item.latest?.evaluated_at || item.latest?.measurement?.observed_at).filter(Boolean).sort().at(-1);
  const queryFailed = monitors.some((item) => item.latest?.measurement?.state === 'query_failed' || Boolean(item.latest?.source_error));
  const observabilitySource = connectors.find((item) => item.enabled !== false)?.source_type || connectors[0]?.source_type || 'Observability';
  const collectionState = collectionStateFromSync({
    connected: connectors.length > 0 || monitors.length > 0,
    failed: queryFailed,
    lastSuccess: lastEval,
    empty: !findings.length,
  });
  const scheduledMinutes = monitors.filter((item) => item.enabled && (item.schedule_minutes || 0) > 0).map((item) => item.schedule_minutes || 0);
  const scheduleCopy = scheduledMinutes.length ? scheduleModeCopy(Math.min(...scheduledMinutes)) : 'On-demand';
  const visibleFindings = openFindings.concat(findings.filter((item) => item.lifecycle === 'resolved')).filter((item) => (
    (!findingFilter.severity || item.severity === findingFilter.severity)
    && (!findingFilter.lifecycle || item.lifecycle === findingFilter.lifecycle)
    && (!findingFilter.source || item.source_type === findingFilter.source)
    && (!findingFilter.monitor || String(item.monitor_id) === findingFilter.monitor)
  ));
  const findingsEmptyCopy = !findings.length && !lastEval
    ? 'Not evaluated yet. Findings appear after a successful refresh on Observability.'
    : !findings.length
      ? 'No findings from successful evaluations.'
      : visibleFindings.length
        ? ''
        : 'No findings match these filters.';

  const refresh = async (monitorIds?: number[], retryFailed = false) => {
    setRefreshing(true);
    setError('');
    setNotice('');
    setStatus(retryFailed ? 'Retrying failed monitors against the original evaluation window…' : 'Refreshing monitors…');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitoring/refresh`), {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ environment, monitor_ids: monitorIds || [], retry_failed: retryFailed, batch_id: retryFailed ? lastBatchId : 0 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Refresh failed');
      const evalId = data.evaluation?.id;
      if (typeof evalId === 'number' && evalId > 0 && !retryFailed) setLastBatchId(evalId);
      for (let attempt = 0; attempt < 20 && evalId; attempt += 1) {
        const poll = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/monitoring/evaluations/${evalId}`), { headers: authHeaders(token) }).then((res) => res.json().catch(() => ({})));
        const state = String(poll.evaluation?.state || '');
        const runs = Array.isArray(poll.evaluation?.runs) ? poll.evaluation.runs : [];
        setStatus(`Refreshing ${runs.filter((run: { state?: string }) => run.state && run.state !== 'queued').length || attempt} of ${monitors.filter((item) => item.enabled).length || '…'}`);
        if (state === 'completed' || state === 'partial' || state === 'failed') {
          if (state === 'partial') setNotice('Some monitors updated; at least one query failed. Previous successful results stay visible.');
          else if (state === 'failed') setNotice('Refresh failed; showing results from the last successful evaluation.');
          else setNotice('Monitoring refreshed. This is on-demand evaluation, not continuous alerting.');
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
      setStatus('');
    }
  };

  const startAddMonitor = () => {
    setEditingMonitorId(0);
    setForm(EMPTY_MONITOR_FORM);
    setFormStep(1);
    setFormOpen(true);
  };

  const startEditMonitor = (monitor: Monitor) => {
    setEditingMonitorId(monitor.id);
    setForm({
      name: monitor.name,
      measurement_type: monitor.measurement_type,
      connector_id: monitor.connector_id || 0,
      query_text: monitor.query_text,
      good_field: monitor.good_field,
      total_field: monitor.total_field,
      target_bps: monitor.target_bps,
      window_minutes: monitor.window_minutes,
      min_samples: monitor.min_samples,
      min_coverage_bps: monitor.min_coverage_bps,
      enable: monitor.enabled,
      warning_below: Number(monitor.warning_rule?.threshold) || 20,
      critical_below: Number(monitor.critical_rule?.threshold) || 5,
      schedule_minutes: monitor.schedule_minutes || 0,
    });
    setFormStep(1);
    setFormOpen(true);
  };

  const saveMonitor = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const editing = monitors.find((item) => item.id === editingMonitorId);
      const response = await fetch(buildPortalApiUrl(apiUrl, editingMonitorId ? `/api/devops/services/${serviceId}/monitors/${editingMonitorId}` : `/api/devops/services/${serviceId}/monitors`), {
        method: editingMonitorId ? 'PATCH' : 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          name: form.name,
          measurement_type: form.measurement_type,
          environment,
          connector_id: form.connector_id || undefined,
          query_text: form.query_text,
          good_field: form.good_field,
          total_field: form.total_field,
          target_bps: form.target_bps,
          window_minutes: form.window_minutes,
          min_samples: form.min_samples,
          min_coverage_bps: form.min_coverage_bps,
          schedule_minutes: form.schedule_minutes,
          enabled: form.enable,
          expected_version: editing?.current_version,
          warning_rule: { comparator: 'below', threshold: form.warning_below, title: 'Error budget running low', description: 'The service still has budget, but consumption needs investigation.' },
          critical_rule: { comparator: 'below', threshold: form.critical_below, title: 'Error budget exhausted', description: 'Budget remaining is below the critical threshold.' },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to save monitor');
      setFormOpen(false);
      setFormStep(1);
      setEditingMonitorId(0);
      setForm(EMPTY_MONITOR_FORM);
      const scheduleCopy = form.schedule_minutes > 0 ? `scheduled every ${form.schedule_minutes} min` : 'on-demand refresh';
      setNotice(form.enable ? `Monitor saved and enabled for ${scheduleCopy}.` : 'Draft monitor saved. Enable it after a successful Test query.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save monitor');
    }
  };

  const applyTemplate = (template: Template) => {
    setForm((current) => ({
      ...current,
      name: template.name,
      measurement_type: template.measurement_type,
      query_text: template.query,
      good_field: template.good_field,
      total_field: template.total_field,
      connector_id: connectors.find((item) => item.source_type === template.source_type)?.id || current.connector_id,
    }));
  };

  const ackFinding = async (finding: Finding) => {
    await fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitoring/findings/${finding.id}`), {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ acknowledge: true, note: 'Acknowledged from the service workspace.' }),
    });
    load();
  };

  const resolveFinding = async (finding: Finding) => {
    setError('');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitoring/findings/${finding.id}`), {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ resolve: true, owner: findingOwner }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to resolve finding');
      setNotice('Finding resolved. Acknowledgement is not recovery; this records that the investigation is closed.');
      closeFinding();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve finding');
    }
  };

  const findingIncidentHref = (finding: Finding) => {
    const href = serviceTicketHref('/incidents/new', { id: serviceId, project_id: projectId, environment, service: serviceName });
    const params = new URLSearchParams(href.split('?')[1] || '');
    params.set('summary', finding.title);
    params.set('notes', [finding.observed, finding.expected].filter(Boolean).join(' '));
    params.set('finding_id', String(finding.id));
    return `/incidents/new?${params.toString()}`;
  };

  const testMonitor = async (monitor: Monitor) => {
    setError('');
    setTestNote('');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitors/${monitor.id}/test`), {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ query_text: monitor.query_text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Test query failed');
      const preview = data.finding_preview ? ` Finding preview: ${data.finding_preview}.` : '';
      setTestNote(`Test query ${data.status || 'finished'} in ${data.duration_ms || 0} ms. Incidents and guardrails stayed off.${preview}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test query failed');
    }
  };

  const enableMonitor = async (monitor: Monitor, enabled: boolean) => {
    setError('');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitors/${monitor.id}`), {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({
          name: monitor.name,
          measurement_type: monitor.measurement_type,
          connector_id: monitor.connector_id || 0,
          query_text: monitor.query_text,
          good_field: monitor.good_field,
          total_field: monitor.total_field,
          target_bps: monitor.target_bps,
          window_minutes: monitor.window_minutes,
          latency_threshold_ms: monitor.latency_threshold_ms,
          min_samples: monitor.min_samples,
          min_coverage_bps: monitor.min_coverage_bps,
          warning_rule: monitor.warning_rule,
          critical_rule: monitor.critical_rule,
          expected_version: monitor.current_version,
          schedule_minutes: monitor.schedule_minutes || 0,
          enabled,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to update monitor');
      setNotice(enabled
        ? ((monitor.schedule_minutes || 0) > 0 ? `Monitor enabled. ${scheduleModeCopy(monitor.schedule_minutes)}.` : 'Monitor enabled for on-demand refresh.')
        : 'Monitor disabled.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update monitor');
    }
  };

  const testConnector = async (connector: Connector) => {
    setError('');
    setTestNote('');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/observability/connectors/${connector.id}/test`), {
        method: 'POST',
        headers: authHeaders(token),
        body: '{}',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Connector test failed');
      setTestNote(data.status === 'ready' ? `${connector.name} is ready. Credentials are not shown.` : `${connector.name} failed: ${data.error || 'query failed'}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connector test failed');
    }
  };

  const startAddConnector = () => {
    setEditingConnectorId(0);
    setConnectorForm(EMPTY_CONNECTOR_FORM);
    setConnectorOpen(true);
  };

  const startEditConnector = (item: Connector) => {
    setEditingConnectorId(item.id);
    setConnectorForm({
      name: item.name,
      source_type: item.source_type,
      base_url: item.base_url || '',
      secret_ref: '',
      grafana_datasource_uid: item.grafana_datasource_uid || '',
      ingest_delay_minutes: item.ingest_delay_minutes || 0,
    });
    setConnectorOpen(true);
  };

  const saveConnector = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const secretRef = connectorForm.secret_ref.trim();
    if (secretRef && !validSecretRefName(secretRef)) {
      setError('Store GRAFANA_TOKEN, SPLUNK_TOKEN, or PRIVATE_SAMPLE_SECRET, not the credential.');
      return;
    }
    const editing = connectors.find((item) => item.id === editingConnectorId);
    if (connectorForm.source_type !== 'fixture' && !secretRef && !editing?.has_credential) {
      setError('Live and private connectors need a secret reference name on the server.');
      return;
    }
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, editingConnectorId ? `/api/devops/observability/connectors/${editingConnectorId}` : '/api/devops/observability/connectors'), {
        method: editingConnectorId ? 'PATCH' : 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          project_id: projectId || undefined,
          name: connectorForm.name,
          source_type: connectorForm.source_type,
          base_url: connectorForm.base_url,
          secret_ref: secretRef,
          grafana_datasource_uid: connectorForm.grafana_datasource_uid,
          ingest_delay_minutes: connectorForm.ingest_delay_minutes,
          enabled: editing ? editing.enabled !== false : true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to save connector');
      setConnectorForm(EMPTY_CONNECTOR_FORM);
      setConnectorOpen(false);
      setEditingConnectorId(0);
      setNotice(connectorForm.source_type === 'private'
        ? 'Private connector saved. Run workers/push_monitoring_sample.py with the same secret reference name in workers/.env.'
        : 'Connector saved. Credentials stay on the server.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save connector');
    }
  };

  const setConnectorEnabled = async (item: Connector, enabled: boolean) => {
    setError('');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/observability/connectors/${item.id}`), {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({
          name: item.name,
          source_type: item.source_type,
          base_url: item.base_url || '',
          grafana_datasource_uid: item.grafana_datasource_uid || '',
          ingest_delay_minutes: item.ingest_delay_minutes || 0,
          enabled,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to update connector');
      setNotice(enabled ? `${item.name} is enabled.` : `${item.name} is disabled. Queries using it stay Unknown until it is enabled.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update connector');
    }
  };

  const previewDraftQuery = async () => {
    setError('');
    setTestNote('');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitors/preview`), {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          connector_id: form.connector_id,
          query_text: form.query_text,
          good_field: form.good_field,
          total_field: form.total_field,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Test query failed');
      setTestNote(`Test query ${data.status || 'finished'} in ${data.duration_ms || 0} ms. Incidents and guardrails stayed off.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test query failed');
    }
  };

  const simulatePolicy = async () => {
    if (!versionMonitorId) return;
    setError('');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitoring/simulate`), {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          monitor_id: versionMonitorId,
          warning_rule: { comparator: 'below', threshold: form.warning_below },
          critical_rule: { comparator: 'below', threshold: form.critical_below },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Simulation failed');
      const sim = data.simulation || {};
      setSimulation(`Simulation only: ${sim.samples || 0} samples, ${sim.critical || 0} critical, ${sim.warning || 0} warning, ${sim.unknown || 0} unknown. ${sim.coverage_note || ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    }
  };

  const rollbackMonitor = async (monitorId: number, version?: number) => {
    setError('');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitors/${monitorId}/rollback`), {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ rollback_to_version: version || 0 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Rollback failed');
      setNotice(`Monitor restored from version ${version || data.monitor?.last_known_good_version || 'last known good'}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed');
    }
  };

  const score = (monitor?: Monitor) => monitor?.latest?.measurement;
  const primaryAction = tab === 'overview'
    ? <button type="button" className="btn btn-primary" onClick={() => setTab('observability')}>Open observability</button>
    : tab === 'observability'
      ? (
        <div className="portal-page__actions">
          <button type="button" className="btn btn-primary" disabled={refreshing || !monitors.some((item) => item.enabled)} onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : 'Refresh all'}</button>
          <button type="button" className="btn btn-secondary" disabled={refreshing} onClick={() => void refresh([], true)}>Retry failed</button>
        </div>
      )
      : tab === 'findings'
        ? (
          <div className="portal-page__actions">
            <button type="button" className="btn btn-secondary" onClick={() => setTab('observability')}>Open observability</button>
            {isManager ? <button type="button" className="btn btn-primary" onClick={() => setTab('configuration')}>Open configuration</button> : null}
          </div>
        )
        : null;

  const why = useMemo(() => {
    const measurement = availability?.latest?.measurement;
    if (!measurement) return null;
    return {
      name: availability.name,
      numerator: measurement.good,
      denominator: measurement.total,
      target: formatBps(measurement.target_bps || availability.target_bps),
      window: measurement.window_minutes || availability.window_minutes,
      coverage: formatBps(measurement.coverage_bps),
      version: availability.current_version,
    };
  }, [availability]);

  return (
    <div className="sre-workspace">
      <div className="sre-workspace__chrome">
        <div className="sre-tabs" role="tablist" aria-label="Service workspace">
          {TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`sre-tabs__tab${tab === item.id ? ' is-active' : ''}`} onClick={() => setTab(item.id)}>
              {item.label}
              {item.id === 'findings' && openFindings.length ? <span className="sre-tabs__count">{openFindings.length}</span> : null}
            </button>
          ))}
        </div>
        <div className="sre-workspace__tools">
          <p className="sre-workspace__mode">{scheduleCopy}{lastEval ? ` · last evaluation ${formatOperationalTime(lastEval)}` : ' · not evaluated yet'}</p>
          <CollectionStatus
            source={observabilitySource}
            lastSuccess={lastEval}
            state={collectionState}
            detail="Missing telemetry stays Unknown, not Healthy."
          />
          {primaryAction}
        </div>
      </div>
      {status ? <p className="sre-live" role="status">{status}</p> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}
      {notice ? <div className="alert">{notice}</div> : null}
      {testNote ? <div className="alert">{testNote}</div> : null}

      {tab === 'overview' ? (
        <div className="sre-panel">
          <section className="sre-cards" aria-label="Reliability summary">
            <article className={`sre-card is-${score(availability)?.state || 'unknown'}`}>
              <span>{availability?.name || 'Availability'}</span>
              <strong>{scoreDisplay(score(availability))}</strong>
              <small>{formatBps(availability?.target_bps)} over {availability?.window_minutes || '—'} min · {stateLabel(score(availability)?.state)}</small>
              {monitors.filter((item) => item.measurement_type === 'availability_sli').length > 1 ? (
                <small>Service rollup uses this monitor. Open Observability for each endpoint SLI.</small>
              ) : null}
            </article>
            <article className={`sre-card is-${score(latency)?.state || 'unknown'}`}>
              <span>Latency compliance</span>
              <strong>{scoreDisplay(score(latency))}</strong>
              <small>{latency ? `${formatBps(latency.target_bps)} within ${latency.latency_threshold_ms || '—'} ms` : 'No latency monitor'}</small>
            </article>
            <article className={`sre-card is-${(score(availability)?.budget_remaining_bps ?? 10000) < 2000 ? 'at_risk' : score(availability)?.state || 'unknown'}`}>
              <span>Error budget remaining</span>
              <strong>{budgetDisplay(score(availability))}</strong>
              <small>Burn rate {score(availability)?.burn_rate_milli != null ? `${(Number(score(availability)?.burn_rate_milli) / 1000).toFixed(2)}x` : 'Unknown'}. Missing telemetry stays Unknown.</small>
            </article>
            <article className={`sre-card is-${openFindings.some((item) => item.severity === 'critical') ? 'breached' : openFindings.length ? 'at_risk' : 'unknown'}`}>
              <span>Active findings</span>
              <strong>{loading ? '…' : openFindings.length}</strong>
              <small>{openFindings.length ? 'Open Critical and Warning items' : 'An empty list is not proof of health if nothing was evaluated.'}</small>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTab('findings')}>{openFindings.length ? 'Open findings' : 'View findings'}</button>
            </article>
          </section>
          <p className="form-section__copy">{scheduleCopy}. Missing telemetry stays Unknown, not Healthy.{lastEval ? ` Last evaluation ${formatOperationalTime(lastEval)}.` : ' This service has not been evaluated yet.'}</p>
          {overview}
        </div>
      ) : null}

      {tab === 'environments' ? (
        <div className="sre-panel">
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Environment versions</h2>
                <p className="portal-surface__subtitle">Commit and image actually observed in each recorded environment. Missing stays Unknown.</p>
              </div>
            </div>
            <ServiceEnvironmentMatrix apiUrl={apiUrl} token={token} serviceId={serviceId} />
          </section>
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div className="sre-panel">
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Service activity</h2>
                <p className="portal-surface__subtitle">Deployments, configuration changes, incidents, and SLO breaches for this service and environment. Each event links to source evidence. Nearby timestamps are correlation, not proven cause.</p>
              </div>
            </div>
            <ServiceActivityTimeline apiUrl={apiUrl} token={token} serviceId={serviceId} environment={environment} />
          </section>
        </div>
      ) : null}

      {tab === 'observability' ? (
        <div className="sre-panel">
          <p className="form-section__copy">Each card is one saved monitor and one SLI percentage. Name the monitor after the endpoint or route. A query that sums every route is still one service SLI, not a list of URLs. Missing telemetry stays Unknown.</p>
          <section className="sre-cards sre-cards--watch" aria-label="Observability scorecards">
            {monitors.length ? monitors.map((monitor, index) => {
              const measurement = monitor.latest?.measurement;
              const state = !monitor.enabled ? 'disabled' : (measurement?.state || 'unknown');
              return (
                <article
                  key={monitor.id}
                  className={`sre-card is-${state} sre-card--tone-${index % 6}${trendMonitor?.id === monitor.id ? ' is-selected' : ''}`}
                  onClick={() => setTrendMonitorId(monitor.id)}
                >
                  <div className="sre-card__top">
                    <span>{monitor.name || measurementTypeLabel(monitor.measurement_type)}</span>
                    <em className="sre-card__state">{stateLabel(state)}</em>
                  </div>
                  <strong>{scoreDisplay(measurement)}</strong>
                  <small>{measurementTypeLabel(monitor.measurement_type)} · {formatBps(monitor.target_bps)} · {qualityLabel(measurement?.quality)}</small>
                  {measurement?.good != null && measurement?.total != null ? (
                    <small>Good {measurement.good} / total {measurement.total} over {measurement.window_minutes || monitor.window_minutes} min</small>
                  ) : null}
                  {measurement?.reason ? <p>{measurement.reason}</p> : null}
                  <button type="button" className="btn btn-secondary btn-sm" disabled={refreshing || !monitor.enabled} onClick={(event) => { event.stopPropagation(); void refresh([monitor.id]); }}>Refresh this monitor</button>
                </article>
              );
            }) : (
              <article className="sre-card is-unknown">
                <span>No monitors</span>
                <strong>Unknown</strong>
                <small>Add a monitor per endpoint you want as its own SLI percentage.</small>
                {isManager ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTab('configuration')}>Configure monitors</button> : null}
              </article>
            )}
            <article className={`sre-card is-${(score(availability)?.budget_remaining_bps ?? 10000) < 2000 ? 'at_risk' : score(availability)?.state || 'unknown'}`}>
              <div className="sre-card__top">
                <span>Error budget remaining</span>
                <em className="sre-card__state">{stateLabel(score(availability)?.state)}</em>
              </div>
              <strong>{budgetDisplay(score(availability))}</strong>
              <small>{availability ? `${availability.name} · ` : ''}Burn rate {score(availability)?.burn_rate_milli != null ? `${(Number(score(availability)?.burn_rate_milli) / 1000).toFixed(2)}x` : 'Unknown'}.</small>
            </article>
            <article className={`sre-card is-${openFindings.some((item) => item.severity === 'critical') ? 'breached' : openFindings.length ? 'at_risk' : 'unknown'}`}>
              <div className="sre-card__top">
                <span>Active findings</span>
                <em className="sre-card__state">{openFindings.some((item) => item.severity === 'critical') ? 'Critical' : openFindings.length ? 'Warning' : 'None recorded'}</em>
              </div>
              <strong>{loading ? '…' : openFindings.length}</strong>
              <small>{openFindings.length ? 'Open Critical and Warning items' : 'An empty list is not proof of health if nothing was evaluated.'}</small>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTab('findings')}>{openFindings.length ? 'Open findings' : 'View findings'}</button>
            </article>
          </section>
          <p className="sre-legend">Healthy is teal. At risk is amber. Breached is red. Unknown stays slate. The left stripe marks the endpoint.</p>
          {why ? (
            <details className="sre-why">
              <summary>Why this result?</summary>
              <p>{why.name}: numerator {why.numerator ?? 'Unknown'} / denominator {why.denominator ?? 'Unknown'} against {why.target} over {why.window} minutes. Coverage {why.coverage}. Query version {why.version}. This is the service availability monitor, not every endpoint. Query success alone does not mean coverage is adequate.</p>
            </details>
          ) : null}
          {history.length ? (
            <section className="portal-surface" aria-label="Recent availability trend">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Recent evaluations</h2>
                  <p className="portal-surface__subtitle">{trendMonitor?.name ? `${trendMonitor.name}. Click a card to change this trend. ` : ''}Missing points stay Unknown, not Healthy.</p>
                </div>
              </div>
              <div className="sre-spark" aria-hidden="true">
                {sparklineHeights([...history].reverse().map((item) => item.measurement?.availability_bps || 0)).map((height, index) => (
                  <i key={`${height}-${index}`} style={{ height: `${height}px` }} />
                ))}
              </div>
              <p className="form-section__copy">
                Current {scoreDisplay(history[0]?.measurement)}.
                {history[1]?.measurement
                  ? ` Previous window ${scoreDisplay(history[1].measurement)}.`
                  : ' No previous window yet.'}
                {' Missing points stay Unknown, not Healthy.'}
              </p>
            </section>
          ) : null}
          <p className="form-section__copy">{scheduleCopy === 'On-demand' ? 'Refresh evaluates saved queries on demand. A schedule is a worker interval, not 24/7 alerting, until a webhook or on-call policy is on.' : `${scheduleCopy}. This is a worker interval, not 24/7 alerting, until a webhook or on-call policy is on.`}</p>
          {isManager ? <button type="button" className="btn btn-secondary" onClick={() => { setTab('configuration'); onConfigure?.(); }}>Configure monitors</button> : null}
        </div>
      ) : null}

          {tab === 'findings' ? (
        <div className="sre-panel">
          <p className="form-section__copy">Monitor findings stay here. Dependency advisories are under Security → Global Vulnerabilities & Patches.</p>
          <p><Link href={`/security/vulnerabilities?tab=findings&service_id=${serviceId}`}>Open dependency findings</Link></p>
          <div className="sre-filter-bar">
            <label>Severity
              <select className="input" value={findingFilter.severity} onChange={(event) => setFindingFilter({ ...findingFilter, severity: event.target.value })}>
                <option value="">All</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </label>
            <label>Lifecycle
              <select className="input" value={findingFilter.lifecycle} onChange={(event) => setFindingFilter({ ...findingFilter, lifecycle: event.target.value })}>
                <option value="">All</option>
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label>Source
              <select className="input" value={findingFilter.source} onChange={(event) => setFindingFilter({ ...findingFilter, source: event.target.value })}>
                <option value="">All</option>
                {Array.from(new Set(findings.map((item) => item.source_type).filter(Boolean))).map((source) => (
                  <option key={source} value={source}>{source}</option>
                ))}
              </select>
            </label>
            <label>Monitor
              <select className="input" value={findingFilter.monitor} onChange={(event) => setFindingFilter({ ...findingFilter, monitor: event.target.value })}>
                <option value="">All</option>
                {monitors.map((monitor) => (
                  <option key={monitor.id} value={String(monitor.id)}>{monitor.name}</option>
                ))}
              </select>
            </label>
          </div>
          {episodes.length ? (
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Alert episodes</h2>
                </div>
              </div>
              <ul className="sre-monitor-list">
                {episodes.map((episode) => (
                  <li key={episode.id}>
                    <strong>{episode.severity === 'critical' ? 'Critical' : 'Warning'} · {episode.title || 'Alert'}</strong>
                    <span>{episode.status} · sequence {episode.sequence || 1}{episode.incident_id ? ` · incident ${episode.incident_id}` : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {!loading && findingsEmptyCopy ? (
            <div className="sre-empty">
              <strong>{findingsEmptyCopy}</strong>
              <p>An empty list is not proof of health if nothing was evaluated.</p>
            </div>
          ) : null}
          {!loading && !monitors.length ? (
            <div className="sre-empty">
              <strong>No monitors yet</strong>
              <p>Configuration is where monitors, connectors, and identity edits live. Observability refresh creates findings.</p>
              {isManager ? <button type="button" className="btn btn-secondary" onClick={() => setTab('configuration')}>Open configuration</button> : null}
            </div>
          ) : null}
          <ul className="sre-findings">
            {visibleFindings.map((finding) => (
              <li key={finding.id} className={`sre-finding-row${selectedFinding?.id === finding.id ? ' is-open' : ''}`}>
                <button type="button" className={`sre-finding is-${finding.lifecycle === 'resolved' ? 'resolved' : finding.severity}`} onClick={() => openFinding(finding)}>
                  <strong>{finding.severity === 'critical' ? 'Critical' : finding.severity === 'warning' ? 'Warning' : 'Info'} · {finding.title}</strong>
                  <span>{finding.observed}. {finding.expected}</span>
                  <small>{finding.lifecycle} · {monitors.find((item) => item.id === finding.monitor_id)?.name || finding.source_type || 'source unknown'} · {formatOperationalTime(finding.last_seen_at)}</small>
                </button>
                {finding.incident_id ? (
                  <Link className="sre-finding__incident" href={`/incidents/${finding.incident_id}/edit`}>{recordReference('INC', finding.incident_id)}</Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === 'configuration' ? (
        <div className="sre-config">
          {configurationLead}
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Monitors and queries</h2>
                <p className="portal-surface__subtitle">Credentials stay on the server. A dashboard URL is evidence, not an executable query.</p>
              </div>
              {isManager && !formOpen ? <button type="button" className="btn btn-primary" onClick={startAddMonitor}>Add monitor</button> : null}
            </div>
            {monitors.length ? (
              <ul className="sre-monitor-list">
                {monitors.map((monitor) => (
                  <li key={monitor.id}>
                    <strong>{monitor.name}</strong>
                    <span>{monitor.enabled ? 'Enabled' : 'Draft'} · {scheduleModeCopy(monitor.schedule_minutes)} · {monitor.measurement_type.replaceAll('_', ' ')} · version {monitor.current_version}{monitor.last_known_good_version ? ` · last known good ${monitor.last_known_good_version}` : ''}</span>
                    {isManager ? (
                      <div className="portal-page__actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEditMonitor(monitor)}>Edit</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void testMonitor(monitor)}>Test query</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void enableMonitor(monitor, !monitor.enabled)}>{monitor.enabled ? 'Disable' : 'Enable'}</button>
                        {monitor.last_known_good_version ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => void rollbackMonitor(monitor.id, monitor.last_known_good_version)}>Restore last known good</button> : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="sre-empty">
                <strong>No monitors yet</strong>
                <p>Add one monitor per endpoint you want as its own SLI percentage. Until a query runs, health stays Unknown.</p>
              </div>
            )}
            {isManager && formOpen ? (
              <form onSubmit={(event) => void saveMonitor(event)} className="sre-monitor-form">
                <h3>{editingMonitorId ? 'Edit monitor' : 'Add monitor'}</h3>
                <div className="sre-steps" aria-label="Monitor steps">
                  {['Basics', 'Query and mapping', 'Objectives and findings', 'Review'].map((label, index) => (
                    <span key={label} className={formStep === index + 1 ? 'is-active' : undefined}>{index + 1}. {label}</span>
                  ))}
                </div>
                {formStep === 1 ? (
                  <>
                    <label className="label">Monitor name<span className="form-req" aria-hidden="true"> *</span><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="Checkout /pay availability" /></label>
                    <p className="form-section__copy">Name it after the endpoint or route. Observability shows one SLI percentage per monitor.</p>
                    <label className="label">Measurement type
                      <select className="input" value={form.measurement_type} onChange={(event) => setForm({ ...form, measurement_type: event.target.value })}>
                        {MEASUREMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                    <label className="label">Connector
                      <select className="input" value={form.connector_id} onChange={(event) => setForm({ ...form, connector_id: Number(event.target.value) })}>
                        <option value={0}>Select a connector</option>
                        {connectors.filter((item) => item.enabled !== false || item.id === form.connector_id).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.source_type}{item.enabled === false ? ', disabled' : ''})</option>)}
                      </select>
                    </label>
                  </>
                ) : null}
                {formStep === 2 ? (
                  <>
                    <fieldset className="form-section">
                      <legend className="form-section__title">Starting templates</legend>
                      <div className="portal-page__actions">
                        {templates.map((template) => (
                          <button key={template.id} type="button" className="btn btn-secondary btn-sm" onClick={() => applyTemplate(template)}>{template.name}</button>
                        ))}
                      </div>
                    </fieldset>
                    <label className="label">Query<span className="form-req" aria-hidden="true"> *</span>
                      <textarea className="input" rows={8} value={form.query_text} onChange={(event) => setForm({ ...form, query_text: event.target.value })} />
                    </label>
                    <p className="form-section__copy">This query runs through an OpsTrellis worker. Credentials are stored securely on the server. Timeout is 15 seconds and results are bounded.</p>
                    <p className="form-section__copy">For one route, keep a path label such as {`{path="/pay"}`}. To roll several endpoints into one SLI, sum good and total across those routes instead of creating a combined card.</p>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void previewDraftQuery()}>Test query</button>
                    <div className="portal-form-grid">
                      <label className="label">Good events field<input className="input" value={form.good_field} onChange={(event) => setForm({ ...form, good_field: event.target.value })} /></label>
                      <label className="label">Total events field<input className="input" value={form.total_field} onChange={(event) => setForm({ ...form, total_field: event.target.value })} /></label>
                    </div>
                  </>
                ) : null}
                {formStep === 3 ? (
                  <div className="portal-form-grid">
                    <label className="label">Target (basis points, 9990 = 99.90%)<input className="input" type="number" value={form.target_bps} onChange={(event) => setForm({ ...form, target_bps: Number(event.target.value) })} /></label>
                    <label className="label">Window (minutes)<input className="input" type="number" value={form.window_minutes} onChange={(event) => setForm({ ...form, window_minutes: Number(event.target.value) })} /></label>
                    <label className="label">Minimum samples<input className="input" type="number" value={form.min_samples} onChange={(event) => setForm({ ...form, min_samples: Number(event.target.value) })} /></label>
                    <label className="label">Minimum coverage (bps)<input className="input" type="number" value={form.min_coverage_bps} onChange={(event) => setForm({ ...form, min_coverage_bps: Number(event.target.value) })} /></label>
                    <label className="label">Warning if remaining budget below %<input className="input" type="number" value={form.warning_below} onChange={(event) => setForm({ ...form, warning_below: Number(event.target.value) })} /></label>
                    <label className="label">Critical if remaining budget below %<input className="input" type="number" value={form.critical_below} onChange={(event) => setForm({ ...form, critical_below: Number(event.target.value) })} /></label>
                    <label className="label">Evaluate every N minutes (0 = on-demand only)<input className="input" type="number" min={0} value={form.schedule_minutes} onChange={(event) => setForm({ ...form, schedule_minutes: Number(event.target.value) })} /></label>
                    <p className="form-section__copy">A schedule runs the saved query on an OpsTrellis worker. It is not 24/7 alerting until a webhook or on-call policy is on. Missing data stays Unknown.</p>
                    <p className="form-section__copy">Rule preview is a local simulation. Critical wins when both rules match. Missing data is Unknown.</p>
                    <p>Healthy sample: {previewFindingRule(form.warning_below + 5, form.warning_below, form.critical_below)}. Warning sample: {previewFindingRule(form.warning_below - 1, form.warning_below, form.critical_below)}. Critical sample: {previewFindingRule(form.critical_below - 1, form.warning_below, form.critical_below)}. Missing data: {previewFindingRule(null, form.warning_below, form.critical_below)}.</p>
                  </div>
                ) : null}
                {formStep === 4 ? (
                  <div>
                    <p><strong>{form.name || 'Unnamed monitor'}</strong> · {form.measurement_type.replaceAll('_', ' ')}</p>
                    <p>Connector {connectors.find((item) => item.id === form.connector_id)?.name || 'not selected'}. Target {formatBps(form.target_bps)} over {form.window_minutes} minutes.</p>
                    <p>Critical wins if remaining budget is below {form.critical_below}%. Warning is below {form.warning_below}%.</p>
                    <p className="form-section__copy">{form.schedule_minutes > 0 ? `${scheduleModeCopy(form.schedule_minutes)}. This is a worker schedule, not 24/7 alerting, until a webhook or on-call policy is on.` : 'Refresh evaluates saved queries on demand. Continuous alerting needs a schedule or an alert integration.'}</p>
                  </div>
                ) : null}
                {formStep === 4 ? <label className="label"><input type="checkbox" checked={form.enable} onChange={(event) => setForm({ ...form, enable: event.target.checked })} /> Save and enable for {form.schedule_minutes > 0 ? 'scheduled evaluation' : 'on-demand refresh'}</label> : null}
                <div className="portal-form-actions">
                  {formStep > 1 ? <button type="button" className="btn btn-secondary" onClick={() => setFormStep(formStep - 1)}>Back</button> : null}
                  {formStep < 4 ? <button type="button" className="btn btn-primary" onClick={() => setFormStep(formStep + 1)}>Next</button> : <button type="submit" className="btn btn-primary">{form.enable ? 'Save and enable' : 'Save draft'}</button>}
                  <button type="button" className="btn btn-secondary" onClick={() => { setFormOpen(false); setFormStep(1); setEditingMonitorId(0); setForm(EMPTY_MONITOR_FORM); }}>Cancel</button>
                </div>
              </form>
            ) : !isManager ? <p className="form-section__copy">You can view configuration. Editing monitors needs a manager role.</p> : null}
            {versionDiff.length ? (
              <div>
                <h3>Query versions</h3>
                <ul>
                  {versionDiff.map((item) => <li key={item}>{item}</li>)}
                </ul>
                {isManager && versions.length > 1 && versionMonitorId ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void rollbackMonitor(versionMonitorId, versions[1].version)}>
                    Restore previous version {versions[1].version}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Connectors</h2>
                <p className="portal-surface__subtitle">Secret values stay in environment variables. This form only stores the variable name.</p>
              </div>
              {isManager && !connectorOpen ? <button type="button" className="btn btn-primary" onClick={startAddConnector}>Add connector</button> : null}
            </div>
            {connectors.length ? connectors.map((item) => (
              <div key={item.id} className="sre-connector">
                <p>{item.name} · {item.source_type} · {item.enabled === false ? 'Disabled' : item.status} · {item.has_credential ? 'credential on file' : 'no credential'}</p>
                {isManager ? (
                  <div className="portal-page__actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEditConnector(item)}>Edit</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void testConnector(item)}>Test connector</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void setConnectorEnabled(item, item.enabled === false)}>{item.enabled === false ? 'Enable' : 'Disable'}</button>
                  </div>
                ) : null}
              </div>
            )) : (
              <div className="sre-empty">
                <strong>No connectors yet</strong>
                <p>Choose a source with Add connector. Pilot fixture evaluates known counts without sending secrets to the browser.</p>
              </div>
            )}
            {isManager && connectorOpen ? (
              <form onSubmit={(event) => void saveConnector(event)} className="sre-monitor-form">
                <h3>{editingConnectorId ? 'Edit connector' : 'Add connector'}</h3>
                <p className="form-section__copy">Pick a source, then enter the environment variable name that holds the credential. The secret itself never belongs in this form or in tickets.</p>
                <div className="sre-source-pick" role="group" aria-label="Connector source">
                  {CONNECTOR_SOURCES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={connectorForm.source_type === item.value ? 'is-active' : undefined}
                      onClick={() => setConnectorForm({
                        ...connectorForm,
                        source_type: item.value,
                        name: connectorForm.name || (item.value === 'fixture' ? 'Pilot fixture' : item.label),
                      })}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <label className="label">Name<span className="form-req" aria-hidden="true"> *</span><input className="input" value={connectorForm.name} onChange={(event) => setConnectorForm({ ...connectorForm, name: event.target.value })} required /></label>
                {connectorForm.source_type !== 'fixture' ? (
                  <>
                    <label className="label">Base URL<input className="input" value={connectorForm.base_url} onChange={(event) => setConnectorForm({ ...connectorForm, base_url: event.target.value })} placeholder="https://metrics.example.internal" /></label>
                    <label className="label">Secret reference name{editingConnectorId ? '' : <span className="form-req" aria-hidden="true"> *</span>}<input className="input" value={connectorForm.secret_ref} onChange={(event) => setConnectorForm({ ...connectorForm, secret_ref: event.target.value.toUpperCase() })} placeholder={editingConnectorId ? 'Leave blank to keep the stored reference' : secretRefPlaceholder(connectorForm.source_type)} /></label>
                  </>
                ) : <p className="form-section__copy">Pilot fixture does not store a credential. It returns known counts for on-demand evaluation.</p>}
                {connectorForm.source_type === 'grafana' ? (
                  <label className="label">Grafana datasource UID<input className="input" value={connectorForm.grafana_datasource_uid} onChange={(event) => setConnectorForm({ ...connectorForm, grafana_datasource_uid: event.target.value })} /></label>
                ) : null}
                {connectorForm.source_type !== 'fixture' ? (
                  <label className="label">Ingestion delay (minutes)<input className="input" type="number" value={connectorForm.ingest_delay_minutes} onChange={(event) => setConnectorForm({ ...connectorForm, ingest_delay_minutes: Number(event.target.value) })} /></label>
                ) : null}
                {connectorForm.source_type === 'private' ? (
                  <p className="form-section__copy">Private samples are HMAC-signed pushes from workers/. Use GRAFANA_TOKEN for Grafana, SPLUNK_TOKEN for Splunk, and PRIVATE_SAMPLE_SECRET for the OpsTrellis push. They are not a public scrape.</p>
                ) : null}
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary">Save connector</button>
                  <button type="button" className="btn btn-secondary" onClick={() => { setConnectorOpen(false); setConnectorForm(EMPTY_CONNECTOR_FORM); setEditingConnectorId(0); }}>Cancel</button>
                </div>
              </form>
            ) : !isManager ? <p className="form-section__copy">You can view connectors. Adding one needs a manager role.</p> : null}
          </section>
          {isManager ? (
            <>
              {!routingOpen && !guardrailOpen ? (
                <div className="portal-page__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setRoutingOpen(true)}>Alert routing</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setGuardrailOpen(true)}>Release guardrail</button>
                </div>
              ) : null}
              {routingOpen ? (
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <h2 className="portal-surface__title">Alert routing</h2>
                    <p className="portal-surface__subtitle">Manual findings stay observation-only until you enable incident creation. Existing alert webhooks still record incidents on their own path.</p>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => setRoutingOpen(false)}>Close</button>
                </div>
                <label className="label"><input type="checkbox" checked={routing.observation_only} onChange={(event) => setRouting({ ...routing, observation_only: event.target.checked })} /> Observation only</label>
                <label className="label"><input type="checkbox" checked={routing.create_incidents} onChange={(event) => setRouting({ ...routing, create_incidents: event.target.checked })} /> Create incidents from monitoring alerts</label>
                <label className="label"><input type="checkbox" checked={routing.page_oncall} onChange={(event) => setRouting({ ...routing, page_oncall: event.target.checked })} /> Page on-call when an incident is created</label>
                <p className="form-section__copy">Page on-call is stored with this routing policy. It is not a live pager until an on-call integration is on.</p>
                <button type="button" className="btn btn-secondary" onClick={() => {
                  void fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/routing`), {
                    method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ ...routing, environment }),
                  }).then(() => setNotice(routing.page_oncall ? 'Routing policy saved. Page on-call is stored with this policy.' : 'Routing policy saved.'));
                }}>Save routing</button>
              </section>
              ) : null}
              {guardrailOpen ? (
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <h2 className="portal-surface__title">Release guardrail</h2>
                    <p className="portal-surface__subtitle">Observation records what would have happened. Enforced mode can block a change webhook for this service after a manager enables it.</p>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => setGuardrailOpen(false)}>Close</button>
                </div>
                <label className="label">Mode
                  <select className="input" value={guardrail.mode} onChange={(event) => setGuardrail({ ...guardrail, mode: event.target.value })}>
                    <option value="observation">Observation</option>
                    <option value="enforced">Enforced</option>
                  </select>
                </label>
                <label className="label">Minimum remaining budget (bps)<input className="input" type="number" value={guardrail.min_budget_bps} onChange={(event) => setGuardrail({ ...guardrail, min_budget_bps: Number(event.target.value) })} /></label>
                <button type="button" className="btn btn-secondary" onClick={() => {
                  void fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/guardrail`), {
                    method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ ...guardrail, environment }),
                  }).then(() => setNotice(guardrail.mode === 'enforced' ? 'Guardrail is enforced for this service and environment.' : 'Guardrail stays observation-only.'));
                }}>Save guardrail</button>
                {guardrailDecision ? (
                  <p className="form-section__copy">{guardrailDecision.mode === 'enforced' ? 'Enforced' : 'Observation'} preview: {guardrailDecision.outcome || 'unknown'}. {guardrailDecision.reason}{guardrailDecision.artifact_sha ? ` Artifact ${guardrailDecision.artifact_sha.slice(0, 12)}.` : ''}{guardrailDecision.expires_at ? ` Expires ${formatOperationalTime(guardrailDecision.expires_at)}.` : ''}</p>
                ) : null}
                {guardrailDecision?.id && guardrail.mode === 'enforced' ? (
                  <>
                    <label className="label">Override reason<textarea className="input" rows={3} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>
                    <button type="button" className="btn btn-secondary" onClick={() => {
                      void fetch(buildPortalApiUrl(apiUrl, `/api/devops/monitoring/guardrail-decisions/${guardrailDecision.id}`), {
                        method: 'POST', headers: authHeaders(token), body: JSON.stringify({ reason: overrideReason }),
                      }).then(async (res) => {
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(data.error || 'Override failed');
                        setNotice('Time-limited override recorded. It is bound to the artifact and expires.');
                      }).catch((err) => setError(err instanceof Error ? err.message : 'Override failed'));
                    }}>Record emergency override</button>
                  </>
                ) : null}
                <button type="button" className="btn btn-secondary" onClick={() => void simulatePolicy()}>Simulate policy on history</button>
                {simulation ? <p className="form-section__copy">{simulation}</p> : null}
              </section>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <InspectorDrawer
        open={Boolean(selectedFinding)}
        onClose={closeFinding}
        resetKey={selectedFinding?.id}
        label="Finding detail"
        eyebrow={selectedFinding ? `${selectedFinding.severity} · ${selectedFinding.lifecycle}` : 'Finding'}
        title={selectedFinding?.title || 'Finding'}
        footer={selectedFinding && selectedFinding.lifecycle !== 'resolved' ? (
          <div className="portal-page__actions">
            {selectedFinding.lifecycle !== 'acknowledged' ? <button type="button" className="btn btn-secondary" onClick={() => void ackFinding(selectedFinding)}>Acknowledge</button> : null}
            <button type="button" className="btn btn-secondary" onClick={() => void resolveFinding(selectedFinding)}>Resolve</button>
          </div>
        ) : null}
      >
        {selectedFinding ? (
          <div className="portal-stack">
            <p><strong>What happened.</strong> {selectedFinding.explanation || 'No additional explanation.'}</p>
            <p>Observed: {selectedFinding.observed}</p>
            <p>Expected: {selectedFinding.expected}</p>
            {evidenceUrl ? <p><a href={evidenceUrl} target="_blank" rel="noreferrer">View evidence</a> A dashboard URL is evidence, not an executable query.</p> : null}
            {selectedFinding.incident_id ? <p>Linked incident: <Link href={`/incidents/${selectedFinding.incident_id}/edit`}>{recordReference('INC', selectedFinding.incident_id)}</Link></p> : (
              <>
                {routing.observation_only ? <p className="form-section__copy">Routing is observation-only. Auto-create stays off. You can still open a new incident from this finding.</p> : null}
                <p><Link className="btn btn-secondary btn-sm" href={findingIncidentHref(selectedFinding)}>Create incident</Link></p>
              </>
            )}
            {changes.length ? (
              <div>
                <p>Overlapping changes are a possible lead, not a proven cause.</p>
                <ul>
                  {changes.map((change) => (
                    <li key={change.id}>
                      <Link href={`/changes/${change.id}`}>{change.change_number || `CHG${String(change.id).padStart(7, '0')}`}</Link>
                      {change.title ? ` · ${change.title}` : ''}
                      {change.created_at ? ` · ${formatOperationalTime(change.created_at)}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p>No overlapping changes in the last 30 days.</p>}
            <label className="label">Owner<input className="input" value={findingOwner} onChange={(event) => setFindingOwner(event.target.value)} placeholder="Investigation owner" /></label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
              void fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${serviceId}/monitoring/findings/${selectedFinding.id}`), {
                method: 'PATCH',
                headers: authHeaders(token),
                body: JSON.stringify({ owner: findingOwner }),
              }).then(() => { setNotice('Owner recorded. Severity is unchanged.'); load(); });
            }}>Assign owner</button>
            <p>Acknowledgement records the owner and time. It does not change severity or claim recovery.</p>
          </div>
        ) : null}
      </InspectorDrawer>
    </div>
  );
}

export function ServiceClassBadge({ value }: { value?: string }) {
  const normalized = SERVICE_CLASSES.some((item) => item.value === value) ? value : 'unclassified';
  return <span className={`sre-class sre-class--${normalized}`}>{serviceClassLabel(normalized)}</span>;
}
