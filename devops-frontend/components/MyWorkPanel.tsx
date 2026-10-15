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
  const { scope } = useWorkspaceScope();
  const chosen = workspaceScopeChoice(projectId, environment, scope.projectId, scope.environment);
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

  const focused = sourceId && workView.items.some((item) => item.key.endsWith(`:${sourceId}`));
  const lastPage = Math.max(1, Math.ceil((block ? 0 : workView.total) / pageSize));
  const shownPage = block ? unknownWorkView() : pageView;
  const shownWork = block ? unknownWorkView() : workView;
  const shownMessage = block ? block : shownPage.state === 'error' ? message : '';

  const meta = (item: { owner: string; service: string }) => [item.service, item.owner].map((value) => value.trim()).filter(Boolean).join(' · ');

  return (
    <div className="work-page">
      <header className="work-page__head">
        <div>
          <h1>My work</h1>
          <p>Deployments, incidents, security, resources, and owners for the project and environment selected above.</p>
        </div>
        <DeskStateChip value={loading ? 'unknown' : shownPage.state} />
      </header>
      <DeskError message={shownMessage} />
      <section className="work-board" aria-label="Work list">
        <div className="work-toolbar">
          <div className="work-kinds" role="group" aria-label="Kind">
            <button type="button" className={selectedKind === '' ? 'is-selected' : ''} onClick={() => onKind('')}>All</button>
            {WORK_KINDS.map((item) => {
              const section = shownPage.sections.find((entry) => entry.kind === item);
              return (
                <button type="button" key={item} className={selectedKind === item ? 'is-selected' : ''} onClick={() => onKind(item)}>
                  {workKindLabel(item)}
                  {section && section.count > 0 ? <small>{section.count}</small> : null}
                </button>
              );
            })}
          </div>
          <label className="work-size">
            Rows
            <select className="input" value={pageSize} onChange={(event) => onPageSize(workPageSize(event.target.value))} aria-label="Rows per page">
              {WORK_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <p className="work-empty">Loading work…</p> : null}
        {!loading && !block && shownWork.items.length === 0 ? (
          <p className="work-empty">No work in this environment.</p>
        ) : null}
        {!loading && shownWork.items.length > 0 ? (
          <ul className="work-list">
            {shownWork.items.map((item) => (
              <li key={item.key}>
                <Link href={item.href} aria-current={focused && item.key.endsWith(`:${sourceId}`) ? 'true' : undefined}>
                  <span className="work-kind">{workKindLabel(item.kind)}</span>
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
      </section>
      <section className="work-lookup" aria-label="Service list">
        <h2>Look up a service</h2>
        <p>Enter one service name to see only its records.</p>
        <form
          className="work-lookup__row"
          onSubmit={(event) => {
            event.preventDefault();
            applyService();
          }}
        >
          <input id="work-service" className="input" name="service" aria-label="Service name" value={draftService} autoComplete="off" placeholder="Service name" onChange={(event) => setDraftService(event.target.value)} />
          <button type="submit" className="btn btn-primary">Show</button>
        </form>
        <DeskError message={serviceMessage} />
        {serviceView.state === 'error' ? <p className="work-empty">This service could not be loaded.</p> : null}
        {!service || block || serviceMessage || serviceView.state === 'error' ? null : serviceView.items.length === 0 ? (
          <p className="work-empty">No records for this service.</p>
        ) : (
          <ul className="work-list">
            {serviceView.items.map((item) => (
              <li key={item.key}>
                <Link href={item.href}>
                  <span className="work-kind">{workKindLabel(item.kind)}</span>
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
      </section>
    </div>
  );
}

export function readWorkPageSize(value: string): WorkPageSize {
  return workPageSize(value);
}
