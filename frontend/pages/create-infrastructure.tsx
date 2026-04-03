import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect } from 'react';

export default function NewRequestLanding() {
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
        <title>New Request - SetuOps</title>
        <meta name="description" content="Choose how to start a new request" />
      </Head>
      <div className="request-entry-shell">
        <div className="container request-entry-container request-entry-container--narrow">
          <div className="request-entry-panel">
            <div className="request-entry-hero request-entry-hero--centered">
              <p className="request-entry-hero__eyebrow">New Request</p>
              <h1 className="request-entry-hero__title">How would you like to start?</h1>
              <p className="request-entry-hero__subtitle">
                Pick the request path that best matches the work you need.
              </p>
            </div>

            <div className="request-entry-grid">
            <Link
              href="/create-infrastructure/iam"
              className="request-entry-option"
            >
              <div className="request-entry-option__icon" aria-hidden="true">🔐</div>
              <div className="request-entry-option__body">
                <p className="request-entry-option__eyebrow">Access path</p>
                <h2 className="request-entry-option__title">Access (IAM)</h2>
                <p className="request-entry-option__copy">
                  Request identity and access changes for a cloud account.
                </p>
              </div>
              <span className="request-entry-option__cta">Continue with IAM</span>
            </Link>
            <Link
              href="/create-infrastructure/new"
              className="request-entry-option"
            >
              <div className="request-entry-option__icon" aria-hidden="true">☁️</div>
              <div className="request-entry-option__body">
                <p className="request-entry-option__eyebrow">Infrastructure path</p>
                <h2 className="request-entry-option__title">Cloud Infrastructure</h2>
                <p className="request-entry-option__copy">
                  Request cloud resources, reuse templates, or start from a project.
                </p>
              </div>
              <span className="request-entry-option__cta">Continue with infrastructure</span>
            </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
