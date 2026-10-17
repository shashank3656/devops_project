import {
  DESK_REJECTED_MESSAGE,
  deskErrorText,
  deskSubmitBlock,
  deskValueRejected,
  normalizeDeskState,
  type DeskState,
} from './deskRules';

export const WORK_KINDS = ['deployment', 'incident', 'security', 'resource', 'owner'] as const;
export const WORK_PAGE_SIZES = [10, 25, 50] as const;

export type WorkKind = (typeof WORK_KINDS)[number];
export type WorkPageSize = (typeof WORK_PAGE_SIZES)[number];

export type WorkSection = {
  kind: WorkKind;
  state: DeskState;
  count: number;
};

export type WorkRecord = {
  key: string;
  label: string;
  state: DeskState;
  kind: WorkKind;
  href: string;
  owner: string;
  service: string;
};

export type WorkView = {
  state: DeskState;
  sections: WorkSection[];
  items: WorkRecord[];
  page: number;
  pageSize: WorkPageSize;
  total: number;
};

const PAGE_RANK: Record<DeskState, number> = { error: 5, stale: 4, unknown: 3, empty: 2, ready: 1 };

export function workKindLabel(kind: string): string {
  switch (kind) {
    case 'deployment':
      return 'Deployment';
    case 'incident':
      return 'Incident';
    case 'security':
      return 'Security';
    case 'resource':
      return 'Resource';
    case 'owner':
      return 'Owner';
    default:
      return 'Work';
  }
}

export function workspacePageState(sections: readonly { state: unknown }[]): DeskState {
  let state: DeskState = 'empty';
  for (const section of sections) {
    const next = normalizeDeskState(section.state);
    if (PAGE_RANK[next] > PAGE_RANK[state]) state = next;
  }
  return state;
}

export function workspaceServiceKey(value: string): boolean {
  const folded = value.trim().toLowerCase();
  if (folded === '' || folded.length > 64 || /[ \n,*]/.test(folded)) return false;
  return !deskValueRejected(folded);
}

export function workspaceScopeBlock(projectId: string, environment: string): string {
  if (!/^[1-9]\d*$/.test(projectId)) return 'One project is required.';
  return deskSubmitBlock(true, environment);
}

export function workspaceScopeChoice(
  linkedProject: string,
  linkedEnvironment: string,
  scopeProject: string,
  scopeEnvironment: string,
): { projectId: string; environment: string } {
  if (linkedProject || linkedEnvironment) return { projectId: linkedProject, environment: linkedEnvironment };
  return { projectId: scopeProject, environment: scopeEnvironment };
}

export function workspaceServiceBlock(service: string): string {
  if (service.trim() === '') return 'One service is required.';
  if (!workspaceServiceKey(service)) return DESK_REJECTED_MESSAGE;
  return '';
}

export function workPageSize(value: unknown): WorkPageSize {
  const size = typeof value === 'number' ? value : Number(value);
  if (size === 25 || size === 50) return size;
  return 10;
}

export function workKind(value: string): WorkKind | '' {
  const folded = value.trim().toLowerCase();
  if (folded === 'deployment' || folded === 'incident' || folded === 'security' || folded === 'resource' || folded === 'owner') {
    return folded;
  }
  return '';
}

export function workspaceQuery(projectId: string, environment: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  params.set('project_id', projectId);
  params.set('environment', environment.trim().toLowerCase());
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function workRecordHref(projectId: string, environment: string, kind: string, sourceId: string, service = ''): string {
  const params = new URLSearchParams();
  params.set('project_id', projectId);
  params.set('environment', environment.trim().toLowerCase());
  params.set('kind', kind);
  if (service) params.set('service', service);
  if (sourceId && !deskValueRejected(sourceId)) params.set('source_id', sourceId);
  return `/my-work?${params.toString()}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function emptyView(): WorkView {
  return {
    state: 'empty',
    sections: WORK_KINDS.map((kind) => ({ kind, state: 'empty', count: 0 })),
    items: [],
    page: 1,
    pageSize: 10,
    total: 0,
  };
}

export function parseWorkView(body: unknown, projectId: string, environment: string): WorkView {
  const record = asRecord(body);
  const rawSections = Array.isArray(record.sections) ? record.sections : [];
  const byKind = new Map<string, WorkSection>();
  for (const entry of rawSections) {
    const section = asRecord(entry);
    const kind = workKind(typeof section.kind === 'string' ? section.kind : '');
    if (!kind) continue;
    const count = typeof section.count === 'number' && section.count > 0 ? section.count : 0;
    byKind.set(kind, { kind, state: normalizeDeskState(section.state), count });
  }
  const sections = WORK_KINDS.map((kind) => byKind.get(kind) || { kind, state: 'unknown' as DeskState, count: 0 });
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items: WorkRecord[] = [];
  for (const entry of rawItems) {
    const item = asRecord(entry);
    const kind = workKind(typeof item.kind === 'string' ? item.kind : '');
    const sourceId = typeof item.source_id === 'string' ? item.source_id.trim() : '';
    const service = typeof item.service_key === 'string' ? item.service_key.trim().toLowerCase() : '';
    const owner = typeof item.owner === 'string' ? item.owner.trim() : '';
    if (!kind || sourceId === '' || deskValueRejected(sourceId) || (service !== '' && deskValueRejected(service)) || (owner !== '' && deskValueRejected(owner))) {
      continue;
    }
    items.push({
      key: `${kind}:${sourceId}`,
      label: `${workKindLabel(kind)} ${sourceId}`,
      state: normalizeDeskState(item.state),
      kind,
      href: workRecordHref(projectId, environment, kind, sourceId, service),
      owner,
      service,
    });
  }
  const page = typeof record.page === 'number' && record.page > 0 ? record.page : 1;
  const total = typeof record.total === 'number' && record.total >= 0 ? record.total : items.length;
  const apiState = typeof record.state === 'string' ? normalizeDeskState(record.state) : workspacePageState(sections);
  return { state: apiState, sections, items, page, pageSize: workPageSize(record.page_size), total };
}

export function workspaceFailure(status: number, body: unknown): { hidden: boolean; state: DeskState; message: string } {
  if (status === 404) return { hidden: true, state: 'empty', message: '' };
  const message = deskErrorText(body && typeof body === 'object' ? body : { error: 'workspace request failed' });
  return { hidden: false, state: 'error', message: message === 'request failed' ? 'workspace request failed' : message };
}

export function hiddenWorkView(): WorkView {
  return emptyView();
}

export function errorWorkView(): WorkView {
  return {
    ...emptyView(),
    state: 'error',
    sections: WORK_KINDS.map((kind) => ({ kind, state: 'error', count: 0 })),
  };
}

export function unknownWorkView(): WorkView {
  return {
    ...emptyView(),
    state: 'unknown',
    sections: WORK_KINDS.map((kind) => ({ kind, state: 'unknown', count: 0 })),
  };
}
