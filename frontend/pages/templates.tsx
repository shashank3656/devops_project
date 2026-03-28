import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const teams = Array.isArray(record.teams)
    ? record.teams.map(normalizeTeamSummary).filter((item): item is TeamSummary => Boolean(item))
    : [];
  const projects = Array.isArray(record.projects)
    ? record.projects.map(normalizeProjectSummary).filter((item): item is ProjectSummary => Boolean(item))
    : [];
  return {
    id,
    name: getString(record.name, `Template ${id}`),
    description: getString(record.description, ''),
    cloud: getString(record.cloud, 'other'),
    env: getString(record.env, 'shared'),
    service: getString(record.service, 'service'),
    teams,
    projects,
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
  if (template.visible_to_all || template.teams.length === 0) return 'All teams';
  return template.teams.length === 1 ? template.teams[0].name : `${template.teams.length} teams`;
}

function formatProjectScope(template: RequestTemplate): string {
  if (template.projects.length === 0) return 'All visible projects';
  if (template.projects.length === 1) {
    const project = template.projects[0];
    return project.code ? `${project.name} (${project.code})` : project.name;
  }
  return `${template.projects.length} projects`;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCloud, setSelectedCloud] = useState('');
  const [selectedService, setSelectedService] = useState('');

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
              if (left.service !== right.service) return left.service.localeCompare(right.service);
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
    if (cloudGroups.length === 0) {
      setSelectedCloud('');
      return;
    }
    if (!selectedCloud || !cloudGroups.some((group) => group.key === selectedCloud)) {
      setSelectedCloud(cloudGroups[0].key);
    }
  }, [cloudGroups, selectedCloud]);

  const activeCloudGroup = useMemo(
    () => cloudGroups.find((group) => group.key === selectedCloud) ?? cloudGroups[0] ?? null,
    [cloudGroups, selectedCloud],
  );

  useEffect(() => {
    if (!activeCloudGroup || activeCloudGroup.services.length === 0) {
      setSelectedService('');
      return;
    }
    if (!selectedService || !activeCloudGroup.services.some((service) => service.key === selectedService)) {
      setSelectedService(activeCloudGroup.services[0].key);
    }
  }, [activeCloudGroup, selectedService]);

  const activeServiceGroup = useMemo(
    () => activeCloudGroup?.services.find((service) => service.key === selectedService) ?? activeCloudGroup?.services[0] ?? null,
    [activeCloudGroup, selectedService],
  );

  const serviceCount = useMemo(
    () => cloudGroups.reduce((count, group) => count + group.services.length, 0),
    [cloudGroups],
  );

  return (
    <>
      <Head>
        <title>Templates - SetuOps User</title>
        <meta name="description" content="Browse request templates by cloud and service" />
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Templates</span>
            <h1 className="portal-page__title">Request Templates</h1>
            <p className="portal-page__subtitle">
              Start from a cloud, narrow to a service, then open the exact template you want to use.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/create-infrastructure/new" className="btn btn-primary">
              Open create infrastructure
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
              No published templates are currently visible to your teams and projects.
            </div>
          </div>
        ) : (
          <>
            <section className="portal-surface template-browser-summary">
              <div className="template-browser-summary__item">
                <span className="template-browser-summary__label">Clouds</span>
                <strong className="template-browser-summary__value">{cloudGroups.length}</strong>
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
                  <span className="portal-surface__eyebrow">Step 1</span>
                  <h2 className="portal-surface__title">Choose a cloud</h2>
                  <p className="portal-surface__subtitle">
                    Pick the platform first. We will list the services that already have reusable request templates.
                  </p>
                </div>
              </div>

              <div className="template-browser-clouds">
                {cloudGroups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    className={`template-browser-cloud ${group.key === activeCloudGroup?.key ? 'template-browser-cloud--active' : ''}`}
                    onClick={() => setSelectedCloud(group.key)}
                  >
                    <span className="template-browser-cloud__name">{group.label}</span>
                    <span className="template-browser-cloud__meta">{group.services.length} services</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Step 2</span>
                  <h2 className="portal-surface__title">
                    {activeCloudGroup ? `${activeCloudGroup.label} services` : 'Services'}
                  </h2>
                  <p className="portal-surface__subtitle">
                    Choose the service you want to work with. The table below opens the matching templates.
                  </p>
                </div>
              </div>

              {activeCloudGroup && activeCloudGroup.services.length > 0 ? (
                <div className="table-scroll">
                  <table className="templates-table template-browser-table">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Environments</th>
                        <th>Templates</th>
                        <th>Scope</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeCloudGroup.services.map((service) => (
                        <tr
                          key={service.key}
                          className={service.key === activeServiceGroup?.key ? 'template-browser-table__row--active' : ''}
                        >
                          <td>
                            <div className="template-browser-table__primary">{service.label}</div>
                          </td>
                          <td>
                            <span className="template-browser-table__meta">
                              {formatEnvironmentList(service.environments)}
                            </span>
                          </td>
                          <td>{service.templates.length}</td>
                          <td>
                            <span className="template-browser-table__meta">
                              {service.teamScopedCount > 0 || service.projectScopedCount > 0
                                ? `${service.teamScopedCount > 0 ? 'Team scoped' : 'All teams'}${service.projectScopedCount > 0 ? ' · Project scoped' : ''}`
                                : 'Open to your visible teams and projects'}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setSelectedService(service.key)}
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">No services are available for this cloud yet.</div>
              )}
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Step 3</span>
                  <h2 className="portal-surface__title">
                    {activeServiceGroup ? `${activeServiceGroup.label} templates` : 'Templates'}
                  </h2>
                  <p className="portal-surface__subtitle">
                    Open a template to review the defaults, or use it directly to start a request.
                  </p>
                </div>
              </div>

              {activeServiceGroup && activeServiceGroup.templates.length > 0 ? (
                <div className="table-scroll">
                  <table className="templates-table template-browser-table">
                    <thead>
                      <tr>
                        <th>Template</th>
                        <th>Environment</th>
                        <th>Team scope</th>
                        <th>Project scope</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeServiceGroup.templates.map((template) => (
                        <tr key={template.id}>
                          <td>
                            <div className="template-browser-table__primary">{template.name}</div>
                            <div className="template-browser-table__meta">
                              {template.description || 'Reusable request defaults for repeatable work.'}
                            </div>
                          </td>
                          <td>
                            <span className="portal-pill">{template.env.toUpperCase()}</span>
                          </td>
                          <td>
                            <span className="template-browser-table__meta">{formatTeamScope(template)}</span>
                          </td>
                          <td>
                            <span className="template-browser-table__meta">{formatProjectScope(template)}</span>
                          </td>
                          <td>
                            <div className="template-browser-table__actions">
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
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">Choose a service to view its templates.</div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
