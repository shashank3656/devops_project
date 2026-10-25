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

export default function CostNav({
  current,
  analysis,
  exporting,
  onExport,
}: {
  current: (typeof TABS)[number]['id'];
  analysis?: CostFilterOptions | null;
  exporting?: boolean;
  onExport?: () => void;
}) {
  return (
    <div className="cost-nav">
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
      {current !== 'configuration' ? (
        <CostFilterBar
          showBasis
          options={current === 'overview' ? analysis : undefined}
          explorer={current === 'explorer'}
          exporting={exporting}
          onExport={onExport}
        />
      ) : null}
    </div>
  );
}
