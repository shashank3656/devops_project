export interface ArchitectureComponent {
  kind: string;
  name: string;
  label: string;
  properties?: Record<string, string>;
}

export interface ArchitectureDiagramJob {
  id: number;
  project_name: string;
  environment: string;
  cloud: string;
  region: string;
  due_date?: string | null;
  notes: string;
  image_filename: string;
  image_mime: string;
  image_size: number;
  image_bucket?: string;
  image_object_key?: string;
  image_url?: string;
  detected_components: ArchitectureComponent[];
  detection_source: string;
  terraform_code: string;
  status: string;
  created_by?: number | null;
  created_by_username?: string;
  created_at: string;
  updated_at: string;
}

export const ARCHITECTURE_CLOUDS = [
  { value: 'aws', label: 'AWS' },
  { value: 'azure', label: 'Azure' },
  { value: 'gcp', label: 'GCP' },
];

export const ARCHITECTURE_ENVS = [
  { value: 'dev', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'qa', label: 'QA' },
  { value: 'prod', label: 'Production' },
];

export const ARCHITECTURE_COMPONENT_KINDS: { kind: string; label: string }[] = [
  { kind: 'vpc', label: 'VPC / Network' },
  { kind: 'load_balancer', label: 'Load Balancer' },
  { kind: 'database', label: 'Database' },
  { kind: 'compute', label: 'Compute' },
  { kind: 'cache', label: 'Cache' },
  { kind: 'queue', label: 'Queue' },
  { kind: 'storage', label: 'Object Storage' },
  { kind: 'cdn', label: 'CDN' },
  { kind: 'dns', label: 'DNS' },
];

export function componentKindLabel(kind: string): string {
  const match = ARCHITECTURE_COMPONENT_KINDS.find((c) => c.kind === kind);
  if (match) return match.label;
  return kind
    .split('_')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function normalizeJob(raw: unknown): ArchitectureDiagramJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const components = Array.isArray(r.detected_components)
    ? (r.detected_components as unknown[])
        .map((c) => {
          if (!c || typeof c !== 'object') return null;
          const cr = c as Record<string, unknown>;
          return {
            kind: String(cr.kind ?? ''),
            name: String(cr.name ?? ''),
            label: String(cr.label ?? ''),
            properties: cr.properties && typeof cr.properties === 'object'
              ? (cr.properties as Record<string, string>)
              : undefined,
          } as ArchitectureComponent;
        })
        .filter((c): c is ArchitectureComponent => Boolean(c && c.kind))
    : [];
  return {
    id,
    project_name: String(r.project_name ?? ''),
    environment: String(r.environment ?? ''),
    cloud: String(r.cloud ?? ''),
    region: String(r.region ?? ''),
    due_date: typeof r.due_date === 'string' ? r.due_date : null,
    notes: String(r.notes ?? ''),
    image_filename: String(r.image_filename ?? ''),
    image_mime: String(r.image_mime ?? ''),
    image_size: Number(r.image_size ?? 0) || 0,
    image_bucket: typeof r.image_bucket === 'string' ? r.image_bucket : '',
    image_object_key: typeof r.image_object_key === 'string' ? r.image_object_key : '',
    image_url: typeof r.image_url === 'string' ? r.image_url : '',
    detected_components: components,
    detection_source: String(r.detection_source ?? ''),
    terraform_code: String(r.terraform_code ?? ''),
    status: String(r.status ?? ''),
    created_by: typeof r.created_by === 'number' ? r.created_by : null,
    created_by_username: typeof r.created_by_username === 'string' ? r.created_by_username : '',
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}
