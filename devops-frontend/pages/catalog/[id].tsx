import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface CatalogService {
  id: number;
  name: string;
  environments: string[];
  teams: string[];
  repos: string[];
  resources: string[];
}

interface CatalogContext {
  service: CatalogService;
  shared_resources: { resource_id: string; service_ids: number[] }[];
}

export default function CatalogEditorPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const serviceID = typeof router.query.id === 'string' ? router.query.id : '';
  const [context, setContext] = useState<CatalogContext | null>(null);
  const [hidden, setHidden] = useState(false);
  const [name, setName] = useState('');
  const [environments, setEnvironments] = useState('');
  const [teams, setTeams] = useState('');
  const [repo, setRepo] = useState('');
  const [resourceID, setResourceID] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = (id: string) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !id) return;
    setLoading(true);
    fetch(`${apiUrl}/api/catalog/services/${id}/context`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (response.status === 404) {
          setHidden(true);
          setContext(null);
          setError('');
          return;
        }
        if (!response.ok) {
          setHidden(false);
          setContext(null);
          setError(data?.error || 'Failed to load service');
          return;
        }
        const next = data.context as CatalogContext;
        setHidden(false);
        setContext(next);
        setName(next?.service?.name || '');
        setEnvironments((next?.service?.environments || []).join(', '));
        setTeams((next?.service?.teams || []).join(', '));
        setError('');
      })
      .catch(() => setError('Failed to load service'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!router.isReady || !serviceID) return;
    load(serviceID);
  }, [apiUrl, router.isReady, serviceID]);

  const saveOwnership = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !serviceID) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/catalog/services/${serviceID}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          environments: environments.split(',').map((item) => item.trim()).filter(Boolean),
          teams: teams.split(',').map((item) => item.trim()).filter(Boolean),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404) {
        setHidden(true);
        setContext(null);
        return;
      }
      if (!response.ok) throw new Error(data?.error || 'Failed to save ownership');
      load(serviceID);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save ownership');
    } finally {
      setSaving(false);
    }
  };

  const addLink = async (path: 'repos' | 'resources', body: Record<string, string>) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !serviceID) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/catalog/services/${serviceID}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404) {
        setHidden(true);
        setContext(null);
        return;
      }
      if (!response.ok) throw new Error(data?.error || 'Failed to add link');
      if (path === 'repos') setRepo('');
      if (path === 'resources') setResourceID('');
      load(serviceID);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add link');
    } finally {
      setSaving(false);
    }
  };

  const service = context?.service;

  return (
    <DevOpsLayout>
      <Head>
        <title>{hidden ? 'Service not found' : `${service?.name || 'Service'} - Catalog`}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Catalog</span>
            <h1 className="portal-page__title">{hidden ? 'Service not found' : service?.name || 'Service'}</h1>
            <p className="portal-page__subtitle">
              {hidden
                ? 'This service is outside your scope. Its repos and resources stay hidden.'
                : `Service ID ${service?.id || serviceID}. Renaming this service does not move its links.`}
            </p>
          </div>
          <Link href="/catalog" className="btn btn-secondary">Back to catalog</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading service...</div> : null}
        {!loading && !hidden && service ? (
          <>
            <section className="portal-surface">
              <form className="portal-form-grid" onSubmit={(event) => void saveOwnership(event)}>
                <label className="label">
                  Name
                  <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
                </label>
                <label className="label">
                  Environments
                  <input className="input" value={environments} onChange={(event) => setEnvironments(event.target.value)} placeholder="dev, prod" />
                </label>
                <label className="label">
                  Owner teams
                  <input className="input" value={teams} onChange={(event) => setTeams(event.target.value)} placeholder="payments" />
                </label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save ownership'}</button>
                </div>
              </form>
            </section>
            <section className="portal-surface">
              <h2 className="portal-page__title" style={{ fontSize: 18 }}>Repositories</h2>
              {service.repos?.length ? <ul>{service.repos.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="empty-state">No repositories linked.</div>}
              <form className="portal-form-grid" onSubmit={(event) => { event.preventDefault(); void addLink('repos', { repo }); }}>
                <label className="label">
                  Add repository
                  <input className="input" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="acme/payments" />
                </label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-secondary" disabled={saving || !repo.trim()}>Link repository</button>
                </div>
              </form>
            </section>
            <section className="portal-surface">
              <h2 className="portal-page__title" style={{ fontSize: 18 }}>Resources</h2>
              {service.resources?.length ? (
                <ul>
                  {service.resources.map((item) => {
                    const share = context?.shared_resources?.find((row) => row.resource_id === item);
                    const others = (share?.service_ids || []).filter((id) => id !== service.id);
                    return (
                      <li key={item}>
                        {item}
                        {others.length ? ` · also used by service ${others.join(', ')}` : ''}
                      </li>
                    );
                  })}
                </ul>
              ) : <div className="empty-state">No resources linked.</div>}
              <form className="portal-form-grid" onSubmit={(event) => { event.preventDefault(); void addLink('resources', { resource_id: resourceID }); }}>
                <label className="label">
                  Add resource
                  <input className="input" value={resourceID} onChange={(event) => setResourceID(event.target.value)} placeholder="b/payments-logs" />
                </label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-secondary" disabled={saving || !resourceID.trim()}>Link resource</button>
                </div>
              </form>
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
