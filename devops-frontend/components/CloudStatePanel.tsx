import Link from 'next/link';
import type { ReactNode } from 'react';
import { cloudLoadErrorHint } from '../lib/cloudPageUtils';

export default function CloudStatePanel({
  kind,
  title,
  message,
  onRetry,
  action,
}: {
  kind: 'error' | 'empty' | 'info';
  title: string;
  message?: string;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  const hint = kind === 'error' && message ? cloudLoadErrorHint(message) : '';
  return (
    <div className={`cloud-state-panel cloud-state-panel--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="cloud-state-panel__icon" aria-hidden>
        {kind === 'error' ? '!' : kind === 'empty' ? '○' : 'i'}
      </div>
      <div className="cloud-state-panel__body">
        <strong className="cloud-state-panel__title">{title}</strong>
        {message ? <p className="cloud-state-panel__message">{message}</p> : null}
        {hint ? <p className="cloud-state-panel__hint">{hint}</p> : null}
        <div className="cloud-state-panel__actions">
          {onRetry ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
              Retry
            </button>
          ) : null}
          {action}
        </div>
      </div>
    </div>
  );
}

export function CloudEmptyCatalogAction() {
  return (
    <Link href="/cloud-accounts/new" className="btn btn-primary btn-sm">
      Onboard account
    </Link>
  );
}
