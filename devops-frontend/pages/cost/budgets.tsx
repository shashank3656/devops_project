import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostNav from '../../components/CostNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { CostBudgets, budgetAlertLabel, costQuery, fetchCostJson } from '../../lib/cost';

export default function CostBudgetsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const [data, setData] = useState<CostBudgets | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [name, setName] = useState('');
  const [scopeType, setScopeType] = useState('all');
  const [scopeValue, setScopeValue] = useState('');
  const [amount, setAmount] = useState('');
  const [budgetBasis, setBudgetBasis] = useState(basis);

  const load = () => {
    if (!router.isReady) return;
    setLoading(true);
    fetchCostJson<CostBudgets>(apiUrl, `/api/cost/budgets${costQuery(basis, currency, { from, to })}`)
      .then((payload) => {
        setData(payload);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [apiUrl, router.isReady, basis, currency, from, to]);

  const createBudget = async () => {
    setActing('create');
    setNotice('');
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
        }),
      });
      setNotice('Budget stored. It never pauses or resizes workloads.');
      setName('');
      setScopeValue('');
      setAmount('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Budget could not be saved.');
    } finally {
      setActing('');
    }
  };

  const removeBudget = async (id: number) => {
    setActing(`delete-${id}`);
    setNotice('');
    try {
      await fetchCostJson(apiUrl, `/api/cost/budgets/${id}`, { method: 'DELETE' });
      setNotice('Budget removed. Workloads were not changed.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Budget could not be removed.');
    } finally {
      setActing('');
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>Cost budgets</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Cost budgets</h1>
            <p className="portal-page__subtitle">
              Remaining uses the same window, basis, and currency as Overview. Incomplete coverage stays Unknown, never $0. Budgets never stop workloads.
            </p>
          </div>
        </div>
        <CostNav current="budgets" />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-info" role="status">{notice}</div> : null}
        <div className="portal-pill-row">
          <span className="portal-pill">Currency {data?.currency || currency}</span>
          <span className="portal-pill">Coverage {data?.coverage || 'none'}</span>
          {data?.window_start ? <span className="portal-pill">{data.window_start} to {data.window_end}</span> : null}
          <span className="portal-pill">Pauses workloads No</span>
        </div>
        <section className="portal-surface">
          <h2 className="portal-surface__title">Add a budget</h2>
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
                <input className="input" value={scopeValue} onChange={(event) => setScopeValue(event.target.value)} placeholder={scopeType === 'account' ? '123456789012' : 'platform-team'} />
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
          </div>
          <button type="button" className="btn btn-primary" disabled={!name || !amount || !!acting || data?.can_operate === false} onClick={() => void createBudget()}>
            {acting === 'create' ? 'Saving…' : 'Save budget'}
          </button>
        </section>
        {loading ? <div className="empty-state">Loading budgets…</div> : null}
        {!loading && !(data?.budgets || []).length ? (
          <div className="empty-state">No budgets yet. Remaining stays Unknown until a complete billed window exists.</div>
        ) : null}
        {!loading && (data?.budgets || []).length ? (
          <section className="portal-surface portal-surface--table">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scope</th>
                  <th>Spent</th>
                  <th>Remaining</th>
                  <th>Alert</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.budgets || []).map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.name}
                      <div className="portal-surface__subtitle">{row.currency} {row.amount} · {row.basis}</div>
                    </td>
                    <td>{row.scope_type}{row.scope_value ? ` · ${row.scope_value}` : ''}</td>
                    <td>{row.spent?.display || 'Unknown'}</td>
                    <td>{row.remaining?.display || 'Unknown'}</td>
                    <td>{budgetAlertLabel(row.alert)}</td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={!!acting || data?.can_operate === false} onClick={() => void removeBudget(row.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="portal-surface__subtitle">{data?.note}</p>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
