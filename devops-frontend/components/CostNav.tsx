import Link from 'next/link';
import CostFilterBar from './CostFilterBar';
import type { CostFilterOptions } from '../lib/cost';

const TABS = [
  { id: 'overview', href: '/cost', label: 'Analysis' },
  { id: 'explorer', href: '/cost/explorer', label: 'Explorer' },
  { id: 'optimization', href: '/cost/optimization', label: 'Optimization' },
  { id: 'anomalies', href: '/cost/anomalies', label: 'Anomalies' },
  { id: 'budgets', href: '/cost/budgets', label: 'Budgets' },
  { id: 'savings', href: '/cost/savings', label: 'Savings' },
  { id: 'kubernetes', href: '/cost/kubernetes', label: 'Kubernetes' },
  { id: 'configuration', href: '/cost/configuration', label: 'Configuration' },
] as const;

export type CostCrumb = { href?: string; label: string };

export default function CostNav({
  current,
  analysis,
  exporting,
  onExport,
  compact = false,
  crumbs,
  visibleAccounts,
  totalAccounts,
}: {
  current: (typeof TABS)[number]['id'];
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
      {compact ? (
        <nav className="cost-crumbs" aria-label="Cost path">
          {(crumbs || [{ href: '/cost', label: 'Cost' }]).map((crumb, index, list) => (
            <span key={`${crumb.label}-${index}`}>
              {crumb.href && index < list.length - 1 ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
              {index < list.length - 1 ? <span className="cost-crumbs__sep">/</span> : null}
            </span>
          ))}
        </nav>
      ) : (
        <div className="cost-tabs" role="tablist">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={tab.href}
              role="tab"
              aria-selected={current === tab.id}
              className={`cost-tabs__link${current === tab.id ? ' is-active' : ''}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      )}
      {current !== 'configuration' ? (
        <CostFilterBar
          showBasis
          options={!compact && current === 'overview' ? analysis : undefined}
          explorer={!compact && current === 'explorer'}
          exporting={exporting}
          onExport={onExport}
          visibleAccounts={visibleAccounts}
          totalAccounts={totalAccounts}
        />
      ) : null}
    </div>
  );
}
