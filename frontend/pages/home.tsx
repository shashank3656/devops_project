import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Check authentication
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
                onClick={() => router.push('/create-infrastructure')}
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

            <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
              <h2 style={{ 
                fontSize: '32px', 
                marginBottom: '16px',
                color: 'var(--text-primary)',
                fontWeight: '700'
              }}>
                Welcome to Infrastructure Portal
              </h2>
              <p style={{ 
                color: 'var(--text-secondary)', 
                marginBottom: '32px',
                fontSize: '18px',
                lineHeight: '1.6'
              }}>
                Manage your cloud infrastructure across AWS, GCP, and Azure with ease.
                Create new infrastructure requests or view your request history.
              </p>
              
              <div style={{ 
                display: 'flex', 
                gap: '16px', 
                justifyContent: 'center',
                flexWrap: 'wrap'
              }}>
                <button
                  onClick={() => router.push('/create-infrastructure')}
                  className="btn btn-primary"
                  style={{ padding: '14px 28px', fontSize: '16px' }}
                >
                  Create New Infrastructure
                </button>
                <button
                  onClick={() => router.push('/history')}
                  className="btn btn-secondary"
                  style={{ padding: '14px 28px', fontSize: '16px' }}
                >
                  View History
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
