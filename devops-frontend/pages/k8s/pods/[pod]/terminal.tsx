import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import DevOpsLayout from '../../../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../../../context/ApiUrlContext';
import {
  buildK8sHref,
  fetchK8sPodExecProfile,
  fetchK8sTerminalSession,
  formatDateTime,
  K8sPodExecProfileData,
  K8sTerminalSessionData,
  K8sTerminalLaunchData,
  LogItem,
  launchK8sTerminalSession,
  readQueryString,
  sendK8sTerminalCommand,
  streamK8sLogAttach,
  streamK8sTerminalAttach,
} from '../../../../lib/k8sWorkspace';

function toneClass(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'running' || normalized === 'healthy' || normalized === 'available') {
    return 'k8s-data-pill k8s-data-pill--healthy';
  }
  if (normalized === 'warning' || normalized === 'pending') {
    return 'k8s-data-pill k8s-data-pill--expiring';
  }
  return 'k8s-data-pill k8s-data-pill--critical';
}

function buildSessionFromLaunch(launch: K8sTerminalLaunchData): K8sTerminalSessionData {
  return {
    projects: launch.projects,
    selected_project_id: launch.selected_project_id,
    selected_cluster: launch.selected_cluster,
    selected_namespace: launch.selected_namespace,
    selected_environment: launch.selected_environment,
    clusters: launch.clusters,
    namespaces: launch.namespaces,
    environments: launch.environments,
    session_id: launch.session_id,
    status: launch.status,
    cluster: launch.cluster,
    pod: launch.pod,
    container: launch.container,
    shell: launch.shell,
    command_preview: launch.command_preview,
    reason: launch.reason,
    created_at: launch.created_at,
    expires_at: launch.expires_at,
    last_activity_at: launch.last_activity_at,
    transcript: launch.initial_output,
  };
}

function liveTailKey(item: LogItem, index: number) {
  return `${item.timestamp}-${item.name}-${item.container}-${index}`;
}

function mergeLiveTail(current: LogItem[], next: LogItem[]): LogItem[] {
  const merged = [...current];
  const seen = new Set(current.map((item) => `${item.timestamp}-${item.name}-${item.container}-${item.message}`));
  next.forEach((item) => {
    const key = `${item.timestamp}-${item.name}-${item.container}-${item.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.unshift(item);
  });
  return merged.slice(0, 24);
}

type K8sTransportState = 'idle' | 'connecting' | 'attached' | 'reconnecting' | 'closed' | 'error';
type TerminalSnippet = {
  id: string;
  label: string;
  command: string;
  container: string;
  shell: string;
  created_at: string;
};

const TERMINAL_SNIPPETS_STORAGE_KEY = 'DEVOPS_K8S_TERMINAL_SNIPPETS';

function describeTransportState(state: K8sTransportState): string {
  switch (state) {
    case 'connecting':
      return 'Connecting';
    case 'attached':
      return 'Attached';
    case 'reconnecting':
      return 'Reconnecting';
    case 'closed':
      return 'Closed';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function getMinutesRemaining(expiresAt: string): number | null {
  const timestamp = Date.parse(expiresAt);
  if (Number.isNaN(timestamp)) return null;
  return Math.ceil((timestamp - Date.now()) / 60000);
}

function describeExpiryWindow(expiresAt: string): string {
  const remainingMinutes = getMinutesRemaining(expiresAt);
  if (remainingMinutes === null) return 'Expiry unknown';
  if (remainingMinutes <= 0) return 'Expired';
  if (remainingMinutes < 60) return `${remainingMinutes}m left`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m left` : `${hours}h left`;
}

function readTerminalSnippets(): TerminalSnippet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TERMINAL_SNIPPETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const candidate = item as Partial<TerminalSnippet>;
        const id = typeof candidate.id === 'string' ? candidate.id : '';
        const label = typeof candidate.label === 'string' ? candidate.label : '';
        const command = typeof candidate.command === 'string' ? candidate.command : '';
        const container = typeof candidate.container === 'string' ? candidate.container : '';
        const shell = typeof candidate.shell === 'string' ? candidate.shell : '';
        const createdAt = typeof candidate.created_at === 'string' ? candidate.created_at : '';
        if (!id || !label || !command) return null;
        return { id, label, command, container, shell, created_at: createdAt };
      })
      .filter((item): item is TerminalSnippet => Boolean(item));
  } catch {
    return [];
  }
}

