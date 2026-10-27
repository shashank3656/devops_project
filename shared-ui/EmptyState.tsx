import type { ReactNode } from 'react';

export default function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="ig-empty">
      <strong>{title}</strong>
      <p className="ig-muted">{body}</p>
      {action ? <div className="ig-empty__action">{action}</div> : null}
    </div>
  );
}
