import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface RequestTemplate {
  id: number;
  name: string;
  description: string;
  cloud: string;
  env: string;
  service: string;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTemplates = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/templates`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.templates)) {
          setTemplates(data.templates);
          setError('');
        } else {
          setTemplates([]);
          setError('');
        }
      })
      .catch(() => {
        setTemplates([]);
        setError('');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchTemplates();
  }, [router, fetchTemplates]);

  const byCloud = templates.reduce<Record<string, RequestTemplate[]>>((acc, template) => {
    const cloud = (template.cloud || 'other').toLowerCase();
    if (!acc[cloud]) acc[cloud] = [];
    acc[cloud].push(template);
    return acc;
  }, {});

  const cloudOrder = ['aws', 'gcp', 'azure'];
  const clouds = Array.from(
    new Set([
      ...cloudOrder.filter((cloud) => byCloud[cloud]?.length),
      ...Object.keys(byCloud).filter((cloud) => !cloudOrder.includes(cloud)),
    ]),
  );

  return (
    <>
      <Head>
        <title>Templates - Infrastructure Portal</title>
        <meta name="description" content="Browse request templates to create infrastructure" />
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Templates</span>
            <h1 className="portal-page__title">Infrastructure Templates</h1>
            <p className="portal-page__subtitle">
              Templates pre-fill cloud, environment, and service selections so repeatable requests move faster through approval.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/create-infrastructure/new" className="btn btn-primary">
              Open Create Infrastructure
            </Link>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="portal-surface">
            <div className="empty-state">Loading templates...</div>
          </div>
        ) : templates.length === 0 ? (
          <div className="portal-surface">
            <div className="empty-state">
              No templates are available currently.
            </div>
          </div>
        ) : (
          clouds.map((cloud) => (
            <section key={cloud} className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">{cloud.toUpperCase()}</span>
                  <h2 className="portal-surface__title">{cloud.toUpperCase()} templates</h2>
                </div>
              </div>

              <div className="portal-template-grid">
                {(byCloud[cloud] || []).map((template) => (
                  <article key={template.id} className="portal-template-card">
                    <div className="portal-template-card__top">
                      <div>
                        <h3 className="portal-template-card__name">{template.name}</h3>
                        <p className="portal-template-card__description">
                          {template.description || 'Template-driven request starter for repeatable infrastructure work.'}
                        </p>
                      </div>
                    </div>
                    <div className="portal-template-card__meta">
                      <span className="portal-pill">{template.env}</span>
                      <span className="portal-pill">{template.service}</span>
                    </div>
                    <div className="portal-template-card__actions">
                      <Link
                        href={`/select-service?cloud=${encodeURIComponent(template.cloud)}&env=${encodeURIComponent(template.env)}&service=${encodeURIComponent(template.service)}&template_id=${template.id}`}
                        className="btn btn-primary"
                      >
                        Use template
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}
