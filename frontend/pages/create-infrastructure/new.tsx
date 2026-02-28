import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';

const CLOUDS = [
  {
    id: 'aws',
    name: 'Amazon Web Services',
    short: 'AWS',
    description: 'Provision AWS resources with guided request capture for compute, storage, database, and identity workflows.',
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    short: 'Azure',
    description: 'Launch Azure resource requests with the same review, approval, and PR generation pipeline.',
  },
  {
    id: 'gcp',
    name: 'Google Cloud Platform',
    short: 'GCP',
    description: 'Create GCP infrastructure requests using standardized inputs for repeatable delivery.',
  },
] as const;

interface UserSavedConfig {
  id: number;
  name: string;
  cloud: string;
  env: string;
  service: string;
  created_at: string;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export default function CreateInfrastructureNew() {
  const router = useRouter();
  const [savedConfigs, setSavedConfigs] = useState<UserSavedConfig[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savedConfigsError, setSavedConfigsError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  const fetchSavedConfigs = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setLoadingSaved(true);
    setSavedConfigsError('');
    fetch(`${apiUrl}/api/me/saved-configs`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.saved_configs)) {
          setSavedConfigs(data.saved_configs);
          setSavedConfigsError('');
        } else {
          setSavedConfigs([]);
          setSavedConfigsError('');
        }
      })
      .catch(() => {
        setSavedConfigs([]);
        setSavedConfigsError('');
      })
      .finally(() => setLoadingSaved(false));
  }, [apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    fetchSavedConfigs();
  }, [fetchSavedConfigs]);

  return (
    <>
      <Head>
        <title>Create Infrastructure - InfraGate</title>
        <meta name="description" content="Create infrastructure resources" />
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Request Studio</span>
            <h1 className="portal-page__title">Choose the cleanest path into delivery.</h1>
            <p className="portal-page__subtitle">
              Start from a cloud lane, reuse a saved configuration, or switch to direct payload entry when you need tighter control.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/custom-json" className="btn btn-secondary">
              Custom JSON
            </Link>
            <Link href="/history" className="btn btn-secondary">
              Open timeline
            </Link>
          </div>
        </div>

        {(savedConfigs.length > 0 || savedConfigsError || loadingSaved) && (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Saved starters</span>
                <h2 className="portal-surface__title">Resume from known-good request patterns</h2>
                <p className="portal-surface__subtitle">Pull forward a saved request and continue from the cloud, environment, and service state you already trust.</p>
              </div>
            </div>

            {loadingSaved ? (
              <div className="empty-state">Loading saved configurations...</div>
            ) : savedConfigs.length === 0 ? (
              <div className="empty-state">No saved configurations available yet.</div>
            ) : (
              <div className="request-saved-grid">
                {savedConfigs.map((config) => (
                  <button
                    key={config.id}
                    type="button"
                    className="request-saved-card"
                    onClick={() =>
                      router.push(
                        `/select-service?cloud=${encodeURIComponent(config.cloud)}&env=${encodeURIComponent(config.env)}&service=${encodeURIComponent(config.service)}&saved_id=${config.id}`,
                      )
                    }
                  >
                    <div>
                      <h3 className="request-saved-card__title">{config.name}</h3>
                      <p>Resume a request path based on this saved configuration.</p>
                    </div>
                    <div className="request-saved-card__meta">
                      <span className="portal-pill">{config.cloud}</span>
                      <span className="portal-pill">{config.env}</span>
                      <span className="portal-pill">{config.service}</span>
                    </div>
                    <small>Saved on {formatDate(config.created_at)}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="request-studio-grid">
          {CLOUDS.map((cloud) => (
            <button
              key={cloud.id}
              type="button"
              className="request-cloud-card"
              onClick={() => router.push(`/select-service?cloud=${cloud.id}`)}
            >
              <img src={`/${cloud.id}-logo.png`} alt={cloud.short} className="request-cloud-card__logo" />
              <div>
                <h2 className="request-cloud-card__title">{cloud.name}</h2>
                <p>{cloud.description}</p>
              </div>
              <div className="request-studio-actions">
                <span className="portal-badge portal-badge--neutral">Guided flow</span>
                <span className="portal-badge portal-badge--success">PR-backed</span>
              </div>
            </button>
          ))}
        </section>

        <section className="portal-grid">
          <article className="request-choice-card">
            <strong>Need maximum control?</strong>
            <p>Use Custom JSON when you already have a payload and want to submit it directly into the review flow.</p>
            <div className="request-studio-actions">
              <Link href="/custom-json" className="btn btn-primary">
                Open Custom JSON
              </Link>
            </div>
          </article>

          <article className="request-choice-card">
            <strong>Prefer service-led selection?</strong>
            <p>Switch to service picking first when the cloud is known but the implementation route is still open.</p>
            <div className="request-studio-actions">
              <Link href="/select-service" className="btn btn-secondary">
                Select service
              </Link>
            </div>
          </article>
        </section>
      </div>
    </>
  );
}
