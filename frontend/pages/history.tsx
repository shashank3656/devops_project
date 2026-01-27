import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import styles from '../styles/History.module.css';

interface RequestHistory {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  payload: string;
  pr_url: string;
  branch: string;
  file_path: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function History() {
  const router = useRouter();
  const [history, setHistory] = useState<RequestHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    team: '',
    env: '',
  });

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/');
    }
  }, [router]);

  useEffect(() => {
    fetchHistory();
  }, [filters]);

  const fetchHistory = async () => {
    setLoading(true);
    setError('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const params = new URLSearchParams();
      if (filters.team) params.append('team', filters.team);
      if (filters.env) params.append('env', filters.env);
      params.append('limit', '100');

      const response = await fetch(`${apiUrl}/history?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch history: ${response.statusText}`);
      }

      const data = await response.json();
      setHistory(data.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load history');
      console.error('Error fetching history:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    const statusClass = status === 'pr_created' ? 'status-success' : 'status-pending';
    return (
      <span className={`${styles.statusBadge} ${styles[statusClass]}`}>
        {status === 'pr_created' ? 'PR Created' : 'Pending'}
      </span>
    );
  };

  return (
    <div className={styles.container}>
      <Head>
        <title>Request History - Infrastructure Portal</title>
      </Head>

      <header className={styles.header}>
        <h1>Request History</h1>
        <div className={styles.headerActions}>
          <button
            className={styles.btnSecondary}
            onClick={() => router.push('/home')}
          >
            ← Back to Home
          </button>
        </div>
      </header>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label htmlFor="team-filter">Team:</label>
          <input
            id="team-filter"
            type="text"
            placeholder="Filter by team"
            value={filters.team}
            onChange={(e) => setFilters({ ...filters, team: e.target.value })}
            className={styles.filterInput}
          />
        </div>
        <div className={styles.filterGroup}>
          <label htmlFor="env-filter">Environment:</label>
          <input
            id="env-filter"
            type="text"
            placeholder="Filter by environment"
            value={filters.env}
            onChange={(e) => setFilters({ ...filters, env: e.target.value })}
            className={styles.filterInput}
          />
        </div>
        <button
          className={styles.btnSecondary}
          onClick={() => setFilters({ team: '', env: '' })}
        >
          Clear Filters
        </button>
      </div>

      {error && (
        <div className={styles.error}>
          {error}
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>Loading history...</div>
      ) : history.length === 0 ? (
        <div className={styles.empty}>
          No requests found. Create your first infrastructure request!
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Team</th>
                <th>Environment</th>
                <th>Cloud</th>
                <th>Service</th>
                <th>Branch</th>
                <th>File Path</th>
                <th>Status</th>
                <th>PR URL</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.team}</td>
                  <td>{item.env}</td>
                  <td className={styles.cloudBadge}>{item.cloud.toUpperCase()}</td>
                  <td>{item.service}</td>
                  <td><code>{item.branch}</code></td>
                  <td><code>{item.file_path}</code></td>
                  <td>{getStatusBadge(item.status)}</td>
                  <td>
                    {item.pr_url ? (
                      <a
                        href={item.pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.link}
                      >
                        View PR
                      </a>
                    ) : (
                      <span className={styles.noPr}>No PR</span>
                    )}
                  </td>
                  <td>{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
