import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function NewServiceMapPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [service, setService] = useState('');
  const [repo, setRepo] = useState('');
  const [environment, setEnvironment] = useState('prod');
  const [grafanaUID, setGrafanaUID] = useState('');
  const [promql, setPromql] = useState('');
  const [dashboardURL, setDashboardURL] = useState('');
  const [metricsURL, setMetricsURL] = useState('');
  const [team, setTeam] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/services`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: service.trim(),
          repo: repo.trim(),
          environment: environment.trim(),
          grafana_uid: grafanaUID.trim(),
          promql: promql.trim(),
          dashboard_url: dashboardURL.trim(),
          metrics_url: metricsURL.trim(),
          team: team.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to save service');
      await router.push('/services');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save service');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Add service - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Service map</span>
            <h1 className="portal-page__title">Add service</h1>
            <p className="portal-page__subtitle">Map a repo to a Grafana dashboard so change and alert webhooks can resolve the project.</p>
          </div>
          <Link href="/services" className="btn btn-secondary">Back to catalog</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <form className="portal-form-grid" onSubmit={(event) => void submit(event)}>
            <label className="label">Service<input className="input" value={service} onChange={(e) => setService(e.target.value)} placeholder="payments-api" /></label>
            <label className="label">Repo<input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="acme/payments-api" /></label>
            <label className="label">Environment<input className="input" value={environment} onChange={(e) => setEnvironment(e.target.value)} /></label>
            <label className="label">Team<input className="input" value={team} onChange={(e) => setTeam(e.target.value)} /></label>
            <label className="label">Grafana UID<input className="input" value={grafanaUID} onChange={(e) => setGrafanaUID(e.target.value)} /></label>
            <label className="label">Dashboard URL<input className="input" value={dashboardURL} onChange={(e) => setDashboardURL(e.target.value)} /></label>
            <label className="label">Metrics JSON URL<input className="input" value={metricsURL} onChange={(e) => setMetricsURL(e.target.value)} placeholder="https://metrics.example/payments.json" /></label>
            <label className="label">PromQL<textarea className="input" rows={3} value={promql} onChange={(e) => setPromql(e.target.value)} /></label>
            <div className="portal-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save service'}</button>
            </div>
          </form>
        </section>
      </div>
    </DevOpsLayout>
  );
}
