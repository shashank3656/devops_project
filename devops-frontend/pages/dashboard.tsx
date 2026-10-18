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

  const needsProject = scope.projectId.trim() === '';
  const incidentCount = (workspace.needs_you || []).filter((item) => String(item.kind || '').toLowerCase().includes('incident')).length;
  const waitingCount = (workspace.needs_you || []).length + (workspace.failed?.length || 0);
  const envLabel = scope.environment || 'all environments';
  const freshness = updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  const countText = (value: number) => (loading || error || needsProject ? 'Unknown' : String(value));
  const scoped = (href: string) => {
    const [path, existing] = href.split('?');
    const params = new URLSearchParams(existing || '');
    if (scope.projectId) params.set('project_id', scope.projectId);
    if (scope.environment) params.set('environment', scope.environment);
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };
  const actionItems: QueueItem[] = needsProject ? [] : [
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
              <h1>Your operations, at a glance.</h1>
              <p>A clear view of the work that needs you.</p>
            </div>
            <Link href={scoped('/my-work')} className="ops-home__primary">Open my work</Link>
          </header>

          <section className="ops-card" aria-label="Needs my action">
            <div className="ops-card__head">
              <h2>Needs my action</h2>
              <span>{loading ? 'Loading…' : `${actionItems.length} in ${envLabel}`}</span>
            </div>
            <WorkQueue
              items={actionItems}
              loading={loading}
              emptyTitle={needsProject ? 'Select a project' : "You're all caught up"}
              emptyBody={needsProject ? 'Approvals, assigned incidents, failed requests, and coverage gaps stay with the project you choose.' : 'Approvals, assigned incidents, failed requests, and coverage gaps will show up here.'}
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
          </section>

          <section className="ops-actions" aria-label="Primary actions">
            <Link href="/projects/new" className="ops-action ops-action--lilac">
              <span>Onboard a project</span>
              <small>Team → cloud → environments → access</small>
            </Link>
            <Link href={scoped('/changes/new')} className="ops-action ops-action--blue">
              <span>Create a change</span>
              <small>Plan, assess and request approval</small>
            </Link>
            <Link href={scoped('/cloud-accounts')} className="ops-action ops-action--mint">
              <span>Connect your cloud</span>
              <small>Unlock inventory and security scans</small>
            </Link>
          </section>

          {needsProject ? (
            <section className="ops-card">
              <h2>Select a project</h2>
              <p>Incidents, services, and reviews stay with the project you choose.</p>
            </section>
          ) : (
            <>
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
                  <span>Open incidents</span>
                  <strong>{loading ? '…' : countText(incidentCount)}</strong>
                  <small>{loading ? 'Loading…' : error ? 'Unknown · could not load' : `Open now · ${freshness || 'not refreshed yet'}`}</small>
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
                Open incidents and reviews count stored records. Service readiness on Scorecards uses known checks only. Scan coverage stays Not connected until a scanner reports. Missing telemetry is Unknown.
              </p>
            </>
          )}

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

          {needsProject ? null : (
            <>
              {setupService ? (
                <section className="ops-notice" aria-label="Service needs setup">
                  <p>
                    <strong>{setupService.name}</strong> is missing {setupService.missingOwner && setupService.missingRepo ? 'an owner and a repository' : setupService.missingOwner ? 'an owner' : 'a repository'}.
                  </p>
                  <Link href={setupHref} className="btn btn-primary btn-sm">Complete service setup</Link>
                </section>
              ) : null}

              <section className="ops-split">
                <article className="ops-card ops-card--chart">
                  <div className="ops-card__head">
                    <h2>Delivery activity</h2>
                  </div>
                  <p>Daily change and deployment counts appear here after a repository or pipeline is connected.</p>
                  <Link href={scoped('/deploy-intelligence')}>Connect delivery data</Link>
                </article>
                <article className="ops-card ops-card--ready ops-ready">
                  <h2>Make your service production-ready</h2>
                  <p>{setupService ? setupService.name : serviceCount === 0 ? 'Register a service to start' : 'No service is waiting for setup'}</p>
                  <div className="ops-ready__meter">
                    <strong>{setupService ? `${setupDone} / 2` : '—'}</strong>
                    <span>Required setup checks completed</span>
                  </div>
                  <ul>
                    <li><span aria-hidden>{setupService?.missingOwner ? '○' : '●'}</span><span><strong>Assign an owner</strong><small>{setupService ? (setupService.missingOwner ? 'Not done' : 'Done') : 'Route incidents to the right team'}</small></span></li>
                    <li><span aria-hidden>{setupService?.missingRepo ? '○' : '●'}</span><span><strong>Connect repository</strong><small>{setupService ? (setupService.missingRepo ? 'Not done' : 'Done') : 'Trace changes back to source'}</small></span></li>
                  </ul>
                  <Link href={setupHref}>{setupService ? 'Open service →' : 'View services →'}</Link>
                </article>
              </section>
            </>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
