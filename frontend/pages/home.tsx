import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Check authentication
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/auth');
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/auth');
  };

  return (
    <>
      <Head>
        <title>Infrastructure Portal - Home</title>
        <meta name="description" content="Create infrastructure resources" />
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
              Infrastructure Portal
            </h1>
            <button 
              onClick={handleLogout}
              className="btn btn-secondary"
              style={{ padding: '10px 20px' }}
            >
              Logout
            </button>
          </div>

          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ 
              display: 'flex', 
              gap: '16px', 
              marginBottom: '40px',
              justifyContent: 'center'
            }}>
              <button
                onClick={() => router.push('/select-service')}
                className="btn btn-primary"
                style={{ padding: '16px 32px', fontSize: '18px' }}
              >
                ➕ New Request
              </button>
              <button
                onClick={() => router.push('/history')}
                className="btn btn-secondary"
                style={{ padding: '16px 32px', fontSize: '18px' }}
              >
                📜 History
              </button>
            </div>

            <h2 style={{ 
              fontSize: '28px', 
              marginBottom: '16px',
              color: 'var(--text-primary)',
              fontWeight: '700'
            }}>
              Create Infrastructure
            </h2>
            <p style={{ 
              color: 'var(--text-secondary)', 
              marginBottom: '40px',
              fontSize: '16px'
            }}>
              Choose how you want to create your infrastructure resources
            </p>

            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '24px',
              maxWidth: '800px',
              margin: '0 auto'
            }}>
              <div 
                onClick={() => router.push('/select-service')}
                className="card card-interactive"
                style={{
                  padding: '40px',
                  border: '2px solid var(--border-color)',
                  margin: '0'
                }}
              >
                <div style={{ 
                  fontSize: '48px', 
                  marginBottom: '16px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent'
                }}>
                  ☁️
                </div>
                <h3 style={{ 
                  fontSize: '22px', 
                  fontWeight: '600',
                  marginBottom: '12px',
                  color: 'var(--text-primary)'
                }}>
                  Select Cloud & Service
                </h3>
                <p style={{ 
                  color: 'var(--text-secondary)', 
                  fontSize: '14px',
                  lineHeight: '1.6'
                }}>
                  Choose your cloud provider (AWS, GCP, Azure) and service type. Fill in the configuration form with guided inputs.
                </p>
              </div>

              <div 
                onClick={() => router.push('/custom-json')}
                className="card card-interactive"
                style={{
                  padding: '40px',
                  border: '2px solid var(--border-color)',
                  margin: '0'
                }}
              >
                <div style={{ 
                  fontSize: '48px', 
                  marginBottom: '16px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent'
                }}>
                  📝
                </div>
                <h3 style={{ 
                  fontSize: '22px', 
                  fontWeight: '600',
                  marginBottom: '12px',
                  color: 'var(--text-primary)'
                }}>
                  Custom JSON
                </h3>
                <p style={{ 
                  color: 'var(--text-secondary)', 
                  fontSize: '14px',
                  lineHeight: '1.6'
                }}>
                  Provide your infrastructure configuration as a custom JSON payload for advanced use cases.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
