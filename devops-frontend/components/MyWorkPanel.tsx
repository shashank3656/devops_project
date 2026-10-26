import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  DeskError,
  DeskStateChip,
  WORK_KINDS,
  WORK_PAGE_SIZES,
  errorWorkView,
  hiddenWorkView,
  parseWorkView,
  unknownWorkView,
  useWorkspaceScope,
  workKind,
  workKindLabel,
  workPageSize,
  workRecordHref,
  workspaceFailure,
  workspaceQuery,
  workspaceScopeBlock,
  workspaceScopeChoice,
  workspaceServiceBlock,
  type WorkKind,
  type WorkPageSize,
  type WorkView,
} from '@infragate/ui';
import { useApiUrl } from '../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

type WaitingHandover = {
  id: number;
  team_name: string;
  shift_date: string;
  state: string;
  incoming_name: string;
  outgoing_name: string;
};

function HandoverWaitingPanel({ apiUrl }: { apiUrl: string }) {
  const [items, setItems] = useState<WaitingHandover[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    let cancel = false;
    fetch(`${apiUrl}/api/oncall/handovers?waiting=me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (cancel) return;
        if (!response.ok) {
          setMessage(typeof data.error === 'string' ? data.error : 'Handovers waiting for you could not be loaded.');
          setItems([]);
          return;
        }
        setMessage('');
        setItems(Array.isArray(data.handovers) ? data.handovers : []);
      })
      .catch(() => {
        if (!cancel) {
          setMessage('Handovers waiting for you could not be loaded.');
          setItems([]);
        }
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl]);

  return (
    <section className="portal-surface" aria-label="Handovers waiting for you">
      <div className="portal-surface__header">
        <div>
          <h2 className="portal-surface__title">Waiting for me</h2>
          <p className="portal-surface__subtitle">On-call handovers that still need you to submit or acknowledge. Acknowledgement can reassign open incidents when that option is on. Status is not changed to Fixed.</p>
        </div>
        <Link href="/on-call/handovers" className="btn btn-secondary btn-sm">All handovers</Link>
      </div>
      {message ? <p className="access-hint">{message}</p> : null}
      {items.length ? (
        <ul className="handover-cards">
          {items.map((row) => (
            <li key={row.id}>
              <Link href={`/on-call/handovers/${row.id}`}>
                {row.state === 'submitted' ? 'Acknowledge' : 'Submit'} {row.team_name}
              </Link>
              {' · '}{row.shift_date} · {row.outgoing_name} to {row.incoming_name}
            </li>
          ))}
        </ul>
      ) : !message ? <p>No handover is waiting for you.</p> : null}
    </section>
  );
}

const PLAIN_KIND: Record<WorkKind, string> = {
  deployment: 'Releases',
  incident: 'Incidents',
  security: 'Security',
  resource: 'Resources',
  owner: 'Ownership',
};

type LoadResult = {
  view: WorkView;
  message: string;
};

async function loadWorkspace(apiUrl: string, path: string, projectId: string, environment: string, extra: Record<string, string>): Promise<LoadResult> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return { view: unknownWorkView(), message: 'workspace request failed' };
  const response = await fetch(`${apiUrl}${path}?${workspaceQuery(projectId, environment, extra)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) {
    window.location.assign('/login');
    return { view: unknownWorkView(), message: '' };
  }
  if (!response.ok) {
    const failure = workspaceFailure(response.status, body);
    return { view: failure.state === 'error' ? errorWorkView() : hiddenWorkView(), message: failure.message };
  }
  return { view: parseWorkView(body, projectId, environment), message: '' };
}

export function MyWorkSummary() {
  const apiUrl = useApiUrl();
  const { scope } = useWorkspaceScope();
  const [view, setView] = useState<WorkView>(hiddenWorkView());
  const [message, setMessage] = useState('');
  const block = workspaceScopeBlock(scope.projectId, scope.environment);

  useEffect(() => {
    if (block) {
      setView(unknownWorkView());
      setMessage(block);
      return;
    }
    let cancel = false;
    setMessage('');
    loadWorkspace(apiUrl, '/api/workspace', scope.projectId, scope.environment, { page_size: '10' })
      .then((result) => {
        if (cancel) return;
        setView(result.view);
        setMessage(result.message);
      })
      .catch(() => {
        if (cancel) return;
        setView(errorWorkView());
        setMessage('workspace request failed');
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl, block, scope.environment, scope.projectId]);

  const shown = block ? unknownWorkView() : view;
  const href = block ? '/my-work' : `/my-work?${workspaceQuery(scope.projectId, scope.environment)}`;

  return (
    <section className="v3-panel" aria-label="My work and services">
      <div className="v3-panel__head">
        <h2>My work and services</h2>
        <DeskStateChip value={shown.state} />
        <Link href={href} className="btn btn-secondary">Open</Link>
      </div>
      <DeskError message={block || message} />
      <ul className="my-work__sections">
        {shown.sections.map((section) => (
          <li key={section.kind}>
            <Link href={block ? href : workRecordHref(scope.projectId, scope.environment, section.kind, '')}>
              <span>{workKindLabel(section.kind)}</span>
              <DeskStateChip value={section.state} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MyWorkDesk({
  projectId,
  environment,
  kind,
  service,
  page,
  pageSize,
  sourceId,
  onKind,
  onService,
  onPage,
  onPageSize,
}: {
  projectId: string;
  environment: string;
  kind: string;
  service: string;
  page: number;
  pageSize: WorkPageSize;
  sourceId: string;
  onKind: (kind: WorkKind | '') => void;
  onService: (service: string) => void;
  onPage: (page: number) => void;
  onPageSize: (size: WorkPageSize) => void;
}) {
  const apiUrl = useApiUrl();
  const { scope, updateScope } = useWorkspaceScope();
  const chosen = workspaceScopeChoice(projectId, environment, scope.projectId, scope.environment);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [pageView, setPageView] = useState<WorkView>(hiddenWorkView());
  const [workView, setWorkView] = useState<WorkView>(hiddenWorkView());
  const [serviceView, setServiceView] = useState<WorkView>(hiddenWorkView());
  const [message, setMessage] = useState('');
  const [serviceMessage, setServiceMessage] = useState('');
  const [draftService, setDraftService] = useState(service);
  const [loading, setLoading] = useState(true);
  const block = workspaceScopeBlock(chosen.projectId, chosen.environment);
  const selectedKind = workKind(kind);

  useEffect(() => {
    setDraftService(service);
  }, [service]);

  useEffect(() => {
    if (block) {
      const unknown = unknownWorkView();
      setPageView(unknown);
      setWorkView(unknown);
      setServiceView(hiddenWorkView());
      setMessage(block);
      setServiceMessage('');
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    const extra: Record<string, string> = { page: String(page), page_size: String(pageSize) };
    if (selectedKind) extra.kind = selectedKind;
    if (!workspaceServiceBlock(service)) extra.service = service.trim().toLowerCase();
    setMessage('');
    Promise.all([
      loadWorkspace(apiUrl, '/api/workspace', chosen.projectId, chosen.environment, { page_size: String(pageSize) }),
      loadWorkspace(apiUrl, '/api/workspace/work', chosen.projectId, chosen.environment, extra),
    ])
      .then(([pageResult, workResult]) => {
        if (cancel) return;
        const failed = pageResult.view.state === 'error' || workResult.view.state === 'error';
        setPageView(failed ? errorWorkView() : pageResult.view);
        setWorkView(failed ? errorWorkView() : workResult.view);
        setMessage(failed ? pageResult.message || workResult.message || 'workspace request failed' : '');
        setLoading(false);
      })
      .catch(() => {
        if (cancel) return;
        setPageView(errorWorkView());
        setWorkView(errorWorkView());
        setMessage('workspace request failed');
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl, block, chosen.environment, chosen.projectId, page, pageSize, selectedKind, service]);

  useEffect(() => {
    const serviceBlock = service ? workspaceServiceBlock(service) : 'One service is required.';
    if (block || serviceBlock) {
      setServiceView(hiddenWorkView());
      setServiceMessage(service && serviceBlock !== 'One service is required.' ? serviceBlock : '');
      return;
    }
    let cancel = false;
    loadWorkspace(apiUrl, '/api/workspace/services', chosen.projectId, chosen.environment, {
      service: service.trim().toLowerCase(),
      page: String(page),
      page_size: String(pageSize),
    })
      .then((result) => {
        if (cancel) return;
        setServiceView(result.view);
        setServiceMessage(result.message);
      })
      .catch(() => {
        if (cancel) return;
        setServiceView(errorWorkView());
        setServiceMessage('workspace request failed');
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl, block, chosen.environment, chosen.projectId, page, pageSize, service]);

  function applyService() {
    const next = draftService.trim().toLowerCase();
    const serviceBlock = workspaceServiceBlock(next);
    if (serviceBlock && next !== '') {
      setServiceMessage(serviceBlock);
      return;
    }
    onService(next);
  }

  useEffect(() => {
    if (!/^[1-9]\d*$/.test(chosen.projectId)) {
      setEnvironments([]);
      return;
    }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    let cancel = false;
    fetch(`${apiUrl}/api/devops/environment-catalog?project_id=${chosen.projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancel) return;
        const names = Array.isArray(body?.environments)
          ? body.environments.map((row: { name?: string }) => String(row?.name || '').trim()).filter(Boolean)
          : [];
        setEnvironments(names.length ? names : ['dev', 'uat', 'prod']);
      })
      .catch(() => {
        if (!cancel) setEnvironments(['dev', 'uat', 'prod']);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl, chosen.projectId]);

  const focused = sourceId && workView.items.some((item) => item.key.endsWith(`:${sourceId}`));
  const lastPage = Math.max(1, Math.ceil((block ? 0 : workView.total) / pageSize));
  const shownPage = block ? unknownWorkView() : pageView;
  const shownWork = block ? unknownWorkView() : workView;
  const shownMessage = block ? block : shownPage.state === 'error' ? message : '';

  const meta = (item: { owner: string; service: string }) => [item.service, item.owner].map((value) => value.trim()).filter(Boolean).join(' · ');

  const missingProject = !/^[1-9]\d*$/.test(chosen.projectId);
  const missingEnvironment = !missingProject && !chosen.environment;

  return (
    <div className="work-page">
      <header className="work-page__head">
        <div>
          <p className="ops-kicker">My work</p>
          <h1>Your personal work list</h1>
          <p>
            This page shows only the work assigned to you. Open an item to review it.
            The service desk is the full ticket list, including work that is not yours.
          </p>
        </div>
        <Link href="/service-desk" className="btn btn-secondary">Open service desk</Link>
      </header>
      <HandoverWaitingPanel apiUrl={apiUrl} />
      <section className="ops-actions-3" aria-label="What this page is for">
        <article className="ops-jump ops-jump--mint">
          <strong>See what is waiting</strong>
          <small>Releases, incidents, security items, cloud resources, and ownership changes assigned to you.</small>
        </article>
        <article className="ops-jump ops-jump--lilac">
          <strong>Review one item</strong>
          <small>Open it, then approve or leave it. The list itself does not release anything.</small>
        </article>
        <article className="ops-jump ops-jump--blue">
          <strong>Look up one service</strong>
          <small>After you choose an environment, search a service name to see only that service.</small>
        </article>
      </section>
      {block ? (
        <section className="ops-caught work-guide">
          <h2>{missingProject ? 'Choose a project to start' : 'Choose one environment to see your work'}</h2>
          <p>
            {missingProject
              ? 'Use the Project menu in the top bar. My work can list items only after a project is selected.'
              : 'All environments is too broad for a personal list. Pick the environment you are working in, then your assigned items appear here.'}
          </p>
          {missingEnvironment && environments.length > 0 ? (
            <div className="work-kinds" role="group" aria-label="Choose an environment">
              {environments.map((name) => (
                <button key={name} type="button" className="btn btn-secondary" onClick={() => updateScope({ environment: name })}>
                  Show {name}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {!block ? <section className="ops-minis" aria-label="Work summary">
        <article className="ops-mini ops-mini--mint">
          <span>Waiting on you</span>
          <strong>{loading || (shownPage.state !== 'ready' && shownPage.state !== 'empty' && shownPage.state !== 'stale') ? 'Unknown' : shownWork.total}</strong>
          <small>{shownWork.total ? 'Assigned items in this environment' : 'Nothing is assigned to you here'}</small>
        </article>
        <article className="ops-mini ops-mini--lilac">
          <span>Needs a decision</span>
          <strong>{loading || (shownPage.state !== 'ready' && shownPage.state !== 'empty' && shownPage.state !== 'stale') ? 'Unknown' : shownWork.items.filter((item) => /review|approv/i.test(item.state)).length}</strong>
          <small>Reviews and approvals on this page</small>
        </article>
        <Link href="/service-desk" className="ops-mini ops-mini--blue">
          <span>All tickets</span>
          <strong>Service desk</strong>
          <small>See tickets beyond your own queue</small>
        </Link>
      </section> : null}
      {!loading && !block && shownWork.items.length === 0 ? (
        <section className="ops-caught">
          <h2>Nothing is waiting on you.</h2>
          <p>No items are assigned to you in this environment. Change the environment in the top bar, or open the service desk to see every ticket.</p>
          <Link href="/service-desk" className="btn btn-primary">Open service desk</Link>
        </section>
      ) : null}
      {!block ? <DeskError message={shownMessage} /> : null}
      {!block && (loading || shownWork.items.length > 0) ? <section className="work-board" aria-label="Work list">
        <div className="work-toolbar">
          <div className="work-kinds" role="group" aria-label="Filter by type">
            <button type="button" className={selectedKind === '' ? 'is-selected' : ''} onClick={() => onKind('')}>All types</button>
            {WORK_KINDS.map((item) => {
              const section = shownPage.sections.find((entry) => entry.kind === item);
              return (
                <button type="button" key={item} className={selectedKind === item ? 'is-selected' : ''} onClick={() => onKind(item)}>
                  {PLAIN_KIND[item]}
                  {section && section.count > 0 ? <small>{section.count}</small> : null}
                </button>
              );
            })}
          </div>
          <label className="work-size">
            Items per page
            <select className="input" value={pageSize} onChange={(event) => onPageSize(workPageSize(event.target.value))} aria-label="Rows per page">
              {WORK_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <p className="work-empty">Loading work…</p> : null}
        {!loading && shownWork.items.length > 0 ? (
          <ul className="work-list">
            {shownWork.items.map((item) => (
              <li key={item.key}>
                <Link href={item.href} aria-current={focused && item.key.endsWith(`:${sourceId}`) ? 'true' : undefined}>
                  <span className="work-kind">{PLAIN_KIND[item.kind]}</span>
                  <span>
                    <strong>{item.label}</strong>
                    {meta(item) ? <small>{meta(item)}</small> : null}
                  </span>
                  <DeskStateChip value={item.state} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {!loading && !block && shownWork.items.length > 0 && lastPage > 1 ? (
          <div className="work-pager">
            <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
            <span>Page {page} of {lastPage}</span>
            <button type="button" className="btn btn-secondary" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>Next</button>
          </div>
        ) : null}
      </section> : null}
      {!block ? <section className="work-lookup" aria-label="Find one service">
        <h2>Find one service</h2>
        <p>Type a service name to see only the work for that service. Leave it blank and choose Show to return to your full list.</p>
        <form
          className="work-lookup__row"
          onSubmit={(event) => {
            event.preventDefault();
            applyService();
          }}
        >
          <input id="work-service" className="input" name="service" aria-label="Service name" value={draftService} autoComplete="off" placeholder="Example: payments-api" onChange={(event) => setDraftService(event.target.value)} />
          <button type="submit" className="btn btn-primary">Show this service</button>
        </form>
        <DeskError message={serviceMessage} />
        {serviceView.state === 'error' ? <p className="work-empty">This service could not be loaded.</p> : null}
        {!service || block || serviceMessage || serviceView.state === 'error' ? null : serviceView.items.length === 0 ? (
          <p className="work-empty">No work was found for this service.</p>
        ) : (
          <ul className="work-list">
            {serviceView.items.map((item) => (
              <li key={item.key}>
                <Link href={item.href}>
                  <span className="work-kind">{PLAIN_KIND[item.kind]}</span>
                  <span>
                    <strong>{item.label}</strong>
                    {meta(item) ? <small>{meta(item)}</small> : null}
                  </span>
                  <DeskStateChip value={item.state} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section> : null}
    </div>
  );
}

export function readWorkPageSize(value: string): WorkPageSize {
  return workPageSize(value);
}
