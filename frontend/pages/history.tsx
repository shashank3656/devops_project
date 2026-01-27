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
      router.push('/login');
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
    router.push('/login');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <>
      <Head>
        <title>History - Infrastructure Portal</title>
      </Head>
      <div style={{ 
        minHeight: '100vh', 
        padding: '40px 20px',
        background: 'linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 50%, #cbd5e0 100%)',
        backgroundAttachment: 'fixed'
      }}>
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
              color: 'var(--text-primary)',
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
          <div className="card" style={{ 
            marginBottom: '24px', 
            padding: '28px',
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px',
              marginBottom: '24px'
            }}>
              <div style={{
                width: '4px',
                height: '24px',
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                borderRadius: '2px'
              }}></div>
              <h3 style={{ 
                margin: 0,
                fontSize: '20px',
                fontWeight: '700',
                color: 'var(--text-primary)'
              }}>
                Filters
              </h3>
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
              gap: '20px' 
            }}>
              <div>
                <label 
                  htmlFor="filter-team"
                  style={{
                    display: 'block',
                    marginBottom: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}
                >
                  Team
                </label>
                <input
                  id="filter-team"
                  type="text"
                  value={filters.team}
                  onChange={(e) => setFilters({ ...filters, team: e.target.value })}
                  placeholder="Filter by team"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '2px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '15px',
                    transition: 'all 0.2s ease',
                    background: '#ffffff'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#2563eb';
                    e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e2e8f0';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
              <div>
                <label 
                  htmlFor="filter-env"
                  style={{
                    display: 'block',
                    marginBottom: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}
                >
                  Environment
                </label>
                <input
                  id="filter-env"
                  type="text"
                  value={filters.env}
                  onChange={(e) => setFilters({ ...filters, env: e.target.value })}
                  placeholder="Filter by environment"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '2px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '15px',
                    transition: 'all 0.2s ease',
                    background: '#ffffff'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#2563eb';
                    e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e2e8f0';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ 
            overflowX: 'auto',
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
          }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  border: '4px solid #e2e8f0',
                  borderTop: '4px solid #2563eb',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  margin: '0 auto 16px'
                }}></div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>Loading...</p>
              </div>
            ) : error ? (
              <div className="error" style={{ 
                margin: '20px',
                padding: '16px',
                borderRadius: '8px',
                background: '#fee2e2',
                color: '#dc2626',
                border: '1px solid #fecaca'
              }}>
                {error}
              </div>
            ) : requests.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div style={{
                  fontSize: '48px',
                  marginBottom: '16px',
                  opacity: 0.5
                }}>📋</div>
                <p style={{ 
                  color: 'var(--text-secondary)', 
                  fontSize: '16px',
                  fontWeight: '500'
                }}>
                  No PR requests found
                </p>
                <p style={{ 
                  color: 'var(--text-muted)', 
                  fontSize: '14px',
                  marginTop: '8px'
                }}>
                  Try adjusting your filters
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ 
                    borderBottom: '2px solid #e2e8f0',
                    background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'
                  }}>
                    <th style={{ 
                      padding: '16px', 
                      textAlign: 'left',
                      fontSize: '14px',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>ID</th>
                    <th style={{ 
                      padding: '16px', 
                      textAlign: 'left',
                      fontSize: '14px',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>Team</th>
                    <th style={{ 
                      padding: '16px', 
                      textAlign: 'left',
                      fontSize: '14px',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>Environment</th>
                    <th style={{ 
                      padding: '16px', 
                      textAlign: 'left',
                      fontSize: '14px',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>Cloud</th>
                    <th style={{ 
                      padding: '16px', 
                      textAlign: 'left',
                      fontSize: '14px',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>Service</th>
                    <th style={{ 
                      padding: '16px', 
                      textAlign: 'left',
                      fontSize: '14px',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>Status</th>
                    <th style={{ 
                      padding: '16px', 
                      textAlign: 'left',
                      fontSize: '14px',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>Created At</th>
                    <th style={{ 
                      padding: '16px', 
                      textAlign: 'left',
                      fontSize: '14px',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>PR Link</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req, index) => (
                    <tr 
                      key={req.id} 
                      style={{ 
                        borderBottom: '1px solid #e2e8f0',
                        background: index % 2 === 0 ? '#ffffff' : '#f8fafc',
                        transition: 'background 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f1f5f9';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = index % 2 === 0 ? '#ffffff' : '#f8fafc';
                      }}
                    >
                      <td style={{ padding: '16px', fontSize: '15px', color: 'var(--text-primary)' }}>{req.id}</td>
                      <td style={{ padding: '16px', fontSize: '15px', color: 'var(--text-primary)', fontWeight: '500' }}>{req.team}</td>
                      <td style={{ padding: '16px', fontSize: '15px', color: 'var(--text-primary)' }}>{req.env}</td>
                      <td style={{ padding: '16px', fontSize: '15px', color: 'var(--text-primary)' }}>{req.cloud}</td>
                      <td style={{ padding: '16px', fontSize: '15px', color: 'var(--text-primary)' }}>{req.service}</td>
                      <td style={{ padding: '16px' }}>
                        <span className={`cloud-badge ${req.status}`}>
                          {req.status}
                        </span>
                      </td>
                      <td style={{ padding: '16px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                        {formatDate(req.created_at)}
                      </td>
                      <td style={{ padding: '16px' }}>
                        <a 
                          href={req.pr_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="link"
                          style={{
                            color: '#2563eb',
                            textDecoration: 'none',
                            fontWeight: '600',
                            transition: 'color 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#1d4ed8';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = '#2563eb';
                          }}
                        >
                          View PR →
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
