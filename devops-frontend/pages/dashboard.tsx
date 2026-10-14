import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { MyWorkSummary } from '../components/MyWorkPanel';
import { useApiUrl } from '../context/ApiUrlContext';
import { WORKSPACE_SCOPE_EVENT, readWorkspaceScope, type WorkspacePayload } from '@infragate/ui';

const DEVOPS_TOKEN_KEY = 'devops_token';
const emptyWorkspace: WorkspacePayload = {
  title: 'Operations queue',
  subtitle: 'Promotions, incidents, and production-impacting PRs.',
  needs_you: [],
  failed: [],
  pipeline: { stages: [] },
  activity: [],
};

interface OncallRotation {
  id: number;
  username?: string;
  team_name?: string;
  active?: boolean;
  starts_at?: string;
  ends_at?: string;
}

export default function DevOpsDashboard() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [workspace, setWorkspace] = useState<WorkspacePayload>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotations, setRotations] = useState<OncallRotation[]>([]);
  const [healthWatching, setHealthWatching] = useState(0);
  const [healthRegressions, setHealthRegressions] = useState(0);
  const [healthHighRisk, setHealthHighRisk] = useState(0);
  const [healthBurned, setHealthBurned] = useState(0);

  const tokenHeaders = (): Record<string, string> => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadOpsControls = () => {
    fetch(`${apiUrl}/api/devops/oncall`, { headers: tokenHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRotations(Array.isArray(data?.rotations) ? data.rotations : []))
      .catch(() => {});
    fetch(`${apiUrl}/api/devops/health`, { headers: tokenHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setHealthWatching(data?.health?.summary?.watching || 0);
        setHealthRegressions(data?.health?.summary?.regressions || 0);
        setHealthHighRisk(data?.health?.summary?.high_risk_alerts || 0);
        setHealthBurned(data?.health?.summary?.burned_slos || 0);
      })
      .catch(() => {});
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

  const pagingNow = rotations.find((item) => item.active);
  const queue = [...(workspace.needs_you || []), ...(workspace.failed || [])].slice(0, 3);
  const incidentCount = (workspace.needs_you || []).filter((item) => String(item.kind || '').toLowerCase().includes('incident')).length || healthHighRisk;
  const blockedCount = workspace.failed?.length || 0;
  const healthyLabel = loading ? '…' : error ? 'Unknown' : healthWatching > 0 ? String(healthWatching) : 'Unknown';

  return (
    <>
      <Head>
        <title>Overview - SetuOps</title>
      </Head>
      <DevOpsLayout>
        <div className="v3-overview">
          <header className="v3-overview__hero">
            <p className="v3-overview__kicker">Operator workspace</p>
            <div className="v3-overview__hero-row">
              <div>
                <h1>Focus on what needs attention</h1>
                <p>Respond to incidents, unblock releases and keep services healthy.</p>
              </div>
              <Link href="/service-desk" className="btn btn-primary">Open service desk</Link>
            </div>
          </header>

          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}

          <section className="v3-metrics" aria-label="At a glance">
            <Link href="/incidents" className="v3-metric">
              <span>Active incidents</span>
              <strong>{loading ? '…' : incidentCount}</strong>
              <em>{healthHighRisk > 0 ? `${healthHighRisk} critical · respond now →` : 'Open incidents →'}</em>
            </Link>
            <Link href="/promotions" className="v3-metric">
              <span>Blocked releases</span>
              <strong>{loading ? '…' : blockedCount}</strong>
              <em>Review deployment gates →</em>
            </Link>
            <Link href="/credential-audit" className="v3-metric">
              <span>Critical findings</span>
              <strong>—</strong>
              <em>Scanner not connected →</em>
            </Link>
            <Link href="/health" className="v3-metric">
              <span>Services watching</span>
              <strong>{healthyLabel}</strong>
              <em>{healthRegressions > 0 ? `${healthRegressions} need attention →` : 'Open service status →'}</em>
            </Link>
          </section>

          <section className="v3-split">
            <div className="v3-panel">
              <div className="v3-panel__head">
                <h2>Your priority queue</h2>
                <Link href="/service-desk" className="btn btn-secondary">View all</Link>
              </div>
              {loading ? <p className="v3-muted">Loading workspace…</p> : null}
              {!loading && queue.length === 0 ? (
                <p className="v3-muted">Nothing is waiting. New incidents, blocked releases and findings will show up here.</p>
              ) : null}
              <ul className="v3-queue">
                {queue.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href || '/service-desk'}>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.meta}</small>
                      </span>
                      <em className={item.tone === 'danger' ? 'is-critical' : 'is-blocked'}>{item.tone === 'danger' ? 'Critical' : item.action || 'Open'}</em>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <aside className="v3-panel">
              <h2>Service health</h2>
              <p className="v3-muted">{error ? 'Health could not be loaded.' : 'Live workspace · missing telemetry stays unknown.'}</p>
              <dl className="v3-health">
                <div><dt>Watching</dt><dd>{loading ? '…' : healthWatching || 'Unknown'}</dd></div>
                <div><dt>Needs attention</dt><dd>{loading ? '…' : healthRegressions}</dd></div>
                <div><dt>Active incidents</dt><dd>{loading ? '…' : healthHighRisk}</dd></div>
                <div><dt>Burned SLOs</dt><dd>{loading ? '…' : healthBurned}</dd></div>
              </dl>
              {pagingNow ? <p className="v3-muted">On call: {pagingNow.username || 'Assigned'}</p> : null}
              <Link href="/health" className="btn btn-secondary">Open Service Status</Link>
            </aside>
          </section>

          <MyWorkSummary />

          <section>
            <h2 className="v3-shortcuts__title">Your shortcuts</h2>
            <div className="v3-shortcuts">
              <Link href="/incidents"><strong>Incidents →</strong><span>Respond and coordinate recovery</span></Link>
              <Link href="/promotions"><strong>Deployments →</strong><span>Review releases and blockers</span></Link>
              <Link href="/health"><strong>Cloud scans →</strong><span>Check coverage and findings</span></Link>
            </div>
          </section>

          <section className="v3-connect">
            <div>
              <strong>Bring your tools into one workspace</strong>
              <p>Review connected tools and resolve missing data at its source.</p>
            </div>
            <Link href="/cloud-accounts" className="btn btn-secondary">View connections</Link>
          </section>
        </div>
      </DevOpsLayout>
    </>
  );
}
