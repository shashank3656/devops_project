import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { ScorecardTable } from '@infragate/ui';
import { SITE_NAME } from '../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface ScorecardCheck {
  key: string;
  label: string;
  passed: boolean;
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
  score: number;
  open_incidents: number;
  last_change?: string;
  last_change_id?: number;
  slo_burned?: boolean;
  drift?: { drifted?: boolean; detail?: string };
  checks?: ScorecardCheck[];
  dora?: DoraMetric[];
}

export default function UserScorecardsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Scorecard[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/me/scorecards`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load scorecards');
        setItems(Array.isArray(data.scorecards) ? data.scorecards : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load scorecards'))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <>
      <Head><title>Scorecards - {SITE_NAME}</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Services</span>
            <h1 className="portal-page__title">Scorecards</h1>
            <p className="portal-page__subtitle">Owner, SLO, incidents, runbook, last CHG, live-vs-CHG drift, and DORA for your visible services.</p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <ScorecardTable
            variant="user"
            rows={items}
            loading={loading}
            empty={<div className="empty-state">No services on your projects yet.</div>}
          />
        </section>
      </div>
    </>
  );
}
