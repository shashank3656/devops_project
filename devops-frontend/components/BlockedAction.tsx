import type { ReactNode } from 'react';

/** Puts the reason beside a control that cannot be used yet. */
export default function BlockedAction({
  blocked,
  reason,
  children,
}: {
  blocked: boolean;
  reason: string;
  children: ReactNode;
}) {
  if (!blocked || !reason) return <>{children}</>;
  return (
    <span className="blocked-action">
      {children}
      <span className="blocked-action__reason">{reason}</span>
    </span>
  );
}
