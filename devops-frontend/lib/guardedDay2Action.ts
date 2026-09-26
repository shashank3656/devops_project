import {
  buildGuardedConfirmOptions,
  portalFetch,
  readWorkspaceScope,
  WORKSPACE_SCOPE_EVENT,
  type ConfirmOptions,
  type GuardedActionContext,
  type GuardedActionKind,
} from '@infragate/ui';
import { asRecord } from './payload';

/** Notify Home / Activity listeners to refetch after a day-2 write (NF-04 + NF-05). */
export function notifyDay2ActionComplete() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_SCOPE_EVENT, { detail: readWorkspaceScope() }));
}

export type GuardedConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export async function fetchGuardedActionContext(
  apiUrl: string,
  token: string,
  params: Record<string, string>,
): Promise<GuardedActionContext> {
  const query = new URLSearchParams(params);
  const res = await portalFetch(`${apiUrl}/api/devops/guarded-action-context?${query.toString()}`, { token });
  const data = asRecord(await res.json().catch(() => ({})));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load action context');
  }
  const ctx = data.context;
  if (!ctx || typeof ctx !== 'object') {
    throw new Error('Guarded action context was missing from the server response.');
  }
  return ctx as GuardedActionContext;
}

export async function confirmGuardedDay2Action(input: {
  apiUrl: string;
  token: string;
  confirm: GuardedConfirmFn;
  action: GuardedActionKind;
  params: Record<string, string>;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
}): Promise<{ confirmed: boolean; context?: GuardedActionContext; blocked?: string }> {
  let ctx: GuardedActionContext;
  try {
    ctx = await fetchGuardedActionContext(input.apiUrl, input.token, {
      action: input.action,
      ...input.params,
    });
  } catch (err) {
    return {
      confirmed: false,
      blocked: err instanceof Error ? err.message : 'Failed to load action context.',
    };
  }
  if (!ctx.can_act) {
    return { confirmed: false, context: ctx, blocked: ctx.block_reason || 'You cannot run this action.' };
  }
  const ok = await input.confirm(
    buildGuardedConfirmOptions(input.title, ctx, input.message, input.confirmLabel, input.destructive),
  );
  return { confirmed: ok, context: ctx };
}
