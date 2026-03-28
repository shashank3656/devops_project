import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect } from 'react';

const CLOUDS = [
  { id: 'aws', name: 'Amazon Web Services', short: 'AWS', color: '#FF9900', description: 'Manage IAM users, roles, and policies on AWS.' },
  { id: 'azure', name: 'Microsoft Azure', short: 'Azure', color: '#0078D4', description: 'Manage Azure Active Directory and access control.' },
  { id: 'gcp', name: 'Google Cloud Platform', short: 'GCP', color: '#4285F4', description: 'Manage IAM and service accounts on GCP.' },
] as const;

export default function IAMCloudSelect() {
  const router = useRouter();

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  return (
    <>
      <Head>
        <title>Access Request - Choose Cloud - SetuOps</title>
        <meta name="description" content="Choose a cloud for an access request" />
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          <div className="request-builder">
            <div className="request-builder__header">
              <Link href="/create-infrastructure" className="btn btn-secondary request-builder__back">
                ← Back to New Request
              </Link>
              <h1 className="request-builder__title">Choose a cloud for access work</h1>
              <p className="request-builder__subtitle">
                Pick the cloud where you need help with access, identity, roles, or service permissions. The next step keeps the form short and focused.
              </p>
            </div>

            <div className="request-builder__layout">
              <div className="request-builder__main">
                <section className="request-builder__section">
                  <div className="request-builder__section-header">
                    <h2>Step 1: Choose the cloud</h2>
                    <p>Select the platform where the access change is needed.</p>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: '20px',
                    }}
                  >
                    {CLOUDS.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => router.push(`/select-service?cloud=${c.id}&type=iam`)}
                        className="card card-interactive"
                        style={{
                          padding: '28px 24px',
                          border: '1px solid var(--color-border)',
                          margin: 0,
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = c.color;
                          e.currentTarget.style.boxShadow = `0 10px 24px ${c.color}18`;
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--color-border)';
                          e.currentTarget.style.boxShadow = 'none';
                          e.currentTarget.style.transform = 'translateY(0)';
                        }}
                      >
                        <div style={{ height: '48px', display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                          <Image
                            src={`/${c.id}-logo.png`}
                            alt={c.short}
                            width={120}
                            height={48}
                            style={{ height: 48, width: 'auto', objectFit: 'contain' }}
                          />
                        </div>
                        <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text)' }}>
                          {c.name}
                        </h3>
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', lineHeight: 1.6, margin: '0 0 16px' }}>
                          {c.description}
                        </p>
                        <span style={{ color: 'var(--color-primary)', fontSize: '14px', fontWeight: 600 }}>
                          Continue with {c.short} →
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              <aside className="request-builder__side">
                <div className="request-builder__summary">
                  <h3>What this path is for</h3>
                  <div className="request-builder__summary-list request-builder__summary-list--plain">
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">Ask for access changes, role updates, or identity-related setup.</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">The next page will ask for the project, team, environment, and the target area inside the selected cloud.</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">You can still save a draft if you are gathering details.</span>
                    </div>
                  </div>
                </div>

                <div className="request-builder__summary">
                  <h3>What happens next</h3>
                  <div className="request-builder__summary-list request-builder__summary-list--plain">
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">1. Choose the project and team that own the change.</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">2. Pick the service area and add the exact access details.</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">3. Save a draft or send it for review.</span>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
