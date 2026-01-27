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
  created_by: number | null;
}

export default function History() {
  const router = useRouter();
  const [requests, setRequests] = useState<PRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState<'team' | 'pr_number' | 'env' | 'cloud'>('team');
  const [filterValue, setFilterValue] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    // Check authentication
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    fetchHistory();
  }, [filterType, filterValue]);

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
      if (filterValue.trim()) {
        // Add filter based on selected type
        if (filterType === 'pr_number') {
          params.append('id', filterValue.trim());
        } else {
          params.append(filterType, filterValue.trim());
        }
      }

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
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
              color: 'var(--text-primary)',
              margin: 0
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

          {/* Single Filter Box */}
          <div className="card" style={{ marginBottom: '24px', padding: '24px' }}>
            <h3 style={{ marginBottom: '20px', fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)' }}>
              Filter Requests
            </h3>
            <div style={{ 
              display: 'flex', 
              gap: '12px', 
              alignItems: 'flex-end',
              flexWrap: 'wrap'
            }}>
              <div style={{ flex: '0 0 auto', minWidth: '180px' }}>
                <label htmlFor="filter-type" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                  Filter By
                </label>
                <select
                  id="filter-type"
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value as 'team' | 'pr_number' | 'env' | 'cloud');
                    setFilterValue(''); // Clear value when changing filter type
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '15px',
                    backgroundColor: 'white',
                    cursor: 'pointer'
                  }}
                >
                  <option value="team">Team</option>
                  <option value="pr_number">PR Number</option>
                  <option value="env">Environment</option>
                  <option value="cloud">Cloud</option>
                </select>
              </div>
              <div style={{ flex: '1 1 300px', minWidth: '250px' }}>
                <label htmlFor="filter-value" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                  {filterType === 'pr_number' ? 'PR Number' : 
                   filterType === 'team' ? 'Team Name' :
                   filterType === 'env' ? 'Environment' : 'Cloud Provider'}
                </label>
                <input
                  id="filter-value"
                  type={filterType === 'pr_number' ? 'number' : 'text'}
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  placeholder={
                    filterType === 'pr_number' ? 'Enter PR number (e.g., 123)' :
                    filterType === 'team' ? 'Enter team name' :
                    filterType === 'env' ? 'Enter environment (dev, stage, prod)' :
                    'Enter cloud provider (AWS, GCP, Azure)'
                  }
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '15px'
                  }}
                />
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <button
                  onClick={() => {
                    setFilterValue('');
                    fetchHistory();
                  }}
                  className="btn btn-secondary"
                  style={{ 
                    padding: '12px 24px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ overflowX: 'auto', padding: '0' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div style={{ 
                  display: 'inline-block',
                  width: '40px',
                  height: '40px',
                  border: '4px solid var(--border-color)',
                  borderTop: '4px solid var(--primary-color)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  marginBottom: '16px'
                }}></div>
                <p style={{ color: 'var(--text-secondary)' }}>Loading requests...</p>
              </div>
            ) : error ? (
              <div className="error" style={{ margin: '24px', padding: '16px', borderRadius: '8px' }}>
                <strong>Error:</strong> {error}
              </div>
            ) : requests.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>
                  {filterValue ? 'No PR requests found matching your filter' : 'No PR requests found'}
                </p>
                {filterValue && (
                  <button
                    onClick={() => {
                      setFilterValue('');
                      fetchHistory();
                    }}
                    className="btn btn-secondary"
                    style={{ marginTop: '16px' }}
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ 
                  width: '100%', 
                  borderCollapse: 'collapse',
                  minWidth: '800px'
                }}>
                  <thead>
                    <tr style={{ 
                      borderBottom: '2px solid var(--border-color)',
                      background: 'var(--bg-gray-50)'
                    }}>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>PR #</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Team</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Environment</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Cloud</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Service</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Status</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Created</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
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
                          borderBottom: '1px solid var(--border-color)',
                          transition: 'background 0.2s ease',
                          background: index % 2 === 0 ? 'white' : 'var(--bg-gray-50)'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--bg-gray-100)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = index % 2 === 0 ? 'white' : 'var(--bg-gray-50)';
                        }}
                      >
                        <td style={{ padding: '16px', fontWeight: '600', color: 'var(--primary-color)' }}>
                          #{req.id}
                        </td>
                        <td style={{ padding: '16px' }}>{req.team}</td>
                        <td style={{ padding: '16px' }}>
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '500',
                            background: 'var(--info-bg)',
                            color: 'var(--info-color)'
                          }}>
                            {req.env}
                          </span>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '500',
                            background: req.cloud === 'AWS' ? '#fff4e6' : req.cloud === 'GCP' ? '#e8f0fe' : '#e3f2fd',
                            color: req.cloud === 'AWS' ? '#ff9900' : req.cloud === 'GCP' ? '#4285f4' : '#0078d4'
                          }}>
                            {req.cloud}
                          </span>
                        </td>
                        <td style={{ padding: '16px' }}>{req.service}</td>
                        <td style={{ padding: '16px' }}>
                          <span style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: '600',
                            background: req.status === 'pending' ? 'var(--warning-bg)' : 
                                       req.status === 'merged' ? 'var(--success-bg)' : 
                                       req.status === 'closed' ? 'var(--error-bg)' : 'var(--info-bg)',
                            color: req.status === 'pending' ? 'var(--warning-color)' : 
                                  req.status === 'merged' ? 'var(--success-color)' : 
                                  req.status === 'closed' ? 'var(--error-color)' : 'var(--info-color)'
                          }}>
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
                            style={{
                              color: 'var(--primary-color)',
                              textDecoration: 'none',
                              fontWeight: '500',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.textDecoration = 'underline';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.textDecoration = 'none';
                            }}
                          >
                            View PR →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
