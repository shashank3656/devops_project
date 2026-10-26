import type { ReactNode } from 'react';

export default function CostTechnicalDetails({ children }: { children: ReactNode }) {
  return (
    <details className="cost-tech">
      <summary>Technical details</summary>
      <div className="cost-tech__body">{children}</div>
    </details>
  );
}
