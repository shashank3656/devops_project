import { useEffect, useState } from 'react';

export const WORKSPACE_SCOPE_KEY = 'setuops-workspace-scope';
export const WORKSPACE_SCOPE_EVENT = 'setuops-scope';

export type WorkspaceScope = {
  projectId: string;
  environment: string;
};

const EMPTY_SCOPE: WorkspaceScope = { projectId: '', environment: '' };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function readWorkspaceScope(): WorkspaceScope {
  if (typeof window === 'undefined') return EMPTY_SCOPE;
  try {
    const raw = localStorage.getItem(WORKSPACE_SCOPE_KEY);
    if (!raw) return EMPTY_SCOPE;
    const data = asRecord(JSON.parse(raw));
    return {
      projectId: typeof data.projectId === 'string' ? data.projectId : '',
      environment: typeof data.environment === 'string' ? data.environment : '',
    };
  } catch {
    return EMPTY_SCOPE;
  }
}

export function writeWorkspaceScope(scope: WorkspaceScope) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(WORKSPACE_SCOPE_KEY, JSON.stringify(scope));
  window.dispatchEvent(new CustomEvent(WORKSPACE_SCOPE_EVENT, { detail: scope }));
}

export function useWorkspaceScope() {
  const [scope, setScope] = useState<WorkspaceScope>(EMPTY_SCOPE);

  useEffect(() => {
    setScope(readWorkspaceScope());
    const refresh = () => setScope(readWorkspaceScope());
    window.addEventListener('storage', refresh);
    window.addEventListener(WORKSPACE_SCOPE_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(WORKSPACE_SCOPE_EVENT, refresh);
    };
  }, []);

  const updateScope = (partial: Partial<WorkspaceScope>) => {
    const next = { ...readWorkspaceScope(), ...partial };
    writeWorkspaceScope(next);
    setScope(next);
    return next;
  };

  return { scope, updateScope };
}

export type ScopeProject = {
  id: number | string;
  name: string;
  code?: string;
  environments?: string[];
};

export function scopeToQuery(scope: WorkspaceScope): Record<string, string> {
  const query: Record<string, string> = {};
  if (scope.projectId) query.project_id = scope.projectId;
  if (scope.environment) query.environment = scope.environment;
  return query;
}

export function queryToScope(query: Record<string, string | string[] | undefined>): Partial<WorkspaceScope> {
  const projectRaw = query.project_id;
  const envRaw = query.environment;
  const projectId = Array.isArray(projectRaw) ? projectRaw[0] : projectRaw;
  const environment = Array.isArray(envRaw) ? envRaw[0] : envRaw;
  const next: Partial<WorkspaceScope> = {};
  if (typeof projectId === 'string') next.projectId = projectId;
  if (typeof environment === 'string') next.environment = environment;
  return next;
}

export function normalizeScopeProjects(value: unknown): ScopeProject[] {
  if (!Array.isArray(value)) return [];
  const projects: ScopeProject[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const rawId = row.id ?? row.project_id;
    if (typeof rawId !== 'number' && typeof rawId !== 'string') continue;
    projects.push({
      id: rawId,
      name: typeof row.name === 'string' ? row.name : typeof row.project_name === 'string' ? row.project_name : `Project ${rawId}`,
      code: typeof row.code === 'string' ? row.code : typeof row.project_code === 'string' ? row.project_code : '',
      environments: Array.isArray(row.environments)
        ? row.environments.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry))
        : [],
    });
  }
  return projects;
}
