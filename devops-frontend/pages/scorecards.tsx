import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { ScorecardTable } from '@infragate/ui';
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
      <Head><title>Scorecards - OpsTrellis</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Service inventory</span>
            <h1 className="portal-page__title">Scorecards</h1>
            <p className="portal-page__subtitle">Readiness is the share of known checks: owner, SLO, open incidents, runbook, last change, live drift, and 30-day change-failure rate. A missing sample is Unknown and is left out of the percentage. It is never counted as healthy.</p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <ScorecardTable
            variant="devops"
            rows={items}
            loading={loading}
            empty={<div className="empty-state">Add services to see scorecards.</div>}
          />
        </section>
      </div>
    </DevOpsLayout>
  );
}
