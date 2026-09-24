import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProblemDetail {
  id: number;
  problem_number: string;
  fingerprint: string;
  service: string;
  environment: string;
  summary: string;
  status: string;
  occurrence_count: number;
}

export default function ProblemDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [item, setItem] = useState<ProblemDetail | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;

  const load = () => {
    if (!id) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/problems/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load problem');
          return;
        }
        setItem(data.problem || null);
      })
      .catch(() => setError('Failed to load problem'));
  };

  useEffect(() => {
    load();
  }, [apiUrl, id]);

  const setStatus = (status: string) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !id) return;
    setSaving(true);
    fetch(`${apiUrl}/api/devops/problems/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to update problem');
          return;
        }
        setItem(data.problem || item);
      })
      .finally(() => setSaving(false));
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.problem_number || 'Problem'} - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Problem</span>
            <h1 className="portal-page__title">{item?.problem_number || 'Problem'}</h1>
            <p className="portal-page__subtitle">{item?.summary || 'Recurring alert fingerprint.'}</p>
          </div>
          <Link href="/problems" className="btn btn-secondary">Back to problems</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {item ? (
          <section className="portal-surface">
            <div className="portal-form-grid">
              <label className="label">Fingerprint<input className="input" readOnly value={item.fingerprint} /></label>
              <label className="label">Service<input className="input" readOnly value={item.service || '—'} /></label>
              <label className="label">Occurrences<input className="input" readOnly value={String(item.occurrence_count)} /></label>
              <label className="label">Status<input className="input" readOnly value={item.status} /></label>
            </div>
            {item.status === 'open' ? (
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => setStatus('resolved')}>
                Mark resolved
              </button>
            ) : null}
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
