import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
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

interface DevOpsTeam {
  id: number;
  name: string;
  slug: string;
  team_type: string;
}

export default function DevOpsDashboard() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [teams, setTeams] = useState<DevOpsTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    Promise.all([
      fetch(`${apiUrl}/api/devops/tickets`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiUrl}/api/devops/my-teams`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(([ticketsRes, teamsRes]) => {
        if (ticketsRes.status === 401 || ticketsRes.status === 403) {
          router.replace('/login');
          return Promise.resolve([{}, {}] as [{ tickets?: Ticket[]; error?: string }, { teams?: DevOpsTeam[] }]);
        }
        return Promise.all([ticketsRes.json(), teamsRes.json()]);
      })
      .then(([ticketsData, teamsData]) => {
        if (ticketsData?.tickets) setTickets(ticketsData.tickets);
        else if (ticketsData?.error) setError(ticketsData.error);
        if (teamsData?.teams) setTeams(teamsData.teams);
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

  const [statusFilter, setStatusFilter] = useState<string>('');

  const teamStatus = useMemo(() => {
    const byTeam: Record<string, { in_progress: number; completed: number; rejected: number; pending_approval: number; other: number }> = {};
    tickets.forEach((t) => {
      const team = t.team || 'Other';
      if (!byTeam[team]) byTeam[team] = { in_progress: 0, completed: 0, rejected: 0, pending_approval: 0, other: 0 };
      if (t.status === 'in_progress') byTeam[team].in_progress += 1;
      else if (t.status === 'completed') byTeam[team].completed += 1;
      else if (t.status === 'rejected') byTeam[team].rejected += 1;
      else if (t.status === 'pending_approval' || t.status === 'pending_devops_approval') byTeam[team].pending_approval += 1;
      else byTeam[team].other += 1;
    });
    return Object.entries(byTeam).map(([team, counts]) => ({
      team,
      ...counts,
      total: counts.in_progress + counts.completed + counts.rejected + counts.pending_approval + counts.other,
    }));
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    if (!statusFilter) return tickets;
    return tickets.filter((t) => t.status === statusFilter);
  }, [tickets, statusFilter]);

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
                <Link href="/workload" className="stat-card-link">Review on Workload →</Link>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">In progress</div>
                <div className="stat-card-value">{stats.in_progress}</div>
              </div>
            </div>
          )}

          {/* Team status – my DevOps teams & ticket status by team */}
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 className="card-title">Team status</h2>
            {teams.length === 0 && teamStatus.length === 0 ? (
              <p className="empty-state" style={{ margin: 0 }}>You are not in any DevOps teams yet. Ticket status by team will appear here once you have teams and tickets.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {teams.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8 }}>My teams</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {teams.map((t) => (
                        <Link key={t.id} href="/team" className="devops-team-pill">
                          {t.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {teamStatus.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8 }}>Ticket status by team</h3>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Team</th>
                            <th>Total</th>
                            <th>In progress</th>
                            <th>Completed</th>
                            <th>Rejected</th>
                            <th>Pending approval</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teamStatus.map((row) => (
                            <tr key={row.team}>
                              <td><strong>{row.team}</strong></td>
                              <td>{row.total}</td>
                              <td>{row.in_progress}</td>
                              <td>{row.completed}</td>
                              <td>{row.rejected}</td>
                              <td>{row.pending_approval}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {loading ? (
            <p className="loading-text">Loading…</p>
          ) : tickets.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <p>No tickets assigned to you yet. Tickets appear here after an admin approves a request and a PR is created.</p>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="devops-tickets-filter">
                <label className="devops-filter-label">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="input"
                  style={{ width: 'auto', minWidth: 140 }}
                >
                  <option value="">All</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Rejected</option>
                  <option value="pending_approval">Pending approval</option>
                  <option value="pending_devops_approval">Pending DevOps</option>
                </select>
              </div>
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
                    {filteredTickets.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>No tickets match the filter.</td>
                      </tr>
                    ) : filteredTickets.map((t) => (
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
