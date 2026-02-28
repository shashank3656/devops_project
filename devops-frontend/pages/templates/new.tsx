import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const CLOUDS = ['aws', 'azure', 'gcp'];
const ENVS = ['dev', 'staging', 'prod', 'qa'];

export default function NewDevOpsTemplate() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloud, setCloud] = useState('aws');
  const [env, setEnv] = useState('prod');
  const [service, setService] = useState('');
  const [config, setConfig] = useState('{}');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
    }
  }, [router]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim() || !cloud.trim() || !env.trim() || !service.trim()) {
      setError('Name, cloud, env, and service are required.');
      return;
    }
    const configStr = config.trim() || '{}';
    try {
      JSON.parse(configStr);
    } catch {
      setError('Config must be valid JSON.');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
      if (!token || token === 'undefined') {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${apiUrl}/api/devops/templates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          cloud: cloud.trim(),
          env: env.trim(),
          service: service.trim(),
          config: configStr,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.template) {
        router.push('/templates?created=1');
        return;
      }
      setError(data.error || 'Failed to create template');
    } catch {
      setError('Failed to create template. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>New template - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page portal-page--narrow">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Templates</span>
              <h1 className="portal-page__title">Create Template</h1>
              <p className="portal-page__subtitle">
                Keep the current template feature set while moving it into a more structured, form-first authoring flow.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/templates" className="btn btn-secondary">
                Back to templates
              </Link>
            </div>
          </header>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Authoring</span>
                <h2 className="portal-surface__title">Template details</h2>
                <p className="portal-surface__subtitle">
                  Pre-fill cloud, environment, service, and JSON defaults for faster request creation.
                </p>
              </div>
            </div>

            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="portal-stack">
              <div className="portal-field-grid portal-field-grid--two">
                <div className="form-group">
                  <label className="label" htmlFor="tpl-name">
                    Name
                  </label>
                  <input
                    id="tpl-name"
                    className="input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    placeholder="e.g. AWS prod EKS"
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="tpl-service">
                    Service
                  </label>
                  <input
                    id="tpl-service"
                    className="input"
                    value={service}
                    onChange={(event) => setService(event.target.value)}
                    required
                    placeholder="e.g. EKS, BigQuery"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="label" htmlFor="tpl-desc">
                  Description
                </label>
                <input
                  id="tpl-desc"
                  className="input"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Short description for users"
                />
              </div>

              <div className="portal-field-grid">
                <div className="form-group">
                  <label className="label" htmlFor="tpl-cloud">
                    Cloud
                  </label>
                  <select id="tpl-cloud" className="input" value={cloud} onChange={(event) => setCloud(event.target.value)}>
                    {CLOUDS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="tpl-env">
                    Environment
                  </label>
                  <select id="tpl-env" className="input" value={env} onChange={(event) => setEnv(event.target.value)}>
                    {ENVS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="tpl-config-preview">
                    Preview
                  </label>
                  <div id="tpl-config-preview" className="portal-pill-row" style={{ minHeight: 46, alignItems: 'center' }}>
                    <span className="portal-pill">{cloud}</span>
                    <span className="portal-pill">{env}</span>
                    <span className="portal-pill">{service || 'service'}</span>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="label" htmlFor="tpl-config">
                  Config (JSON)
                </label>
                <textarea
                  id="tpl-config"
                  className="input portal-code-input"
                  value={config}
                  onChange={(event) => setConfig(event.target.value)}
                  rows={8}
                  placeholder='{"team":"platform","priority":"medium"}'
                />
              </div>

              <div className="portal-form-actions">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Creating...' : 'Create template'}
                </button>
                <Link href="/templates" className="btn btn-secondary">
                  Cancel
                </Link>
              </div>
            </form>
          </section>
        </div>
      </DevOpsLayout>
    </>
  );
}
