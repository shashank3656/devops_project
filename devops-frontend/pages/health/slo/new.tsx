import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function NewSLOPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [service, setService] = useState('');
  const [environment, setEnvironment] = useState(typeof router.query.environment === 'string' ? router.query.environment : 'prod');
  const [latency, setLatency] = useState('500');
  const [errorPercent, setErrorPercent] = useState('1');
  const [saturationPercent, setSaturationPercent] = useState('80');
  const [freezeOnBudget, setFreezeOnBudget] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    if (!service.trim()) {
      setError('Service is required');
      return;
    }
    setSaving(true);
    setError('');
    const projectID = Number(Array.isArray(router.query.project_id) ? router.query.project_id[0] : router.query.project_id);
    try {
      const response = await fetch(`${apiUrl}/api/devops/slos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          service: service.trim(),
          environment: environment.trim(),
          latency_p95_ms: Number(latency) || 0,
          error_ratio: (Number(errorPercent) || 0) / 100,
          saturation: (Number(saturationPercent) || 0) / 100,
          freeze_on_budget: freezeOnBudget,
          project_id: Number.isSafeInteger(projectID) && projectID > 0 ? projectID : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save SLO');
      }
      await router.push('/health');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save SLO');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Define SLO - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Health</span>
            <h1 className="portal-page__title">Define SLO</h1>
            <p className="portal-page__subtitle">
              Absolute targets keep a small spike from paging when the service is still inside its budget.
            </p>
          </div>
          <Link href="/health" className="btn btn-secondary">
            Back to health
          </Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <form className="portal-form-grid" onSubmit={(event) => void submit(event)}>
            <label className="label">
              Service
              <input className="input" value={service} onChange={(event) => setService(event.target.value)} placeholder="payments-api" />
            </label>
            <label className="label">
              Environment
              <input className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="prod" />
            </label>
            <label className="label">
              p95 latency (ms)
              <input className="input" value={latency} onChange={(event) => setLatency(event.target.value)} />
            </label>
            <label className="label">
              Error budget (%)
              <input className="input" value={errorPercent} onChange={(event) => setErrorPercent(event.target.value)} />
            </label>
            <label className="label">
              Saturation (%)
              <input className="input" value={saturationPercent} onChange={(event) => setSaturationPercent(event.target.value)} />
            </label>
            <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={freezeOnBudget} onChange={(event) => setFreezeOnBudget(event.target.checked)} />
              Block promotions when the budget is burned
            </label>
            <div className="portal-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save SLO'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </DevOpsLayout>
  );
}
