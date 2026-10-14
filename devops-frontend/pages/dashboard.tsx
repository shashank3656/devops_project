import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { useWorkspaceScope, WORKSPACE_SCOPE_EVENT, readWorkspaceScope, type WorkspacePayload } from '@infragate/ui';

const DEVOPS_TOKEN_KEY = 'devops_token';
const emptyWorkspace: WorkspacePayload = {
  title: 'Operations queue',
  subtitle: 'Promotions, incidents, and production-impacting PRs.',
  needs_you: [],
  failed: [],
  pipeline: { stages: [] },
  activity: [],
};

export default function DevOpsDashboard() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [workspace, setWorkspace] = useState<WorkspacePayload>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState('Unknown');
  const [connections, setConnections] = useState<'unknown' | 'empty' | 'ready' | 'error'>('unknown');
  const { scope } = useWorkspaceScope();

  const tokenHeaders = (): Record<string, string> => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadOpsControls = () => {
    fetch(`${apiUrl}/api/devops/health`, { headers: tokenHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const observed = data?.health?.observed_at || data?.health?.summary?.observed_at;
        setFreshness(typeof observed === 'string' && observed.trim() ? observed : 'Unknown');
      })
      .catch(() => setFreshness('Unknown'));
    fetch(`${apiUrl}/api/connections`, { headers: tokenHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          setConnections('error');
          return;
        }
        const data = await res.json();
        const list = Array.isArray(data?.connections) ? data.connections : [];
        setConnections(list.length > 0 ? 'ready' : 'empty');
      })
      .catch(() => setConnections('error'));
  };

  const loadWorkspace = useCallback(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    const scope = readWorkspaceScope();
    const workspaceUrl =
      scope.projectId.trim() !== ''
        ? `${apiUrl}/api/devops/workspace?project_id=${encodeURIComponent(scope.projectId)}`
        : `${apiUrl}/api/devops/workspace`;
    fetch(workspaceUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace('/login');
          return null;
        }
        if (!res.ok) {
          throw new Error(`Home could not load (${res.status}).`);
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        if (!data.workspace) {
          throw new Error('Home response was empty.');
        }
        setWorkspace(data.workspace);
      })
      .catch((err: Error) => {
        setWorkspace(emptyWorkspace);
        setError(err?.message || 'Home could not load.');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  useEffect(() => {
    loadWorkspace();
    loadOpsControls();
  }, [apiUrl, loadWorkspace]);

  useEffect(() => {
    const onScope = () => {
      loadWorkspace();
    };
    window.addEventListener(WORKSPACE_SCOPE_EVENT, onScope);
    return () => window.removeEventListener(WORKSPACE_SCOPE_EVENT, onScope);
  }, [loadWorkspace]);

  const needsProject = scope.projectId.trim() === '';
  const queue = needsProject ? [] : [...(workspace.needs_you || []), ...(workspace.failed || [])].slice(0, 3);
  const incidentCount = (workspace.needs_you || []).filter((item) => String(item.kind || '').toLowerCase().includes('incident')).length;
  const blockedCount = workspace.failed?.length || 0;
  const scoped = (href: string) => {
    if (!scope.projectId) return href;
    const params = new URLSearchParams({ project_id: scope.projectId });
    if (scope.environment) params.set('environment', scope.environment);
    return `${href}?${params.toString()}`;
  };

  return (
    <>
      <Head>
        <title>Overview - SetuOps</title>
      </Head>
      <DevOpsLayout>
        <div className="v3-overview desk-landing">
          <header className="v3-overview__hero">
            <div className="v3-overview__hero-row">
              <div>
                <h1>What needs attention</h1>
                <p>One queue for this project. Missing data stays unknown.</p>
              </div>
              <Link href={scoped('/service-desk')} className="btn btn-primary">Open service desk</Link>
            </div>
          </header>

          {needsProject ? (
            <section className="v3-panel">
              <h2>Select a project</h2>
              <p className="v3-muted">Incidents, releases, and findings stay with the project you choose. All projects can browse. It cannot create work.</p>
            </section>
          ) : (
            <>
              {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
              <section className="v3-metrics" aria-label="At a glance">
                <Link href={scoped('/incidents')} className="v3-metric">
                  <span>Active incidents</span>
                  <strong>{loading || error ? 'Unknown' : incidentCount}</strong>
                  <em>Open incidents →</em>
                </Link>
                <Link href={scoped('/promotions')} className="v3-metric">
                  <span>Blocked releases</span>
                  <strong>{loading || error ? 'Unknown' : blockedCount}</strong>
                  <em>Review deployment gates →</em>
                </Link>
                <Link href={scoped('/security/findings')} className="v3-metric">
                  <span>Findings</span>
                  <strong>Unknown</strong>
                  <em>Scanner not connected →</em>
                </Link>
                <Link href="/health" className="v3-metric">
                  <span>Freshness</span>
                  <strong>{freshness === 'Unknown' ? 'Unknown' : 'Observed'}</strong>
                  <em>{freshness === 'Unknown' ? 'No observation time' : freshness}</em>
                </Link>
              </section>

              <section className="v3-panel">
                <div className="v3-panel__head">
                  <h2>Needs attention</h2>
                  <Link href={scoped('/my-work')} className="btn btn-secondary">My work</Link>
                </div>
                {loading ? <p className="v3-muted">Loading workspace…</p> : null}
                {!loading && queue.length === 0 ? (
                  <p className="v3-muted">Nothing is waiting in this project.</p>
                ) : null}
                <ul className="v3-queue">
                  {queue.map((item) => (
                    <li key={item.id}>
                      <Link href={item.href || scoped('/service-desk')}>
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.meta}</small>
                        </span>
                        <em className={item.tone === 'danger' ? 'is-critical' : 'is-blocked'}>{item.tone === 'danger' ? 'Critical' : item.action || 'Open'}</em>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {connections === 'empty' || connections === 'error' ? (
            <section className="v3-connect">
              <div>
                <strong>{connections === 'error' ? 'Connections could not be loaded' : 'No connections in this workspace'}</strong>
                <p>Open Connections to review health. A missing connection stays unknown.</p>
              </div>
              <Link href="/connections" className="btn btn-secondary">Open connections</Link>
            </section>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
