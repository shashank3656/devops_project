import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface Ticket {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  pr_url: string;
  application_id: string;
  created_at: string;
  updated_at: string;
}

interface DashboardStats {
  pending_approval: number;
  in_progress: number;
}

export default function DevOpsDashboard() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/tickets`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.tickets) setTickets(data.tickets);
        else if (data?.error) setError(data.error);
      })
      .catch(() => setError('Failed to load tickets'))
      .finally(() => setLoading(false));
  }, [router, apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/dashboard-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 200) return res.json();
        return null;
      })
      .then((data) => {
        if (data?.status === 'ok' && typeof data.pending_approval === 'number') {
          setStats({ pending_approval: data.pending_approval, in_progress: data.in_progress ?? 0 });
        }
      })
      .catch(() => {});
  }, [apiUrl]);

  return (
    <>
      <Head>
        <title>My tickets - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="container">
          <h1 className="page-title">My tickets</h1>
          {stats != null && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              <div className="stat-card">
                <div className="stat-card-label">Pending your approval</div>
                <div className="stat-card-value">{stats.pending_approval}</div>
                <a href="/workload" className="stat-card-link">Review on Workload →</a>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">In progress</div>
                <div className="stat-card-value">{stats.in_progress}</div>
              </div>
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
          {loading ? (
            <p className="loading-text">Loading…</p>
          ) : tickets.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <p>No tickets assigned to you yet.</p>
                <p style={{ marginTop: 8, fontSize: 14 }}>After an admin approves a request and a PR is created, tickets are assigned by priority (Critical→L4, High→L3, Medium→L2, Low→L1).</p>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ticket #</th>
                      <th>Team</th>
                      <th>Env</th>
                      <th>Cloud</th>
                      <th>Service</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>PR</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      <tr key={t.id}>
                        <td><code>#{t.id}</code></td>
                        <td>{t.team}</td>
                        <td>{t.env}</td>
                        <td>{t.cloud}</td>
                        <td>{t.service}</td>
                        <td>{t.priority}</td>
                        <td>{t.status}</td>
                        <td>{t.pr_url ? <a href={t.pr_url} target="_blank" rel="noopener noreferrer">Open PR</a> : '-'}</td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{new Date(t.updated_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
