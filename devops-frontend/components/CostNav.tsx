import Link from 'next/link';
import CostFilterBar from './CostFilterBar';
import type { CostFilterOptions } from '../lib/cost';

export type CostCrumb = { href?: string; label: string };
export type CostNavId = 'overview' | 'explorer' | 'optimization' | 'anomalies' | 'budgets' | 'savings' | 'kubernetes' | 'configuration';

export default function CostNav({
  current,
  analysis,
  exporting,
  onExport,
  crumbs,
  visibleAccounts,
  totalAccounts,
}: {
  current: CostNavId;
  analysis?: CostFilterOptions | null;
  exporting?: boolean;
  onExport?: () => void;
  compact?: boolean;
  crumbs?: CostCrumb[];
  visibleAccounts?: number;
  totalAccounts?: number;
}) {
  return (
    <div className="cost-nav">
      {crumbs?.length ? (
        <nav className="cost-crumbs" aria-label="Cost path">
          {crumbs.map((crumb, index, list) => (
            <span key={`${crumb.label}-${index}`}>
              {crumb.href && index < list.length - 1 ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
              {index < list.length - 1 ? <span className="cost-crumbs__sep">/</span> : null}
            </span>
          ))}
        </nav>
      ) : null}
      {current !== 'configuration' ? (
        <CostFilterBar
          showBasis
          options={current === 'overview' ? analysis : undefined}
          explorer={current === 'explorer'}
          exporting={exporting}
          onExport={onExport}
          visibleAccounts={visibleAccounts}
          totalAccounts={totalAccounts}
        />
      ) : null}
    </div>
  );
}
