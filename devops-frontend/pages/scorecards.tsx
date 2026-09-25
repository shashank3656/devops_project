import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ScorecardCheck {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
}

interface DoraMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  band: string;
}

interface Scorecard {
  service: string;
  environment?: string;
  team?: string;
  project_name?: string;
  score: number;
  open_incidents: number;
  last_change?: string;
  last_change_id?: number;
  slo_burned?: boolean;
  drift?: { drifted?: boolean; detail?: string };
  checks?: ScorecardCheck[];
  dora?: DoraMetric[];
}

export default function ScorecardsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<Scorecard[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/scorecards`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load scorecards');
        setItems(Array.isArray(data.scorecards) ? data.scorecards : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load scorecards'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  return (
    <DevOpsLayout>
      <Head><title>Scorecards - SetuOps</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Services</span>
            <h1 className="portal-page__title">Scorecards</h1>
            <p className="portal-page__subtitle">Owner, SLO, incidents, runbook, last CHG, live-vs-CHG drift, and DORA for each catalog service.</p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading scorecards…</div> : null}
        {!loading && items.length === 0 ? <div className="empty-state">Add services to see scorecards.</div> : null}
        {items.length > 0 ? (
          <section className="portal-surface">
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Score</th>
                  <th>DORA</th>
                  <th>Checks</th>
                  <th>Last change</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.service}-${item.environment || ''}`}>
                    <td>
                      <strong>{item.service}</strong>
                      <div className="portal-surface__subtitle">{item.team || item.project_name || item.environment || '—'}</div>
                    </td>
                    <td>{item.score}</td>
                    <td>
                      {(item.dora || []).filter((metric) => metric.key === 'change_failure_rate' || metric.key === 'deploy_frequency').map((metric) => (
                        <div key={metric.key}>{metric.label}: {metric.value} {metric.unit} ({metric.band})</div>
                      ))}
                    </td>
                    <td>
                      {(item.checks || []).map((check) => (
                        <div key={check.key}>{check.passed ? 'pass' : 'fail'} · {check.label}</div>
                      ))}
                    </td>
                    <td>
                      {item.last_change_id ? <Link href={`/changes/${item.last_change_id}`}>{item.last_change}</Link> : '—'}
                      {item.slo_burned ? <div className="portal-surface__subtitle">SLO burning</div> : null}
                      {item.drift?.drifted ? <div className="portal-surface__subtitle">{item.drift.detail || 'Live image drifted from last CHG'}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
