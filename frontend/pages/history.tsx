import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

interface PRRequest {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  pr_url: string;
  branch: string;
  file_path: string;
  status: string;
  created_at: string;
  updated_at: string;
  created_by: number;
}

export default function History() {
  const router = useRouter();
  const [requests, setRequests] = useState<PRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ team: '', env: '' });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    // Check authentication
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/auth');
      return;
    }

    fetchHistory();
  }, [filters]);

  const fetchHistory = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const params = new URLSearchParams();
      if (filters.team) params.append('team', filters.team);
      if (filters.env) params.append('env', filters.env);

      const response = await fetch(`${apiUrl}/api/history?${params.toString()}`, {
        headers,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      setRequests(data.requests || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/auth');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <>
      <Head>
        <title>History - Infrastructure Portal</title>
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '32px'
          }}>
            <h1 style={{ 
              fontSize: '36px', 
              fontWeight: 'bold',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              PR Request History
            </h1>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => router.push('/home')}
                className="btn btn-secondary"
              >
                Home
              </button>
              <button 
                onClick={handleLogout}
                className="btn btn-secondary"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="card" style={{ marginBottom: '24px', padding: '20px' }}>
            <h3 style={{ marginBottom: '16px' }}>Filters</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div>
                <label htmlFor="filter-team">Team</label>
                <input
                  id="filter-team"
                  type="text"
                  value={filters.team}
                  onChange={(e) => setFilters({ ...filters, team: e.target.value })}
                  placeholder="Filter by team"
                />
              </div>
              <div>
                <label htmlFor="filter-env">Environment</label>
                <input
                  id="filter-env"
                  type="text"
                  value={filters.env}
                  onChange={(e) => setFilters({ ...filters, env: e.target.value })}
                  placeholder="Filter by environment"
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ overflowX: 'auto' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <p>Loading...</p>
              </div>
            ) : error ? (
              <div className="error" style={{ margin: '20px' }}>
                {error}
              </div>
            ) : requests.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <p>No PR requests found</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '12px', textAlign: 'left' }}>ID</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Team</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Environment</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Cloud</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Service</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Created At</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>PR Link</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '12px' }}>{req.id}</td>
                      <td style={{ padding: '12px' }}>{req.team}</td>
                      <td style={{ padding: '12px' }}>{req.env}</td>
                      <td style={{ padding: '12px' }}>{req.cloud}</td>
                      <td style={{ padding: '12px' }}>{req.service}</td>
                      <td style={{ padding: '12px' }}>
                        <span className={`cloud-badge ${req.status}`}>
                          {req.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                        {formatDate(req.created_at)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <a 
                          href={req.pr_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="link"
                        >
                          View PR
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
