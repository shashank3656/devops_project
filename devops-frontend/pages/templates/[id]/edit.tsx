import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';

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

export default function EditDevOpsTemplate() {
  const router = useRouter();
  const { id } = router.query;
  const apiUrl = useApiUrl();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloud, setCloud] = useState('aws');
  const [env, setEnv] = useState('prod');
  const [service, setService] = useState('');
  const [config, setConfig] = useState('{}');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);

  const fetchTemplate = useCallback(async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || typeof id !== 'string' || !id) return;
    setFetchLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/templates/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.template) {
        const t = data.template as RequestTemplate;
        setName(t.name);
        setDescription(t.description || '');
        setCloud(t.cloud || 'aws');
        setEnv(t.env || 'prod');
        setService(t.service || '');
        setConfig(t.config || '{}');
        setError('');
      } else {
        setError(data.error || 'Template not found');
      }
    } catch {
      setError('Failed to load template. Check your connection.');
    } finally {
      setFetchLoading(false);
    }
  }, [id, router, apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    if (typeof id === 'string' && id) fetchTemplate();
  }, [id, router, fetchTemplate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof id !== 'string') return;
    setError('');
    if (!name.trim() || !cloud.trim() || !env.trim() || !service.trim()) {
      setError('Name, cloud, env, and service are required.');
      return;
    }
    let configStr = config.trim() || '{}';
    try {
      JSON.parse(configStr);
    } catch {
      setError('Config must be valid JSON.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/devops/templates/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem(DEVOPS_TOKEN_KEY)}`,
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
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push('/templates?updated=1');
        return;
      }
      setError(data.error || 'Failed to update template');
    } catch {
      setError('Failed to update template. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) {
    return (
      <DevOpsLayout>
        <div className="container" style={{ padding: '24px' }}>
          <p>Loading template…</p>
        </div>
      </DevOpsLayout>
    );
  }

  return (
    <>
      <Head>
        <title>Edit template - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="container" style={{ padding: '24px' }}>
          <Link href="/templates" style={{ display: 'inline-block', marginBottom: '16px', color: 'var(--primary-color)', textDecoration: 'none' }}>
            ← Back to Templates
          </Link>
          <div className="card" style={{ maxWidth: 560 }}>
            <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Edit template</h2>
            {error && (
              <div className="alert alert-error" role="alert" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <span>{error}</span>
                <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={fetchTemplate}>
                  Retry
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="label" htmlFor="tpl-name">Name <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                <input
                  id="tpl-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  style={{ width: '100%', padding: '8px 12px' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="label" htmlFor="tpl-desc">Description</label>
                <input
                  id="tpl-desc"
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div className="form-group">
                  <label className="label" htmlFor="tpl-cloud">Cloud *</label>
                  <select id="tpl-cloud" className="input" value={cloud} onChange={(e) => setCloud(e.target.value)} style={{ width: '100%', padding: '8px 12px' }}>
                    {CLOUDS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="tpl-env">Environment *</label>
                  <select id="tpl-env" className="input" value={env} onChange={(e) => setEnv(e.target.value)} style={{ width: '100%', padding: '8px 12px' }}>
                    {ENVS.map((envOpt) => (
                      <option key={envOpt} value={envOpt}>{envOpt}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="tpl-service">Service *</label>
                  <input
                    id="tpl-service"
                    className="input"
                    value={service}
                    onChange={(e) => setService(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px 12px' }}
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="label" htmlFor="tpl-config">Config (JSON)</label>
                <textarea
                  id="tpl-config"
                  className="input"
                  value={config}
                  onChange={(e) => setConfig(e.target.value)}
                  rows={6}
                  style={{ fontFamily: 'monospace', fontSize: '13px', width: '100%', padding: '8px 12px' }}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ padding: '10px 24px' }}>
                {loading ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          </div>
        </div>
      </DevOpsLayout>
    </>
  );
}
