import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';

const CLOUDS = [
  { id: 'aws', name: 'Amazon Web Services (AWS)', short: 'AWS', color: '#FF9900', icon: '☁️', description: 'Provision AWS resources: EC2, S3, RDS, Lambda, and more with guided configuration.' },
  { id: 'azure', name: 'Microsoft Azure', short: 'Azure', color: '#0078D4', icon: '☁️', description: 'Deploy Azure resources: VMs, Storage, Databases, and services with guided inputs.' },
  { id: 'gcp', name: 'Google Cloud Platform (GCP)', short: 'GCP', color: '#4285F4', icon: '☁️', description: 'Create GCP resources: Compute Engine, Cloud Storage, BigQuery, and more.' },
] as const;

interface PRRequest {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  pr_url: string;
  created_at: string;
}

export default function CreateInfrastructure() {
  const router = useRouter();
  const [selectedCloud, setSelectedCloud] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [cloudLogs, setCloudLogs] = useState<PRRequest[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  // Fetch logs for selected cloud only
  useEffect(() => {
    if (!selectedCloud) {
      setCloudLogs([]);
      return;
    }
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    setLogsLoading(true);
    fetch(`${apiUrl}/api/history?cloud=${encodeURIComponent(selectedCloud)}&limit=20&offset=0`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((data) => setCloudLogs(data.requests || []))
      .catch(() => setCloudLogs([]))
      .finally(() => setLogsLoading(false));
  }, [selectedCloud]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  const selectedCloudInfo = CLOUDS.find((c) => c.id === selectedCloud);

  return (
    <>
      <Head>
        <title>Create Infrastructure - Infrastructure Portal</title>
        <meta name="description" content="Create infrastructure resources" />
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '32px',
          }}>
            <h1 style={{
              fontSize: '36px',
              fontWeight: 'bold',
              color: 'var(--text-primary)',
              margin: 0,
            }}>
              Create Infrastructure
            </h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
              <button
                onClick={() => router.push('/custom-json')}
                className="btn btn-primary"
              >
                Custom JSON
              </button>
              <button onClick={() => router.push('/home')} className="btn btn-secondary">
                Home
              </button>
              <button onClick={handleLogout} className="btn btn-secondary">
                Logout
              </button>
            </div>
          </div>

          {/* Select Cloud dropdown */}
          <div className="card" style={{ marginBottom: 24 }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 16 }}>
              Choose how you want to create your infrastructure resources
            </p>
            <div ref={dropdownRef} style={{ position: 'relative', maxWidth: 360 }}>
              <button
                type="button"
                onClick={() => setDropdownOpen((o) => !o)}
                className="input"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 14px',
                  fontSize: 14,
                  color: selectedCloud ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                <span>{selectedCloudInfo ? selectedCloudInfo.name : 'Select Cloud'}</span>
                <span style={{ opacity: 0.7 }}>{dropdownOpen ? '▲' : '▼'}</span>
              </button>
              {dropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: 50,
                    overflow: 'hidden',
                  }}
                >
                  {CLOUDS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCloud(c.id);
                        setDropdownOpen(false);
                      }}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        textAlign: 'left',
                        border: 'none',
                        background: selectedCloud === c.id ? 'var(--primary-tint)' : 'transparent',
                        color: 'var(--text-primary)',
                        fontSize: 14,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <span style={{ width: 20, flexShrink: 0 }}>
                        {selectedCloud === c.id ? '✓' : ''}
                      </span>
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* When a cloud is selected: show that cloud only + logs for that cloud */}
          {selectedCloud && selectedCloudInfo && (
            <>
              <div className="card" style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
                  Configure {selectedCloudInfo.short}
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
                  {selectedCloudInfo.description}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <button
                    onClick={() => router.push(`/select-service?cloud=${selectedCloud}`)}
                    className="btn btn-primary"
                  >
                    Configure {selectedCloudInfo.short} resources
                  </button>
                  <button
                    onClick={() => router.push('/custom-json')}
                    className="btn btn-secondary"
                  >
                    Custom JSON
                  </button>
                </div>
              </div>

              <div className="card">
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
                  Logs for {selectedCloudInfo.short}
                </h2>
                {logsLoading ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</p>
                ) : cloudLogs.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                    No requests for {selectedCloudInfo.short} yet. Create one above to see logs here.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>ID</th>
                          <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Team</th>
                          <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Env</th>
                          <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Service</th>
                          <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                          <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Created</th>
                          <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cloudLogs.map((req) => (
                          <tr key={req.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                            <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>{req.id}</td>
                            <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>{req.team}</td>
                            <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>{req.env}</td>
                            <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>{req.service}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span
                                className="status-badge"
                                data-status={req.status}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontWeight: 500,
                                }}
                              >
                                {req.status.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 13 }}>
                              {new Date(req.created_at).toLocaleString()}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {req.pr_url ? (
                                <a href={req.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                                  Open PR
                                </a>
                              ) : (
                                <Link href={`/history?id=${req.id}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                                  View
                                </Link>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p style={{ marginTop: 16, marginBottom: 0 }}>
                  <Link href="/history" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                    View full history
                  </Link>
                </p>
              </div>
            </>
          )}

          {/* When no cloud selected: show three cards */}
          {!selectedCloud && (
            <div className="card" style={{ textAlign: 'center' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
                Select a cloud above to see options and logs for that cloud, or choose one below to get started.
              </p>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '24px',
                maxWidth: '900px',
                margin: '0 auto',
              }}>
                {CLOUDS.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => router.push(`/select-service?cloud=${c.id}`)}
                    className="card card-interactive"
                    style={{
                      padding: '28px 20px',
                      border: '2px solid var(--border-color)',
                      margin: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = c.color;
                      e.currentTarget.style.boxShadow = `0 4px 12px ${c.color}20`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: 'var(--radius-md)',
                      background: `${c.color}18`,
                      color: c.color,
                      fontSize: '22px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '12px',
                    }}>
                      {c.icon}
                    </div>
                    <h3 style={{
                      fontSize: '18px',
                      fontWeight: '600',
                      marginBottom: '6px',
                      color: 'var(--text-primary)',
                    }}>
                      {c.name}
                    </h3>
                    <p style={{
                      color: 'var(--text-secondary)',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      margin: 0,
                    }}>
                      {c.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
