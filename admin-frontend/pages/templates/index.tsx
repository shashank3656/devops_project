import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';
import { asRecord, getString } from '../../lib/payload';

interface RequestTemplate {
  id: number;
  name: string;
  description: string;
  cloud: string;
  env: string;
  service: string;
  config: string;
  status?: string;
  created_at: string;
  created_by: number | null;
  teams?: TeamSummary[];
  projects?: ProjectSummary[];
  visible_to_all?: boolean;
}

interface TeamSummary {
  id: number;
  name: string;
}

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface ServiceGroup {
  key: string;
  label: string;
  templates: RequestTemplate[];
  environments: string[];
}

interface CloudGroup {
  key: string;
  label: string;
  services: ServiceGroup[];
}

function getNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeTeamSummary(value: unknown): TeamSummary | null {
  const record = asRecord(value);
  const id = getNumber(record.id, 0);
  if (id <= 0) return null;
  return {
    id,
    name: getString(record.name, `Team ${id}`),
  };
}

function normalizeProjectSummary(value: unknown): ProjectSummary | null {
  const record = asRecord(value);
  const id = getNumber(record.id, 0);
  if (id <= 0) return null;
  return {
    id,
    name: getString(record.name, `Project ${id}`),
    code: getString(record.code, ''),
  };
}

function normalizeTemplate(value: unknown): RequestTemplate | null {
  const record = asRecord(value);
  const id = getNumber(record.id, 0);
  if (id <= 0) return null;
  return {
    id,
    name: getString(record.name, `Template ${id}`),
    description: getString(record.description, ''),
    cloud: getString(record.cloud, 'other'),
    env: getString(record.env, 'shared'),
    service: getString(record.service, 'service'),
    config: getString(record.config, '{}'),
    status: getString(record.status, 'draft'),
    created_at: getString(record.created_at, ''),
    created_by: typeof record.created_by === 'number' ? record.created_by : null,
    teams: Array.isArray(record.teams)
      ? record.teams.map(normalizeTeamSummary).filter((item): item is TeamSummary => Boolean(item))
      : [],
    projects: Array.isArray(record.projects)
      ? record.projects.map(normalizeProjectSummary).filter((item): item is ProjectSummary => Boolean(item))
      : [],
    visible_to_all: Boolean(record.visible_to_all),
  };
}

function formatCloudLabel(cloud: string): string {
  const normalized = cloud.trim().toLowerCase();
  switch (normalized) {
    case 'aws':
      return 'AWS';
    case 'gcp':
      return 'GCP';
    case 'azure':
      return 'Azure';
    default:
      return normalized ? normalized.toUpperCase() : 'Other';
  }
}

