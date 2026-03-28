import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { asRecord, getString } from '../lib/payload';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface TeamSummary {
  id: number;
  name: string;
}

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface RequestTemplate {
  id: number;
  name: string;
  description: string;
  cloud: string;
  env: string;
  service: string;
  teams: TeamSummary[];
  projects: ProjectSummary[];
  visible_to_all: boolean;
}

interface ServiceGroup {
  key: string;
  label: string;
  templates: RequestTemplate[];
  environments: string[];
  teamScopedCount: number;
  projectScopedCount: number;
}

interface CloudGroup {
  key: string;
  label: string;
  services: ServiceGroup[];
}

interface TemplateDiagnostics {
  reason: string;
  published_count: number;
  visible_to_all_count: number;
  matching_team_count: number;
  user_portal_team_count: number;
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
    teams: Array.isArray(record.teams)
      ? record.teams.map(normalizeTeamSummary).filter((item): item is TeamSummary => Boolean(item))
      : [],
    projects: Array.isArray(record.projects)
      ? record.projects.map(normalizeProjectSummary).filter((item): item is ProjectSummary => Boolean(item))
      : [],
    visible_to_all: Boolean(record.visible_to_all),
  };
}

function normalizeDiagnostics(value: unknown): TemplateDiagnostics | null {
  const record = asRecord(value);
  const reason = getString(record.reason, '');
  if (!reason) return null;
  return {
    reason,
    published_count: getNumber(record.published_count, 0),
    visible_to_all_count: getNumber(record.visible_to_all_count, 0),
    matching_team_count: getNumber(record.matching_team_count, 0),
    user_portal_team_count: getNumber(record.user_portal_team_count, 0),
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
  if (template.visible_to_all || template.teams.length === 0) return 'All teams';
  return template.teams.length === 1 ? template.teams[0].name : `${template.teams.length} teams`;
}

function formatProjectScope(template: RequestTemplate): string {
  if (template.projects.length === 0) return 'All assigned projects';
  if (template.projects.length === 1) {
    const project = template.projects[0];
    return project.code ? `${project.name} (${project.code})` : project.name;
  }
  return `${template.projects.length} projects`;
}

function getDiagnosticsMessage(diagnostics: TemplateDiagnostics | null): { title: string; detail: string } {
  switch (diagnostics?.reason) {
    case 'no_published_templates':
      return {
        title: 'No published templates yet',
        detail: 'Templates exist only as draft or pending approval. Ask the platform team to publish one for the user portal.',
      };
    case 'no_portal_team_membership':
      return {
        title: 'No portal team is linked to your account',
        detail: 'Published templates can only be shown after your user is added to a portal team.',
      };
    case 'no_team_assigned_templates':
      return {
        title: 'Published templates exist, but none are assigned to your team',
        detail: `There are ${diagnostics.published_count} published templates, but none are mapped to your current portal teams.`,
      };
    case 'visible_templates_available':
      return {
        title: 'Published templates should be available',
        detail: 'At least one published template is marked for broad visibility. If the table is still empty after rebuild, the frontend build is likely stale.',
      };
    default:
      return {
        title: 'No templates are visible right now',
        detail: 'Published templates may still need the right team assignment or a refreshed frontend build.',
      };
  }
}

function getServiceRowKey(cloudKey: string, serviceKey: string): string {
  return `${cloudKey}::${serviceKey}`;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [diagnostics, setDiagnostics] = useState<TemplateDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedClouds, setExpandedClouds] = useState<string[]>([]);
  const [expandedServices, setExpandedServices] = useState<string[]>([]);

  const fetchTemplates = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      setTemplates([]);
      setLoading(false);
      router.replace('/login');
      return;
    }

    setLoading(true);
    setError('');

    fetch(`${apiUrl}/api/templates`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return null;
        }

        const data = asRecord(await res.json().catch(() => ({})));
        setDiagnostics(normalizeDiagnostics(data.diagnostics));
        if (res.ok && Array.isArray(data.templates)) {
          setTemplates(
            data.templates
              .map(normalizeTemplate)
              .filter((item): item is RequestTemplate => Boolean(item)),
          );
          setError('');
        } else {
          setTemplates([]);
          setError(getString(data.error, 'Failed to load templates'));
        }
        return null;
      })
      .catch(() => {
        setTemplates([]);
        setDiagnostics(null);
        setError('Failed to load templates');
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchTemplates();
  }, [router, fetchTemplates]);

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
        .map(([serviceKey, items]) => {
          const environments = Array.from(
            new Set(items.map((template) => template.env.trim()).filter(Boolean)),
          ).sort((left, right) => left.localeCompare(right));

          return {
            key: serviceKey,
            label: formatServiceLabel(serviceKey),
            templates: items.slice().sort((left, right) => {
              if (left.env !== right.env) return left.env.localeCompare(right.env);
              return left.name.localeCompare(right.name);
            }),
            environments,
            teamScopedCount: items.filter((template) => !template.visible_to_all && template.teams.length > 0).length,
            projectScopedCount: items.filter((template) => template.projects.length > 0).length,
          };
        })
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

  const diagnosticsMessage = getDiagnosticsMessage(diagnostics);
  const cloudCount = cloudGroups.length;
  const serviceCount = cloudGroups.reduce((count, group) => count + group.services.length, 0);

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
        <title>Templates - SetuOps User</title>
        <meta name="description" content="Browse request templates in a simple cloud and service list" />
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Templates</span>
            <h1 className="portal-page__title">Request Templates</h1>
            <p className="portal-page__subtitle">
              Browse published templates in one simple list. Open a cloud, then a service, then the exact template you want.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/create-infrastructure/new" className="btn btn-primary">
              Open create infrastructure
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
            <div className="empty-state">Loading templates...</div>
          </div>
        ) : templates.length === 0 ? (
          <div className="portal-surface">
            <div className="empty-state template-browser-empty">
              <strong className="template-browser-empty__title">{diagnosticsMessage.title}</strong>
              <p className="template-browser-empty__detail">{diagnosticsMessage.detail}</p>
              {diagnostics ? (
                <div className="template-browser-empty__facts">
                  <span className="portal-pill">Published: {diagnostics.published_count}</span>
                  <span className="portal-pill">Your portal teams: {diagnostics.user_portal_team_count}</span>
                  <span className="portal-pill">Visible to all: {diagnostics.visible_to_all_count}</span>
                  <span className="portal-pill">Assigned to your teams: {diagnostics.matching_team_count}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <section className="portal-surface template-browser-summary">
              <div className="template-browser-summary__item">
                <span className="template-browser-summary__label">Clouds</span>
                <strong className="template-browser-summary__value">{cloudCount}</strong>
              </div>
              <div className="template-browser-summary__item">
                <span className="template-browser-summary__label">Services</span>
                <strong className="template-browser-summary__value">{serviceCount}</strong>
              </div>
              <div className="template-browser-summary__item">
                <span className="template-browser-summary__label">Templates</span>
                <strong className="template-browser-summary__value">{templates.length}</strong>
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Template library</span>
                  <h2 className="portal-surface__title">Cloud and service list</h2>
                  <p className="portal-surface__subtitle">
                    Click a cloud to open its services. Click a service to see the templates inside it.
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
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cloudGroups.map((cloud) => {
                      const cloudTemplateCount = cloud.services.reduce((count, service) => count + service.templates.length, 0);
                      const cloudExpanded = expandedClouds.includes(cloud.key);
                      return (
                        <Fragment key={cloud.key}>
                          <tr key={cloud.key} className="template-tree__row template-tree__row--cloud">
                            <td>
                              <button
                                type="button"
                                className="template-tree__toggle"
                                onClick={() => toggleCloud(cloud.key)}
                              >
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
                                      <td>{service.teamScopedCount > 0 ? 'Team scoped' : 'All teams'}</td>
                                      <td>{service.projectScopedCount > 0 ? 'Project scoped' : 'All projects'}</td>
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
                                            <td>
                                              <span className="portal-pill">{template.env.toUpperCase()}</span>
                                            </td>
                                            <td>{formatTeamScope(template)}</td>
                                            <td>{formatProjectScope(template)}</td>
                                            <td>
                                              <div className="template-tree__actions">
                                                <Link href={`/templates/${template.id}`} className="btn btn-secondary btn-sm">
                                                  View
                                                </Link>
                                                <Link
                                                  href={`/select-service?cloud=${encodeURIComponent(template.cloud)}&env=${encodeURIComponent(template.env)}&service=${encodeURIComponent(template.service)}&template_id=${template.id}${template.projects.length === 1 ? `&project_id=${template.projects[0].id}` : ''}`}
                                                  className="btn btn-primary btn-sm"
                                                >
                                                  Use
                                                </Link>
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
          </>
        )}
      </div>
    </>
  );
}
