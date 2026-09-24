import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { DataTable, EmptyState, type DataTableColumn } from '@infragate/ui';
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
  status: string;
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

type TemplateTreeRow =
  | { kind: 'cloud'; rowKey: string; cloud: CloudGroup }
  | { kind: 'service'; rowKey: string; cloud: CloudGroup; service: ServiceGroup; serviceRowKey: string }
  | { kind: 'template'; rowKey: string; template: RequestTemplate };

function cloudTemplateCount(cloud: CloudGroup) {
  return cloud.services.reduce((count, service) => count + service.templates.length, 0);
}

interface TemplateDiagnostics {
  reason: string;
  template_count: number;
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
    status: getString(record.status, 'draft'),
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
    template_count: getNumber(record.template_count, 0),
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
    case 'no_templates':
      return {
        title: 'No templates exist yet',
        detail: 'Once admin or DevOps creates templates, they will appear here for your team.',
      };
    case 'no_portal_team_membership':
      return {
        title: 'No portal team is linked to your account',
        detail: 'Templates can be shown after your user is added to a portal team.',
      };
    case 'no_team_assigned_templates':
      return {
        title: 'Templates exist, but none are assigned to your team',
        detail: `There are ${diagnostics.template_count} templates in the shared library, but none are mapped to your current portal teams.`,
      };
    case 'visible_templates_available':
      return {
        title: 'Templates should be available',
        detail: 'At least one template is marked for broad visibility. If the list is still empty after rebuild, the frontend build is likely stale.',
      };
    default:
      return {
        title: 'No templates are visible right now',
        detail: 'Templates may still need the right team assignment or a refreshed frontend build.',
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

  const flatTreeRows = useMemo(() => {
    const rows: TemplateTreeRow[] = [];
    for (const cloud of cloudGroups) {
      rows.push({ kind: 'cloud', rowKey: `cloud:${cloud.key}`, cloud });
      if (!expandedClouds.includes(cloud.key)) continue;
      for (const service of cloud.services) {
        const serviceRowKey = getServiceRowKey(cloud.key, service.key);
        rows.push({ kind: 'service', rowKey: `service:${serviceRowKey}`, cloud, service, serviceRowKey });
        if (!expandedServices.includes(serviceRowKey)) continue;
        for (const template of service.templates) {
          rows.push({ kind: 'template', rowKey: `template:${template.id}`, template });
        }
      }
    }
    return rows;
  }, [cloudGroups, expandedClouds, expandedServices]);

  const treeColumns = useMemo((): DataTableColumn<TemplateTreeRow>[] => {
    return [
      {
        id: 'name',
        header: 'Name',
        cell: (row) => {
          if (row.kind === 'cloud') {
            const expanded = expandedClouds.includes(row.cloud.key);
            return (
              <div className="ig-tree-cell">
                <button type="button" className="ig-tree-toggle" onClick={() => toggleCloud(row.cloud.key)}>
                  <span className="ig-tree-toggle__chevron">{expanded ? '▾' : '▸'}</span>
                  {row.cloud.label}
                </button>
                <span className="ig-cell-meta">
                  {row.cloud.services.length} services · {cloudTemplateCount(row.cloud)} templates
                </span>
              </div>
            );
          }
          if (row.kind === 'service') {
            const expanded = expandedServices.includes(row.serviceRowKey);
            return (
              <div className="ig-tree-cell ig-tree-cell--service">
                <button type="button" className="ig-tree-toggle" onClick={() => toggleService(row.serviceRowKey)}>
                  <span className="ig-tree-toggle__chevron">{expanded ? '▾' : '▸'}</span>
                  {row.service.label}
                </button>
                <span className="ig-cell-meta">
                  {row.service.templates.length} templates · {formatEnvironmentList(row.service.environments)}
                </span>
              </div>
            );
          }
          return (
            <div className="ig-tree-cell ig-tree-cell--template">
              <span className="ig-cell-title">{row.template.name}</span>
              <span className="ig-cell-meta">{row.template.description || 'Reusable request defaults for repeatable work.'}</span>
            </div>
          );
        },
      },
      {
        id: 'type',
        header: 'Type',
        cell: (row) => (row.kind === 'cloud' ? 'Cloud' : row.kind === 'service' ? 'Service' : 'Template'),
      },
      {
        id: 'environment',
        header: 'Environment',
        cell: (row) =>
          row.kind === 'template' ? (
            <span className="ig-chip ig-chip--info">{row.template.env.toUpperCase()}</span>
          ) : row.kind === 'service' ? (
            formatEnvironmentList(row.service.environments) || '—'
          ) : (
            '—'
          ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row) =>
          row.kind === 'template' ? (
            <span className="ig-chip ig-chip--neutral">{row.template.status.replace(/_/g, ' ')}</span>
          ) : (
            '—'
          ),
      },
      {
        id: 'team',
        header: 'Team scope',
        cell: (row) =>
          row.kind === 'template'
            ? formatTeamScope(row.template)
            : row.kind === 'service'
              ? row.service.teamScopedCount > 0
                ? 'Team scoped'
                : 'All teams'
              : '—',
      },
      {
        id: 'project',
        header: 'Project scope',
        cell: (row) =>
          row.kind === 'template'
            ? formatProjectScope(row.template)
            : row.kind === 'service'
              ? row.service.projectScopedCount > 0
                ? 'Project scoped'
                : 'All projects'
              : '—',
      },
      {
        id: 'actions',
        header: '',
        className: 'ig-cell-actions',
        cell: (row) =>
          row.kind === 'template' ? (
            <div className="template-tree__actions">
              <Link href={`/templates/${row.template.id}`} className="btn btn-secondary btn-sm">
                View
              </Link>
              {row.template.status === 'published' ? (
                <Link
                  href={`/select-service?cloud=${encodeURIComponent(row.template.cloud)}&env=${encodeURIComponent(row.template.env)}&service=${encodeURIComponent(row.template.service)}&template_id=${row.template.id}${row.template.projects.length === 1 ? `&project_id=${row.template.projects[0].id}` : ''}`}
                  className="btn btn-primary btn-sm"
                >
                  Use
                </Link>
              ) : (
                <span className="ig-cell-meta">View only until published</span>
              )}
            </div>
          ) : null,
      },
    ];
  }, [expandedClouds, expandedServices]);

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
              Browse the shared template library from admin and DevOps in one simple list. Open a cloud, then a service, then the exact template you want.
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
                  <span className="portal-pill">Templates: {diagnostics.template_count}</span>
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

              <div className="ig-legacy-table">
                <DataTable<TemplateTreeRow>
                  label="Template library tree"
                  columns={treeColumns}
                  rows={flatTreeRows}
                  rowKey={(row) => row.rowKey}
                  rowClassName={(row) =>
                    row.kind === 'cloud' ? 'ig-tree-row--cloud' : row.kind === 'service' ? 'ig-tree-row--service' : 'ig-tree-row--template'
                  }
                  onRowOpen={(row) => {
                    if (row.kind === 'cloud') toggleCloud(row.cloud.key);
                    else if (row.kind === 'service') toggleService(row.serviceRowKey);
                    else void router.push(`/templates/${row.template.id}`);
                  }}
                  empty={<EmptyState title="No templates in tree" body="Expand a cloud and service to browse templates." />}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
