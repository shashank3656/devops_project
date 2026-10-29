import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { useWorkspaceScope, WORKSPACE_SCOPE_EVENT, WorkQueue, readWorkspaceScope, type QueueItem, type WorkspacePayload } from '@infragate/ui';
import { loadTicketAudience } from '../lib/ticketAudience';
import { readRecentServices, type RecentService } from '../lib/recentServices';

const DEVOPS_TOKEN_KEY = 'devops_token';
const emptyWorkspace: WorkspacePayload = {
  title: 'Operations queue',
  subtitle: 'Promotions, incidents, and production-impacting PRs.',
  needs_you: [],
  failed: [],
  pipeline: { stages: [] },
  activity: [],
};
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
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [recentServices, setRecentServices] = useState<RecentService[]>([]);
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
      ? `${apiUrl}/api/devops/services?view=summary&project_id=${encodeURIComponent(current.projectId)}`
      : `${apiUrl}/api/devops/services?view=summary`;
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
        const summaryTotal = typeof servicesBody?.total === 'number' ? servicesBody.total : null;
        setServiceCount(summaryTotal);
        const incomplete = servicesBody?.setup && typeof servicesBody.setup === 'object' ? servicesBody.setup as { id?: number; service?: string; team?: string; repo?: string } : null;
        setSetupService(incomplete ? {
          id: Number(incomplete.id) || 0,
          name: String(incomplete.service || 'Service'),
          missingOwner: !String(incomplete.team || '').trim() || String(incomplete.team || '') === 'Unknown',
          missingRepo: !String(incomplete.repo || '').trim(),
        } : null);
        return loadTicketAudience(apiUrl).then((audience) => {
          setUpdatedAt(new Date());
          if (audience.scope === 'all') {
            setWorkspace(data.workspace);
            return;
          }
          setWorkspace({ ...data.workspace, activity: [] });
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
    setRecentServices(readRecentServices());
  }, [apiUrl, loadWorkspace]);

  useEffect(() => {
    const onScope = () => loadWorkspace();
    window.addEventListener(WORKSPACE_SCOPE_EVENT, onScope);
    return () => window.removeEventListener(WORKSPACE_SCOPE_EVENT, onScope);
  }, [loadWorkspace]);

  const allProjects = scope.projectId.trim() === '';
  const incidentCount = (workspace.needs_you || []).filter((item) => String(item.kind || '').toLowerCase().includes('incident')).length;
  const waitingCount = (workspace.needs_you || []).length + (workspace.failed?.length || 0);
  const envLabel = scope.environment || 'all environments';
  const freshness = updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  const countText = (value: number) => (loading || error ? 'Unknown' : String(value));
  const scoped = (href: string) => {
    const [path, existing] = href.split('?');
    const params = new URLSearchParams(existing || '');
    if (scope.projectId) params.set('project_id', scope.projectId);
    if (scope.environment) params.set('environment', scope.environment);
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };
  const actionItems: QueueItem[] = [
    ...(workspace.needs_you || []),
    ...(workspace.failed || []),
  ].map((item) => ({ ...item, href: scoped(item.href) }));
  const setupHref = setupService?.id ? `/services/${setupService.id}` : scoped('/services');
  const setupDone = setupService ? Number(!setupService.missingOwner) + Number(!setupService.missingRepo) : 0;

  return (
    <>
      <Head>
        <title>Overview - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="ops-home desk-landing">
          <header className="ops-home__head">
            <div>
              <p className="ops-home__eyebrow">Your control room</p>
              <h1>Attention</h1>
              <p>{allProjects ? 'Across every project you can access.' : `Work that needs you in this project · ${envLabel}.`}</p>
            </div>
            <Link href={scoped('/my-work')} className="ops-home__primary">Open my work</Link>
          </header>

          {serviceCount === 0 && !loading && !error ? (
            <section className="ops-card" aria-label="Platform setup">
              <div className="ops-card__head">
                <h2>Platform setup</h2>
                <span>Start here</span>
              </div>
              <ol className="ops-setup">
                <li><Link href="/projects/new">Project</Link> <small>Team and environments</small></li>
                <li><Link href={scoped('/cloud-accounts')}>Cloud account</Link> <small>Inventory stays empty until connected</small></li>
                <li><Link href={scoped('/cost')}>Billing import</Link> <small>Manual CUR 2.0. Incomplete is never $0</small></li>
                <li><Link href={scoped('/k8s')}>Cluster</Link> <small>Kubernetes is a breakdown of the cloud bill</small></li>
                <li><Link href={scoped('/security/findings')}>Scans</Link> <small>Missing coverage stays Unknown, never Secure</small></li>
              </ol>
            </section>
          ) : (
            <details className="ops-card" aria-label="Platform setup">
              <summary>Platform setup · Project → Cloud → Billing → Cluster → Scans</summary>
              <ol className="ops-setup">
                <li><Link href="/projects/new">Project</Link></li>
                <li><Link href={scoped('/cloud-accounts')}>Cloud account</Link></li>
                <li><Link href={scoped('/cost')}>Billing import</Link></li>
                <li><Link href={scoped('/k8s')}>Cluster</Link></li>
                <li><Link href={scoped('/security/findings')}>Scans</Link></li>
              </ol>
            </details>
          )}

          <section className="ops-card" aria-label="Needs my action">
            <div className="ops-card__head">
              <h2>Needs my action</h2>
              <span>
                {loading ? 'Loading…' : error ? 'Could not load' : actionItems.length === 0 ? 'Nothing waiting' : `${actionItems.length} in ${allProjects ? 'all projects' : envLabel}`}
              </span>
            </div>
            <WorkQueue
              items={actionItems}
              loading={loading}
              emptyPresentation="success"
              error={error || ''}
              onRetry={() => loadWorkspace()}
              emptyTitle="You're all caught up"
              emptyBody="Approvals, assigned incidents, handovers, failed requests, and coverage gaps show up here. Stale demo breaches stay on the ticket, not in this feed. Scorecard gaps stay on Scorecards."
            />
            <details className="access-hint">
              <summary>How these words are used</summary>
              <p>A team is the group that owns the work. A person is someone with a portal account. The owner is accountable for the record; the assignee is the person doing the current step. A service is the catalog entry; a resource is one cloud object that belongs to it.</p>
            </details>
          </section>

          <section className="ops-actions" aria-label="Everyday tasks">
            <Link href={scoped('/changes?status=new&mine=1')} className="ops-action ops-action--lilac">
              <span>Review a change</span>
              <small>Changes awaiting your approval</small>
            </Link>
            <Link href={scoped('/services')} className="ops-action ops-action--blue">
              <span>Find a service</span>
              <small>Open the catalog and search by name</small>
            </Link>
            <Link href={scoped('/incidents/new')} className="ops-action ops-action--mint">
              <span>Raise an incident</span>
              <small>Describe the impact. A draft stays in this browser</small>
            </Link>
            <Link href={scoped('/changes/new')} className="ops-action ops-action--blue">
              <span>Create a change</span>
              <small>From a pull request or a planned window</small>
            </Link>
          </section>

          {serviceCount === 0 && !loading && !error ? (
            <section className="ops-card">
              <h2>Onboard a project</h2>
              <p>No production catalogue yet. Create a project, then connect cloud, billing, and clusters from the same workspace.</p>
              <Link href="/projects/new" className="btn btn-primary">Onboard a project</Link>
            </section>
          ) : null}
              {error ? (
                <div className="alert alert-error ops-home__error" role="alert">
                  <span>{error}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={loadWorkspace}>
                    Try again
                  </button>
                </div>
              ) : null}

              <div className="ops-scores__meta">
                <span>Current state · {envLabel}</span>
                <span aria-live="polite">{loading ? 'Refreshing…' : error ? 'Not refreshed' : freshness}</span>
              </div>
              <section className="ops-scores" aria-label="Operational scorecards" aria-busy={loading}>
                <Link href={scoped('/incidents?mine=1')} className="ops-score ops-score--mint">
                  <span>My open incidents</span>
                  <strong>{loading ? '…' : countText(incidentCount)}</strong>
                  <small>{loading ? 'Loading…' : error ? 'Unknown · could not load' : `Assigned to you · ${freshness || 'not refreshed yet'}`}</small>
                </Link>
                <Link href={scoped('/tickets?status=pending_devops_approval')} className="ops-score ops-score--lilac">
                  <span>Awaiting your review</span>
                  <strong>{loading ? '…' : countText(waitingCount)}</strong>
                  <small>{loading ? 'Loading…' : error ? 'Unknown · could not load' : `Waiting now · ${freshness || 'not refreshed yet'}`}</small>
                </Link>
                <Link href={scoped('/services')} className="ops-score ops-score--blue">
                  <span>Registered services</span>
                  <strong>{loading ? '…' : serviceCount === null ? 'Unknown' : serviceCount}</strong>
                  <small>
                    {loading
                      ? 'Loading…'
                      : serviceCount === null
                        ? 'Unknown · could not load'
                        : `Catalog total · ${freshness || 'not refreshed yet'}`}
                  </small>
                </Link>
                <Link href={scoped('/security/findings')} className="ops-score ops-score--peach ops-score--disconnected">
                  <span>Scan coverage</span>
                  <strong>Not connected</strong>
                  <small>No scanner timeframe yet. Connect a scanner to begin.</small>
                </Link>
              </section>

              <p className="ops-scores__meta">
                My open incidents and reviews count stored records. Service readiness on Scorecards uses known checks only. Scan coverage stays Not connected until a scanner reports. Missing telemetry is Unknown.
              </p>

          {recentServices.length ? (
            <section className="ops-card" aria-label="Recently visited services">
              <h2>Recently visited services</h2>
              <ul className="recent-services">
                {recentServices.map((item) => (
                  <li key={item.id}>
                    <Link href={`/services/${item.id}`}>{item.name}</Link>
                    <span>{[item.project, item.environment].filter(Boolean).join(' · ') || 'Project unknown'}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

              {setupService ? (
                <article className="ops-card ops-card--ready ops-ready" aria-label="Complete service setup">
                  <h2>Complete service setup</h2>
                  <p>
                    <strong>{setupService.name}</strong> is missing {setupService.missingOwner && setupService.missingRepo ? 'an owner and a repository' : setupService.missingOwner ? 'an owner' : 'a repository'}.
                  </p>
                  <div className="ops-ready__meter">
                    <strong>{`${setupDone} / 2`}</strong>
                    <span>Required setup checks completed</span>
                  </div>
                  <ul>
                    <li><span aria-hidden>{setupService.missingOwner ? '○' : '●'}</span><span><strong>Assign an owner</strong><small>{setupService.missingOwner ? 'Not done' : 'Done'}</small></span></li>
                    <li><span aria-hidden>{setupService.missingRepo ? '○' : '●'}</span><span><strong>Connect repository</strong><small>{setupService.missingRepo ? 'Not done' : 'Done'}</small></span></li>
                  </ul>
                  <Link href={setupHref} className="btn btn-primary btn-sm">Complete service setup</Link>
                </article>
              ) : (
                <p className="ops-scores__meta">
                  Delivery counts appear after a repository is connected. <Link href={scoped('/deploy-intelligence')}>Connect delivery data</Link>
                </p>
              )}
        </div>
      </DevOpsLayout>
    </>
  );
}
