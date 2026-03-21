import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { asRecord, getString } from '../../../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const CLOUDS = ['aws', 'azure', 'gcp'];
const ENVS = ['dev', 'staging', 'prod', 'qa'];

interface RequestTemplate {
  id: number;
  name: string;
  description: string;
  cloud: string;
  env: string;
  service: string;
  config: string;
}

function parsePositiveIntParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export default function EditDevOpsTemplate() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const routeTemplateId = parsePositiveIntParam(router.query.id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloud, setCloud] = useState('aws');
  const [env, setEnv] = useState('prod');
  const [service, setService] = useState('');
  const [config, setConfig] = useState('{}');
  const [templateID, setTemplateID] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);

  const fetchTemplate = useCallback(async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined' || !routeTemplateId) return;
    setFetchLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/templates`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = asRecord(await res.json().catch(() => ({})));
      const templates = Array.isArray(data.templates) ? data.templates : [];
      const template = templates.find((item: { id?: unknown }) => Number(item?.id) === routeTemplateId) as RequestTemplate | undefined;
      if (res.ok && template) {
        setTemplateID(template.id);
        setName(template.name);
        setDescription(template.description || '');
        setCloud(template.cloud || 'aws');
        setEnv(template.env || 'prod');
        setService(template.service || '');
        setConfig(template.config || '{}');
      } else {
        setTemplateID(null);
        setError(getString(data.error, 'Template not found'));
      }
    } catch {
      setTemplateID(null);
      setError('Failed to load template. Check your connection.');
    } finally {
      setFetchLoading(false);
    }
  }, [routeTemplateId, router, apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    if (routeTemplateId) {
      void fetchTemplate();
    } else {
      setFetchLoading(false);
      setTemplateID(null);
      setError('Template not found');
    }
  }, [router, routeTemplateId, fetchTemplate]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!templateID) return;
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
      const res = await fetch(`${apiUrl}/api/devops/templates/${templateID}`, {
        method: 'PUT',
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
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        router.push('/templates?updated=1');
        return;
      }
      setError(getString(data.error, 'Failed to update template'));
    } catch {
      setError('Failed to update template. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Edit template - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page portal-page--narrow">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Templates</span>
              <h1 className="portal-page__title">Edit Template</h1>
              <p className="portal-page__subtitle">
                Existing template editing behavior is unchanged, but the authoring flow now follows the same design language as the rest of the portal.
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
                <span className="portal-surface__eyebrow">Editing</span>
                <h2 className="portal-surface__title">Template details</h2>
                <p className="portal-surface__subtitle">
                  Update naming, defaults, and config without changing the underlying template API flow.
                </p>
              </div>
            </div>

            {fetchLoading ? (
              <div className="portal-empty">
                <p>Loading template...</p>
              </div>
            ) : (
              <>
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
                      <label className="label" htmlFor="tpl-preview">
                        Preview
                      </label>
                      <div id="tpl-preview" className="portal-pill-row" style={{ minHeight: 46, alignItems: 'center' }}>
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
                    />
                  </div>

                  <div className="portal-form-actions">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? 'Saving...' : 'Save changes'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => void fetchTemplate()}>
                      Reset
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      </DevOpsLayout>
    </>
  );
}
