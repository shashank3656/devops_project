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
              color: 'var(--text-primary)',
              margin: 0
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

          <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
            <h2 style={{ 
              fontSize: '36px', 
              marginBottom: '20px',
              color: 'var(--text-primary)',
              fontWeight: '700'
            }}>
              Welcome to Infrastructure Portal
            </h2>
            <p style={{ 
              color: 'var(--text-secondary)', 
              marginBottom: '48px',
              fontSize: '18px',
              lineHeight: '1.6',
              maxWidth: '600px',
              margin: '0 auto 48px'
            }}>
              Manage your cloud infrastructure across AWS, GCP, and Azure with ease.
              Create new infrastructure requests or view your request history.
            </p>
            
            <div style={{ 
              display: 'flex', 
              gap: '20px', 
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}>
              <button
                onClick={() => router.push('/create-infrastructure')}
                className="btn btn-primary"
                style={{ 
                  padding: '16px 40px', 
                  fontSize: '18px',
                  fontWeight: '600',
                  minWidth: '220px'
                }}
              >
                ➕ New Request
              </button>
              <button
                onClick={() => router.push('/history')}
                className="btn btn-secondary"
                style={{ 
                  padding: '16px 40px', 
                  fontSize: '18px',
                  fontWeight: '600',
                  minWidth: '220px'
                }}
              >
                📜 View History
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
