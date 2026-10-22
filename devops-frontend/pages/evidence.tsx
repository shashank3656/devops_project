import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface EvidencePack {
  summary?: string;
  changes?: {
    change_number: string;
    sha: string;
    status: string;
    watch_result?: string;
    cab_approved_by_username?: string;
    author?: string;
    policy_status?: string;
    cost_delta_usd?: number;
    cost_currency?: string;
  }[];
  incidents?: { incident_number?: string; summary: string; status: string; severity?: string }[];
  branch_protection?: { repo: string; base_branch: string; onboarded?: boolean; required_checks?: string[]; summary?: string }[];
}

export default function EvidencePage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/evidence`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load evidence');
        setPack(data.evidence || null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load evidence'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const download = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const res = await fetch(`${apiUrl}/api/devops/evidence?format=md`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'opstrellis-evidence.md';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DevOpsLayout>
      <Head><title>Evidence - OpsTrellis</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Compliance</span>
            <h1 className="portal-page__title">Evidence pack</h1>
            <p className="portal-page__subtitle">Who approved, what SHA shipped, watch result, policy, cost, incidents, and required branch checks for the last 30 days.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={download}>Download markdown</button>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Building pack…</div> : null}
        {pack ? (
          <>
            <section className="portal-surface" style={{ marginBottom: 16 }}>
              <p className="portal-surface__subtitle">{pack.summary}</p>
              <h2 className="portal-surface__title">Changes</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Change</th>
                    <th>SHA</th>
                    <th>Watch</th>
                    <th>Approved by</th>
                    <th>Policy</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(pack.changes || []).slice(0, 40).map((item) => (
                    <tr key={item.change_number}>
                      <td>{item.change_number}</td>
                      <td><code>{item.sha}</code></td>
                      <td>{item.watch_result || item.status}</td>
                      <td>{item.cab_approved_by_username || item.author || '—'}</td>
                      <td>{item.policy_status || 'none'}</td>
                      <td>{item.cost_currency || 'USD'} {item.cost_delta_usd ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="portal-surface" style={{ marginBottom: 16 }}>
              <h2 className="portal-surface__title">Incidents</h2>
              <ul>
                {(pack.incidents || []).slice(0, 40).map((item) => (
                  <li key={item.incident_number || item.summary}>{item.incident_number} · {item.severity} · {item.status} · {item.summary}</li>
                ))}
              </ul>
            </section>
            <section className="portal-surface">
              <h2 className="portal-surface__title">Branch protection</h2>
              <ul>
                {(pack.branch_protection || []).map((item) => (
                  <li key={item.repo}>{item.summary || `${item.repo} ${item.base_branch}`} {item.onboarded ? '· onboarded' : ''}</li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
