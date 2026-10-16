import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { useWorkspaceScope, WORKSPACE_SCOPE_EVENT, readWorkspaceScope, type WorkspacePayload } from '@infragate/ui';
import { loadTicketAudience } from '../lib/ticketAudience';

const DEVOPS_TOKEN_KEY = 'devops_token';
const emptyWorkspace: WorkspacePayload = {
  title: 'Operations queue',
  subtitle: 'Promotions, incidents, and production-impacting PRs.',
  needs_you: [],
  failed: [],
  pipeline: { stages: [] },
  activity: [],
};
const DEMO_BARS = [42, 58, 48, 72, 64, 88, 70];

interface SetupService {
  id: number;
  name: string;
  missingOwner: boolean;
  missingRepo: boolean;
}

export default function DevOpsDashboard() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const apiUrl = useApiUrl();
  const [workspace, setWorkspace] = useState<WorkspacePayload>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceCount, setServiceCount] = useState<number | null>(null);
  const [setupService, setSetupService] = useState<SetupService | null>(null);
  const { scope } = useWorkspaceScope();

  const loadWorkspace = useCallback(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      routerRef.current.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    const current = readWorkspaceScope();
    const headers = { Authorization: `Bearer ${token}` };
    const workspaceUrl = current.projectId.trim()
      ? `${apiUrl}/api/devops/workspace?project_id=${encodeURIComponent(current.projectId)}`
      : `${apiUrl}/api/devops/workspace`;
    const serviceUrl = current.projectId.trim()
      ? `${apiUrl}/api/devops/services?project_id=${encodeURIComponent(current.projectId)}`
      : `${apiUrl}/api/devops/services`;
    Promise.all([
      fetch(workspaceUrl, { headers }).then(async (res) => {
        if (res.status === 401) {
          routerRef.current.replace('/login');
          return null;
        }
        if (!res.ok) throw new Error(`Home could not load (${res.status}).`);
        return res.json();
      }),
      fetch(serviceUrl, { headers }).then(async (res) => (res.ok ? res.json() : null)),
    ])
      .then(([data, servicesBody]) => {
        if (!data?.workspace) throw new Error('Home response was empty.');
        const list = Array.isArray(servicesBody?.services) ? servicesBody.services : [];
        const scoped = current.projectId.trim()
          ? list.filter((item: { project_id?: number }) => String(item.project_id || '') === current.projectId)
          : list;
        setServiceCount(scoped.length);
        const incomplete = scoped.find((item: { team?: string; repo?: string; owner?: string }) => {
          const owner = String(item.team || item.owner || '').trim();
          const repo = String(item.repo || '').trim();
          return !owner || owner === 'Unknown' || !repo;
        });
        setSetupService(incomplete ? {
          id: Number(incomplete.id) || 0,
          name: String(incomplete.service || incomplete.name || 'Service'),
          missingOwner: !String(incomplete.team || incomplete.owner || '').trim() || String(incomplete.team || incomplete.owner || '') === 'Unknown',
          missingRepo: !String(incomplete.repo || '').trim(),
        } : null);
        return loadTicketAudience(apiUrl).then((audience) => {
          if (audience.scope === 'all') {
            setWorkspace(data.workspace);
            return;
          }
          setWorkspace({ ...data.workspace, needs_you: [], failed: [], activity: [] });
        });
      })
      .catch((err: Error) => {
        setWorkspace(emptyWorkspace);
        setServiceCount(null);
        setSetupService(null);
        setError(err?.message || 'Home could not load.');
      })
      .finally(() => setLoading(false));
  }, [apiUrl]);

  useEffect(() => {
    loadWorkspace();
  }, [apiUrl, loadWorkspace]);

  useEffect(() => {
    const onScope = () => loadWorkspace();
    window.addEventListener(WORKSPACE_SCOPE_EVENT, onScope);
    return () => window.removeEventListener(WORKSPACE_SCOPE_EVENT, onScope);
  }, [loadWorkspace]);

  const needsProject = scope.projectId.trim() === '';
  const incidentCount = (workspace.needs_you || []).filter((item) => String(item.kind || '').toLowerCase().includes('incident')).length;
  const waitingCount = (workspace.needs_you || []).length + (workspace.failed?.length || 0);
  const envLabel = scope.environment || 'this environment';
  const countText = (value: number) => (loading || error || needsProject ? 'Unknown' : String(value));
  const scoped = (href: string) => {
    if (!scope.projectId) return href;
    const params = new URLSearchParams({ project_id: scope.projectId });
    if (scope.environment) params.set('environment', scope.environment);
    return `${href}?${params.toString()}`;
  };
  const setupHref = setupService?.id ? `/services/${setupService.id}` : scoped('/services');
  const setupDone = setupService ? Number(!setupService.missingOwner) + Number(!setupService.missingRepo) : 0;

  return (
    <>
      <Head>
        <title>Overview - SetuOps</title>
      </Head>
      <DevOpsLayout>
        <div className="ops-home desk-landing">
          <header className="ops-home__head">
            <div>
              <p className="ops-home__eyebrow">Your control room</p>
              <h1>Your operations, at a glance.</h1>
              <p>A clear view of the work that needs you.</p>
            </div>
            <Link href={scoped('/my-work')} className="ops-home__primary">Open my work</Link>
          </header>

          {needsProject ? (
            <section className="ops-card">
              <h2>Select a project</h2>
              <p>Incidents, services, and reviews stay with the project you choose.</p>
            </section>
          ) : (
            <>
              {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
              <section className="ops-spotlight">
                <div className="ops-spotlight__copy">
                  <p className="ops-home__eyebrow">SetuOps / operations hub</p>
                  <h2>Less noise. More control.</h2>
                  <p>{setupService ? 'Start with the service that needs you. Ownership or repository is still missing.' : 'Nothing in this project is waiting for setup.'}</p>
                </div>
                <div className="ops-spotlight__action">
                  <small>01 SERVICE NEEDS ATTENTION</small>
                  <Link href={setupHref}>Complete service setup →</Link>
                </div>
              </section>

              <section className="ops-scores" aria-label="Operational scorecards">
                <Link href={scoped('/incidents')} className="ops-score ops-score--mint">
                  <span>Open incidents</span>
                  <strong>{loading ? '…' : countText(incidentCount)}</strong>
                  <small>{loading ? 'Checking this environment' : error ? 'Could not load incidents' : incidentCount ? `${incidentCount} open in ${envLabel}` : `No open incidents in ${envLabel}`}</small>
                </Link>
                <Link href={scoped('/my-work')} className="ops-score ops-score--lilac">
                  <span>Awaiting review</span>
                  <strong>{loading ? '…' : countText(waitingCount)}</strong>
                  <small>{loading ? 'Checking your queue' : error ? 'Could not load reviews' : waitingCount ? `${waitingCount} waiting for you` : 'Your approval queue is clear'}</small>
                </Link>
                <Link href={scoped('/services')} className="ops-score ops-score--blue">
                  <span>Registered services</span>
                  <strong>{loading ? '…' : serviceCount === null ? 'Unknown' : serviceCount}</strong>
                  <small>{setupService ? '1 service needs ownership' : 'Ownership is filled in'}</small>
                </Link>
                <Link href={scoped('/security/findings')} className="ops-score ops-score--peach">
                  <span>Scan coverage</span>
                  <strong>—</strong>
                  <small>Connect a scanner to begin</small>
                </Link>
              </section>

              <section className="ops-split">
                <article className="ops-card ops-card--chart">
                  <h2>Delivery activity</h2>
                  <p>Illustrative data · preview of the connected state</p>
                  <div className="ops-bars" aria-hidden="true">
                    {DEMO_BARS.map((height, index) => (
                      <i key={index}>
                        <b style={{ height: `${height}%` }} />
                        <b style={{ height: `${Math.max(24, height - 22)}%` }} />
                      </i>
                    ))}
                  </div>
                  <div className="ops-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
                  <div className="ops-legend"><em>● Changes</em><em>● Deployments</em><span>Demo values · not live telemetry</span></div>
                </article>
                <article className="ops-card ops-card--ready ops-ready">
                  <h2>Make your service production-ready</h2>
                  <p>{setupService ? setupService.name : 'No service is waiting'}</p>
                  <div className="ops-ready__meter">
                    <strong>{setupService ? `${setupDone} / 2` : '—'}</strong>
                    <span>Required setup checks completed</span>
                  </div>
                  <ul>
                    <li><span>{setupService?.missingOwner ? '○' : '●'}</span><span><strong>Assign an owner</strong><small>Route incidents to the right team</small></span></li>
                    <li><span>{setupService?.missingRepo ? '○' : '●'}</span><span><strong>Connect repository</strong><small>Trace changes back to source</small></span></li>
                  </ul>
                  <Link href={setupHref}>Open service →</Link>
                </article>
              </section>

              <section className="ops-actions">
                <Link href="/projects/new" className="ops-action ops-action--lilac">
                  <span>Onboard a project ↗</span>
                  <small>Team → cloud → environments</small>
                </Link>
                <Link href={scoped('/changes/new')} className="ops-action ops-action--blue">
                  <span>Create a change ↗</span>
                  <small>Plan, assess and request approval</small>
                </Link>
                <Link href={scoped('/cloud-accounts')} className="ops-action ops-action--mint">
                  <span>Connect your cloud ↗</span>
                  <small>Unlock inventory and security scans</small>
                </Link>
              </section>
            </>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
