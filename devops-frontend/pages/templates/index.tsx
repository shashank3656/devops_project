import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { DataTable, EmptyState, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';
import {
  buildCloudGroups,
  formatEnvironmentList,
  normalizeTemplate,
  RequestTemplate,
  type CloudGroup,
} from '../../lib/requestTemplates';

const DEVOPS_TOKEN_KEY = 'devops_token';

const CLOUD_COLUMNS: DataTableColumn<CloudGroup>[] = [
  {
    id: 'cloud',
    header: 'Cloud',
    cell: (cloud) => (
      <div className="ig-cell-stack">
        <span className="ig-cell-title">{cloud.label}</span>
        <span className="ig-cell-meta">Click to browse the services and templates inside this cloud.</span>
      </div>
    ),
  },
  { id: 'services', header: 'Services', align: 'right', className: 'ig-cell-num', cell: (cloud) => cloud.services.length },
  { id: 'templates', header: 'Templates', align: 'right', className: 'ig-cell-num', cell: (cloud) => cloud.templateCount },
  { id: 'environments', header: 'Environments', cell: (cloud) => formatEnvironmentList(cloud.environments) || '—' },
];

export default function DevOpsTemplatesList() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    void fetchTemplates();
  }, [router]);

  const fetchTemplates = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
      if (!token || token === 'undefined') {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${apiUrl}/api/devops/templates`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        setTemplates(
          Array.isArray(data.templates)
            ? data.templates.map(normalizeTemplate).filter((item): item is RequestTemplate => Boolean(item))
            : [],
        );
        setError('');
      } else {
        setTemplates([]);
        setError(getString(data.error, 'Failed to load templates'));
      }
    } catch {
      setTemplates([]);
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const cloudGroups = useMemo(() => buildCloudGroups(templates), [templates]);
  const filteredCloudGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return cloudGroups;
    return cloudGroups.filter((cloud) => {
      if (cloud.label.toLowerCase().includes(query)) return true;
      return cloud.services.some((service) => {
        if (service.label.toLowerCase().includes(query)) return true;
        return service.templates.some((template) => {
          const haystack = `${template.name} ${template.description} ${template.service} ${template.env}`.toLowerCase();
          return haystack.includes(query);
        });
      });
    });
  }, [cloudGroups, search]);

  const openCloud = (cloudKey: string) => {
    void router.push(`/templates/cloud/${cloudKey}`);
  };

  return (
    <>
      <Head>
        <title>Templates - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Templates</span>
              <h1 className="portal-page__title">Template Management</h1>
              <p className="portal-page__subtitle">
                Browse one shared template library. Open a cloud first, then drill into its services and templates.
              </p>
            </div>
            <Link href="/templates/new" className="btn btn-primary">
              New template
            </Link>
          </div>

          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="portal-surface">
              <div className="portal-empty">
                <p>Loading templates...</p>
              </div>
            </div>
          ) : templates.length === 0 ? (
            <div className="portal-surface">
              <div className="portal-empty">
                <p>No templates exist yet.</p>
              </div>
            </div>
          ) : (
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Template library</span>
                  <h2 className="portal-surface__title">Cloud list</h2>
                  <p className="portal-surface__subtitle">
                    The same shared templates created from admin or DevOps are listed here.
                  </p>
                </div>
              </div>

              <div className="template-browser-filter">
                <label className="template-browser-filter__search">
                  <span className="template-browser-filter__label">Search</span>
                  <input
                    className="input template-browser-filter__input"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search cloud, service, or template"
                  />
                </label>
              </div>

              <div className="ig-legacy-table">
                <DataTable<CloudGroup>
                  label="Template clouds"
                  columns={CLOUD_COLUMNS}
                  rows={filteredCloudGroups}
                  rowKey={(cloud) => cloud.key}
                  onRowOpen={(cloud) => openCloud(cloud.key)}
                  empty={<EmptyState title="No clouds match search" body="Try a different cloud, service, or template name." />}
                />
              </div>
            </section>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
