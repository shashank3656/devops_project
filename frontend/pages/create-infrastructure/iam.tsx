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
      <div className="request-entry-shell request-entry-shell--wide">
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

                  <div className="request-entry-grid request-entry-grid--clouds">
                    {CLOUDS.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => router.push(`/select-service?cloud=${c.id}&type=iam`)}
                        className="request-entry-option request-entry-option--cloud"
                      >
                        <div className="request-entry-option__logo-wrap">
                          <Image
                            src={`/${c.id}-logo.png`}
                            alt={c.short}
                            width={120}
                            height={48}
                            className="request-entry-option__logo"
                          />
                        </div>
                        <div className="request-entry-option__body">
                          <p className="request-entry-option__eyebrow">{c.short}</p>
                          <h3 className="request-entry-option__title">{c.name}</h3>
                          <p className="request-entry-option__copy">{c.description}</p>
                        </div>
                        <span className="request-entry-option__cta">Continue with {c.short}</span>
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
