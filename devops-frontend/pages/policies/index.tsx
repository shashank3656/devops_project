import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface PolicyRow {
  id: number;
  name: string;
  target: string;
  enabled: boolean;
  updated_at: string;
}

export default function PoliciesCatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<PolicyRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/policies`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load policies');
        setItems(Array.isArray(data.policies) ? data.policies : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load policies'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  return (
    <DevOpsLayout>
      <Head><title>Policies - SetuOps</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Gates</span>
            <h1 className="portal-page__title">Policies</h1>
            <p className="portal-page__subtitle">
              Lightweight Rego deny rules on CHGs and request.json. Failures post the existing infragate/policy check.
            </p>
          </div>
          <Link href="/policies/configure" className="btn btn-primary">Configure</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading policies…</div> : null}
        {!loading && items.length === 0 ? <div className="empty-state">No stored policies yet. Built-in Friday prod CAB rule still runs.</div> : null}
        {items.length > 0 ? (
          <section className="portal-surface">
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong> · {item.target} · {item.enabled ? 'on' : 'off'}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
