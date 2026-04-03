import { asRecord, getString } from './payload';

export interface TeamSummary {
  id: number;
  name: string;
}

export interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

export interface RequestTemplate {
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
  teams: TeamSummary[];
  projects: ProjectSummary[];
  visible_to_all: boolean;
}

export interface ServiceGroup {
  key: string;
  label: string;
  templates: RequestTemplate[];
  environments: string[];
}

export interface CloudGroup {
  key: string;
  label: string;
  services: ServiceGroup[];
  templateCount: number;
  environments: string[];
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

export function normalizeTemplate(value: unknown): RequestTemplate | null {
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

export function formatCloudLabel(cloud: string): string {
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

export function formatServiceLabel(service: string): string {
  const normalized = service.trim();
  if (!normalized) return 'Service';
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatEnvironmentList(environments: string[]): string {
  return environments
    .map((environment) => environment.trim())
    .filter(Boolean)
    .map((environment) => environment.toUpperCase())
    .join(', ');
}

export function formatTeamScope(template: RequestTemplate): string {
  if (template.visible_to_all || template.teams.length === 0) return 'All portal teams';
  return template.teams.length === 1 ? template.teams[0].name : `${template.teams.length} teams`;
}

export function formatProjectScope(template: RequestTemplate): string {
  if (template.projects.length === 0) return 'All projects';
  if (template.projects.length === 1) {
    const project = template.projects[0];
    return project.code ? `${project.name} (${project.code})` : project.name;
  }
  return `${template.projects.length} projects`;
}

export function buildCloudGroups(templates: RequestTemplate[]): CloudGroup[] {
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
      templateCount: services.reduce((count, service) => count + service.templates.length, 0),
      environments: Array.from(new Set(services.flatMap((service) => service.environments))).sort((left, right) => left.localeCompare(right)),
    };
  });
}