function writeTerminalSnippets(next: TerminalSnippet[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TERMINAL_SNIPPETS_STORAGE_KEY, JSON.stringify(next));
}

export default function DevOpsK8sPodTerminalPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [detail, setDetail] = useState<K8sPodExecProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [podName, setPodName] = useState('');
  const [selectedContainer, setSelectedContainer] = useState('');
  const [selectedShell, setSelectedShell] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [reason, setReason] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [sessionData, setSessionData] = useState<K8sTerminalSessionData | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [transportState, setTransportState] = useState<K8sTransportState>('idle');
  const [tailTransportState, setTailTransportState] = useState<K8sTransportState>('idle');
  const [queryHydrated, setQueryHydrated] = useState(false);
  const [sessionAttachVersion, setSessionAttachVersion] = useState(0);
  const [tailAttachVersion, setTailAttachVersion] = useState(0);
  const [commandInput, setCommandInput] = useState('');
  const [sendingCommand, setSendingCommand] = useState(false);
  const [savedSnippets, setSavedSnippets] = useState<TerminalSnippet[]>([]);
  const [snippetLabel, setSnippetLabel] = useState('');
  const [snippetFeedback, setSnippetFeedback] = useState('');
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [liveTail, setLiveTail] = useState<LogItem[]>([]);
  const [tailStatus, setTailStatus] = useState('idle');
  const [tailIntervalSeconds, setTailIntervalSeconds] = useState(5);
  const targetKeyRef = useRef('');
  const sessionRetryCountRef = useRef(0);
  const tailRetryCountRef = useRef(0);

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(readQueryString(router.query.project_id));
    setClusterName(readQueryString(router.query.cluster_name));
    setNamespace(readQueryString(router.query.namespace));
    setEnvironment(readQueryString(router.query.environment));
    setPodName(readQueryString(router.query.pod_name) || readQueryString(router.query.pod));
    setSelectedContainer(readQueryString(router.query.container));
    setSelectedShell(readQueryString(router.query.shell));
    setActiveSessionId(readQueryString(router.query.session_id));
    setQueryHydrated(true);
  }, [
    router.isReady,
    router.query.cluster_name,
    router.query.container,
    router.query.environment,
    router.query.namespace,
    router.query.pod,
    router.query.pod_name,
    router.query.project_id,
    router.query.session_id,
    router.query.shell,
  ]);

  useEffect(() => {
    setSavedSnippets(readTerminalSnippets());
  }, []);

  useEffect(() => {
    if (!router.isReady || !podName) return;
    let active = true;
    setLoading(true);
    setError('');

    fetchK8sPodExecProfile(apiUrl, {
      project_id: projectId || undefined,
      cluster_name: clusterName || undefined,
      namespace: namespace || undefined,
      environment: environment || undefined,
      pod_name: podName,
    })
      .then((payload) => {
        if (!active) return;
        setDetail(payload);
      })
      .catch((err) => {
        if (!active) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : 'Failed to load pod terminal profile');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, environment, namespace, podName, projectId, refreshKey, router.isReady]);

  useEffect(() => {
    if (!detail) return;
    setSelectedContainer((current) => current || detail.available_containers[0] || '');
    setSelectedShell((current) => current || detail.default_shell || detail.allowed_shells[0] || '');
    setReason((current) => current || `Investigate pod ${detail.pod?.name || podName} runtime behavior`);
  }, [detail]);

  useEffect(() => {
    if (!detail) return;
    const nextTargetKey = [
      podName,
      clusterName || detail.cluster?.cluster_name || '',
      namespace || detail.pod?.namespace || '',
      environment,
      selectedContainer || detail.available_containers[0] || '',
      selectedShell || detail.default_shell || detail.allowed_shells[0] || '',
    ].join('::');
    if (!targetKeyRef.current) {
      targetKeyRef.current = nextTargetKey;
      return;
    }
    if (targetKeyRef.current === nextTargetKey) return;
    targetKeyRef.current = nextTargetKey;
    setLaunchError('');
    setActiveSessionId('');
    setSessionData(null);
    setSessionError('');
    setTransportState('idle');
    setTailTransportState('idle');
    sessionRetryCountRef.current = 0;
    tailRetryCountRef.current = 0;
    setSessionAttachVersion(0);
    setTailAttachVersion(0);
    setCommandInput('');
    setLiveTail([]);
    setTailStatus('idle');
  }, [clusterName, detail, environment, namespace, podName, selectedContainer, selectedShell]);

  const pod = detail?.pod;
  const scopeProjectId = projectId || String(detail?.selected_project_id || '');
  const scopeCluster = clusterName || pod?.cluster_name || '';
  const scopeNamespace = namespace || pod?.namespace || '';
  const sessionExpiryLabel = useMemo(
    () => (sessionData ? describeExpiryWindow(sessionData.expires_at) : 'Awaiting session'),
    [sessionData],
  );
  const activeContainerCount = detail?.available_containers.length || 0;
  const canReconnectSession = Boolean(activeSessionId) && transportState !== 'attached' && sessionData?.status !== 'expired';
  const canSendCommand =
    Boolean(activeSessionId) &&
    Boolean(commandInput.trim()) &&
    !sendingCommand &&
    sessionData?.status !== 'expired' &&
    transportState === 'attached';
  const suggestedSnippets = useMemo<TerminalSnippet[]>(() => {
    const shell = (selectedShell || detail?.default_shell || '').toLowerCase();
    const container = selectedContainer || detail?.available_containers[0] || '';
    const shellName = shell.includes('bash') ? '/bin/bash' : shell.includes('ash') ? '/bin/ash' : '/bin/sh';
    return [
      { id: 'suggested-pwd', label: 'Working dir', command: 'pwd', container, shell: shellName, created_at: '' },
      { id: 'suggested-env', label: 'Environment', command: 'printenv | sort', container, shell: shellName, created_at: '' },
      { id: 'suggested-processes', label: 'Processes', command: 'ps aux', container, shell: shellName, created_at: '' },
      { id: 'suggested-disk', label: 'Disk usage', command: 'df -h', container, shell: shellName, created_at: '' },
    ];
  }, [detail?.available_containers, detail?.default_shell, selectedContainer, selectedShell]);
  const commandPreview = useMemo(() => {
    if (!detail) return '';
    const resolvedPod = pod?.name || podName || '<pod>';
    const resolvedNamespace = pod?.namespace || scopeNamespace || 'default';
    const resolvedContainer = selectedContainer || detail.available_containers[0] || 'main';
    const resolvedShell = selectedShell || detail.default_shell || detail.allowed_shells[0] || '/bin/sh';
    return `kubectl exec -it -n ${resolvedNamespace} ${resolvedPod} -c ${resolvedContainer} -- ${resolvedShell}`;
  }, [detail, pod?.name, pod?.namespace, podName, scopeNamespace, selectedContainer, selectedShell]);

  async function handleCopy() {
    if (!commandPreview || typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopyState('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(commandPreview);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('failed');
    }
  }

  async function handleCopySessionLink() {
    if (typeof window === 'undefined' || !navigator.clipboard) {
      setShareState('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${router.asPath}`);
      setShareState('copied');
      window.setTimeout(() => setShareState('idle'), 2000);
    } catch {
      setShareState('failed');
    }
  }

  function handleApplySnippet(snippet: TerminalSnippet) {
    if (snippet.container) setSelectedContainer(snippet.container);
    if (snippet.shell) setSelectedShell(snippet.shell);
    setCommandInput(snippet.command);
    setSnippetFeedback(`Loaded snippet: ${snippet.label}`);
    window.setTimeout(() => setSnippetFeedback(''), 2200);
  }

  function handleSaveSnippet() {
    const command = commandInput.trim();
    if (!command) {
      setSnippetFeedback('Enter a command before saving a snippet.');
      return;
    }
    const label = snippetLabel.trim() || command.split(/\s+/).slice(0, 3).join(' ');
    const nextSnippet: TerminalSnippet = {
      id: `snippet-${Date.now()}`,
      label,
      command,
      container: selectedContainer || detail?.available_containers[0] || '',
      shell: selectedShell || detail?.default_shell || '',
      created_at: new Date().toISOString(),
    };
    const next = [nextSnippet, ...savedSnippets].slice(0, 8);
    setSavedSnippets(next);
    writeTerminalSnippets(next);
    setSnippetLabel('');
    setSnippetFeedback(`Saved snippet: ${label}`);
    window.setTimeout(() => setSnippetFeedback(''), 2200);
  }

  function handleDeleteSnippet(snippetId: string) {
    const next = savedSnippets.filter((item) => item.id !== snippetId);
    setSavedSnippets(next);
    writeTerminalSnippets(next);
  }

  async function handleLaunch() {
    if (!detail || !pod) return;
    setLaunching(true);
    setLaunchError('');
    sessionRetryCountRef.current = 0;
    tailRetryCountRef.current = 0;
    setTransportState('connecting');
    setTailTransportState('connecting');
    try {
      const payload = await launchK8sTerminalSession(apiUrl, {
        project_id: Number(scopeProjectId || detail.selected_project_id || 0),
        cluster_name: scopeCluster || pod.cluster_name,
        namespace: scopeNamespace || pod.namespace,
        environment: environment || undefined,
        pod_name: pod.name,
        container: selectedContainer || detail.available_containers[0] || undefined,
        shell: selectedShell || detail.default_shell || undefined,
        reason,
      });
      setActiveSessionId(payload.session_id);
      setSessionData(buildSessionFromLaunch(payload));
      setCommandInput('');
      setSessionError('');
    } catch (err) {
      setTransportState('error');
      setLaunchError(err instanceof Error ? err.message : 'Failed to launch terminal session');
    } finally {
      setLaunching(false);
    }
  }

  function handleReconnectTransport() {
    if (!activeSessionId) return;
    sessionRetryCountRef.current = 0;
    tailRetryCountRef.current = 0;
    setSessionError('');
    setTailStatus('reconnecting');
    setTransportState('reconnecting');
    setTailTransportState('reconnecting');
    setSessionAttachVersion((value) => value + 1);
    setTailAttachVersion((value) => value + 1);
  }

  useEffect(() => {
    if (!router.isReady || !queryHydrated) return;
    const currentSessionId = readQueryString(router.query.session_id);
    const currentContainer = readQueryString(router.query.container);
    const currentShell = readQueryString(router.query.shell);
    const nextSessionId = activeSessionId.trim();
    const nextContainer = selectedContainer.trim();
    const nextShell = selectedShell.trim();
    if (currentSessionId === nextSessionId && currentContainer === nextContainer && currentShell === nextShell) return;
    const nextQuery: { [key: string]: string | string[] | undefined } = { ...router.query };
    if (nextSessionId) nextQuery.session_id = nextSessionId;
    else delete nextQuery.session_id;
    if (nextContainer) nextQuery.container = nextContainer;
    else delete nextQuery.container;
    if (nextShell) nextQuery.shell = nextShell;
    else delete nextQuery.shell;
    void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true, scroll: false });
  }, [activeSessionId, queryHydrated, router, selectedContainer, selectedShell]);

  useEffect(() => {
    if (!activeSessionId || !detail) return;
    let active = true;
    fetchK8sTerminalSession(apiUrl, {
      project_id: scopeProjectId || String(detail.selected_project_id || ''),
      cluster_name: scopeCluster || pod?.cluster_name || undefined,
      namespace: scopeNamespace || pod?.namespace || undefined,
      environment: environment || undefined,
      session_id: activeSessionId,
    })
      .then((payload) => {
        if (!active) return;
        setSessionData(payload);
        if (payload.status === 'expired') {
          setTransportState('closed');
          setSessionError('Terminal session expired');
        }
      })
      .catch((err) => {
        if (!active) return;
        setTransportState('error');
        setSessionError(err instanceof Error ? err.message : 'Failed to load terminal session');
      });
    return () => {
      active = false;
    };
  }, [activeSessionId, apiUrl, detail, environment, pod?.cluster_name, pod?.namespace, scopeCluster, scopeNamespace, scopeProjectId]);

  useEffect(() => {
    if (!activeSessionId || !detail) return;
    const controller = new AbortController();
    let retryTimer: number | undefined;
    setSessionError('');
    setTransportState(sessionAttachVersion > 0 ? 'reconnecting' : 'connecting');

    void streamK8sTerminalAttach(
      apiUrl,
      {
        project_id: scopeProjectId || String(detail.selected_project_id || ''),
        cluster_name: scopeCluster || pod?.cluster_name || undefined,
        namespace: scopeNamespace || pod?.namespace || undefined,
        environment: environment || undefined,
        session_id: activeSessionId,
      },
      (event) => {
        if (event.data) {
          sessionRetryCountRef.current = 0;
          setSessionData(event.data);
          setTransportState(event.data.status === 'expired' ? 'closed' : 'attached');
        }
        if (event.type === 'closed') {
          setSessionError(event.message || 'Terminal session closed');
          setTransportState('closed');
          return;
        }
        setSessionError('');
      },
      controller.signal,
    ).catch((err) => {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Failed to attach terminal session';
      setSessionError(message);
      if (sessionRetryCountRef.current < 2) {
        sessionRetryCountRef.current += 1;
        setTransportState('reconnecting');
        retryTimer = window.setTimeout(() => {
          setSessionAttachVersion((value) => value + 1);
        }, 2200);
        return;
      }
      setTransportState('error');
    });

    return () => {
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [
    activeSessionId,
    apiUrl,
    detail,
    environment,
    pod?.cluster_name,
    pod?.namespace,
    scopeCluster,
    scopeNamespace,
    scopeProjectId,
    sessionAttachVersion,
  ]);

  useEffect(() => {
    if (!activeSessionId || !detail || !pod) return;
    const controller = new AbortController();
    let retryTimer: number | undefined;
    setTailStatus('connecting');
    setTailTransportState(tailAttachVersion > 0 ? 'reconnecting' : 'connecting');

    void streamK8sLogAttach(
      apiUrl,
      {
        project_id: scopeProjectId || String(detail.selected_project_id || ''),
        cluster_name: scopeCluster || pod.cluster_name,
        namespace: scopeNamespace || pod.namespace,
        environment: environment || undefined,
        pod_name: pod.name,
        container: selectedContainer || undefined,
      },
      (event) => {
        if (!event.data) {
          if (event.message) {
            setTailStatus(event.message);
          }
          return;
        }
        const streamPayload = event.data;
        tailRetryCountRef.current = 0;
        setTailTransportState('attached');
        setTailStatus(streamPayload.stream_status || 'live');
        setTailIntervalSeconds(streamPayload.live_interval_seconds || 5);
        setLiveTail((current) =>
          event.type === 'snapshot' ? streamPayload.items.slice(0, 24) : mergeLiveTail(current, streamPayload.items),
        );
      },
      controller.signal,
    ).catch(() => {
      if (controller.signal.aborted) return;
      setTailStatus('degraded');
      if (tailRetryCountRef.current < 2) {
        tailRetryCountRef.current += 1;
        setTailTransportState('reconnecting');
        retryTimer = window.setTimeout(() => {
          setTailAttachVersion((value) => value + 1);
        }, 2200);
        return;
      }
      setTailTransportState('error');
    });

    return () => {
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [
    activeSessionId,
    apiUrl,
    detail,
    environment,
    pod,
    scopeCluster,
    scopeNamespace,
    scopeProjectId,
    selectedContainer,
    tailAttachVersion,
  ]);

  async function handleSendCommand() {
    if (!activeSessionId || !commandInput.trim() || transportState !== 'attached') return;
    setSendingCommand(true);
    setSessionError('');
    try {
      const payload = await sendK8sTerminalCommand(apiUrl, {
        session_id: activeSessionId,
        command: commandInput.trim(),
      });
      setSessionData(payload);
      setCommandInput('');
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : 'Failed to send terminal command');
    } finally {
      setSendingCommand(false);
    }
  }

  return (
    <>
      <Head>
        <title>Terminal Access - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Terminal Access"
          subtitle="Prepare the right exec target before we expose live terminal sessions. Operators can confirm scope, container choice, and the audited command that will be used."
          queryState={{ project_id: projectId, cluster_name: clusterName, namespace, environment }}
          actions={
            <div className="k8s-action-buttons">
              <Link
                className="btn btn-secondary"
                href={buildK8sHref(`/k8s/pods/${encodeURIComponent(pod?.name || podName)}`, {
                  project_id: scopeProjectId || undefined,
                  cluster_name: scopeCluster || undefined,
                  namespace: scopeNamespace || undefined,
                  environment: environment || undefined,
                  pod_name: pod?.name || podName,
                })}
              >
                Back to pod
              </Link>
              <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          }
        >
          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Exec groundwork</span>
                <h2 className="portal-surface__title">{pod?.name || podName || 'Pod terminal'}</h2>
                <p className="portal-surface__subtitle">
                  This is the guarded preflight view for terminal access. It keeps the cluster, container, shell, audit notes, and recent runtime signals together before we enable live exec sessions.
                </p>
              </div>
            </div>

            <div className="k8s-detail-grid">
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Cluster</span>
                <span className="k8s-detail-card__value">{detail?.cluster?.cluster_name || scopeCluster || '—'}</span>
                <span className="k8s-detail-card__meta">{pod?.namespace || scopeNamespace || 'default'} namespace</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Containers</span>
                <span className="k8s-detail-card__value">{detail?.available_containers.length || 0}</span>
                <span className="k8s-detail-card__meta">{detail?.available_containers.join(', ') || 'No containers detected yet'}</span>
              </div>
              <div className="k8s-detail-card">
                <span className="k8s-detail-card__label">Access model</span>
                <span className="k8s-detail-card__value">{detail?.access_model || 'Manager reviewed'}</span>
                <span className="k8s-detail-card__meta">{detail?.audit_hint || 'Every terminal launch should be audited.'}</span>
              </div>
            </div>

            <div className="k8s-filterbar k8s-filterbar--resources">
              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Container</span>
                <select
                  className="input k8s-filterbar__input"
                  value={selectedContainer}
                  onChange={(event) => setSelectedContainer(event.target.value)}
                >
                  {(detail?.available_containers || []).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Shell</span>
                <select className="input k8s-filterbar__input" value={selectedShell} onChange={(event) => setSelectedShell(event.target.value)}>
                  {(detail?.allowed_shells || []).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <div className="k8s-filterbar__actions">
                <span className="portal-pill">Audited preview</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
                  {copyState === 'copied' ? 'Copied' : 'Copy command'}
                </button>
              </div>
            </div>

            {activeContainerCount > 1 ? (
              <div className="k8s-terminal-targets">
                <span className="k8s-filterbar__label">Quick container switch</span>
                <div className="k8s-terminal-targets__chips">
                  {detail!.available_containers.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`k8s-terminal-targets__chip${selectedContainer === item ? ' k8s-terminal-targets__chip--active' : ''}`}
                      onClick={() => setSelectedContainer(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="k8s-command-block">
              <code>{commandPreview || detail?.command_preview || 'No command preview available yet.'}</code>
            </div>

            {launchError ? (
              <div className="alert alert-error" role="alert">
                {launchError}
              </div>
            ) : null}

            <div className="k8s-terminal-grid">
              <section className="k8s-terminal-panel">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Launch request</span>
                    <h3 className="portal-surface__title">Audited terminal session</h3>
                  </div>
                  {sessionData ? <span className="portal-pill">Transport attached</span> : <span className="portal-pill">Manager gated</span>}
                </div>
                <label className="k8s-terminal-panel__field">
                  <span className="k8s-detail-card__label">Reason</span>
                  <textarea
                    className="input k8s-terminal-panel__textarea"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why do you need terminal access for this pod?"
                  />
                </label>
                <p className="k8s-detail-card__meta">
                  We attach this reason to the audit log, along with the pod, container, shell, and launch timestamp.
                </p>
                <div className="k8s-terminal-panel__actions">
                  {detail?.k8s_access === 'write' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleLaunch}
                    disabled={launching || !reason.trim() || !detail}
                  >
                    {launching ? 'Launching...' : 'Launch audited session'}
                  </button>
                  ) : (
                    <p className="k8s-detail-card__meta">Write access is not granted for this project.</p>
                  )}
                  <button type="button" className="btn btn-secondary" onClick={handleCopy}>
                    {copyState === 'copied' ? 'Copied' : 'Copy command'}
                  </button>
                </div>
              </section>

              <section className="k8s-terminal-panel">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Session card</span>
                    <h3 className="portal-surface__title">Attached session</h3>
                  </div>
                </div>
                {sessionError ? (
                  <div className="alert alert-error" role="alert">
                    {sessionError}
                  </div>
                ) : null}
                {sessionData ? (
                  <div className="k8s-feed">
                    <div className="k8s-feed__item">
                      <div className="k8s-terminal-session__meta">
                        <div>
                          <div className="k8s-feed__header">
                            <span className="k8s-feed__title">{sessionData.session_id}</span>
                            <span className="portal-pill">{sessionData.status}</span>
                          </div>
                          <p className="k8s-feed__meta">
                            Started {formatDateTime(sessionData.created_at)} • Last activity {formatDateTime(sessionData.last_activity_at)}
                          </p>
                          <p className="k8s-feed__meta">
                            Expires {formatDateTime(sessionData.expires_at)} • {sessionData.cluster?.cluster_name || scopeCluster} •{' '}
                            {sessionData.pod?.namespace || scopeNamespace}
                          </p>
                        </div>
                        <div className="portal-pill-row">
                          <span className="portal-pill">Transport {describeTransportState(transportState)}</span>
                          <span className="portal-pill">Tail {describeTransportState(tailTransportState)}</span>
                        </div>
                      </div>
                      <div className="portal-pill-row">
                        <span className="portal-pill">Expiry {sessionExpiryLabel}</span>
                        <span className="portal-pill">Container {sessionData.container || selectedContainer || 'main'}</span>
                        <span className="portal-pill">Shell {sessionData.shell}</span>
                        {activeSessionId ? <span className="portal-pill">Resume ready</span> : null}
                      </div>
                      <p className="k8s-feed__message">{sessionData.reason || reason}</p>
                    </div>
                    <div className="k8s-command-block">
                      <code>{sessionData.command_preview}</code>
                    </div>
                    <div className="k8s-terminal-panel__actions">
                      {canReconnectSession ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={handleReconnectTransport}>
                          Reconnect transport
                        </button>
                      ) : null}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopySessionLink}>
                        {shareState === 'copied' ? 'Session link copied' : 'Copy session link'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSessionData((current) => (current ? { ...current, transcript: [] } : current))}
                        disabled={!sessionData.transcript.length}
                      >
                        Clear visible transcript
                      </button>
                    </div>
                    <div className="k8s-terminal-console">
                      {(sessionData.transcript || []).map((line, index) => (
                        <code key={`${sessionData.session_id}-${index}`}>{line}</code>
                      ))}
                    </div>
                    <div className="k8s-terminal-command-form">
                      <input
                        className="input k8s-terminal-command-input"
                        value={commandInput}
                        onChange={(event) => setCommandInput(event.target.value)}
                        placeholder="Type a command for the attached session"
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void handleSendCommand();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleSendCommand}
                        disabled={!canSendCommand}
                      >
                        {sendingCommand ? 'Sending...' : 'Send command'}
                      </button>
                    </div>
                    <div className="k8s-terminal-live-tail">
                      <div className="k8s-terminal-live-tail__header">
                        <span className="portal-surface__eyebrow">Live pod tail</span>
                        <div className="portal-pill-row">
                          <span className="portal-pill">{describeTransportState(tailTransportState)}</span>
                          <span className="portal-pill">{tailStatus}</span>
                          <span className="portal-pill">Every {tailIntervalSeconds}s</span>
                        </div>
                      </div>
                      {activeContainerCount > 1 ? (
                        <div className="k8s-terminal-targets__chips">
                          {detail!.available_containers.map((item) => (
                            <button
                              key={`tail-${item}`}
                              type="button"
                              className={`k8s-terminal-targets__chip${selectedContainer === item ? ' k8s-terminal-targets__chip--active' : ''}`}
                              onClick={() => setSelectedContainer(item)}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {liveTail.length > 0 ? (
                        <div className="k8s-terminal-transcript">
                          {liveTail.map((item, index) => (
                            <code key={liveTailKey(item, index)}>
                              [{formatDateTime(item.timestamp)}] {item.container || selectedContainer || 'main'}: {item.message}
                            </code>
                          ))}
                        </div>
                      ) : (
                        <div className="portal-empty">
                          <p>No live log lines have arrived for this pod yet.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="portal-empty">
                    <p>Launch a session to attach the transcript, command input, and live pod tail to this terminal surface.</p>
                  </div>
                )}
              </section>
            </div>

            <div className="k8s-spotlight-grid">
              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Saved snippets</span>
                    <h3 className="portal-surface__title">Reusable operator commands</h3>
                  </div>
                </div>
                <div className="k8s-terminal-snippet-form">
                  <input
                    className="input"
                    value={snippetLabel}
                    onChange={(event) => setSnippetLabel(event.target.value)}
                    placeholder="Snippet label"
                  />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleSaveSnippet} disabled={!commandInput.trim()}>
                    Save current command
                  </button>
                </div>
                {snippetFeedback ? <p className="k8s-detail-card__meta">{snippetFeedback}</p> : null}
                <div className="k8s-terminal-snippets">
                  {savedSnippets.length > 0 ? (
                    savedSnippets.map((snippet) => (
                      <div key={snippet.id} className="k8s-terminal-snippet">
                        <div>
                          <div className="k8s-feed__header">
                            <span className="k8s-feed__title">{snippet.label}</span>
                            <span className="portal-pill">{snippet.container || 'all containers'}</span>
                          </div>
                          <p className="k8s-feed__meta">{snippet.shell || 'default shell'}</p>
                          <code className="k8s-terminal-snippet__command">{snippet.command}</code>
                        </div>
                        <div className="k8s-terminal-panel__actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleApplySnippet(snippet)}>
                            Load
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleDeleteSnippet(snippet.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="portal-empty">
                      <p>Save a command once and it becomes part of your operator toolkit for the next session.</p>
                    </div>
                  )}
                </div>
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Quick starters</span>
                    <h3 className="portal-surface__title">Container-aware command set</h3>
                  </div>
                </div>
                <div className="k8s-terminal-targets__chips">
                  {suggestedSnippets.map((snippet) => (
                    <button
                      key={snippet.id}
                      type="button"
                      className="k8s-terminal-targets__chip"
                      onClick={() => handleApplySnippet(snippet)}
                    >
                      {snippet.label}
                    </button>
                  ))}
                </div>
                <p className="k8s-detail-card__meta">
                  These starter commands follow the currently selected container and shell, so they stay safe for quick investigations.
                </p>
                <div className="k8s-terminal-handoff">
                  <div>
                    <div className="k8s-feed__header">
                      <span className="k8s-feed__title">Session handoff</span>
                      {activeSessionId ? <span className="portal-pill">Shareable</span> : <span className="portal-pill">Pending launch</span>}
                    </div>
                    <p className="k8s-feed__meta">
                      Share the exact pod, container, shell, and active session state with another operator without re-explaining the scope.
                    </p>
                  </div>
                  <div className="k8s-terminal-panel__actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopySessionLink}>
                      {shareState === 'copied' ? 'Link copied' : 'Copy handoff link'}
                    </button>
                  </div>
                </div>
              </section>
            </div>

            <div className="k8s-spotlight-grid">
              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Recent events</span>
                    <h3 className="portal-surface__title">Pod event trail</h3>
                  </div>
                </div>
                {(detail?.recent_events || []).length > 0 ? (
                  detail!.recent_events.map((item) => (
                    <div key={item.id || `${item.reason}-${item.timestamp}`} className="k8s-log-feed__item">
                      <div className="k8s-log-feed__meta">
                        <span className={toneClass(item.severity)}>{item.severity}</span>
                        <span>{item.reason}</span>
                        <span>{formatDateTime(item.timestamp)}</span>
                      </div>
                      <div className="k8s-log-feed__message">{item.message}</div>
                    </div>
                  ))
                ) : (
                  <div className="portal-empty">
                    <p>No recent events are available for this pod yet.</p>
                  </div>
                )}
              </section>

              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Recent logs</span>
                    <h3 className="portal-surface__title">Container signals</h3>
                  </div>
                </div>
                {(detail?.recent_logs || []).length > 0 ? (
                  detail!.recent_logs.map((item, index) => (
                    <div key={`${item.timestamp}-${index}`} className="k8s-log-feed__item">
                      <div className="k8s-log-feed__meta">
                        <span className={toneClass(item.level || 'info')}>{item.level || 'info'}</span>
                        <span>{item.container || selectedContainer || 'main'}</span>
                        <span>{formatDateTime(item.timestamp)}</span>
                      </div>
                      <div className="k8s-log-feed__message">{item.message}</div>
                    </div>
                  ))
                ) : (
                  <div className="portal-empty">
                    <p>No recent logs are available for this pod yet.</p>
                  </div>
                )}
              </section>
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
