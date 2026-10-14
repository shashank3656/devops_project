import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  DeskError,
  DeskStateChip,
  WORK_KINDS,
  WORK_PAGE_SIZES,
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
    return { view: { ...hiddenWorkView(), state: failure.state }, message: failure.message };
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
        setView({ ...hiddenWorkView(), state: 'error' });
        setMessage('workspace request failed');
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl, block, scope.environment, scope.projectId]);

  const href = block ? '/my-work' : `/my-work?${workspaceQuery(scope.projectId, scope.environment)}`;

  return (
    <section className="v3-panel" aria-label="My work and services">
      <div className="v3-panel__head">
        <h2>My work and services</h2>
        <DeskStateChip value={view.state} />
        <Link href={href} className="btn btn-secondary">Open</Link>
      </div>
      <DeskError message={message} />
      <ul className="my-work__sections">
        {view.sections.map((section) => (
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
      return;
    }
    let cancel = false;
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
        setPageView(pageResult.view);
        setWorkView(workResult.view);
        setMessage(pageResult.message || workResult.message);
      })
      .catch(() => {
        if (cancel) return;
        setPageView({ ...hiddenWorkView(), state: 'error' });
        setWorkView({ ...hiddenWorkView(), state: 'error' });
        setMessage('workspace request failed');
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
        setServiceView({ ...hiddenWorkView(), state: 'error' });
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
  const lastPage = Math.max(1, Math.ceil(workView.total / pageSize));

  return (
    <div className="desk-language">
      <header className="sd-hero">
        <div>
          <h1 className="sd-hero__title">My work and services</h1>
          <p className="sd-hero__subtitle">Deployment, incident, security, resource, and owner records for one project and one environment.</p>
        </div>
        <DeskStateChip value={pageView.state} />
      </header>
      <DeskError message={message} />
      <section className="desk-language__panel" aria-label="Page state">
        <h2>Sections</h2>
        <ul className="my-work__sections">
          {pageView.sections.map((section) => (
            <li key={section.kind}>
              <button type="button" onClick={() => onKind(section.kind)}>
                <span>{workKindLabel(section.kind)}</span>
                <DeskStateChip value={section.state} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="desk-language__panel" aria-label="Work list">
        <h2>Work</h2>
        <div className="desk-language__choices" role="group" aria-label="Kind">
          <button type="button" className={selectedKind === '' ? 'is-selected' : ''} onClick={() => onKind('')}>All</button>
          {WORK_KINDS.map((item) => (
            <button type="button" key={item} className={selectedKind === item ? 'is-selected' : ''} onClick={() => onKind(item)}>
              {workKindLabel(item)}
            </button>
          ))}
        </div>
        <div className="desk-language__choices" role="group" aria-label="Page size">
          {WORK_PAGE_SIZES.map((size) => (
            <button type="button" key={size} className={pageSize === size ? 'is-selected' : ''} onClick={() => onPageSize(size)}>
              {size}
            </button>
          ))}
        </div>
        {workView.items.length === 0 ? (
          <div className="desk-language__empty">
            <DeskStateChip value={workView.state === 'error' ? 'error' : 'empty'} />
            <p>{block ? 'Choose one project and one environment.' : 'No work in this environment.'}</p>
          </div>
        ) : (
          <ul className="desk-language__records">
            {workView.items.map((item) => (
              <li key={item.key} aria-current={focused && item.key.endsWith(`:${sourceId}`) ? 'true' : undefined}>
                <Link href={item.href}>{item.label}</Link>
                <DeskStateChip value={item.state} />
              </li>
            ))}
          </ul>
        )}
        <div className="desk-language__choices">
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
          <button type="button" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>Next</button>
        </div>
      </section>
      <section className="desk-language__panel" aria-label="Service list">
        <h2>Service</h2>
        <form
          className="desk-language__form"
          onSubmit={(event) => {
            event.preventDefault();
            applyService();
          }}
        >
          <label htmlFor="work-service">Service</label>
          <input id="work-service" name="service" value={draftService} autoComplete="off" onChange={(event) => setDraftService(event.target.value)} />
          <button type="submit" className="btn btn-primary">Show service</button>
        </form>
        <DeskError message={serviceMessage} />
        {serviceView.items.length === 0 ? (
          <div className="desk-language__empty">
            <DeskStateChip value={service && !serviceMessage ? serviceView.state : 'empty'} />
            <p>{service ? 'No records for this service.' : 'One service is required.'}</p>
          </div>
        ) : (
          <ul className="desk-language__records">
            {serviceView.items.map((item) => (
              <li key={item.key}>
                <Link href={item.href}>{item.label}</Link>
                <DeskStateChip value={item.state} />
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
