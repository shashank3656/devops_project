import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';

const CLOUDS = [
  { id: 'aws', name: 'Amazon Web Services', short: 'AWS', color: '#FF9900', icon: '☁️', description: 'Provision AWS resources: EC2, S3, RDS, Lambda, and more with guided configuration.' },
  { id: 'azure', name: 'Microsoft Azure', short: 'Azure', color: '#0078D4', icon: '☁️', description: 'Deploy Azure resources: VMs, Storage, Databases, and services with guided inputs.' },
  { id: 'gcp', name: 'Google Cloud Platform', short: 'GCP', color: '#4285F4', icon: '☁️', description: 'Create GCP resources: Compute Engine, Cloud Storage, BigQuery, and more.' },
] as const;

export default function CreateInfrastructure() {
  const router = useRouter();

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

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
              <Link href="/history" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                Logs
              </Link>
              <button onClick={() => router.push('/home')} className="btn btn-secondary">
                Home
              </button>
              <button onClick={handleLogout} className="btn btn-secondary">
                Logout
              </button>
            </div>
          </div>

          <div className="card" style={{ textAlign: 'center' }}>
            <p style={{
              color: 'var(--text-secondary)',
              marginBottom: '32px',
              fontSize: '16px',
            }}>
              Choose how you want to create your infrastructure resources
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '24px',
              maxWidth: '960px',
              margin: '0 auto',
            }}>
              {CLOUDS.map((c) => (
                <div
                  key={c.id}
                  onClick={() => router.push(`/select-service?cloud=${c.id}`)}
                  className="card card-interactive"
                  style={{
                    padding: '32px 24px',
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
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    background: `${c.color}18`,
                    color: c.color,
                    fontSize: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '16px',
                  }}>
                    {c.icon}
                  </div>
                  <h3 style={{
                    fontSize: '20px',
                    fontWeight: '600',
                    marginBottom: '8px',
                    color: 'var(--text-primary)',
                  }}>
                    {c.name}
                  </h3>
                  <p style={{
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                    lineHeight: 1.6,
                    margin: 0,
                  }}>
                    {c.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
