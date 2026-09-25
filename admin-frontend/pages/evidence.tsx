import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
import { ADMIN_SITE_NAME } from '../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface EvidencePack {
  summary?: string;
  changes?: { change_number: string; sha: string; watch_result?: string; policy_status?: string; cost_delta_usd?: number }[];
  incidents?: { incident_number?: string; summary: string; status: string }[];
  branch_protection?: { repo: string; summary?: string }[];
}

export default function AdminEvidencePage() {
  const router = useRouter();
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/admin/evidence`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load evidence');
        setPack(data.evidence || null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load evidence'))
      .finally(() => setLoading(false));
  }, [router]);

  const download = async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    const res = await fetch(`${apiUrl}/api/admin/evidence?format=md`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'setuops-evidence.md';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <Head><title>Evidence - {ADMIN_SITE_NAME}</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Compliance</span>
            <h1 className="portal-page__title">Evidence pack</h1>
            <p className="portal-page__subtitle">Read-only 30-day trail: SHA, watch result, policy, cost, incidents, and required checks.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={download}>Download markdown</button>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading…</div> : null}
        {pack ? (
          <section className="portal-surface">
            <p className="portal-surface__subtitle">{pack.summary}</p>
            <ul>
              {(pack.changes || []).slice(0, 20).map((item) => (
                <li key={item.change_number}>{item.change_number} · {item.sha} · {item.watch_result || 'open'} · {item.policy_status || 'none'} · Δ ${item.cost_delta_usd || 0}</li>
              ))}
            </ul>
            {(pack.branch_protection || []).length ? (
              <p className="portal-surface__subtitle">{pack.branch_protection?.length} repos with required SetuOps checks.</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </AdminLayout>
  );
}