function formatServiceLabel(service: string): string {
  const normalized = service.trim();
  if (!normalized) return 'Service';
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatEnvironmentList(environments: string[]): string {
  return environments
    .map((environment) => environment.trim())
    .filter(Boolean)
    .map((environment) => environment.toUpperCase())
    .join(', ');
}

function formatTeamScope(template: RequestTemplate): string {
  if (template.visible_to_all || template.teams?.length === 0) return 'All portal teams';
  return template.teams.length === 1 ? template.teams[0].name : `${template.teams.length} teams`;
}

function formatProjectScope(template: RequestTemplate): string {
  if (!template.projects?.length) return 'All projects';
  if (template.projects.length === 1) {
    const project = template.projects[0];
    return project.code ? `${project.name} (${project.code})` : project.name;
  }
  return `${template.projects.length} projects`;
}

function getServiceRowKey(cloudKey: string, serviceKey: string): string {
  return `${cloudKey}::${serviceKey}`;
}

export default function TemplatesList() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expandedClouds, setExpandedClouds] = useState<string[]>([]);
  const [expandedServices, setExpandedServices] = useState<string[]>([]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchTemplates();
  }, [router]);

  const fetchTemplates = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/templates`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
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
    } catch (_) {
      setTemplates([]);
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (template: RequestTemplate) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    setDeletingId(template.id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/templates/${template.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        setTemplates((prev) => prev.filter((x) => x.id !== template.id));
      } else {
        setError(getString(data.error, 'Failed to delete'));
      }
    } catch (_) {
      setError('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const cloudGroups = useMemo<CloudGroup[]>(() => {
    const cloudMap = new Map<string, Map<string, RequestTemplate[]>>();

    for (const template of templates) {
      const cloudKey = (template.cloud || 'other').trim().toLowerCase();
      const serviceKey = (template.service || 'service').trim().toLowerCase();
      if (!cloudMap.has(cloudKey)) {
        cloudMap.set(cloudKey, new Map<string, RequestTemplate[]>());
      }
      const serviceMap = cloudMap.get(cloudKey)!;
      if (!serviceMap.has(serviceKey)) {
        serviceMap.set(serviceKey, []);
      }
      serviceMap.get(serviceKey)!.push(template);
    }

    const preferredCloudOrder = ['aws', 'gcp', 'azure'];
    const cloudKeys = Array.from(cloudMap.keys()).sort((left, right) => {
      const leftIndex = preferredCloudOrder.indexOf(left);
      const rightIndex = preferredCloudOrder.indexOf(right);
      if (leftIndex !== -1 || rightIndex !== -1) {
        if (leftIndex === -1) return 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
      }
      return left.localeCompare(right);
    });

    return cloudKeys.map((cloudKey) => {
      const serviceMap = cloudMap.get(cloudKey)!;
      const services = Array.from(serviceMap.entries())
        .map(([serviceKey, items]) => ({
          key: serviceKey,
          label: formatServiceLabel(serviceKey),
          templates: items.slice().sort((left, right) => {
            if (left.env !== right.env) return left.env.localeCompare(right.env);
            return left.name.localeCompare(right.name);
          }),
          environments: Array.from(new Set(items.map((template) => template.env.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
        }))
        .sort((left, right) => left.label.localeCompare(right.label));

      return {
        key: cloudKey,
        label: formatCloudLabel(cloudKey),
        services,
      };
    });
  }, [templates]);

  useEffect(() => {
    const availableCloudKeys = cloudGroups.map((group) => group.key);
    const availableServiceKeys = cloudGroups.flatMap((group) =>
      group.services.map((service) => getServiceRowKey(group.key, service.key)),
    );

    setExpandedClouds((current) => {
      const filtered = current.filter((key) => availableCloudKeys.includes(key));
      return filtered.length > 0 || availableCloudKeys.length === 0 ? filtered : availableCloudKeys;
    });

    setExpandedServices((current) => {
      const filtered = current.filter((key) => availableServiceKeys.includes(key));
      return filtered.length > 0 || availableServiceKeys.length === 0 ? filtered : availableServiceKeys;
    });
  }, [cloudGroups]);

  const toggleCloud = (cloudKey: string) => {
    setExpandedClouds((current) =>
      current.includes(cloudKey) ? current.filter((key) => key !== cloudKey) : current.concat(cloudKey),
    );
  };

  const toggleService = (rowKey: string) => {
    setExpandedServices((current) =>
      current.includes(rowKey) ? current.filter((key) => key !== rowKey) : current.concat(rowKey),
    );
  };

  return (
    <>
      <Head>
        <title>Templates - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Templates</span>
              <h1 className="portal-page__title">Template Management</h1>
              <p className="portal-page__subtitle">
                Shape reusable request patterns by cloud, update weak templates, and retire the ones that should not be reused.
              </p>
            </div>
            <Link href="/templates/new" className="btn btn-primary">
              New template
            </Link>
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
                No templates exist yet.
              </div>
            </div>
          ) : (
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Template library</span>
                  <h2 className="portal-surface__title">Cloud and service list</h2>
                  <p className="portal-surface__subtitle">
                    Open a cloud, then a service, then manage the templates inside it.
                  </p>
                </div>
              </div>

              <div className="table-scroll">
                <table className="templates-table template-tree-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Environment</th>
                      <th>Team scope</th>
                      <th>Project scope</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cloudGroups.map((cloud) => {
                      const cloudTemplateCount = cloud.services.reduce((count, service) => count + service.templates.length, 0);
                      const cloudExpanded = expandedClouds.includes(cloud.key);
                      return (
                        <Fragment key={cloud.key}>
                          <tr className="template-tree__row template-tree__row--cloud">
                            <td>
                              <button type="button" className="template-tree__toggle" onClick={() => toggleCloud(cloud.key)}>
                                <span className="template-tree__chevron">{cloudExpanded ? '▾' : '▸'}</span>
                                <span className="template-tree__label">{cloud.label}</span>
                              </button>
                              <div className="template-tree__meta">
                                {cloud.services.length} services · {cloudTemplateCount} templates
                              </div>
                            </td>
                            <td>Cloud</td>
                            <td>—</td>
                            <td>—</td>
                            <td>—</td>
                            <td>—</td>
                            <td></td>
                          </tr>

                          {cloudExpanded
                            ? cloud.services.map((service) => {
                                const serviceRowKey = getServiceRowKey(cloud.key, service.key);
                                const serviceExpanded = expandedServices.includes(serviceRowKey);
                                return (
                                  <Fragment key={serviceRowKey}>
                                    <tr className="template-tree__row template-tree__row--service">
                                      <td>
                                        <button
                                          type="button"
                                          className="template-tree__toggle template-tree__toggle--nested"
                                          onClick={() => toggleService(serviceRowKey)}
                                        >
                                          <span className="template-tree__chevron">{serviceExpanded ? '▾' : '▸'}</span>
                                          <span className="template-tree__label">{service.label}</span>
                                        </button>
                                        <div className="template-tree__meta">
                                          {service.templates.length} templates · {formatEnvironmentList(service.environments)}
                                        </div>
                                      </td>
                                      <td>Service</td>
                                      <td>{formatEnvironmentList(service.environments) || '—'}</td>
                                      <td>—</td>
                                      <td>—</td>
                                      <td>—</td>
                                      <td></td>
                                    </tr>

                                    {serviceExpanded
                                      ? service.templates.map((template) => (
                                          <tr key={template.id} className="template-tree__row template-tree__row--template">
                                            <td>
                                              <div className="template-tree__template-name">{template.name}</div>
                                              <div className="template-tree__meta">
                                                {template.description || 'Reusable request defaults for repeatable work.'}
                                              </div>
                                            </td>
                                            <td>Template</td>
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
                                        ))
                                      : null}
                                  </Fragment>
                                );
                              })
                            : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </AdminLayout>
    </>
  );
}
