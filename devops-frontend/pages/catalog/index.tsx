import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface CatalogService {
  id: number;
  project_id: number;
  name: string;
  environments: string[];
  teams: string[];
  repos: string[];
  resources: string[];
}

interface TriageAsset {
  resource_id: string;
  display_name: string;
  environment: string;
  region: string;
  service_type: string;
}

export default function CatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [services, setServices] = useState<CatalogService[]>([]);
  const [assets, setAssets] = useState<TriageAsset[]>([]);
  const [serviceChoice, setServiceChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState('');

  const load = () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${apiUrl}/api/catalog/services`, { headers }),
      fetch(`${apiUrl}/api/catalog/triage`, { headers }),
    ])
      .then(async ([servicesResponse, triageResponse]) => {
        const servicesData = await servicesResponse.json().catch(() => ({}));
        const triageData = await triageResponse.json().catch(() => ({}));
        if (!servicesResponse.ok) {
          setError(servicesData?.error || 'Failed to load catalog');
          setServices([]);
        } else {
          setServices(Array.isArray(servicesData.services) ? servicesData.services : []);
          setError('');
        }
        setAssets(triageResponse.ok && Array.isArray(triageData.assets) ? triageData.assets : []);
      })
      .catch(() => setError('Failed to load catalog'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [apiUrl]);

  const linkAsset = async (asset: TriageAsset) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const serviceID = serviceChoice[asset.resource_id];
    if (!token || !serviceID) return;
    setLinking(asset.resource_id);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/catalog/services/${serviceID}/resources`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource_id: asset.resource_id }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404) throw new Error('That service is outside your catalog scope.');
      if (!response.ok) throw new Error(data?.error || 'Failed to link resource');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link resource');
    } finally {
      setLinking('');
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Catalog - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Catalog</span>
            <h1 className="portal-page__title">Service catalog</h1>
            <p className="portal-page__subtitle">
              Services you can read, plus cloud assets that are not linked to one of those services.
            </p>
          </div>
          <Link href="/catalog/new" className="btn btn-primary">Onboard service</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          {loading ? <div className="empty-state">Loading catalog...</div> : null}
          {!loading && !services.length ? <div className="empty-state">No services in your scope yet.</div> : null}
          {services.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Environments</th>
                  <th>Owner teams</th>
                  <th>Resources</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/catalog/${service.id}`)}>
                    <td>
                      <strong>{service.name}</strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>ID {service.id}</div>
                    </td>
                    <td>{service.environments?.join(', ') || '—'}</td>
                    <td>{service.teams?.join(', ') || '—'}</td>
                    <td>{service.resources?.length || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
        <section className="portal-surface">
          <h2 className="portal-page__title" style={{ fontSize: 18 }}>Triage</h2>
          <p className="portal-page__subtitle">Assets with no link to a service you can read. Linking one does not reveal any other owner.</p>
          {!loading && !assets.length ? <div className="empty-state">No unmapped assets in your environments.</div> : null}
          {assets.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Environment</th>
                  <th>Link to service</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.resource_id}>
                    <td>
                      <strong>{asset.display_name || asset.resource_id}</strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{asset.resource_id}</div>
                    </td>
                    <td>{asset.environment || '—'}</td>
                    <td>
                      <select
                        className="input"
                        value={serviceChoice[asset.resource_id] || ''}
                        onChange={(event) => setServiceChoice((current) => ({ ...current, [asset.resource_id]: event.target.value }))}
                      >
                        <option value="">Select</option>
                        {services.map((service) => (
                          <option key={service.id} value={service.id}>{service.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!serviceChoice[asset.resource_id] || linking === asset.resource_id}
                        onClick={() => void linkAsset(asset)}
                      >
                        {linking === asset.resource_id ? 'Linking...' : 'Link'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
