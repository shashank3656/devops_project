import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useConfirm } from '@infragate/ui';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { asRecord, getString } from '../../../lib/payload';
import {
  buildCloudGroups,
  formatCloudLabel,
  formatEnvironmentList,
  formatProjectScope,
  formatTeamScope,
  normalizeTemplate,
  RequestTemplate,
} from '../../../lib/requestTemplates';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function DevOpsTemplateCloudPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const askConfirm = useConfirm();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const cloudParam = Array.isArray(router.query.cloud) ? router.query.cloud[0] : router.query.cloud;
  const cloudKey = typeof cloudParam === 'string' ? cloudParam.trim().toLowerCase() : '';

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    if (!router.isReady) return;
    void fetchTemplates();
  }, [router, router.isReady]);

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
  const selectedCloud = cloudGroups.find((group) => group.key === cloudKey) || null;
  const tableRows = useMemo(() => {
    if (!selectedCloud) return [];
    return selectedCloud.services.flatMap((service) =>
      service.templates.map((template) => ({
        serviceKey: service.key,
        serviceLabel: service.label,
        template,
      })),
    );
  }, [selectedCloud]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tableRows.filter(({ serviceKey, serviceLabel, template }) => {
      if (serviceFilter && serviceKey !== serviceFilter) return false;
      if (environmentFilter && template.env.trim().toLowerCase() !== environmentFilter) return false;
      if (statusFilter && (template.status || 'draft').trim().toLowerCase() !== statusFilter) return false;
      if (!query) return true;
      const haystack = [
        serviceLabel,
        template.service,
        template.name,
        template.description,
        template.env,
        template.status || 'draft',
        formatTeamScope(template),
        formatProjectScope(template),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [environmentFilter, search, serviceFilter, statusFilter, tableRows]);

  const serviceOptions = useMemo(() => {
    if (!selectedCloud) return [];
    return selectedCloud.services.map((service) => ({ key: service.key, label: service.label }));
  }, [selectedCloud]);

  const statusOptions = useMemo(() => {
    return Array.from(new Set(tableRows.map(({ template }) => (template.status || 'draft').trim().toLowerCase()).filter(Boolean))).sort();
  }, [tableRows]);

  const handleDelete = async (template: RequestTemplate) => {
    const ok = await askConfirm({
      title: 'Delete template',
      message: `Delete template "${template.name}"?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setDeletingId(template.id);
    setError('');
    try {
      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
      if (!token || token === 'undefined') {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${apiUrl}/api/devops/templates/${template.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        setTemplates((previous) => previous.filter((item) => item.id !== template.id));
      } else {
        setError(getString(data.error, 'Failed to delete template'));
      }
    } catch {
      setError('Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  };

  const titleCloud = selectedCloud ? selectedCloud.label : formatCloudLabel(cloudKey || 'other');

  return (
    <>
      <Head>
        <title>{titleCloud} Templates - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Templates</span>
              <h1 className="portal-page__title">{titleCloud} Services</h1>
              <p className="portal-page__subtitle">
                Review the shared templates available under this cloud, whether they were created from admin or DevOps.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/templates" className="btn btn-secondary">
                Back to clouds
              </Link>
              <Link href="/templates/new" className="btn btn-primary">
                New template
              </Link>
            </div>
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
          ) : !selectedCloud ? (
            <div className="portal-surface">
              <div className="portal-empty">
                <p>No templates are available for this cloud.</p>
              </div>
            </div>
          ) : (
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">{selectedCloud.label}</span>
                  <h2 className="portal-surface__title">Services and templates</h2>
                  <p className="portal-surface__subtitle">
                    {selectedCloud.services.length} services · {selectedCloud.templateCount} templates · {formatEnvironmentList(selectedCloud.environments) || 'Shared'}
                  </p>
                </div>
              </div>

              <div className="template-browser-filter template-browser-filter--dense">
                <label className="template-browser-filter__search">
                  <span className="template-browser-filter__label">Search</span>
                  <input
                    className="input template-browser-filter__input"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search service, template, environment, or status"
                  />
                </label>
                <label className="template-browser-filter__field">
                  <span className="template-browser-filter__label">Service</span>
                  <select
                    className="input template-browser-filter__input"
                    value={serviceFilter}
                    onChange={(event) => setServiceFilter(event.target.value)}
                  >
                    <option value="">All services</option>
                    {serviceOptions.map((service) => (
                      <option key={service.key} value={service.key}>
                        {service.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="template-browser-filter__field">
                  <span className="template-browser-filter__label">Environment</span>
                  <select
                    className="input template-browser-filter__input"
                    value={environmentFilter}
                    onChange={(event) => setEnvironmentFilter(event.target.value)}
                  >
                    <option value="">All environments</option>
                    {selectedCloud.environments.map((environment) => (
                      <option key={environment} value={environment}>
                        {environment.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="template-browser-filter__field">
                  <span className="template-browser-filter__label">Status</span>
                  <select
                    className="input template-browser-filter__input"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="">All status</option>
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="template-browser-filter__actions">
                  <span className="portal-pill">{visibleRows.length} visible</span>
                  {(search || serviceFilter || environmentFilter || statusFilter) ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setSearch('');
                        setServiceFilter('');
                        setEnvironmentFilter('');
                        setStatusFilter('');
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="table-scroll">
                <table className="templates-table template-tree-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Template</th>
                      <th>Environment</th>
                      <th>Team scope</th>
                      <th>Project scope</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(({ serviceLabel, template }) => (
                      <tr key={template.id} className="template-tree__row template-tree__row--template">
                        <td>
                          <div className="template-tree__template-name">{serviceLabel}</div>
                          <div className="template-tree__meta">{template.cloud.toUpperCase()}</div>
                        </td>
                        <td>
                          <div className="template-tree__template-name">{template.name}</div>
                          <div className="template-tree__meta">
                            {template.description || 'Reusable request defaults for repeatable work.'}
                          </div>
                        </td>
                        <td><span className="portal-pill">{template.env.toUpperCase()}</span></td>
                        <td>{formatTeamScope(template)}</td>
                        <td>{formatProjectScope(template)}</td>
                        <td><span className="portal-pill">{(template.status || 'draft').replace(/_/g, ' ')}</span></td>
                        <td>
                          <div className="template-tree__actions">
                            <Link href={`/templates/${template.id}`} className="btn btn-secondary btn-sm">
                              View
                            </Link>
                            <Link href={`/templates/${template.id}/edit`} className="btn btn-secondary btn-sm">
                              Edit
                            </Link>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={deletingId === template.id}
                              onClick={() => handleDelete(template)}
                            >
                              {deletingId === template.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="portal-empty">
                            <p>No templates match the current filters.</p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
