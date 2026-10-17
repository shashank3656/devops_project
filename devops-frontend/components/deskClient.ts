import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';
import { queryString, readWorkspaceScope, useWorkspaceScope, workspaceScopeBlock, workspaceScopeChoice, writeWorkspaceScope } from '@infragate/ui';

export function useDeskScope() {
  const router = useRouter();
  const { scope } = useWorkspaceScope();
  const seeded = useRef('');
  const projectId = queryString(router.query, 'project_id');
  const environment = queryString(router.query, 'environment');

  useEffect(() => {
    if (!router.isReady) return;
    const key = `${projectId}\n${environment}`;
    if (seeded.current === key) return;
    seeded.current = key;
    if (workspaceScopeBlock(projectId, environment)) return;
    const current = readWorkspaceScope();
    if (current.projectId !== projectId || current.environment !== environment) {
      writeWorkspaceScope({ projectId, environment });
    }
    const query = { ...router.query };
    delete query.project_id;
    delete query.environment;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  }, [environment, projectId, router]);

  return workspaceScopeChoice(projectId, environment, scope.projectId, scope.environment);
}

export function actorId(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem('devops_user');
    const id = raw ? Number((JSON.parse(raw) as { id?: number }).id) : 0;
    return Number.isInteger(id) && id > 0 ? id : 0;
  } catch {
    return 0;
  }
}

export function sessionRole(): 'viewer' | 'operator' {
  if (typeof window === 'undefined') return 'operator';
  try {
    const raw = localStorage.getItem('devops_user');
    const user = raw ? (JSON.parse(raw) as { user_type?: string; role?: string }) : {};
    const role = String(user.user_type || user.role || '').toLowerCase();
    return role === 'viewer' ? 'viewer' : 'operator';
  } catch {
    return 'operator';
  }
}

export async function deskCall(apiUrl: string, path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; body: unknown }> {
  const token = localStorage.getItem('devops_token');
  if (!token) {
    window.location.assign('/login');
    return { status: 401, body: null };
  }
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (response.status === 401) window.location.assign('/login');
  return { status: response.status, body: payload };
}
