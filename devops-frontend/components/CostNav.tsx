import Link from 'next/link';
import CostAskChips from './CostAskChips';
import CostFilterBar from './CostFilterBar';
import type { CostFilterOptions } from '../lib/cost';

export default function CostNav({
  current,
  analysis,
}: {
  current: 'overview' | 'explorer' | 'optimization' | 'anomalies' | 'budgets' | 'savings' | 'kubernetes' | 'configuration';
  analysis?: CostFilterOptions | null;
}) {
  return (
    <>
      <div className="portal-tabs" role="tablist">
        <Link href="/cost" className={`btn btn-sm ${current === 'overview' ? 'btn-primary' : 'btn-secondary'}`}>Analysis</Link>
        <Link href="/cost/explorer" className={`btn btn-sm ${current === 'explorer' ? 'btn-primary' : 'btn-secondary'}`}>Explorer</Link>
        <Link href="/cost/optimization" className={`btn btn-sm ${current === 'optimization' ? 'btn-primary' : 'btn-secondary'}`}>Optimization</Link>
        <Link href="/cost/anomalies" className={`btn btn-sm ${current === 'anomalies' ? 'btn-primary' : 'btn-secondary'}`}>Anomalies</Link>
        <Link href="/cost/budgets" className={`btn btn-sm ${current === 'budgets' ? 'btn-primary' : 'btn-secondary'}`}>Budgets</Link>
        <Link href="/cost/savings" className={`btn btn-sm ${current === 'savings' ? 'btn-primary' : 'btn-secondary'}`}>Savings</Link>
        <Link href="/cost/kubernetes" className={`btn btn-sm ${current === 'kubernetes' ? 'btn-primary' : 'btn-secondary'}`}>Kubernetes</Link>
        <Link href="/cost/configuration" className={`btn btn-sm ${current === 'configuration' ? 'btn-primary' : 'btn-secondary'}`}>Configuration</Link>
      </div>
      {current !== 'configuration' ? <CostFilterBar showBasis={Boolean(analysis)} options={analysis} /> : null}
      <CostAskChips />
    </>
  );
}
