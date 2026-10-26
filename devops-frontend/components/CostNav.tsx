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
  exportDisabled,
  exportDisabledReason,
  crumbs,
  visibleAccounts,
  totalAccounts,
  sample,
}: {
  current: CostNavId;
  analysis?: CostFilterOptions | null;
  exporting?: boolean;
  onExport?: () => void;
  exportDisabled?: boolean;
  exportDisabledReason?: string;
  compact?: boolean;
  crumbs?: CostCrumb[];
  visibleAccounts?: number;
  totalAccounts?: number;
  sample?: boolean;
}) {
  const overview = current === 'overview';
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
          showPeriod={!overview}
          options={overview ? analysis : undefined}
          explorer={current === 'explorer'}
          exporting={exporting}
          onExport={onExport}
          exportDisabled={exportDisabled}
          exportDisabledReason={exportDisabledReason}
          sample={sample}
          visibleAccounts={sample ? undefined : visibleAccounts}
          totalAccounts={sample ? undefined : totalAccounts}
        />
      ) : null}
    </div>
  );
}
