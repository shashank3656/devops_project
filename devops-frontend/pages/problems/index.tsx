import Link from 'next/link';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { PROBLEM_STATES, priorityLabel, problemStateLabel } from '../../lib/itsm';
import { CopyButton } from '@infragate/ui';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProblemRow {
  id: number;
  problem_number: string;
  fingerprint: string;
  service: string;
  environment: string;
  summary: string;
  status: string;
  priority?: string;
  occurrence_count: number;
}

function stateKey(status: string): string {
  const key = (status || '').toLowerCase();
  return key === 'open' ? 'new' : key;
}

export default function ProblemsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ProblemRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/problems`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load problems');
          return;
        }
        setItems(Array.isArray(data.problems) ? data.problems : []);
      })
      .catch(() => setError('Failed to load problems'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const filtering = Boolean(query.trim() || status);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status && stateKey(item.status) !== status) return false;
      if (!needle) return true;
      const haystack = [item.problem_number, item.summary, item.service, item.environment, item.fingerprint].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, query, status]);

  function clearFilters() {
    setQuery('');
    setStatus('');
  }

  return (
    <DevOpsLayout>
      <Head>
        <title>Problems - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Problems</span>
            <h1 className="portal-page__title">Problems</h1>
            <p className="portal-page__subtitle">Open a problem for root cause, or let three matching alerts in 14 days open one.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void router.push('/problems/new')}>
            Create problem
          </button>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <form className="iam-filters" onSubmit={(event) => event.preventDefault()}>
            <label>
              Search
              <input
                className="input"
                type="search"
                value={query}
                placeholder="Number, summary, service, or fingerprint"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              State
              <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All states</option>
                {PROBLEM_STATES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <div className="iam-filters__actions">
              {filtering ? <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear</button> : null}
            </div>
          </form>
          {loading ? <div className="empty-state">Loading problems...</div> : null}
          {!loading && !visible.length ? (
            <div className="empty-state">{filtering ? 'No problems match this filter.' : 'No recurring problems yet.'}</div>
          ) : null}
          {visible.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Problem</th>
                  <th>Priority</th>
                  <th>Service</th>
                  <th>Count</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/problems/${item.id}`)}>
                    <td>
                      <strong>
                        <Link href={`/problems/${item.id}`} onClick={(event) => event.stopPropagation()}>{item.problem_number}</Link>
                        <CopyButton value={item.problem_number} label="problem number" />
                      </strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.summary || item.fingerprint}</div>
                    </td>
                    <td>{priorityLabel(item.priority || 'p3')}</td>
                    <td>{item.service || item.environment || '—'}</td>
                    <td>{item.occurrence_count}</td>
                    <td>{problemStateLabel(item.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
