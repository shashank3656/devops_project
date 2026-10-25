import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BulkBar, CopyButton, DataTable, EmptyState, formatOperationalTime, type DataTableColumn, type RowKey } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { downloadCSV } from '../../lib/csv';
import { accessLabel, asRows, canManageVulnWorkspace, collectionModeLabel, downloadJSONFile, epssLabel, findingIsClosed, isInternetAdvisoryMatch, lifecycleLabel, matchSourceLabel, patchLabel, queryText, reachabilityLabel, scanJobIds, sessionCanManageVulnWorkspace, severityBadge, severityLabel, usageLabel, vulnRequest, vulnTab, VULN_TABS, type VulnTab } from '../../lib/securityVuln';
import { useWorkspaceScope } from '../../shared-ui/useWorkspaceScope';

type Overview = {
  critical_findings?: number;
  high_findings?: number;
  affected_services?: number;
  registered_services?: number;
  scanned_repositories?: number;
  kev_matches?: number;
  overdue?: number;
  intelligence_synced_at?: string;
  intel_new_matches?: number;
  intel_repos_assessed?: number;
  intel_open_matches?: number;
  unscanned_repositories?: number;
  github_token_configured?: boolean;
  count_note?: string;
};

type ServiceRow = {
  service_id: number;
  service: string;
  repository: string;
  project_name?: string;
  team?: string;
  technologies?: string[];
  critical_findings: number;
  high_findings: number;
  patch_readiness: string;
  coverage: string;
  last_scan_at?: string;
};

type AdvisoryRow = {
  id: number;
  canonical_id: string;
  title: string;
  severity: string;
  ecosystem?: string;
  package_name?: string;
  first_fixed_version?: string;
  kev: boolean;
  epss?: number;
  fetched_at?: string;
  withdrawn: boolean;
  affected_services: number;
  count_note?: string;
  source_url?: string;
};

type FindingRow = {
  id: number;
  repository: string;
  service?: string;
  canonical_id: string;
  title: string;
  severity: string;
  priority: string;
  lifecycle: string;
  patch_state: string;
  package_name: string;
  installed_version: string;
  first_fixed_version?: string;
  parent_package?: string;
  owner?: string;
  kev: boolean;
  due_at?: string;
  last_seen_at?: string;
  service_id?: number;
  reachability?: string;
  match_source?: string;
  last_scan_id?: number;
  direct?: boolean;
  dev?: boolean;
  epss?: number;
  epss_percentile?: number;
  overdue?: boolean;
  path?: string;
};

type ScanRow = {
  id: number;
  state: string;
  stage: string;
  repository: string;
  commit_sha?: string;
  error?: string;
  discovered_modules: number;
  assessed_modules: number;
  finding_count?: number;
  coverage?: { path?: string; reason?: string }[];
  coverage_note?: string;
  created_at?: string;
  finished_at?: string;
};

type ScanEvent = { stage: string; detail: string; created_at: string };
type ScanFinding = { id: number; canonical_id: string; severity: string; package_name: string; installed_version: string; lifecycle: string; confidence: string };
type ScanDiff = {
  current_id?: number;
  previous_id?: number;
  repository?: string;
  note?: string;
  added?: ScanFinding[];
  still_open?: ScanFinding[];
  gone?: ScanFinding[];
};

type PlanRow = {
  id: number;
  repository: string;
  package_name: string;
  current_version: string;
  target_version: string;
  action: string;
  status: string;
  label: string;
  estimated: boolean;
};

type SourceRow = {
  provider: string;
  status: string;
  enabled: boolean;
  last_success_at?: string;
  last_error?: string;
};

type AgentRow = { id: number; name: string; status: string; version?: string; last_heartbeat_at?: string };
type CampaignOccurrence = { finding_id: number; repository: string; package_name: string; installed_version?: string; direct?: boolean; dev?: boolean; owner?: string; due_at?: string; plan_id?: number };
type CampaignRow = { canonical_id: string; title: string; severity: string; count: number; services?: string[]; occurrences?: CampaignOccurrence[] };
type RepoAccess = { repository: string; access_state?: string; access_detail?: string; collection_mode?: string };
type ComparisonRow = { id: number; pr_number: number; repository: string; state: string; coverage: string; introduced_critical: number; introduced_high: number; removed_count: number; note?: string; compare_source?: string; enforce_pr_gate?: boolean };
type NewDepRow = { repository: string; ecosystem: string; package_name: string; version: string; note?: string };
type RepoConfig = {
  id: number;
  repository: string;
  provider?: string;
  collection_mode: string;
  owner_team?: string;
  schedule_minutes: number;
  alert_min_severity: string;
  allow_fork_prs: boolean;
  enforce_pr_gate?: boolean;
  exclusions?: string;
  branch: string;
  access_state?: string;
  access_detail?: string;
  last_scheduled_at?: string;
  stale?: boolean;
  stale_reason?: string;
  stale_after_days?: number;
  last_inventory_at?: string;
  inventory_age_days?: number;
  last_scan_state?: string;
  enabled?: boolean;
};

function known(value?: string): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

export default function GlobalVulnerabilitiesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const { scope } = useWorkspaceScope();
  const tab = router.isReady ? vulnTab(router.query.tab) : 'services';
  const projectId = router.isReady ? queryText(router.query.project_id) || scope.projectId : '';
  const serviceId = router.isReady ? queryText(router.query.service_id) : '';
  const [overview, setOverview] = useState<Overview>({});
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [advisories, setAdvisories] = useState<AdvisoryRow[]>([]);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonRow[]>([]);
  const [newDeps, setNewDeps] = useState<NewDepRow[]>([]);
  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [hosted, setHosted] = useState(false);
  const [hostedNote, setHostedNote] = useState('');
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isManager, setIsManager] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [bootstrap, setBootstrap] = useState('');
  const [sbomRepo, setSbomRepo] = useState('');
  const [sbomCommit, setSbomCommit] = useState('');
  const [sbomText, setSbomText] = useState('');
  const [prRepo, setPrRepo] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [kevOnly, setKevOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [intelOnly, setIntelOnly] = useState(false);
  const [teamFilter, setTeamFilter] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [patchFilter, setPatchFilter] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');
  const [newRepo, setNewRepo] = useState('');
  const [newRepoBranch, setNewRepoBranch] = useState('main');
  const [scanTargetRepo, setScanTargetRepo] = useState('');
  const [selectedScanId, setSelectedScanId] = useState(0);
  const [scanDetail, setScanDetail] = useState<ScanRow | null>(null);
  const [scanLog, setScanLog] = useState<ScanEvent[]>([]);
  const [scanFindings, setScanFindings] = useState<ScanFinding[]>([]);
  const [scanDiff, setScanDiff] = useState<ScanDiff | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [compareDetail, setCompareDetail] = useState<{ id: number; items: { classification: string; canonical_id: string; package_name: string; severity: string; base_version?: string; head_version?: string }[] } | null>(null);
  const [repoFilter, setRepoFilter] = useState('');
  const [latestScanOnly, setLatestScanOnly] = useState(false);
  const [hideDevDeps, setHideDevDeps] = useState(false);
  const [reachFilter, setReachFilter] = useState('');
  const [watchScanIds, setWatchScanIds] = useState<number[]>([]);
  const [findingSelected, setFindingSelected] = useState<Set<RowKey>>(new Set());
  const [assignOwner, setAssignOwner] = useState('');
  const [assignDue, setAssignDue] = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkExpires, setBulkExpires] = useState('');
  const viewReady = useRef(false);
  const [campaignDetail, setCampaignDetail] = useState<CampaignRow | null>(null);
  const [repoAccess, setRepoAccess] = useState<RepoAccess[]>([]);
  const [deployService, setDeployService] = useState('');
  const [deployEnv, setDeployEnv] = useState('production');
  const [deployDigest, setDeployDigest] = useState('');
  const [deployCommitSha, setDeployCommitSha] = useState('');
  const [deploySbom, setDeploySbom] = useState('');

  useEffect(() => {
    setIsManager(sessionCanManageVulnWorkspace());
  }, []);

  const setTab = (next: VulnTab) => {
    const { tab: _tab, ...rest } = router.query;
    const query = next === 'services' ? rest : { ...rest, tab: next };
    void router.replace({ pathname: '/security/vulnerabilities', query }, undefined, { shallow: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (serviceId) params.set('service_id', serviceId);
    const projectQuery = params.toString() ? `?${params.toString()}` : '';
    const findingParams = new URLSearchParams(params);
    if (lifecycleFilter) findingParams.set('lifecycle', lifecycleFilter);
    if (overdueOnly) findingParams.set('overdue', '1');
    const findingQuery = findingParams.toString() ? `?${findingParams.toString()}` : '';
    const probe = tab === 'configuration' || tab === 'sources' ? '?probe=1' : '';
    const [overviewRes, serviceRes, advisoryRes, findingRes, scanRes, planRes, sourceRes, campaignRes, compareRes, depRes, repoRes, meRes] = await Promise.all([
      vulnRequest(apiUrl, '/api/devops/security/overview'),
      vulnRequest(apiUrl, `/api/devops/security/services${projectQuery}`),
      vulnRequest(apiUrl, '/api/devops/security/advisories?severity=all'),
      vulnRequest(apiUrl, `/api/devops/security/findings${findingQuery}`),
      vulnRequest(apiUrl, '/api/devops/security/scans'),
      vulnRequest(apiUrl, '/api/devops/security/plans'),
      vulnRequest(apiUrl, `/api/devops/security/sources${probe}`),
      vulnRequest(apiUrl, '/api/devops/security/campaigns'),
      vulnRequest(apiUrl, '/api/devops/security/pr-comparisons'),
      vulnRequest(apiUrl, '/api/devops/security/new-dependencies'),
      vulnRequest(apiUrl, `/api/devops/security/repositories${probe}`),
      vulnRequest(apiUrl, '/api/devops/me'),
    ]);
    if (overviewRes.status !== 200) {
      setError(typeof overviewRes.body.error === 'string' ? overviewRes.body.error : 'This workspace could not be loaded.');
      setLoading(false);
      return;
    }
    setOverview(overviewRes.body as Overview);
    setServices(asRows<ServiceRow>(serviceRes.body.services));
    setAdvisories(asRows<AdvisoryRow>(advisoryRes.body.advisories));
    setFindings(asRows<FindingRow>(findingRes.body.findings));
    setScans(asRows<ScanRow>(scanRes.body.scans));
    setPlans(asRows<PlanRow>(planRes.body.plans));
    setSources(asRows<SourceRow>(sourceRes.body.sources));
    setAgents(asRows<AgentRow>(sourceRes.body.private_agents));
    setCampaigns(asRows<CampaignRow>(campaignRes.body.campaigns));
    setComparisons(asRows<ComparisonRow>(compareRes.body.comparisons));
    setNewDeps(asRows<NewDepRow>(depRes.body.dependencies));
    setRepos(asRows<RepoConfig>(repoRes.body.repositories));
    setHosted(Boolean(sourceRes.body.hosted_collector));
    setHostedNote(typeof sourceRes.body.hosted_collector_note === 'string' ? sourceRes.body.hosted_collector_note : '');
    setRepoAccess(asRows<RepoAccess>(sourceRes.body.repository_access));
    setIsManager(canManageVulnWorkspace(meRes.body) || sessionCanManageVulnWorkspace());
    setLoading(false);
  }, [apiUrl, lifecycleFilter, overdueOnly, projectId, serviceId, tab]);

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [load, router.isReady]);

  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;
    void (async () => {
      const result = await vulnRequest(apiUrl, '/api/devops/security/findings/view');
      if (cancelled || result.status !== 200) {
        viewReady.current = true;
        return;
      }
      const filters = result.body.filters && typeof result.body.filters === 'object' && !Array.isArray(result.body.filters)
        ? result.body.filters as Record<string, unknown>
        : {};
      if (typeof filters.severity === 'string') setSeverity(filters.severity);
      if (typeof filters.lifecycle === 'string') setLifecycleFilter(filters.lifecycle);
      if (typeof filters.repository === 'string') setRepoFilter(filters.repository);
      if (typeof filters.patch_state === 'string') setPatchFilter(filters.patch_state);
      if (typeof filters.reachability === 'string') setReachFilter(filters.reachability);
      if (typeof filters.unassigned_only === 'boolean') setUnassignedOnly(filters.unassigned_only);
      if (typeof filters.intel_only === 'boolean') setIntelOnly(filters.intel_only);
      if (typeof filters.hide_dev === 'boolean') setHideDevDeps(filters.hide_dev);
      if (typeof filters.overdue_only === 'boolean') setOverdueOnly(filters.overdue_only);
      viewReady.current = true;
    })();
    return () => { cancelled = true; };
  }, [apiUrl, router.isReady]);

  useEffect(() => {
    if (!viewReady.current) return;
    const timer = window.setTimeout(() => {
      void vulnRequest(apiUrl, '/api/devops/security/findings/view', 'PUT', {
        severity, lifecycle: lifecycleFilter, repository: repoFilter, patch_state: patchFilter,
        reachability: reachFilter, unassigned_only: unassignedOnly, intel_only: intelOnly,
        hide_dev: hideDevDeps, overdue_only: overdueOnly,
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [apiUrl, hideDevDeps, intelOnly, lifecycleFilter, overdueOnly, patchFilter, reachFilter, repoFilter, severity, unassignedOnly]);

  const loadScanDetail = useCallback(async (id: number) => {
    if (!id) {
      setScanDetail(null);
      setScanLog([]);
      setScanFindings([]);
      setScanDiff(null);
      return;
    }
    const result = await vulnRequest(apiUrl, `/api/devops/security/scans/${id}`);
    if (result.status !== 200) {
      return;
    }
    setScanDetail((result.body.scan || null) as ScanRow | null);
    setScanLog(asRows<ScanEvent>(result.body.log));
    setScanFindings(asRows<ScanFinding>(result.body.findings));
    setScanDiff((result.body.diff || null) as ScanDiff | null);
  }, [apiUrl]);

  useEffect(() => {
    if (tab !== 'history') return;
    if (!selectedScanId && scans.length) {
      setSelectedScanId(scans[0].id);
      return;
    }
    if (selectedScanId) void loadScanDetail(selectedScanId);
  }, [loadScanDetail, scans, selectedScanId, tab]);

  useEffect(() => {
    const active = scans.some((item) => item.state === 'queued' || item.state === 'running') || watchScanIds.length > 0;
    if (!active) return;
    if (tab !== 'history' && watchScanIds.length === 0) return;
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(timer);
  }, [load, scans, tab, watchScanIds]);

  useEffect(() => {
    if (!watchScanIds.length) return;
    const watched = watchScanIds.map((id) => scans.find((item) => item.id === id)).filter((item): item is ScanRow => Boolean(item));
    if (!watched.length) return;
    if (watched.some((item) => item.state === 'queued' || item.state === 'running')) return;
    const failed = watched.filter((item) => item.state === 'failed');
    const cancelled = watched.filter((item) => item.state === 'cancelled');
    const ok = watched.filter((item) => item.state !== 'failed' && item.state !== 'cancelled');
    const repos = Array.from(new Set(ok.map((item) => item.repository).filter(Boolean)));
    setWatchScanIds([]);
    setLatestScanOnly(false);
    if (!ok.length) {
      if (cancelled.length && !failed.length) {
        setNotice(`Scan #${cancelled[0].id} cancelled. History and open findings were kept. This is not Fixed.`);
        return;
      }
      setNotice(failed[0] ? `Scan #${failed[0].id} failed${failed[0].error ? `: ${failed[0].error}` : ''}. Stay on History for the log.` : 'Queued scans finished without stored findings.');
      return;
    }
    if (repos.length === 1) setRepoFilter(repos[0]);
    else setRepoFilter('');
    setTab('findings');
    setNotice(
      repos.length > 1
        ? `${ok.length} scans finished. Open findings from those repositories are listed together; closed findings stay off this list.`
        : `Scan for ${repos[0]} finished. New matches were added; open findings were kept.`,
    );
  }, [scans, watchScanIds]);

  useEffect(() => {
    if (scanTargetRepo || !repos.length) return;
    setScanTargetRepo(String(repos[repos.length - 1].id));
  }, [repos, scanTargetRepo]);

  const showScorecards = tab === 'services' || tab === 'advisories' || tab === 'findings' || tab === 'remediation' || tab === 'campaigns';
  const teams = useMemo(() => Array.from(new Set(services.map((item) => item.team).filter((item): item is string => Boolean(item)))), [services]);
  const technologies = useMemo(() => Array.from(new Set(services.flatMap((item) => item.technologies || []))), [services]);

  const visibleServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((item) => {
      if (severity === 'critical' && item.critical_findings <= 0) return false;
      if (severity === 'high' && item.high_findings <= 0) return false;
      if (teamFilter && item.team !== teamFilter) return false;
      if (techFilter && !(item.technologies || []).includes(techFilter)) return false;
      if (patchFilter === 'fix_available' && !(item.patch_readiness || '').toLowerCase().includes('candidate')) return false;
      if (patchFilter === 'no_known_fix' && !(item.patch_readiness || '').toLowerCase().includes('no action')) return false;
      if (!q) return true;
      return `${item.service} ${item.repository} ${item.team || ''} ${(item.technologies || []).join(' ')}`.toLowerCase().includes(q);
    });
  }, [patchFilter, search, services, severity, teamFilter, techFilter]);

  const visibleAdvisories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return advisories.filter((item) => {
      if (severity && item.severity !== severity) return false;
      if (kevOnly && !item.kev) return false;
      if (!q) return true;
      return `${item.canonical_id} ${item.title} ${item.package_name || ''}`.toLowerCase().includes(q);
    });
  }, [advisories, kevOnly, search, severity]);

  const visibleFindings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((item) => {
      if (severity && item.severity !== severity) return false;
      if (unassignedOnly && (item.owner || '').trim()) return false;
      if (intelOnly && !isInternetAdvisoryMatch(item.match_source)) return false;
      if (repoFilter && item.repository !== repoFilter) return false;
      const focusScanId = selectedScanId || scans[0]?.id || 0;
      if (latestScanOnly && focusScanId && item.last_scan_id !== focusScanId) return false;
      if (hideDevDeps && item.dev) return false;
      if (overdueOnly && !item.overdue) return false;
      if (reachFilter && (item.reachability || 'unknown') !== reachFilter) return false;
      if (!lifecycleFilter && findingIsClosed(item.lifecycle)) return false;
      if (lifecycleFilter && item.lifecycle !== lifecycleFilter) return false;
      if (patchFilter && item.patch_state !== patchFilter) return false;
      if (teamFilter && !`${item.service || ''} ${item.repository}`.toLowerCase().includes(teamFilter.toLowerCase())) return false;
      if (!q) return true;
      return `${item.canonical_id} ${item.package_name} ${item.repository} ${item.service || ''} ${item.owner || ''}`.toLowerCase().includes(q);
    });
  }, [findings, hideDevDeps, intelOnly, latestScanOnly, lifecycleFilter, overdueOnly, patchFilter, reachFilter, repoFilter, scans, search, selectedScanId, severity, teamFilter, unassignedOnly]);

  const findingRepos = useMemo(
    () => Array.from(new Set([...findings.map((item) => item.repository), ...repos.map((item) => item.repository)].filter(Boolean))).sort(),
    [findings, repos],
  );

  function findingsEmptyBody() {
    const latest = scans[0];
    if (latest && latest.state === 'failed') {
      return `Latest scan #${latest.id} for ${latest.repository} failed${latest.error ? `: ${latest.error}` : ''}. Internet advisory matches need a stored lockfile. Open History and read that job’s Scan log.`;
    }
    if (intelOnly) {
      return 'A public advisory becomes a finding only after it matches a stored lockfile for a registered repository. Scan-origin package matches are included here.';
    }
    return 'Open findings stay listed until they are closed. A finished scan is not a clean bill of health. Open History for that job’s results and log.';
  }

  async function scanSelected() {
    if (!selected.length) {
      setError('Select at least one service.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/scans', 'POST', { service_ids: selected });
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The scan could not be queued.');
      return;
    }
    const ids = scanJobIds(result.body);
    setNotice(ids.length > 1
      ? `${ids.length} scans queued for different repositories. History stays on these jobs until they finish, then Findings lists every open match.`
      : 'Scan queued. History will stay on this job until it finishes.');
    setSelected([]);
    if (ids.length) {
      setSelectedScanId(ids[0]);
      setWatchScanIds(ids);
    }
    setTab('history');
    void load();
  }

  async function scanRepositories(ids: number[]) {
    const repoIds = ids.filter((id) => id > 0);
    if (!repoIds.length) {
      setError('Select a registered repository.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/scans', 'POST', {
      repository_ids: repoIds,
      ...(projectId ? { project_id: Number(projectId) } : {}),
    });
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The scan could not be queued.');
      return;
    }
    const jobIds = scanJobIds(result.body);
    setNotice(jobIds.length > 1
      ? `${jobIds.length} scans queued. New matches are added; the same package and advisory is not duplicated.`
      : 'Scan queued. History will stay on this job until it finishes, then Findings opens for that repository.');
    if (jobIds.length) {
      setSelectedScanId(jobIds[0]);
      setWatchScanIds(jobIds);
    }
    setTab('history');
    void load();
  }

  async function refreshIntelligence() {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/intelligence/sync', 'POST', {});
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Intelligence sync could not start.');
      return;
    }
    setNotice('Intelligence sync queued. New public advisories will be matched against stored lockfiles; the browser does not fetch feeds.');
  }

  async function enrollAgent() {
    if (!agentName.trim()) {
      setError('Agent name is required.');
      return;
    }
    setBusy(true);
    const result = await vulnRequest(apiUrl, '/api/devops/security/agents', 'POST', { name: agentName.trim() });
    setBusy(false);
    if (result.status !== 201) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The agent could not be enrolled.');
      return;
    }
    setBootstrap(typeof result.body.bootstrap_token === 'string' ? result.body.bootstrap_token : '');
    setNotice('Bootstrap token is shown once. The API stores only a hash.');
    setAgentName('');
    void load();
  }

  async function uploadSbom() {
    const repoId = Number(sbomRepo);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(sbomText);
    } catch {
      setError('SBOM must be JSON.');
      return;
    }
    setBusy(true);
    const result = await vulnRequest(apiUrl, '/api/devops/security/inventories', 'POST', {
      repository_id: repoId, commit_sha: sbomCommit.trim(), sbom: parsed,
    });
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The inventory could not be accepted.');
      return;
    }
    setNotice('Inventory accepted. CycloneDX, SPDX, and SARIF with package identity correlate like a hosted scan. Results without a package are skipped. Images are not pulled.');
    void load();
  }

  async function comparePr() {
    setBusy(true);
    const result = await vulnRequest(apiUrl, '/api/devops/security/pr-comparisons', 'POST', {
      repository_id: Number(prRepo), pr_number: Number(prNumber),
    });
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The pull request could not be compared.');
      return;
    }
    setNotice('Comparison stored against immutable base and head commits. Informational unless repository policy enforces the gate. OpsTrellis does not merge.');
    void load();
  }

  async function registerRepo() {
    setBusy(true);
    const result = await vulnRequest(apiUrl, '/api/devops/security/repositories', 'POST', {
      repository: newRepo.trim(),
      branch: newRepoBranch.trim() || 'main',
      ...(projectId ? { project_id: Number(projectId) } : {}),
    });
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Repository could not be registered.');
      return;
    }
    const ids = scanJobIds(result.body);
    const repoId = Number(result.body.repository_id) || 0;
    if (repoId) setScanTargetRepo(String(repoId));
    if (ids.length) {
      setSelectedScanId(ids[0]);
      setWatchScanIds(ids);
      setNotice('Repository registered and a hosted scan was queued. History stays on this job until it finishes.');
      setTab('history');
    } else {
      setNotice('Repository registered. Inventory arrives from a private agent or CI upload.');
    }
    setNewRepo('');
    void load();
  }

  async function registerFromServiceMap() {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/repositories/from-services', 'POST', {});
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Service map repositories could not be registered.');
      return;
    }
    setNotice(`Registered ${Number(result.body.registered) || 0} from the service map. ${Number(result.body.already) || 0} already registered. Scan is still explicit.`);
    void load();
  }

  async function openComparison(id: number) {
    const result = await vulnRequest(apiUrl, `/api/devops/security/pr-comparisons/${id}`);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Comparison detail could not be loaded.');
      return;
    }
    const comparison = result.body.comparison as { id: number; items?: { classification: string; canonical_id: string; package_name: string; severity: string; base_version?: string; head_version?: string }[] };
    setCompareDetail({ id: comparison.id, items: Array.isArray(comparison.items) ? comparison.items : [] });
  }

  function selectedFindingIds(): number[] {
    return Array.from(findingSelected).map((key) => Number(key)).filter((id) => id > 0);
  }

  function clearVulnFilters() {
    setSearch('');
    setSeverity('');
    setKevOnly(false);
    setUnassignedOnly(false);
    setIntelOnly(false);
    setTeamFilter('');
    setTechFilter('');
    setPatchFilter('');
    setLifecycleFilter('');
    setRepoFilter('');
    setLatestScanOnly(false);
    setHideDevDeps(false);
    setReachFilter('');
    setOverdueOnly(false);
  }

  function inventoryFilename(repo: string, suffix: string): string {
    const slug = (repo || 'inventory').replace(/[^a-zA-Z0-9._-]+/g, '-');
    return `${slug}-${suffix}.json`;
  }

  async function downloadScanInventory(scanId: number, repo: string) {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/scans/${scanId}/inventory`);
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'No stored inventory for that scan. Coverage is Unknown.');
      return;
    }
    downloadJSONFile(inventoryFilename(repo, `scan-${scanId}-sbom`), result.body.inventory ?? result.body);
  }

  async function downloadRepoInventory(repoId: number, repo: string) {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/repositories/${repoId}/inventory`);
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'No stored inventory for that repository. Coverage is Unknown.');
      return;
    }
    downloadJSONFile(inventoryFilename(repo, 'inventory-sbom'), result.body.inventory ?? result.body);
  }

  async function bulkFindings(lifecycle: string, reason: string) {
    const ids = selectedFindingIds();
    if (!ids.length) {
      setError('Select at least one finding.');
      return;
    }
    const payload: Record<string, unknown> = { ids, reason };
    if (lifecycle) payload.lifecycle = lifecycle;
    if (assignOwner.trim()) payload.owner = assignOwner.trim();
    if (assignDue) payload.due_at = assignDue;
    if (lifecycle === 'false_positive' || lifecycle === 'risk_accepted') {
      if (!bulkReason.trim() || !bulkExpires) {
        setError('Bulk false-positive and risk-accept need a reason and expiry.');
        return;
      }
      payload.reason = bulkReason.trim();
      payload.expires_at = bulkExpires;
    }
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/findings/bulk', 'POST', payload);
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The selected findings could not be updated.');
      return;
    }
    setNotice(`${Number(result.body.updated) || ids.length} findings updated. Fixed is never set from bulk actions.`);
    setFindingSelected(new Set());
    void load();
  }

  async function assignSelectedFindings() {
    const ids = selectedFindingIds();
    if (!ids.length) {
      setError('Select at least one finding.');
      return;
    }
    if (!assignOwner.trim() && !assignDue) {
      setError('Enter an owner or a due date.');
      return;
    }
    await bulkFindings('', 'Assigned from Findings');
  }

  async function openCampaignPRs(canonical: string) {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/campaigns/prs', 'POST', { canonical_id: canonical });
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Draft pull requests could not be opened.');
      return;
    }
    const urls = Array.isArray(result.body.pr_urls) ? result.body.pr_urls.filter((item): item is string => typeof item === 'string') : [];
    setNotice(urls.length ? `Opened ${urls.length} draft proposal${urls.length === 1 ? '' : 's'}. OpsTrellis does not merge them.` : 'Draft proposals opened. OpsTrellis does not merge them.');
    void load();
  }

  async function toggleRepoEnabled(id: number, enabled: boolean) {
    setBusy(true);
    setError('');
    setNotice('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/repositories/${id}/${enabled ? 'resume' : 'pause'}`, 'POST', {});
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Repository schedule could not be updated.');
      return;
    }
    setNotice(typeof result.body.note === 'string'
      ? result.body.note
      : (enabled
        ? 'Scheduled collection is enabled. History and open findings were kept.'
        : 'Scheduled collection is paused. History and open findings were kept. Scan now still runs.'));
    void load();
  }

  function exportCampaignCSV(campaign: CampaignRow) {
    const rows = (campaign.occurrences || []).map((item) => [
      campaign.canonical_id,
      item.repository || '',
      item.package_name || '',
      item.installed_version || '',
      (item.owner || '').includes('@') ? '' : (item.owner || ''),
      item.due_at || '',
    ]);
    const filename = `${campaign.canonical_id.replace(/[^A-Za-z0-9_-]+/g, '-')}-open-occurrences.csv`;
    downloadCSV(filename, ['advisory', 'repository', 'package', 'version', 'owner', 'due_at'], rows);
    setNotice('Exported open occurrences for a change request. Emails are not included. This is not Fixed.');
  }

  async function bindDeployment() {
    const serviceID = Number(deployService);
    if (!serviceID || !deployDigest.trim()) {
      setError('Select a service and enter an image digest. Images are not pulled.');
      return;
    }
    let sbom: unknown;
    if (deploySbom.trim()) {
      try {
        sbom = JSON.parse(deploySbom);
      } catch {
        setError('SBOM must be JSON.');
        return;
      }
    }
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/deployments', 'POST', {
      service_id: serviceID,
      environment: deployEnv.trim() || 'production',
      digest: deployDigest.trim(),
      commit_sha: deployCommitSha.trim(),
      sbom,
    });
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The deployment digest could not be saved.');
      return;
    }
    setNotice('Digest recorded. Images were not pulled and production was not patched.');
    setDeployDigest('');
    setDeploySbom('');
    void load();
  }

  const serviceColumns: DataTableColumn<ServiceRow>[] = useMemo(() => [
    {
      id: 'select',
      header: '',
      cell: (item) => (
        <input
          type="checkbox"
          checked={selected.includes(item.service_id)}
          onChange={(event) => {
            setSelected((current) => event.target.checked ? [...current, item.service_id] : current.filter((id) => id !== item.service_id));
          }}
          aria-label={`Select ${item.service}`}
        />
      ),
    },
    {
      id: 'service',
      header: 'Service',
      cell: (item) => <Link className="ig-cell-title" href={`/security/vulnerabilities/services/${item.service_id}`}>{item.service || 'Unknown'}</Link>,
    },
    {
      id: 'repo',
      header: 'Repository',
      cell: (item) => known(item.repository),
    },
    {
      id: 'tech',
      header: 'Technology',
      cell: (item) => (item.technologies && item.technologies.length ? item.technologies.join(' · ') : 'Not assessed'),
    },
    {
      id: 'findings',
      header: 'Findings',
      cell: (item) => (
        item.critical_findings + item.high_findings > 0
          ? <button type="button" className={item.critical_findings ? 'sec-sev sec-sev--critical' : 'sec-sev sec-sev--high'} onClick={() => { setSeverity(item.critical_findings ? 'critical' : 'high'); setTab('findings'); }}>{item.critical_findings ? `${item.critical_findings} Critical` : `${item.high_findings} High`}</button>
          : item.coverage === 'Not scanned' ? 'Not scanned' : 'No matches in scanned scope'
      ),
    },
    {
      id: 'patch',
      header: 'Patch readiness',
      cell: (item) => item.patch_readiness || 'Unknown',
    },
    {
      id: 'coverage',
      header: 'Coverage',
      cell: (item) => item.coverage,
    },
    {
      id: 'scan',
      header: 'Last scan',
      cell: (item) => (item.last_scan_at ? formatOperationalTime(item.last_scan_at) : 'No successful scan'),
    },
    {
      id: 'open',
      header: '',
      cell: (item) => <Link href={`/security/vulnerabilities/services/${item.service_id}`}>Open</Link>,
    },
  ], [selected]);

  const advisoryColumns: DataTableColumn<AdvisoryRow>[] = useMemo(() => [
    { id: 'id', header: 'Advisory', cell: (item) => <Link href={`/security/vulnerabilities/advisories/${item.id}`}>{item.canonical_id}</Link> },
    { id: 'title', header: 'Title', cell: (item) => item.title || 'Unknown' },
    { id: 'sev', header: 'Severity', cell: (item) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
    { id: 'pkg', header: 'Package', cell: (item) => item.package_name ? `${item.ecosystem || ''} ${item.package_name}`.trim() : 'Unknown' },
    { id: 'fix', header: 'First fixed version', cell: (item) => item.first_fixed_version || 'No known fix' },
    { id: 'kev', header: 'KEV', cell: (item) => (item.kev ? 'Known exploitation' : 'Not listed') },
    { id: 'epss', header: 'EPSS', cell: (item) => (item.epss ? `${Math.round(item.epss * 1000) / 10}%` : 'Unknown') },
    { id: 'local', header: 'Your affected services', cell: (item) => (item.affected_services ? `${item.affected_services} confirmed` : 'No matches in available inventory') },
  ], []);

  const findingColumns: DataTableColumn<FindingRow>[] = useMemo(() => [
    { id: 'adv', header: 'Advisory', cell: (item) => <Link href={`/security/vulnerabilities/findings/${item.id}`}>{item.canonical_id}</Link> },
    { id: 'pkg', header: 'Package', cell: (item) => `${item.package_name}@${item.installed_version || 'unresolved'}` },
    { id: 'usage', header: 'Usage', cell: (item) => usageLabel(item) },
    { id: 'repo', header: 'Repository', cell: (item) => known(item.repository) },
    { id: 'sev', header: 'Severity', cell: (item) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
    { id: 'priority', header: 'Priority', cell: (item) => item.priority || 'review' },
    { id: 'fix', header: 'Fix', cell: (item) => item.patch_state === 'fix_available' ? <span className="sec-sev sec-sev--high">Fix available{item.first_fixed_version ? ` · ${item.first_fixed_version}` : ''}</span> : (item.first_fixed_version || patchLabel(item.patch_state)) },
    { id: 'reach', header: 'Reachability', cell: (item) => reachabilityLabel(item.reachability) },
    { id: 'origin', header: 'Origin', cell: (item) => matchSourceLabel(item.match_source) },
    { id: 'epss', header: 'EPSS', cell: (item) => epssLabel(item.epss, item.epss_percentile) },
    { id: 'owner', header: 'Owner', cell: (item) => known(item.owner) },
    { id: 'due', header: 'Due', cell: (item) => (
      item.due_at
        ? <span>{item.overdue ? <span className="sec-sev sec-sev--critical">Overdue</span> : null}{item.overdue ? ' ' : ''}{formatOperationalTime(item.due_at)}</span>
        : 'None'
    ) },
    { id: 'seen', header: 'Last scan', cell: (item) => (item.last_seen_at ? formatOperationalTime(item.last_seen_at) : 'Unknown') },
    { id: 'state', header: 'State', cell: (item) => lifecycleLabel(item.lifecycle) },
  ], []);

  const scanColumns: DataTableColumn<ScanRow>[] = useMemo(() => [
    { id: 'id', header: 'Job', cell: (item) => (
      <button type="button" className={item.id === selectedScanId ? 'btn btn-secondary btn-sm is-current' : 'btn btn-secondary btn-sm'} onClick={() => setSelectedScanId(item.id)}>#{item.id}</button>
    ) },
    { id: 'repo', header: 'Repository', cell: (item) => known(item.repository) },
    { id: 'state', header: 'State', cell: (item) => `${item.state} · ${item.stage}` },
    { id: 'mods', header: 'Modules', cell: (item) => `${item.assessed_modules} assessed / ${item.discovered_modules} discovered` },
    { id: 'hits', header: 'Findings', cell: (item) => String(item.finding_count ?? 0) },
    { id: 'cov', header: 'Coverage', cell: (item) => item.coverage_note || ((item.coverage || []).length ? `${item.coverage?.length} notes` : 'No coverage notes') },
    { id: 'commit', header: 'Commit', cell: (item) => item.commit_sha ? item.commit_sha.slice(0, 12) : 'Unknown' },
    { id: 'when', header: 'Queued', cell: (item) => (item.created_at ? formatOperationalTime(item.created_at) : 'Unknown') },
    { id: 'err', header: 'Error', cell: (item) => item.error || 'None recorded' },
    { id: 'cancel', header: '', cell: (item) => (
      item.state === 'queued'
        ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void cancelScan(item.id)}>Cancel</button>
        : null
    ) },
  ], [busy, selectedScanId]);

  async function openPatchPR(planId: number) {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/plans/${planId}/pr`, 'POST', {});
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'A patch pull request could not be opened.');
      return;
    }
    setNotice('Draft patch proposal opened. OpsTrellis does not merge it and does not patch production.');
    void load();
  }

  async function cancelScan(id: number) {
    setBusy(true);
    setError('');
    setNotice('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/scans/${id}/cancel`, 'POST', {});
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The queued scan could not be cancelled.');
      return;
    }
    setWatchScanIds((ids) => ids.filter((item) => item !== id));
    setNotice(typeof result.body.note === 'string' ? result.body.note : 'Queued scan cancelled. History and open findings were kept. This is not Fixed.');
    void load();
  }

  async function cancelQueuedScans() {
    const queued = scans.filter((item) => item.state === 'queued');
    if (!queued.length) {
      setError('No queued scans to cancel.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/scans/cancel-queued', 'POST', {});
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Queued scans could not be cancelled.');
      return;
    }
    const ids = new Set(queued.map((item) => item.id));
    setWatchScanIds((current) => current.filter((item) => !ids.has(item)));
    const n = Number(result.body.cancelled) || queued.length;
    setNotice(typeof result.body.note === 'string' ? result.body.note : `${n} queued scan${n === 1 ? '' : 's'} cancelled. History and open findings were kept.`);
    void load();
  }

  const repoColumns: DataTableColumn<RepoConfig>[] = useMemo(() => [
    { id: 'repo', header: 'Repository', cell: (item) => known(item.repository) },
    { id: 'provider', header: 'Provider', cell: (item) => item.provider || 'github' },
    { id: 'mode', header: 'Collection', cell: (item) => collectionModeLabel(item.collection_mode) },
    { id: 'access', header: 'Token', cell: (item) => <span title={item.access_detail || ''}>{accessLabel(item.access_state)}</span> },
    { id: 'branch', header: 'Branch', cell: (item) => item.branch || 'main' },
    { id: 'team', header: 'Owner', cell: (item) => known(item.owner_team) },
    { id: 'status', header: 'Schedule', cell: (item) => (item.enabled === false ? 'Paused' : (item.last_scheduled_at ? formatOperationalTime(item.last_scheduled_at) : (item.schedule_minutes >= 15 ? `Every ${item.schedule_minutes}m` : 'Off'))) },
    { id: 'fresh', header: 'Inventory', cell: (item) => (
      <span title={item.stale_reason || ''}>{item.stale ? 'Stale · Unknown' : (item.last_inventory_at ? `Fresh · ${item.inventory_age_days ?? 0}d` : 'Unknown')}</span>
    ) },
    { id: 'gate', header: 'PR gate', cell: (item) => (item.enforce_pr_gate ? 'Enforced' : 'Informational') },
    { id: 'edit', header: '', cell: (item) => (
      <span className="sec-vuln-row-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void scanRepositories([item.id])}>Scan now</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void downloadRepoInventory(item.id, item.repository)}>Download inventory</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !isManager} onClick={() => void toggleRepoEnabled(item.id, item.enabled === false)}>{item.enabled === false ? 'Enable' : 'Pause'}</button>
        <Link className="btn btn-secondary btn-sm" href={`/security/vulnerabilities/policy/${item.id}`}>Edit policy</Link>
      </span>
    ) },
  ], [apiUrl, busy, isManager, projectId]);

  const sourceColumns: DataTableColumn<SourceRow>[] = useMemo(() => [
    { id: 'provider', header: 'Provider', cell: (item) => item.provider },
    { id: 'status', header: 'Status', cell: (item) => (item.enabled ? item.status : 'Paused') },
    { id: 'ok', header: 'Last success', cell: (item) => (item.last_success_at ? formatOperationalTime(item.last_success_at) : 'Unknown') },
    { id: 'err', header: 'Error', cell: (item) => item.last_error || 'None recorded' },
  ], []);

  const agentColumns: DataTableColumn<AgentRow>[] = useMemo(() => [
    { id: 'name', header: 'Name', cell: (item) => item.name },
    { id: 'status', header: 'Status', cell: (item) => item.status },
    { id: 'ver', header: 'Version', cell: (item) => item.version || 'Unknown' },
    { id: 'hb', header: 'Last heartbeat', cell: (item) => (item.last_heartbeat_at ? formatOperationalTime(item.last_heartbeat_at) : 'Unknown') },
  ], []);

  const planColumns: DataTableColumn<PlanRow>[] = useMemo(() => [
    { id: 'label', header: 'Plan', cell: (item) => item.label },
    { id: 'repo', header: 'Repository', cell: (item) => known(item.repository) },
    { id: 'pkg', header: 'Upgrade', cell: (item) => `${item.package_name} ${item.current_version} → ${item.target_version}` },
    { id: 'action', header: 'Action', cell: (item) => item.action.replace(/_/g, ' ') },
    { id: 'status', header: 'Status', cell: (item) => patchLabel(item.status) },
    { id: 'pr', header: 'Proposal', cell: (item) => <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void openPatchPR(item.id)}>Open draft PR</button> },
  ], [apiUrl, busy]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Global Vulnerabilities & Patches - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Security</span>
            <h1 className="portal-page__title">Global Vulnerabilities & Patches</h1>
            <p className="portal-page__subtitle">
              {tab === 'configuration'
                ? 'Register a repository, then set collection and alert policy. Tokens stay on the API.'
                : tab === 'sources'
                  ? 'Feeds, private agents, and CI inventory. A feed is not repository coverage.'
                  : 'See which services need action and which patches are available. A public advisory is not proof of repository exposure.'}
            </p>
          </div>
          <div className="runbooks__action-row">
            {isManager && (showScorecards || tab === 'sources') ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void refreshIntelligence()}>Refresh intelligence</button> : null}
            {showScorecards ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void scanSelected()}>{busy ? 'Working…' : 'Scan selected services'}</button> : null}
          </div>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {showScorecards ? (
        <p className="ops-scores__meta">
          <span>Last intelligence sync · {overview.intelligence_synced_at ? formatOperationalTime(overview.intelligence_synced_at) : 'Unknown'} · KEV matches {loading ? '…' : overview.kev_matches ?? 0} · Overdue {loading ? '…' : overview.overdue ?? 0}</span>
          <span>Hosted collector · {hosted ? 'Configured' : 'Offline'}</span>
        </p>
        ) : null}
        {showScorecards ? (
        <section className="ops-minis ops-minis--four" aria-label="Vulnerability scorecards">
          <article className="ops-mini ops-mini--peach">
            <span>Critical findings</span>
            <strong>{loading ? '…' : overview.critical_findings ?? 'Unknown'}</strong>
            <small>Confirmed repository occurrences</small>
          </article>
          <article className="ops-mini ops-mini--peach">
            <span>High findings</span>
            <strong>{loading ? '…' : overview.high_findings ?? 'Unknown'}</strong>
            <small>Confirmed repository occurrences</small>
          </article>
          <article className="ops-mini ops-mini--blue">
            <span>Affected services</span>
            <strong>{loading ? '…' : `${overview.affected_services ?? 0} of ${overview.registered_services ?? 0}`}</strong>
            <small>Registered in this scope</small>
          </article>
          <article className="ops-mini ops-mini--lilac">
            <span>Coverage</span>
            <strong>{loading ? '…' : `${overview.scanned_repositories ?? 0} scanned`}</strong>
            <small>Repositories with a stored inventory</small>
          </article>
        </section>
        ) : null}
        {showScorecards ? <p className="form-section__copy">{overview.count_note || 'Scorecards count confirmed matches, not global advisory volume.'}</p> : null}
        {showScorecards ? (
          <p className="ops-scores__meta sec-vuln-intel">
            <span>
              Internet advisories · Last sync {overview.intelligence_synced_at ? formatOperationalTime(overview.intelligence_synced_at) : 'Unknown'}
              {' '}· {loading ? '…' : overview.intel_repos_assessed ?? 0} stored inventories re-checked
              {' '}· {loading ? '…' : overview.intel_new_matches ?? 0} new matches this sync
              {' '}· {loading ? '…' : overview.intel_open_matches ?? 0} open internet matches
            </span>
            <span>
              {(overview.unscanned_repositories ?? 0) > 0
                ? `${overview.unscanned_repositories} registered repos have no inventory, so new CVEs cannot be checked there.`
                : 'Repos with a stored lockfile are checked when public advisories refresh.'}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setIntelOnly(true);
                void router.replace({ pathname: '/security/vulnerabilities', query: { ...router.query, tab: 'findings' } }, undefined, { shallow: true });
              }}
            >
              Show internet matches
            </button>
          </p>
        ) : null}
        <nav className="ops-tabs sec-vuln-tabs" aria-label="Vulnerability workspace">
          {VULN_TABS.map((item) => (
            <Link key={item.id} href={{ pathname: '/security/vulnerabilities', query: { ...(projectId ? { project_id: projectId } : {}), ...(item.id === 'services' ? {} : { tab: item.id }) } }} className={tab === item.id ? 'is-current' : undefined}>{item.label}</Link>
          ))}
        </nav>
        {tab === 'findings' ? (
          <form className="sec-vuln-filters" onSubmit={(event) => event.preventDefault()}>
            <div className="sec-vuln-filters__fields">
              <label className="sec-vuln-filters__search">
                Search
                <input className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Service, repository, package, or advisory" />
              </label>
              <label>
                Severity
                <select className="input" value={severity} onChange={(event) => setSeverity(event.target.value)}>
                  <option value="">All displayed</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                </select>
              </label>
              <label>
                Fix availability
                <select className="input" value={patchFilter} onChange={(event) => setPatchFilter(event.target.value)}>
                  <option value="">All patch states</option>
                  <option value="fix_available">Fix available</option>
                  <option value="no_known_fix">No known fix</option>
                  <option value="pr_linked">PR linked</option>
                </select>
              </label>
              <label>
                Lifecycle
                <select className="input" value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value)}>
                  <option value="">Open findings</option>
                  <option value="open">Open</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="in_remediation">In remediation</option>
                  <option value="pending_verification">Pending verification</option>
                  <option value="risk_accepted">Risk accepted</option>
                  <option value="fixed">Fixed</option>
                  <option value="false_positive">False positive</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              </label>
              <label>
                Repository
                <select className="input" value={repoFilter} onChange={(event) => setRepoFilter(event.target.value)}>
                  <option value="">All repositories</option>
                  {findingRepos.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                Reachability
                <select className="input" value={reachFilter} onChange={(event) => setReachFilter(event.target.value)}>
                  <option value="">All evidence</option>
                  <option value="imported">Imported</option>
                  <option value="not_imported">Not imported</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
            </div>
            <div className="sec-vuln-filters__options">
              <div className="sec-vuln-filters__toggles">
                <label className={`sec-vuln-filters__chip${unassignedOnly ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={unassignedOnly} onChange={(event) => setUnassignedOnly(event.target.checked)} />
                  Unassigned
                </label>
                <label className={`sec-vuln-filters__chip${intelOnly ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={intelOnly} onChange={(event) => setIntelOnly(event.target.checked)} />
                  Internet matches
                </label>
                <label className={`sec-vuln-filters__chip${latestScanOnly ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={latestScanOnly} onChange={(event) => setLatestScanOnly(event.target.checked)} />
                  This scan
                </label>
                <label className={`sec-vuln-filters__chip${hideDevDeps ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={hideDevDeps} onChange={(event) => setHideDevDeps(event.target.checked)} />
                  Hide devDependencies
                </label>
                <label className={`sec-vuln-filters__chip${overdueOnly ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />
                  Overdue
                </label>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearVulnFilters}>Clear</button>
            </div>
          </form>
        ) : null}
        {tab === 'services' || tab === 'advisories' ? (
          <form className="svc-filters svc-filters--inventory" onSubmit={(event) => event.preventDefault()}>
            <label>
              Search
              <input className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Service, repository, package, or advisory" />
            </label>
            <label>
              Severity
              <select className="input" value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="">All displayed</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
              </select>
            </label>
            {tab === 'services' ? (
              <label>
                Team
                <select className="input" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                  <option value="">All teams</option>
                  {teams.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            ) : null}
            {tab === 'services' ? (
              <label>
                Technology
                <select className="input" value={techFilter} onChange={(event) => setTechFilter(event.target.value)}>
                  <option value="">All technologies</option>
                  {technologies.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              Fix availability
              <select className="input" value={patchFilter} onChange={(event) => setPatchFilter(event.target.value)}>
                <option value="">All patch states</option>
                <option value="fix_available">Fix available</option>
                <option value="no_known_fix">No known fix</option>
                <option value="pr_linked">PR linked</option>
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={clearVulnFilters}>Clear</button>
            {tab === 'advisories' ? <label className="label"><input type="checkbox" checked={kevOnly} onChange={(event) => setKevOnly(event.target.checked)} /> KEV only</label> : null}
          </form>
        ) : null}

        {tab === 'services' ? (
          <div className="sec-vuln-workspace">
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Services</h2>
                  <p className="portal-surface__subtitle">Empty coverage is not a clean bill of health. “No matches in scanned scope” only covers assessed modules.</p>
                </div>
              </div>
              {selected.length ? <p className="form-section__copy">{selected.length} services selected. Shared repositories are scanned once.</p> : null}
              <DataTable
                label="Registered services"
                columns={serviceColumns}
                rows={visibleServices}
                rowKey={(item) => String(item.service_id)}
                empty={(
                  <EmptyState
                    title={loading ? 'Loading services' : 'No registered services in this scope'}
                    body="Connect a repository on the service record, then scan. This page does not invent coverage."
                  />
                )}
              />
            </section>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Runtime digest</h2>
                  <p className="portal-surface__subtitle">Record an observed image digest and an optional SBOM. Images are not pulled. A digest without an SBOM cannot prove production is patched.</p>
                </div>
              </div>
              <form className="sec-vuln-inline sec-vuln-inline--digest" onSubmit={(event) => { event.preventDefault(); void bindDeployment(); }}>
                <label className="label">Service
                  <select className="input" value={deployService} onChange={(event) => setDeployService(event.target.value)}>
                    <option value="">Select a service</option>
                    {services.map((item) => <option key={item.service_id} value={item.service_id}>{item.service || `Service ${item.service_id}`}</option>)}
                  </select>
                </label>
                <label className="label">Environment<input className="input" value={deployEnv} onChange={(event) => setDeployEnv(event.target.value)} /></label>
                <label className="label">Image digest<input className="input" value={deployDigest} onChange={(event) => setDeployDigest(event.target.value)} placeholder="sha256:…" /></label>
                <label className="label">Commit SHA<input className="input" value={deployCommitSha} onChange={(event) => setDeployCommitSha(event.target.value)} /></label>
                <label className="label">Optional SBOM JSON<textarea className="input" rows={6} value={deploySbom} onChange={(event) => setDeploySbom(event.target.value)} placeholder="CycloneDX or SPDX JSON" /></label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-secondary" disabled={busy}>Record digest</button>
                </div>
              </form>
            </section>
          </div>
        ) : null}

        {tab === 'advisories' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Global advisories</h2>
                <p className="portal-surface__subtitle">Public intelligence. A Critical advisory here is not organization exposure unless a repository finding exists.</p>
              </div>
            </div>
            <DataTable
              label="Global advisories"
              columns={advisoryColumns}
              rows={visibleAdvisories}
              rowKey={(item) => String(item.id)}
              empty={<EmptyState title={loading ? 'Loading advisories' : 'No saved advisories'} body="Use Refresh intelligence. The browser never contacts vulnerability feeds." />}
            />
          </section>
        ) : null}

        {tab === 'findings' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Repository findings</h2>
                <p className="portal-surface__subtitle">Confirmed and potential dependency matches stay here until a finding is closed. Overdue does not auto-close. A second scan of the same repository adds newly identified packages instead of duplicating existing rows. Production exposure stays Unknown until a deployment mapping exists.</p>
              </div>
            </div>
            {scans[0] ? (
              <p className="form-section__copy">
                Latest scan #{scans[0].id} for {scans[0].repository} is {scans[0].state}
                {scans[0].state === 'failed'
                  ? `${scans[0].error ? ` (${scans[0].error})` : ''}. Clone must succeed before internet advisories can match this repo.`
                  : (scans[0].finding_count ?? 0) > 0
                    ? ` and created ${scans[0].finding_count} package findings.`
                    : '. It created no package findings. Open History and read that job’s Scan log — a failed clone, missing lockfile, or OSV miss all look empty here.'}
                {scans[0].coverage_note ? ` Coverage: ${scans[0].coverage_note}.` : ''}
                {' '}Unknown reachability means source files were not sampled for import evidence; that is not a not-affected claim.
              </p>
            ) : (
              <p className="form-section__copy">No scan has finished yet. Register a repository on Config or use Scan latest commit on History.</p>
            )}
            <div className="sec-vuln-bulk">
              <BulkBar count={findingSelected.size} noun="finding" onClear={() => setFindingSelected(new Set())}>
                <label className="label">Owner<input className="input" value={assignOwner} onChange={(event) => setAssignOwner(event.target.value)} placeholder="Team or owner" /></label>
                <label className="label">Due<input className="input" type="date" value={assignDue} onChange={(event) => setAssignDue(event.target.value)} /></label>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void assignSelectedFindings()}>Assign</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void bulkFindings('acknowledged', 'Acknowledged from Findings')}>Acknowledge</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void bulkFindings('in_remediation', 'Moved to in remediation from Findings')}>In remediation</button>
                <label className="label">Reason<input className="input" value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} placeholder="Required for false positive / risk accept" /></label>
                <label className="label">Expiry<input className="input" type="date" value={bulkExpires} onChange={(event) => setBulkExpires(event.target.value)} /></label>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !isManager} onClick={() => void bulkFindings('false_positive', bulkReason.trim())}>False positive</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !isManager} onClick={() => void bulkFindings('risk_accepted', bulkReason.trim())}>Risk accept</button>
              </BulkBar>
            </div>
            <DataTable
              label="Repository findings"
              columns={findingColumns}
              rows={visibleFindings}
              rowKey={(item) => String(item.id)}
              selectable
              selectedKeys={findingSelected}
              onSelectionChange={setFindingSelected}
              empty={<EmptyState title={loading ? 'Loading findings' : intelOnly ? 'No internet advisory matches' : 'No package findings in this scope'} body={findingsEmptyBody()} />}
            />
          </section>
        ) : null}

        {tab === 'campaigns' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Campaigns</h2>
                <p className="portal-surface__subtitle">Open findings grouped by canonical advisory, including internet advisories matched to stored lockfiles. Export CSV of one advisory for a change request. Closed findings leave this list. Emails are not included. This is not Fixed.</p>
              </div>
            </div>
            <DataTable
              label="Advisory campaigns"
              columns={[
                { id: 'id', header: 'Advisory', cell: (item: CampaignRow) => item.canonical_id },
                { id: 'title', header: 'Title', cell: (item: CampaignRow) => item.title || 'Unknown' },
                { id: 'sev', header: 'Severity', cell: (item: CampaignRow) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
                { id: 'count', header: 'Open findings', cell: (item: CampaignRow) => String(item.count) },
                { id: 'svc', header: 'Services', cell: (item: CampaignRow) => (item.services && item.services.length ? item.services.join(', ') : 'Unknown') },
              ]}
              rows={campaigns}
              rowKey={(item) => item.canonical_id}
              onRowOpen={(item) => setCampaignDetail(item)}
              empty={<EmptyState title={loading ? 'Loading campaigns' : 'No open advisory campaigns'} body="Campaigns appear after confirmed repository findings exist." />}
            />
            {campaignDetail ? (
              <div className="portal-surface" style={{ marginTop: 16 }}>
                <div className="portal-surface__header">
                  <div>
                    <h3 className="portal-surface__title">{campaignDetail.canonical_id}</h3>
                    <p className="portal-surface__subtitle">{campaignDetail.title || 'Open occurrences for this advisory. One draft PR is opened per repository that has a patch plan.'}</p>
                  </div>
                  <div className="runbooks__action-row">
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !(campaignDetail.occurrences || []).length} onClick={() => exportCampaignCSV(campaignDetail)}>Export CSV</button>
                    {isManager ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void openCampaignPRs(campaignDetail.canonical_id)}>Open draft PRs</button> : null}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCampaignDetail(null)}>Close</button>
                  </div>
                </div>
                <DataTable
                  label="Campaign occurrences"
                  columns={[
                    { id: 'finding', header: 'Finding', cell: (item: CampaignOccurrence) => <Link href={`/security/vulnerabilities/findings/${item.finding_id}`}>#{item.finding_id}</Link> },
                    { id: 'repo', header: 'Repository', cell: (item: CampaignOccurrence) => known(item.repository) },
                    { id: 'pkg', header: 'Package', cell: (item: CampaignOccurrence) => `${item.package_name}@${item.installed_version || 'unresolved'}` },
                    { id: 'owner', header: 'Owner', cell: (item: CampaignOccurrence) => known((item.owner || '').includes('@') ? '' : item.owner) },
                    { id: 'due', header: 'Due', cell: (item: CampaignOccurrence) => (item.due_at ? formatOperationalTime(item.due_at) : 'Unknown') },
                    { id: 'usage', header: 'Usage', cell: (item: CampaignOccurrence) => usageLabel(item) },
                    { id: 'plan', header: 'Plan', cell: (item: CampaignOccurrence) => (item.plan_id ? `Plan ${item.plan_id}` : 'No plan yet') },
                  ]}
                  rows={campaignDetail.occurrences || []}
                  rowKey={(item) => String(item.finding_id)}
                  empty={<EmptyState title="No occurrences" body="This campaign has no open findings in your scope." />}
                />
                {!isManager ? <p className="form-section__copy">Opening draft PRs needs a manager role. OpsTrellis never merges them.</p> : null}
              </div>
            ) : <p className="form-section__copy">Open a campaign row to see repositories and open one draft PR per repo that has a patch plan.</p>}
          </section>
        ) : null}

        {tab === 'remediation' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Patch plans</h2>
                <p className="portal-surface__subtitle">Grouped candidate upgrades. Counts stay estimated until each occurrence is verified. There is no Apply patch action.</p>
              </div>
            </div>
            <DataTable
              label="Patch plans"
              columns={planColumns}
              rows={plans}
              rowKey={(item) => String(item.id)}
              empty={<EmptyState title={loading ? 'Loading plans' : 'No patch plans'} body="Plans appear after a confirmed match has a source-supported fix version." />}
            />
          </section>
        ) : null}

        {tab === 'history' ? (
          <div className="sec-vuln-workspace">
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Scan history</h2>
                  <p className="portal-surface__subtitle">Partial and failed scans keep the last successful inventory. They cannot close unscanned modules. Queued scans can be cancelled; running scans keep going.</p>
                </div>
                {scans.some((item) => item.state === 'queued') ? (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void cancelQueuedScans()}>Cancel queued</button>
                ) : null}
              </div>
              <form className="sec-vuln-inline" onSubmit={(event) => { event.preventDefault(); void scanRepositories([Number(scanTargetRepo)]); }}>
                <label className="label">Registered repository
                  <select className="input" value={scanTargetRepo} onChange={(event) => setScanTargetRepo(event.target.value)}>
                    <option value="">Select a repository</option>
                    {repos.map((item) => <option key={item.id} value={item.id}>{item.repository}</option>)}
                  </select>
                </label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy || !scanTargetRepo}>Scan latest commit</button>
                </div>
              </form>
              <DataTable
                label="Scan history"
                columns={scanColumns}
                rows={scans}
                rowKey={(item) => String(item.id)}
                empty={<EmptyState title={loading ? 'Loading history' : 'No scans yet'} body="Register a repository on Config, or scan a registered repository here." />}
              />
            </section>
            {scanDetail ? (
              <div className="sec-vuln-split">
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <h2 className="portal-surface__title">Scan results</h2>
                      <p className="portal-surface__subtitle">{scanDetail.repository} · job #{scanDetail.id}. Empty coverage is not a secure label.</p>
                    </div>
                    <span className="sec-vuln-row-actions">
                      {scanDetail.state === 'queued' ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void cancelScan(scanDetail.id)}>Cancel queued scan</button> : null}
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void downloadScanInventory(scanDetail.id, scanDetail.repository)}>Download inventory</button>
                    </span>
                  </div>
                  <dl className="sec-vuln-status">
                    <div><dt>State</dt><dd>{scanDetail.state} · {scanDetail.stage}</dd></div>
                    <div><dt>Commit</dt><dd>{scanDetail.commit_sha ? scanDetail.commit_sha.slice(0, 12) : 'Unknown'}</dd></div>
                    <div><dt>Modules</dt><dd>{scanDetail.assessed_modules} assessed / {scanDetail.discovered_modules} discovered</dd></div>
                    <div><dt>Findings</dt><dd>{scanDetail.finding_count ?? scanFindings.length}</dd></div>
                    <div><dt>Finished</dt><dd>{scanDetail.finished_at ? formatOperationalTime(scanDetail.finished_at) : 'In progress'}</dd></div>
                  </dl>
                  {scanDetail.error ? <p className="form-section__copy">{scanDetail.error}</p> : null}
                  {scanDetail.coverage_note ? <p className="form-section__copy">Coverage: {scanDetail.coverage_note}</p> : null}
                  {scanDetail.state === 'cancelled' ? (
                    <p className="form-section__copy">This job was cancelled before the collector started. History and open findings were kept. This is not Fixed.</p>
                  ) : scanDetail.state !== 'queued' && scanDetail.state !== 'running' && (scanDetail.finding_count ?? scanFindings.length) === 0 ? (
                    <p className="form-section__copy">This job did not create package findings. The Scan log records whether lockfiles were found and whether OSV answered. An empty Findings tab is not proof the collector skipped the repo.</p>
                  ) : null}
                  <h3 className="portal-surface__title">Coverage notes</h3>
                  {(scanDetail.coverage || []).length ? (
                    <ul className="sec-vuln-coverage">
                      {(scanDetail.coverage || []).map((item, index) => (
                        <li key={`${item.path || 'path'}-${index}`}>{item.path || '/'} · {item.reason || 'Coverage note'}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="form-section__copy">No coverage notes were recorded for this job.</p>
                  )}
                  <DataTable
                    label="Findings from this scan"
                    columns={[
                      { id: 'id', header: 'Advisory', cell: (item: ScanFinding) => <Link href={`/security/vulnerabilities/findings/${item.id}`}>{item.canonical_id}</Link> },
                      { id: 'pkg', header: 'Package', cell: (item: ScanFinding) => `${item.package_name}@${item.installed_version || 'unresolved'}` },
                      { id: 'sev', header: 'Severity', cell: (item: ScanFinding) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
                      { id: 'state', header: 'State', cell: (item: ScanFinding) => lifecycleLabel(item.lifecycle) },
                    ]}
                    rows={scanFindings}
                    rowKey={(item) => String(item.id)}
                    empty={<EmptyState title={scanDetail.state === 'queued' || scanDetail.state === 'running' ? 'Scan in progress' : (scanDetail.state === 'cancelled' ? 'Scan cancelled' : 'No matches from this scan')} body="This is not a secure label. Unscanned modules stay Unknown." />}
                  />
                  <div className="sec-vuln-diff">
                    <h3 className="portal-surface__title">Scan-to-scan diff</h3>
                    <p className="form-section__copy">{scanDiff?.note || 'Gone since the previous scan is not Fixed. Close only after a verify scan or an explicit disposition.'}{scanDiff?.previous_id ? ` Compared with job #${scanDiff.previous_id}.` : ' No previous succeeded scan to compare.'}</p>
                    <DataTable
                      label="Scan-to-scan diff"
                      columns={[
                        { id: 'bucket', header: 'Change', cell: (item: ScanFinding & { bucket: string }) => item.bucket },
                        { id: 'id', header: 'Advisory', cell: (item: ScanFinding) => <Link href={`/security/vulnerabilities/findings/${item.id}`}>{item.canonical_id}</Link> },
                        { id: 'pkg', header: 'Package', cell: (item: ScanFinding) => `${item.package_name}@${item.installed_version || 'unresolved'}` },
                        { id: 'sev', header: 'Severity', cell: (item: ScanFinding) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
                        { id: 'state', header: 'State', cell: (item: ScanFinding) => lifecycleLabel(item.lifecycle) },
                      ]}
                      rows={[
                        ...(scanDiff?.added || []).map((item) => ({ ...item, bucket: 'Added' })),
                        ...(scanDiff?.still_open || []).map((item) => ({ ...item, bucket: 'Still open' })),
                        ...(scanDiff?.gone || []).map((item) => ({ ...item, bucket: 'Gone · not Fixed' })),
                      ]}
                      rowKey={(item) => `${item.bucket}-${item.id}`}
                      empty={<EmptyState title="No scan-to-scan changes" body="Added, still-open, and gone rows appear after a succeeded or partial scan. Gone is not Fixed." />}
                    />
                  </div>
                </section>
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <h2 className="portal-surface__title">Scan log</h2>
                      <p className="portal-surface__subtitle">Stage trail for this job. Tokens are never written here.</p>
                    </div>
                  </div>
                  {scanLog.length ? (
                    <ol className="sec-vuln-log">
                      {scanLog.map((item, index) => (
                        <li key={`${item.created_at}-${index}`}>
                          <strong>{item.stage || 'log'}</strong>
                          <span>{item.detail}</span>
                          <small>{item.created_at ? formatOperationalTime(item.created_at) : ''}</small>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyState title="No log yet" body="Events appear as the collector clones, inventories, and correlates the repository." />
                  )}
                </section>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'comparisons' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">PR comparisons</h2>
                <p className="portal-surface__subtitle">Opened and updated pull requests store the same comparison as this form. Informational unless repository policy enforces the gate. OpsTrellis does not merge.</p>
              </div>
            </div>
            <form className="portal-form-grid" onSubmit={(event) => { event.preventDefault(); void comparePr(); }}>
              <label className="label">Repository
                <select className="input" value={prRepo} onChange={(event) => setPrRepo(event.target.value)}>
                  <option value="">Select</option>
                  {repos.map((item) => <option key={item.id} value={item.id}>{item.repository}</option>)}
                </select>
              </label>
              <label className="label">PR number<input className="input" value={prNumber} onChange={(event) => setPrNumber(event.target.value)} /></label>
              <div className="portal-form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>Compare pull request</button>
              </div>
            </form>
            <DataTable
              label="PR comparisons"
              columns={[
                { id: 'pr', header: 'PR', cell: (item: ComparisonRow) => <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openComparison(item.id)}>{item.repository}#{item.pr_number}</button> },
                { id: 'src', header: 'Source', cell: (item: ComparisonRow) => (item.compare_source === 'webhook' ? 'Webhook' : 'Manual') },
                { id: 'gate', header: 'Gate', cell: (item: ComparisonRow) => (item.enforce_pr_gate ? 'Enforced' : 'Informational') },
                { id: 'state', header: 'State', cell: (item: ComparisonRow) => `${item.state} · ${item.coverage}` },
                { id: 'in', header: 'Introduced C/H', cell: (item: ComparisonRow) => `${item.introduced_critical} / ${item.introduced_high}` },
                { id: 'out', header: 'Removed', cell: (item: ComparisonRow) => String(item.removed_count) },
              ]}
              rows={comparisons}
              rowKey={(item) => String(item.id)}
              empty={<EmptyState title={loading ? 'Loading comparisons' : 'No PR comparisons'} body="Removed in a PR does not close default-branch findings." />}
            />
            {compareDetail ? (
              <div className="portal-surface" style={{ marginTop: 16 }}>
                <h3 className="portal-surface__title">Comparison #{compareDetail.id}</h3>
                <p className="form-section__copy">Incomplete coverage is never a clean introduced verdict. Removed here does not close default-branch findings.</p>
                <table className="data-table">
                  <thead>
                    <tr><th>Class</th><th>Advisory</th><th>Package</th><th>Base</th><th>Head</th><th>Severity</th></tr>
                  </thead>
                  <tbody>
                    {compareDetail.items.length ? compareDetail.items.map((item, index) => (
                      <tr key={`${item.canonical_id}-${index}`}>
                        <td>{item.classification.replace(/_/g, ' ')}</td>
                        <td>{item.canonical_id}</td>
                        <td>{item.package_name}</td>
                        <td>{item.base_version || '—'}</td>
                        <td>{item.head_version || '—'}</td>
                        <td><span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span></td>
                      </tr>
                    )) : <tr><td colSpan={6}>No comparable items in this snapshot.</td></tr>}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === 'new-deps' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">New dependencies</h2>
                <p className="portal-surface__subtitle">Packages that appeared between the last two inventories. Missing metadata is Unknown, not malicious.</p>
              </div>
            </div>
            <DataTable
              label="New dependencies"
              columns={[
                { id: 'repo', header: 'Repository', cell: (item: NewDepRow) => item.repository },
                { id: 'pkg', header: 'Package', cell: (item: NewDepRow) => `${item.ecosystem} ${item.package_name}@${item.version || 'Unknown'}` },
                { id: 'note', header: 'Note', cell: (item: NewDepRow) => item.note || 'Newly introduced package.' },
              ]}
              rows={newDeps}
              rowKey={(item) => `${item.repository}|${item.ecosystem}|${item.package_name}|${item.version}`}
              empty={<EmptyState title={loading ? 'Loading' : 'No newly introduced packages'} body="A second successful inventory is required before a diff exists." />}
            />
          </section>
        ) : null}

        {tab === 'sources' ? (
          <div className="sec-vuln-workspace">
            <dl className="sec-vuln-status">
              <div>
                <dt>Hosted collector</dt>
                <dd>{hosted ? 'Configured' : 'Offline'}</dd>
              </div>
              <div>
                <dt>Private agents</dt>
                <dd>{agents.length ? `${agents.length} enrolled` : 'None enrolled'}</dd>
              </div>
              <div>
                <dt>Last intelligence sync</dt>
                <dd>{overview.intelligence_synced_at ? formatOperationalTime(overview.intelligence_synced_at) : 'Unknown'}</dd>
              </div>
              <div>
                <dt>Inventories re-checked</dt>
                <dd>{overview.intel_repos_assessed ?? 0}</dd>
              </div>
              <div>
                <dt>New internet matches</dt>
                <dd>{overview.intel_new_matches ?? 0}</dd>
              </div>
            </dl>
            <p className="form-section__copy">{hostedNote || 'Hosted collector status is Unknown until the API answers. An online collector does not mean repositories were scanned.'}</p>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Repository token health</h2>
                  <p className="portal-surface__subtitle">Found, private/no access, or missing. Token values are never shown.</p>
                </div>
              </div>
              <DataTable
                label="Repository access"
                columns={[
                  { id: 'repo', header: 'Repository', cell: (item: RepoAccess) => known(item.repository) },
                  { id: 'mode', header: 'Collection', cell: (item: RepoAccess) => collectionModeLabel(item.collection_mode || 'hosted') },
                  { id: 'access', header: 'Token', cell: (item: RepoAccess) => <span title={item.access_detail || ''}>{accessLabel(item.access_state)}</span> },
                  { id: 'detail', header: 'Detail', cell: (item: RepoAccess) => item.access_detail || 'Unknown' },
                ]}
                rows={repoAccess.length ? repoAccess : repos.map((item) => ({ repository: item.repository, access_state: item.access_state, access_detail: item.access_detail, collection_mode: item.collection_mode }))}
                rowKey={(item) => item.repository}
                empty={<EmptyState title={loading ? 'Checking access' : 'No registered repositories'} body="Register a repository on Config, then return here. Tokens stay on the API." />}
              />
            </section>
            <div className="sec-vuln-split">
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <h2 className="portal-surface__title">Intelligence feeds</h2>
                    <p className="portal-surface__subtitle">Public advisories saved on the API, then matched to stored lockfiles.</p>
                  </div>
                </div>
                <DataTable
                  label="Intelligence feeds"
                  columns={sourceColumns}
                  rows={sources}
                  rowKey={(item) => item.provider}
                  empty={<EmptyState title={loading ? 'Loading feeds' : 'No intelligence sources'} body="Refresh intelligence after the API worker can reach the allowlisted feeds." />}
                />
              </section>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <h2 className="portal-surface__title">Private agents</h2>
                    <p className="portal-surface__subtitle">Workers upload inventory only. They do not print tokens or write findings.</p>
                  </div>
                </div>
                <DataTable
                  label="Private agents"
                  columns={agentColumns}
                  rows={agents}
                  rowKey={(item) => String(item.id)}
                  empty={<EmptyState title={loading ? 'Loading agents' : 'None enrolled'} body="Create a bootstrap token, then run the worker from a runner that can read the repository." />}
                />
                {isManager ? (
                  <form className="sec-vuln-inline" onSubmit={(event) => { event.preventDefault(); void enrollAgent(); }}>
                    <label className="label">Agent name<input className="input" value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="build-runner-1" /></label>
                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-primary" disabled={busy}>Create bootstrap token</button>
                    </div>
                  </form>
                ) : <p className="form-section__copy">Enrolling an agent needs a manager role.</p>}
                {bootstrap ? (
                  <div className="alert alert-success sec-vuln-token" role="status">
                    <span>Shown once. Put this in workers/.env as VULN_BOOTSTRAP_TOKEN.</span>
                    <code>{bootstrap}</code>
                    <CopyButton value={bootstrap} label="bootstrap token" />
                  </div>
                ) : null}
                <p className="form-section__copy">Set OPSTRELLIS_API_URL and VULN_BOOTSTRAP_TOKEN in workers/.env, then run:</p>
                <pre className="sec-vuln-run">python3 workers/vuln_agent.py</pre>
              </section>
            </div>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">CI / SBOM upload</h2>
                  <p className="portal-surface__subtitle">Bind a CycloneDX, SPDX, or SARIF document to a registered repository and commit. SARIF results without package identity are skipped. Images are not pulled from a Docker socket.</p>
                </div>
              </div>
              <form className="sec-vuln-inline sec-vuln-inline--ci" onSubmit={(event) => { event.preventDefault(); void uploadSbom(); }}>
                <label className="label">Repository
                  <select className="input" value={sbomRepo} onChange={(event) => setSbomRepo(event.target.value)}>
                    <option value="">Select a registered repository</option>
                    {repos.map((item) => <option key={item.id} value={item.id}>{item.repository}</option>)}
                  </select>
                </label>
                <label className="label">Commit SHA<input className="input" value={sbomCommit} onChange={(event) => setSbomCommit(event.target.value)} placeholder="Immutable commit" /></label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>Upload inventory</button>
                </div>
                <label className="label">SBOM or SARIF JSON<textarea className="input" rows={5} value={sbomText} onChange={(event) => setSbomText(event.target.value)} /></label>
              </form>
              <p className="form-section__copy">CI can also run <code>python3 workers/vuln_agent.py --ci</code> with VULN_PORTAL_TOKEN and VULN_REPOSITORY_ID.</p>
            </section>
          </div>
        ) : null}

        {tab === 'configuration' ? (
          <div className="sec-vuln-workspace">
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Repositories</h2>
                  <p className="portal-surface__subtitle">GitHub, GitLab, and Bitbucket URLs are accepted. Hosted tokens stay on the API. Record a runtime image digest on Services; images are not pulled.</p>
                </div>
                <Link className="btn btn-secondary" href="/security/vulnerabilities/policy">Repository policy</Link>
              </div>
              <form className="sec-vuln-inline" onSubmit={(event) => { event.preventDefault(); void registerRepo(); }}>
                <label className="label">Repository<input className="input" value={newRepo} onChange={(event) => setNewRepo(event.target.value)} placeholder="org/service or gitlab.com/group/service" /></label>
                <label className="label">Branch<input className="input" value={newRepoBranch} onChange={(event) => setNewRepoBranch(event.target.value)} /></label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy || !isManager}>Register</button>
                  <button type="button" className="btn btn-secondary" disabled={busy || !isManager} onClick={() => void registerFromServiceMap()}>Register from service map</button>
                </div>
              </form>
              {!isManager ? <p className="form-section__copy">Registering a repository needs a manager role.</p> : null}
              <DataTable
                label="Registered repositories"
                columns={repoColumns}
                rows={repos}
                rowKey={(item) => String(item.id)}
                empty={<EmptyState title={loading ? 'Loading repositories' : 'No repositories registered'} body="Register owner/name or a GitHub, GitLab, or Bitbucket URL, then open Repository policy. Pause stops scheduled scans and webhooks; Scan now still runs and history stays." />}
              />
            </section>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Weekly open-risk digest</h2>
                  <p className="portal-surface__subtitle">Owner teams receive confirmed Critical and High matches when a digest has not been sent in six days. Public advisories are not organization exposure. Empty coverage stays Unknown. Findings are not auto-closed.</p>
                </div>
              </div>
              <p className="form-section__copy">Set owner team on repository policy so the digest can route. Stale inventory stays Unknown until a stored snapshot exists.</p>
            </section>
          </div>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
