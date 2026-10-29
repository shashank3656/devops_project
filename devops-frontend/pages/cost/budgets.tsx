import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CollectionStatus, { collectionStateFromSync } from '../../components/CollectionStatus';
import CostEmpty from '../../components/CostEmpty';
import CostFirstRun from '../../components/CostFirstRun';
import CostNav from '../../components/CostNav';
import CostPageTabs from '../../components/CostPageTabs';
import CostTechnicalDetails from '../../components/CostTechnicalDetails';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { CostAnomalies, CostBudgets, budgetAlertLabel, costHref, costQuery, fetchCostJson } from '../../lib/cost';

export default function CostBudgetsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const tab = router.query.tab === 'alerts' ? 'alerts' : 'budgets';
  const [data, setData] = useState<CostBudgets | null>(null);
  const [anomalies, setAnomalies] = useState<CostAnomalies | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const createHref = costHref('/cost/budgets/new', router.query);
  const canOperate = data?.can_operate !== false;

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

  useEffect(() => {
    if (!router.isReady) return;
    fetchCostJson<CostAnomalies>(apiUrl, `/api/cost/anomalies${costQuery(basis, currency, { from, to })}`)
      .then((payload) => setAnomalies(payload))
      .catch(() => setAnomalies(null));
  }, [apiUrl, router.isReady, basis, currency, from, to]);

  useEffect(() => {
    if (!router.isReady || router.query.saved !== '1') return;
    setNotice('Budget stored for its own calendar period. Analysis filters do not change that lifecycle.');
    const query = { ...router.query };
    delete query.saved;
    void router.replace({ pathname: '/cost/budgets', query }, undefined, { shallow: true });
  }, [router.isReady, router.query.saved]);

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
      <Head><title>Budgets & alerts</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <h1 className="portal-page__title">Budgets & alerts</h1>
          {tab === 'budgets' ? (
            <div className="portal-page__actions">
              {canOperate ? (
                <Link href={createHref} className="btn btn-primary btn-sm">Create budget</Link>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" disabled title="Ask someone with Cost operate to create a budget.">Create budget</button>
              )}
            </div>
          ) : null}
        </div>
        <CostNav current="budgets" />
        {!loading ? (
          <CollectionStatus
            source="CUR 2.0"
            lastSuccess={anomalies?.prior_window_end || null}
            state={collectionStateFromSync({
              connected: Boolean(data?.coverage && data.coverage !== 'none'),
              failed: Boolean(error),
              empty: tab === 'alerts' ? !(anomalies?.anomalies || []).length : !(data?.budgets || []).length,
            })}
            detail={tab === 'alerts' ? 'An empty alert list is No findings, not a $0 bill.' : 'Budgets use their own calendar period.'}
          />
        ) : null}
        <CostPageTabs
          tabs={[{ id: 'budgets', label: 'Budgets' }, { id: 'alerts', label: 'Alerts' }]}
          current={tab}
          onSelect={(id) => {
            const query = { ...router.query, tab: id === 'alerts' ? 'alerts' : undefined };
            if (id !== 'alerts') delete query.tab;
            void router.replace({ pathname: '/cost/budgets', query }, undefined, { shallow: true });
          }}
        />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-info" role="status">{notice}</div> : null}
        {tab === 'alerts' ? (
          <>
            <p className="cost-review-note">Alerts require two complete billed windows. They never pause workloads.</p>
            <dl className="cost-k8s-meta" aria-label="Cost alert readiness">
              <div><dt>Alerts enabled</dt><dd>{anomalies?.alerts?.alerts_enabled ? 'On' : 'Off'}</dd></div>
              <div><dt>Monitoring ready</dt><dd>{anomalies?.alerts?.monitoring_ready ? 'Yes' : 'No'}</dd></div>
              <div><dt>Delivery verified</dt><dd>{anomalies?.alerts?.delivery_verified ? 'Yes' : 'No'}</dd></div>
              <div><dt>Evaluation</dt><dd>{anomalies?.alerts?.blocked_reason || (anomalies?.alerts?.monitoring_ready ? 'Ready' : 'Unknown')}</dd></div>
            </dl>
            {(Boolean(anomalies?.insufficient_data) || (!(anomalies?.anomalies || []).length && (anomalies?.prior_coverage || 'none') !== 'complete')) ? (
              <CostFirstRun canOperate title="Not enough comparable data" primaryLabel="Ingest billed data" />
            ) : (anomalies?.anomalies || []).length ? (
              <section className="portal-surface portal-surface--table">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Current</th>
                      <th>Baseline</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(anomalies?.anomalies || []).filter((row) => row.resource_id || row.like_for_like).map((row) => (
                      <tr key={row.calc_id}>
                        <td>{row.service || 'Window'}</td>
                        <td>{row.current?.display || 'Unknown'}</td>
                        <td>{row.baseline?.display || 'Unknown'}</td>
                        <td>{row.delta?.display || 'Unknown'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <CostTechnicalDetails>
                  {(anomalies?.anomalies || []).map((row) => (
                    <p key={row.calc_id}>{row.calc_id}</p>
                  ))}
                </CostTechnicalDetails>
              </section>
            ) : (
              <div className="empty-state">No anomalies in this complete window.</div>
            )}
          </>
        ) : null}
        {tab === 'budgets' ? (
          <>
            {loading ? <div className="empty-state">Loading budgets…</div> : null}
            {!loading && !(data?.budgets || []).length ? (
              <CostEmpty
                canOperate={canOperate}
                title="Create a budget to track spend"
                copy="Budgets evaluate against their own calendar month, not the Overview window. Remaining stays Unknown until a complete billed window exists."
                actionHref={createHref}
                actionLabel="Create budget"
                deniedNote="Ask someone with Cost operate to create a budget."
              />
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
                          <div className="portal-surface__subtitle">{row.currency} {row.amount} · {row.basis} · {row.period || 'calendar_month'} · warn {row.warn_percent || 80}% / over {row.over_percent || 100}%</div>
                        </td>
                        <td>{row.scope_type}{row.scope_value ? ` · ${row.scope_value}` : ''}{row.owner_slug ? ` · owner ${row.owner_slug}` : ''}</td>
                        <td>{row.spent?.display || 'Unknown'}</td>
                        <td>{row.remaining?.display || 'Unknown'}</td>
                        <td>{budgetAlertLabel(row.alert)}</td>
                        <td>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={!!acting || !canOperate} onClick={() => void removeBudget(row.id)}>
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
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
