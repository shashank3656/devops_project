import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import CostNav from '../../../components/CostNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { costHref, fetchCostJson } from '../../../lib/cost';

export default function CreateCostBudgetPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const [name, setName] = useState('');
  const [scopeType, setScopeType] = useState('all');
  const [scopeValue, setScopeValue] = useState('');
  const [amount, setAmount] = useState('');
  const [budgetBasis, setBudgetBasis] = useState(basis);
  const [period, setPeriod] = useState('calendar_month');
  const [ownerSlug, setOwnerSlug] = useState('');
  const [warnPercent, setWarnPercent] = useState('80');
  const [overPercent, setOverPercent] = useState('100');
  const budgetsHref = costHref('/cost/budgets', router.query);

  const save = async () => {
    setActing(true);
    setError('');
    try {
      await fetchCostJson(apiUrl, '/api/cost/budgets', {
        method: 'POST',
        body: JSON.stringify({
          name,
          scope_type: scopeType,
          scope_value: scopeValue,
          amount,
          currency,
          basis: budgetBasis,
          period,
          owner_slug: ownerSlug,
          warn_percent: Number(warnPercent) || 80,
          over_percent: Number(overPercent) || 100,
        }),
      });
      void router.push(costHref('/cost/budgets', router.query, { saved: '1' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Budget could not be saved.');
      setActing(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>Create budget</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <h1 className="portal-page__title">Create budget</h1>
          <div className="portal-page__actions">
            <Link href={budgetsHref} className="btn btn-secondary btn-sm">Cancel</Link>
          </div>
        </div>
        <CostNav
          current="budgets"
          crumbs={[
            { href: costHref('/cost', router.query), label: 'Overview' },
            { href: budgetsHref, label: 'Budgets' },
            { label: 'Create budget' },
          ]}
        />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <section className="portal-surface">
          <p className="cost-shell__hint">Budgets evaluate against their own calendar month, not the Overview window. Saving a budget does not pause or change workloads.</p>
          <div className="portal-form-grid">
            <label className="label">Name
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="September operating" />
            </label>
            <label className="label">Scope
              <select className="input" value={scopeType} onChange={(event) => setScopeType(event.target.value)}>
                <option value="all">All billed lines</option>
                <option value="account">Account</option>
                <option value="team">Team</option>
                <option value="service">Service</option>
              </select>
            </label>
            {scopeType !== 'all' ? (
              <label className="label">Scope value
                <input className="input" value={scopeValue} onChange={(event) => setScopeValue(event.target.value)} placeholder={scopeType === 'team' ? 'platform-team' : scopeType === 'service' ? 'Compute' : 'Account'} />
              </label>
            ) : null}
            <label className="label">Amount
              <input className="input" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="500.00" />
            </label>
            <label className="label">Basis
              <select className="input" value={budgetBasis} onChange={(event) => setBudgetBasis(event.target.value)}>
                <option value="actual">Actual</option>
                <option value="amortized">Amortized</option>
              </select>
            </label>
            <label className="label">Period
              <select className="input" value={period} onChange={(event) => setPeriod(event.target.value)}>
                <option value="calendar_month">Calendar month</option>
              </select>
            </label>
            <label className="label">Owner team
              <input className="input" value={ownerSlug} onChange={(event) => setOwnerSlug(event.target.value)} placeholder="platform-team" />
            </label>
            <label className="label">Warn at %
              <input className="input" value={warnPercent} onChange={(event) => setWarnPercent(event.target.value)} placeholder="80" />
            </label>
            <label className="label">Over at %
              <input className="input" value={overPercent} onChange={(event) => setOverPercent(event.target.value)} placeholder="100" />
            </label>
          </div>
          <div className="portal-page__actions">
            <button type="button" className="btn btn-primary" disabled={!name || !amount || acting} onClick={() => void save()}>
              {acting ? 'Saving…' : 'Save budget'}
            </button>
            <Link href={budgetsHref} className="btn btn-secondary">Cancel</Link>
          </div>
        </section>
      </div>
    </DevOpsLayout>
  );
}
