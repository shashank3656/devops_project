import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostNav from '../../../components/CostNav';
import CostSetupFlow from '../../../components/CostSetupFlow';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { CostAccountDashboard, costBillingSetup, costQuery, fetchCostJson, importableLabel } from '../../../lib/cost';

export default function CostCloudAccountPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const [data, setData] = useState<CostAccountDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady || !id) return;
    setLoading(true);
    fetchCostJson<CostAccountDashboard>(apiUrl, `/api/cost/cloud-accounts/${id}/dashboard${costQuery(basis, currency, { from, to })}`)
      .then((payload) => {
        if (payload.connection?.id) {
          void router.replace(`/cost/accounts/${payload.connection.id}${costQuery(basis, currency, { from, to })}`);
          return;
        }
        setData(payload);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl, router.isReady, id, basis, currency, from, to]);

  const title = data?.connection?.display_name || 'Cloud account';
  const setup = costBillingSetup(data?.cloud || data?.connection?.provider || '');

  return (
    <DevOpsLayout>
      <Head><title>{title}</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">{title}</h1>
            <p className="cost-shell__hint">
              {data?.project?.name || 'Project'} · {setup.label} · {data?.environment || 'Unknown'}. {data?.note || setup.note}
            </p>
          </div>
          <div className="portal-page__actions">
            {data?.project?.id ? <Link href={`/cost/projects/${data.project.id}`} className="btn btn-secondary btn-sm">Project</Link> : null}
            <Link href="/cost" className="btn btn-secondary btn-sm">All projects</Link>
            {data?.can_operate ? (
              <Link href="/cost/configuration" className="btn btn-primary btn-sm">
                {setup.ingestReady ? 'Enable Cost' : setup.connectLabel}
              </Link>
            ) : null}
          </div>
        </div>
        <CostNav
          current="overview"
          compact
          crumbs={[
            { href: '/cost', label: 'Cost' },
            data?.project?.id ? { href: `/cost/projects/${data.project.id}`, label: data.project.name || 'Project' } : { href: '/cost', label: 'Project' },
            { label: title },
          ]}
        />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {loading ? <div className="empty-state">Loading account…</div> : null}
        {!loading && data ? (
          setup.ingestReady ? (
          <section className="cost-dash__side">
            <span className="portal-surface__eyebrow">Import</span>
            <h2 className="portal-surface__title">What can still be brought in</h2>
            <div className="cost-import">
              {(data.importable || []).map((item) => (
                <Link key={item.id} href={item.href || '/cost/configuration'} className="cost-import__row">
                  <span>
                    <span className="cost-import__label">{item.label}</span>
                    <span className="cost-import__note">{item.note}</span>
                  </span>
                  <span className="cost-import__status">{importableLabel(item.status)}</span>
                </Link>
              ))}
            </div>
          </section>
          ) : (
            <CostSetupFlow
              canOperate={data.can_operate}
              state="none"
              clouds={[setup.cloud]}
            />
          )
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
