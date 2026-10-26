import type { ReactNode } from 'react';
import { InspectorDrawer } from '@infragate/ui';

export default function CostDrawer({
  open,
  onClose,
  title,
  eyebrow,
  subtitle,
  footer,
  children,
  resetKey,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  resetKey?: string | number | null;
}) {
  return (
    <InspectorDrawer
      open={open}
      onClose={onClose}
      title={title}
      eyebrow={eyebrow}
      subtitle={subtitle}
      footer={footer}
      label="Cost details"
      resetKey={resetKey}
    >
      {children}
    </InspectorDrawer>
  );
}
