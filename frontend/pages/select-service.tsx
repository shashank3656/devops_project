import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { EstimatePanel, SegmentedControl, Stepper, type CostEstimate } from '@infragate/ui';
import { useToast } from '../context/ToastContext';
import CalendarDateInput from '../components/CalendarDateInput';
import { asRecord } from '../lib/payload';
import { clouds, environments } from '../config/clouds';
import { awsServices, awsServiceList, ServiceField } from '../config/awsServices';
import { gcpServices, gcpServiceList } from '../config/gcpServices';

interface TeamOption {
  id: number;
  name: string;
  slug: string;
  default_env?: string;
  default_cloud?: string;
}

interface ProjectServiceOption {
  cloud: string;
  service: string;
}

interface ProjectTeamAccess {
  team_id: number;
  team_name: string;
  team_slug: string;
  environments: string[];
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  description: string;
  environments: string[];
  clouds: string[];
  services: ProjectServiceOption[];
  team_access: ProjectTeamAccess[];
}

interface BundledServiceDraft {
  id: string;
  env: string;
  cloud: string;
  service: string;
  normalizedService: string;
  displayName: string;
  formValues: Record<string, any>;
}

interface BundledServiceSummaryEntry {
  id: string;
  title: string;
  detail: string;
  gitPath: string;
  isCurrentDraft: boolean;
  envLabel: string;
}

const VALID_CLOUDS = ['aws', 'gcp', 'azure'];
const ENV_LABEL_OVERRIDES: Record<string, string> = {
  dev: 'Development',
  development: 'Development',
  qa: 'QA',
  uat: 'UAT',
  stage: 'Staging',
  staging: 'Staging',
  prod: 'Production',
  production: 'Production',
};

function normalizeEnvironmentValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function formatEnvironmentLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  const configured = environments.find((item) => item.value === normalized);
  if (configured) return configured.label;
  if (ENV_LABEL_OVERRIDES[normalized]) return ENV_LABEL_OVERRIDES[normalized];
  return normalized
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizePathPreviewSegment(value: string, fallback: string): string {
  const lower = value.trim().toLowerCase();
  let out = '';
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    const isAlnum = (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
    if (isAlnum) {
      out += lower[i];
    } else if (out.length > 0 && out.charCodeAt(out.length - 1) !== 45) {
      out += '-';
    }
  }
  while (out.startsWith('-')) out = out.slice(1);
  while (out.endsWith('-')) out = out.slice(0, -1);
  return out || fallback;
}

function groupBundledServiceSummaryByEnvironment(entries: BundledServiceSummaryEntry[]) {
  const groups = new Map<string, BundledServiceSummaryEntry[]>();
  for (const entry of entries) {
    const existing = groups.get(entry.envLabel);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(entry.envLabel, [entry]);
    }
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([environment, services]) => ({ environment, services }));
}

function parsePositiveIntParam(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatToggleState(value: unknown): string {
  return value === true ? 'Enabled' : 'Disabled';
}

function formatDefaultValue(value: string | number | boolean | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  return String(value);
}

function shouldRenderFieldDescription(description: string | undefined): boolean {
  if (!description) return false;
  return !description.startsWith('Recommended default:') && !description.startsWith('Default:');
}

function formatServiceFieldSummaryValue(field: ServiceField, value: unknown): string {
  const resolvedValue = value === '' || value === undefined || value === null ? field.defaultValue : value;
  if (resolvedValue === '' || resolvedValue === undefined || resolvedValue === null) {
    return field.required ? 'Not set yet' : '';
  }
  if (field.type === 'boolean') {
    return resolvedValue === true ? 'Enabled' : 'Disabled';
  }
  if (typeof resolvedValue === 'number') {
    return String(resolvedValue);
  }
  return String(resolvedValue);
}

function getResourceNameGuidance(field: ServiceField, value: unknown): { tone: 'ok' | 'warning'; text: string } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();

  const lowercaseKebabPattern = /^[a-z][a-z0-9-]{1,61}$/;
  const bucketPattern = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

  if (field.name === 'bucket_name') {
    if (!bucketPattern.test(trimmed) || trimmed.includes('..') || trimmed.includes('.-') || trimmed.includes('-.')) {
      return {
        tone: 'warning',
        text: 'Bucket names should stay lowercase and use only numbers, letters, dots, and hyphens. Avoid spaces, underscores, and repeated separators.',
      };
    }
    return {
      tone: 'ok',
      text: 'Bucket name format looks valid for a standard GCS bucket request.',
    };
  }

  if (field.name === 'kms_key_name') {
    if (!/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(trimmed)) {
      return {
        tone: 'warning',
        text: 'Use the full CMEK resource path: projects/<project>/locations/<region>/keyRings/<ring>/cryptoKeys/<key>.',
      };
    }
    return {
      tone: 'ok',
      text: 'CMEK key path format looks good.',
    };
  }

  if (['cluster_name', 'instance_name', 'db_instance_name', 'network_name', 'vpc_name', 'node_group_name'].includes(field.name)) {
    if (!lowercaseKebabPattern.test(trimmed)) {
      return {
        tone: 'warning',
        text: 'Use a lowercase kebab-case name so it is easier for infra, audit, and ops teams to work with later.',
      };
    }
    return {
      tone: 'ok',
      text: 'Name format looks clean and operator-friendly.',
    };
  }

  return null;
}

function getSectionExample(service: string, sectionTitle: string): string {
  const examples: Record<string, Record<string, string>> = {
    'cloud-storage': {
      'Bucket basics': 'Example: app-artifacts bucket in asia-east2 with STANDARD storage.',
      'Protection and retention': 'Example: keep soft delete on default, leave versioning off unless recovery is required.',
      Encryption: 'Example: stay on Google-managed encryption unless a team-specific CMEK key is required.',
    },
    gke: {
      'Cluster settings': 'Example: regional cluster on 1.28 for a shared application platform.',
      Placement: 'Example: asia-east2 regional footprint with the default zone spread.',
      'Maintenance and scaling': 'Example: evening maintenance window with autoscaling tuned for optimization.',
      'Node pool': 'Example: e2-standard-4 nodes with balanced disks and autoscaling enabled.',
    },
    'compute-engine': {
      'Core setup': 'Example: one application VM with the standard Ubuntu image.',
      Placement: 'Example: place the VM close to the main app or data dependency.',
      'Sizing and capacity': 'Example: start with e2-medium and a 20 GB disk, then scale if usage grows.',
    },
    'cloud-sql': {
      'Core setup': 'Example: one shared database instance for the service team.',
      'Database settings': 'Example: PostgreSQL with the team-approved engine version and database name.',
      Placement: 'Example: keep the database in the same region as the main workload.',
      'Sizing and capacity': 'Example: start small, then grow tier and disk only when needed.',
    },
    vpc: {
      'Core setup': 'Example: one dedicated network lane for the application boundary.',
      Networking: 'Example: regional routing with manual subnet control for stricter ownership.',
    },
    ec2: {
      'Core setup': 'Example: a single application EC2 instance for a small internal workload.',
      'Sizing and capacity': 'Example: start on t2.micro unless the workload already needs more headroom.',
      'Access and bootstrap': 'Example: only add a key pair when the image bootstrap does not already cover access.',
    },
    eks: {
      'Cluster settings': 'Example: a team-owned EKS cluster pinned to the validated Kubernetes version.',
      'Node pool': 'Example: one main node group with standard instance sizing for app workloads.',
      'Sizing and capacity': 'Example: begin with a narrow autoscaling range and widen it only when traffic proves the need.',
    },
    rds: {
      'Core setup': 'Example: one managed PostgreSQL instance for the application service.',
      'Database settings': 'Example: keep the engine and version aligned with the team platform baseline.',
      'Sizing and capacity': 'Example: start with a small class and 20 GB unless expected usage is already known.',
    },
  };

  return examples[service]?.[sectionTitle] || '';
}

function getReviewImpactNotes(service: string): string[] {
  const notes: Record<string, string[]> = {
    'cloud-storage': [
      'Reviewers usually check naming, data location, retention, and encryption posture first.',
      'CMEK requests often need one extra review because key ownership and access have to line up.',
    ],
    gke: [
      'Reviewers usually check environment fit, Kubernetes version, and autoscaling posture first.',
      'Node size and maintenance window choices often affect both cost and operational approval.',
    ],
    'compute-engine': [
      'Reviewers usually check image baseline, machine size, and placement.',
      'Instance naming and zone choice matter because they shape later operations and ownership.',
    ],
    'cloud-sql': [
      'Reviewers usually check engine version, region alignment, and sizing.',
      'Database requests often get extra attention when the version differs from the platform baseline.',
    ],
    vpc: [
      'Reviewers usually check CIDR ownership, DNS posture, and routing mode.',
      'Network requests often affect other teams, so clear naming and scope help approvals move faster.',
    ],
    ec2: [
      'Reviewers usually check instance purpose, image baseline, and machine size.',
      'Key pair and AMI choices can trigger follow-up questions if they differ from the standard pattern.',
    ],
    eks: [
      'Reviewers usually check Kubernetes version, node group posture, and scaling limits.',
      'Cluster requests often need stronger business context because they create a broader operational surface.',
    ],
    rds: [
      'Reviewers usually check engine choice, version, storage, and class.',
      'Database sizing and engine changes are common approval slow-downs when the impact is not explained clearly.',
    ],
  };

  return notes[service] || ['Reviewers will usually check the core setup, placement, and main configuration choices for this request.'];
}

function normalizeServiceKey(cloud: string, serviceKey: string): string {
  if (cloud !== 'gcp') return serviceKey;

  const normalized = serviceKey.trim().toLowerCase();
  const aliases: Record<string, string> = {
    storage: 'cloud-storage',
    'cloud-storage': 'cloud-storage',
    cloudsql: 'cloud-sql',
    'cloud-sql': 'cloud-sql',
  };

  return aliases[normalized] || normalized;
}

function normalizeServicePathPreviewKey(cloud: string, serviceKey: string): string {
  const normalizedService = normalizeServiceKey(cloud, serviceKey);
  if (cloud === 'gcp') {
    if (normalizedService === 'cloud-storage') return 'storage';
    if (normalizedService === 'cloud-sql') return 'cloudsql';
  }
  return normalizedService;
}

function getServiceDisplayName(cloud: string, serviceKey: string): string {
  if (!cloud || !serviceKey) return serviceKey;
  if (cloud === 'aws') return awsServices[serviceKey]?.displayName || serviceKey;
  if (cloud === 'gcp') return gcpServices[normalizeServiceKey(cloud, serviceKey)]?.displayName || serviceKey;
  return serviceKey;
}

export default function SelectService() {
  const router = useRouter();
  const { toast } = useToast();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [team, setTeam] = useState('');
  const [clientName, setClientName] = useState('');
  const [env, setEnv] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [initialComment, setInitialComment] = useState('');
  const [cloud, setCloud] = useState('');
  const [service, setService] = useState('');
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [bundledServices, setBundledServices] = useState<BundledServiceDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [prUrl, setPrUrl] = useState('');
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [step, setStep] = useState<'configure' | 'review'>('configure');
  const [canCreatePR, setCanCreatePR] = useState<boolean | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const requestType = typeof router.query.type === 'string' ? router.query.type.trim().toLowerCase() : '';
  const isIamFlow = requestType === 'iam';

  // Pre-select cloud, env, service from URL; load template or saved config when present
  useEffect(() => {
    if (!router.isReady) return;
    const qProjectId = router.query.project_id;
    const qCloud = router.query.cloud;
    const qEnv = router.query.env;
    const qService = router.query.service;
    const cloudParam = typeof qCloud === 'string' ? qCloud.toLowerCase() : '';
    const envParam = typeof qEnv === 'string' ? qEnv.trim().toLowerCase() : '';
    const serviceParam = typeof qService === 'string' ? qService.trim() : '';
    if (typeof qProjectId === 'string') {
      const parsed = Number(qProjectId);
      if (!Number.isNaN(parsed) && parsed > 0) setProjectId(parsed);
    }
    if (VALID_CLOUDS.includes(cloudParam)) setCloud((c) => c || cloudParam);
    if (envParam) setEnv((e) => e || envParam);
    if (serviceParam) setService((s) => s || serviceParam);
  }, [router.isReady, router.query.project_id, router.query.cloud, router.query.env, router.query.service]);

  const instanceTypeValue = String(formValues.instance_type || formValues.instance_class || formValues.node_type || '');

  useEffect(() => {
    if (!cloud || !service) {
      setEstimate(null);
      setEstimateLoading(false);
      return;
    }
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ cloud, service, env: env || 'dev' });
    if (projectId) params.set('project_id', String(projectId));
    if (team) params.set('team', team);
    if (instanceTypeValue) params.set('instance_type', instanceTypeValue);
    const controller = new AbortController();
    setEstimateLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`${apiUrl}/api/cost-guardrail?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          setEstimate(typeof data?.estimated_monthly === 'number' ? (data as CostEstimate) : null);
          setEstimateLoading(false);
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return;
          setEstimate(null);
          setEstimateLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl, cloud, service, env, projectId, team, instanceTypeValue]);

  // Fetch template or saved config and prefill form
  useEffect(() => {
    if (!router.isReady) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    const templateId = parsePositiveIntParam(router.query.template_id);
    const savedId = parsePositiveIntParam(router.query.saved_id);
    if (!templateId && !savedId) return;

    const applyConfig = (data: { cloud?: string; env?: string; service?: string; config?: string; projects?: Array<{ id: number }> }) => {
      if (data.cloud && VALID_CLOUDS.includes(data.cloud.toLowerCase())) setCloud(data.cloud.toLowerCase());
      if (data.env) setEnv(data.env.trim().toLowerCase());
      if (data.service) setService(data.service);
      if (projectId === '' && Array.isArray(data.projects) && data.projects.length === 1 && data.projects[0]?.id) {
        setProjectId(data.projects[0].id);
      }
      if (data.config) {
        try {
          const parsed = JSON.parse(data.config) as Record<string, unknown>;
          const parsedProjectID = typeof parsed.project_id === 'number' ? parsed.project_id : Number(parsed.project_id);
          if (!Number.isNaN(parsedProjectID) && parsedProjectID > 0) setProjectId(parsedProjectID);
          if (typeof parsed.team === 'string') setTeam(parsed.team);
          if (typeof parsed.client_name === 'string') setClientName(parsed.client_name);
          if (['low', 'medium', 'high', 'critical'].includes(parsed.priority as string)) setPriority(parsed.priority as 'low' | 'medium' | 'high' | 'critical');
          if (typeof parsed.due_date === 'string') setDueDate(parsed.due_date);
          if (typeof parsed.initial_comment === 'string') setInitialComment(parsed.initial_comment);
          const rest: Record<string, any> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (!['project_id', 'team', 'client_name', 'priority', 'due_date', 'initial_comment', 'comment', 'cloud', 'env', 'service'].includes(k)) {
              rest[k] = v;
            }
          }
          if (Object.keys(rest).length > 0) setFormValues((prev) => ({ ...prev, ...rest }));
        } catch (_) {}
      }
    };

    if (templateId) {
      fetch(`${apiUrl}/api/templates`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((rawData) => {
          const data = asRecord(rawData);
          const templates = Array.isArray(data.templates) ? data.templates : [];
          const matchedTemplate = templates.find((template: { id?: unknown }) => Number(template?.id) === templateId);
          if (matchedTemplate) applyConfig(matchedTemplate);
        })
        .catch(() => {});
    } else if (savedId) {
      fetch(`${apiUrl}/api/me/saved-configs`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((rawData) => {
          const data = asRecord(rawData);
          const savedConfigs = Array.isArray(data.saved_configs) ? data.saved_configs : [];
          const matchedSavedConfig = savedConfigs.find((savedConfig: { id?: unknown }) => Number(savedConfig?.id) === savedId);
          if (matchedSavedConfig) applyConfig(matchedSavedConfig);
        })
        .catch(() => {});
    }
  }, [router.isReady, router.query.template_id, router.query.saved_id, apiUrl]);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    const token = localStorage.getItem('token');
    if (token && token !== 'undefined') {
      Promise.all([
        fetch(`${apiUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.ok ? res.json() : null),
        fetch(`${apiUrl}/api/me/teams`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.ok ? res.json() : null),
        fetch(`${apiUrl}/api/me/projects`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.ok ? res.json() : null),
      ]).then(([rawMeData, rawTeamsData, rawProjectsData]) => {
        const meData = asRecord(rawMeData);
        const teamsData = asRecord(rawTeamsData);
        const projectsData = asRecord(rawProjectsData);
        const u = asRecord(meData.user);
        setCanCreatePR(!!(u?.verified && (u?.role === 'contributor' || u?.role === 'admin')));
        setTeams(Array.isArray(teamsData.teams) ? (teamsData.teams as TeamOption[]) : []);
        setProjects(Array.isArray(projectsData.projects) ? (projectsData.projects as ProjectOption[]) : []);
      }).catch(() => setCanCreatePR(false));
    } else {
      setCanCreatePR(false);
    }
  }, [router, apiUrl]);

  const selectedProject = projects.find((project) => project.id === projectId) || null;

  const availableTeams = selectedProject
    ? teams.filter((option) => selectedProject.team_access.some((access) => access.team_id === option.id))
    : teams;
  const selectedTeamOption =
    availableTeams.find((option) => option.slug === team) ||
    teams.find((option) => option.slug === team) ||
    null;

  const availableEnvironments = (() => {
    if (!selectedProject) return normalizeEnvironmentValues(environments.map((item) => item.value));
    const access = selectedProject.team_access.find((entry) => entry.team_slug === team);
    const sourceValues = access?.environments?.length ? access.environments : selectedProject.environments;
    return normalizeEnvironmentValues(sourceValues);
  })();
  const availableEnvironmentOptions = availableEnvironments.map((value) => ({
    value,
    label: formatEnvironmentLabel(value),
  }));

  const availableCloudOptions = selectedProject
    ? clouds.filter((option) => selectedProject.clouds.includes(option.value))
    : clouds;

  // Get available services based on selected cloud
  const getAvailableServices = () => {
    if (selectedProject) {
      return selectedProject.services.filter((entry) => entry.cloud === cloud).map((entry) => entry.service);
    }
    if (cloud === 'aws') return awsServiceList;
    if (cloud === 'gcp') return gcpServiceList;
    if (cloud === 'azure') return []; // Add Azure services later
    return [];
  };

  // Get service configuration
  const getServiceConfig = () => {
    if (cloud === 'aws' && service) {
      return awsServices[service];
    }
    if (cloud === 'gcp' && service) {
      return gcpServices[normalizeServiceKey(cloud, service)];
    }
    return null;
  };

  // Initialize form values when service changes
  useEffect(() => {
    if (!selectedProject) return;
    const teamAllowed = availableTeams.some((entry) => entry.slug === team);
    if (team && !teamAllowed) {
      setTeam('');
    }
    if (env && !availableEnvironments.includes(env)) {
      setEnv('');
    }
    if (cloud && !selectedProject.clouds.includes(cloud)) {
      setCloud('');
      setService('');
    }
  }, [selectedProject, availableTeams, availableEnvironments, team, env, cloud]);

  useEffect(() => {
    const config = getServiceConfig();
    if (config) {
      setFormValues((prev) => {
        const nextValues: Record<string, any> = {};
        config.fields.forEach((field) => {
          if (prev[field.name] !== undefined) {
            nextValues[field.name] = prev[field.name];
          } else if (field.defaultValue !== undefined) {
            nextValues[field.name] = field.defaultValue;
          } else {
            nextValues[field.name] = '';
          }
        });
        return nextValues;
      });
    } else {
      setFormValues({});
    }
  }, [service, cloud]);

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormValues(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const buildBundledServiceDraft = (
    draftEnv: string,
    draftCloud: string,
    draftService: string,
    values: Record<string, any>,
    draftId?: string,
  ): BundledServiceDraft | null => {
    if (!draftEnv || !draftCloud || !draftService) return null;
    const normalized = normalizeServiceKey(draftCloud, draftService);
    return {
      id: draftId || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      env: draftEnv,
      cloud: draftCloud,
      service: draftService,
      normalizedService: normalized,
      displayName: getServiceDisplayName(draftCloud, draftService),
      formValues: { ...values },
    };
  };

  const getServiceIdentityPreview = (draft: BundledServiceDraft): string => {
    const identityFieldNames = ['bucket_name', 'cluster_name', 'instance_name', 'db_instance_name', 'network_name', 'vpc_name'];
    const identityField = Object.entries(draft.formValues).find(([key, value]) => identityFieldNames.includes(key) && value);
    if (identityField?.[1]) return String(identityField[1]);
    return 'Configuration in progress';
  };

  const removeBundledService = (draftId: string) => {
    setBundledServices((prev) => prev.filter((item) => item.id !== draftId));
  };

  const addCurrentServiceToBundle = () => {
    const nextDraft = buildBundledServiceDraft(env, cloud, service, formValues);
    if (!nextDraft) {
      toast('Choose the environment, cloud, and service before adding another one.', 'error');
      return;
    }

    setBundledServices((prev) => [...prev, nextDraft]);
    setCloud('');
    setService('');
    setFormValues({});
    toast(`${nextDraft.displayName} added to this request bundle.`, 'success');
  };

  const renderField = (field: ServiceField) => {
    const value = formValues[field.name] ?? '';

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            className="input"
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            required={field.required}
          />
        );
      
      case 'number':
        return (
          <input
            type="number"
            className="input"
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.name, Number(e.target.value))}
            required={field.required}
          />
        );
      
      case 'select':
        return (
          <select
            className="select"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            required={field.required}
          >
            <option value="">Select {field.label}</option>
            {field.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      
      case 'boolean':
        return (
          <div className="checkbox-group">
            <input
              type="checkbox"
              className="checkbox"
              checked={value === true}
              onChange={(e) => handleFieldChange(field.name, e.target.checked)}
            />
            <label>{field.label}</label>
          </div>
        );
      
      default:
        return null;
    }
  };

  const renderConfiguredField = (field: ServiceField) => (
    <div key={field.name} className="form-group">
      {field.type !== 'boolean' && (
        <label className="label">
          {field.label} {field.required && <span style={{ color: 'var(--error-color)' }}>*</span>}
        </label>
      )}
      {renderField(field)}
      {(field.defaultValue !== undefined || field.description) && (
        <div className="request-builder__field-meta">
          {field.defaultValue !== undefined && (
            <span className="request-builder__field-default">
              Recommended default: {formatDefaultValue(field.defaultValue)}
            </span>
          )}
          {shouldRenderFieldDescription(field.description) && <p className="request-builder__note">{field.description}</p>}
        </div>
      )}
      {getResourceNameGuidance(field, formValues[field.name]) && (
        <div
          className={`request-builder__validation-hint request-builder__validation-hint--${
            getResourceNameGuidance(field, formValues[field.name])?.tone || 'ok'
          }`}
        >
          {getResourceNameGuidance(field, formValues[field.name])?.text}
        </div>
      )}
    </div>
  );

  const submitRequest = async (asDraft: boolean) => {
    const currentDraft = buildBundledServiceDraft(env, cloud, service, formValues);
    const requestServices = currentDraft ? [...bundledServices, currentDraft] : [...bundledServices];
    const primaryService = requestServices[0];

    if (!projectId || !team || !primaryService) {
      setError('Choose the project, team, and at least one service first.');
      return;
    }
    if (!asDraft && estimate?.allowed === false) {
      setError(estimate.warning || 'This estimate exceeds the project monthly budget.');
      return;
    }

    setLoading(true);
    setError('');
    setPrUrl('');

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

    const token = localStorage.getItem('token');
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;

    try {
      const serviceBundlePayload = requestServices.map((entry) => ({
        env: entry.env,
        cloud: entry.cloud,
        service: entry.normalizedService || entry.service,
        normalized_service: entry.normalizedService,
        display_name: entry.displayName,
        config: entry.formValues,
      }));
      const isBundledRequest = serviceBundlePayload.length > 1;
      const sharedConfig = isBundledRequest
        ? {
            bundle_mode: true,
            service_bundle: serviceBundlePayload,
          }
        : { ...primaryService.formValues };

      const payload = {
        project_id: projectId,
        team,
        env: primaryService.env,
        cloud: primaryService.cloud,
        service: primaryService.normalizedService || primaryService.service,
        client_name: clientName || undefined,
        priority,
        due_date: dueDate || undefined,
        draft: asDraft,
        initial_comment: initialComment.trim() || undefined,
        config: isIamFlow ? { request_type: 'iam', ...sharedConfig } : sharedConfig
      };

      const response = await fetch(`${apiUrl}/api/request`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const text = await response.text();
        let errMsg = text || `Server returned ${response.status}`;
        try {
          const d = JSON.parse(text);
          if (d?.error) errMsg = d.error;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      setPrUrl(data.pr_url || '');
      toast(data.message || (asDraft ? 'Draft saved.' : isIamFlow ? 'Access request sent successfully.' : 'Request sent successfully.'), 'success');
      if (asDraft) {
        router.push('/history');
      } else {
        const params = new URLSearchParams({ id: String(data.id || ''), team: team || '' });
        if (isIamFlow) params.set('type', 'iam');
        router.push(`/request-success?${params.toString()}`);
      }
    } catch (err: any) {
      console.error('Error creating PR:', err);
      const errorMessage = err.message || 'Something went wrong while sending the request.';
      if (err.message === 'Failed to fetch' || err.name === 'TypeError' || err.message.includes('NetworkError')) {
        setError(`Cannot connect to backend at ${apiUrl}. Make sure the backend is running.`);
        toast('Cannot connect to backend', 'error');
      } else {
        setError(errorMessage);
        toast(errorMessage, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const serviceConfig = getServiceConfig();
  const availableServices = getAvailableServices();
  const currentServiceDraft = buildBundledServiceDraft(env, cloud, service, formValues, 'current-draft');
  const requestServices = currentServiceDraft ? [...bundledServices, currentServiceDraft] : bundledServices;
  const primaryBundledService = requestServices[0] || null;
  const selectedServiceLabel = currentServiceDraft
    ? currentServiceDraft.displayName
    : primaryBundledService
      ? `${requestServices.length} service${requestServices.length === 1 ? '' : 's'} selected`
      : 'Not chosen yet';
  const requestReady = !!(projectId && team && requestServices.length > 0);
  const canSubmitRequest = loading || !projectId || !team || requestServices.length === 0 || canCreatePR !== true;
  const multiServiceMode = requestServices.length > 1;

  const goToStep = (next: 'configure' | 'review') => {
    setStep(next);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'configure') {
      if (!env && bundledServices.length === 0) {
        setError('Choose an environment to continue.');
        return;
      }
      if (requestServices.length === 0) {
        setError('Choose a cloud and service to continue.');
        return;
      }
      setError('');
      goToStep('review');
      return;
    }
    submitRequest(false);
  };

  const wizardSteps = [
    { id: 'choose', label: 'Choose' },
    { id: 'configure', label: 'Configure' },
    { id: 'review', label: 'Review' },
  ];
  const handleStepSelect = (id: string) => {
    if (id === 'choose') router.push('/create-infrastructure');
    else if (id === 'configure') goToStep('configure');
  };

  const normalizedService = service ? normalizeServiceKey(cloud, service) : '';
  const isGcpStorageBucket = cloud === 'gcp' && normalizedService === 'cloud-storage';
  const pageTitle = isIamFlow ? 'Create an access request' : 'Create a request';
  const pageSubtitle = isIamFlow
    ? 'Start with the basics first. Then choose the cloud area related to the access change. The form only asks for the extra details reviewers need.'
    : 'Start with the basics first. Once the project, team, environment, cloud, and service are selected, the page only asks for the extra details that matter.';
  const basicsHelpText = isIamFlow
    ? 'These choices decide what access request you can make and who should review it.'
    : 'These selections decide what you are allowed to request and who can review it.';
  const platformStepTitle = isIamFlow ? 'Step 2: Choose the access target' : 'Step 2: Choose the platform options';
  const platformStepText = isIamFlow
    ? 'Pick the cloud and the service area related to the access change. The form will adapt if more details are needed.'
    : 'Pick the cloud and service. The form will adapt based on what you choose.';
  const detailsStepTitle = isIamFlow ? 'Step 3: Fill in request details' : 'Step 3: Fill in service details';
  const detailsStepText = isIamFlow
    ? 'Only the details needed for this access request are shown here.'
    : 'Only the fields needed for this service are shown here.';
  const detailsCardTitle = isIamFlow ? 'Extra details for this request' : 'Extra details for this service';
  const submitStepText = isIamFlow
    ? 'Add a note so reviewers understand who needs access and why, then save a draft or send the request.'
    : 'Add a note if reviewers need business context, then save a draft or send the request.';
  const requestSummaryTitle = isIamFlow ? 'Access request summary' : 'Request summary';
  const requestSummaryText = isIamFlow
    ? 'These choices are currently shaping this access request.'
    : 'These are the choices currently driving this request.';
  const targetSummaryLabel = isIamFlow ? 'Cloud and request target' : 'Cloud and service';
  const bucketPolicySummary = isGcpStorageBucket
    ? [
        { label: 'Storage bucket name', value: String(formValues.bucket_name || 'Not set yet') },
        { label: 'Region', value: String(formValues.region || 'asia-east2') },
        { label: 'Storage class', value: String(formValues.storage_class || 'STANDARD') },
        { label: 'Soft delete policy', value: String(formValues.soft_delete_policy || 'Default') },
        { label: 'Object versioning', value: formatToggleState(formValues.versioning_enabled) },
        { label: 'Bucket retention policy', value: formatToggleState(formValues.bucket_retention_policy_enabled) },
        { label: 'Object retention', value: formatToggleState(formValues.object_retention_enabled) },
        { label: 'Encryption type', value: String(formValues.encryption_type || 'Google-managed') },
        ...(formValues.encryption_type === 'Customer-managed (CMEK)' && formValues.kms_key_name
          ? [{ label: 'CMEK key resource', value: String(formValues.kms_key_name) }]
          : []),
      ]
    : [];
  const visibleServiceFields = serviceConfig
    ? serviceConfig.fields.filter((field) => {
        if (!field.showWhen) return true;
        return formValues[field.showWhen.field] === field.showWhen.equals;
      })
    : [];
  const requiredServiceFieldCount = visibleServiceFields.filter((field) => field.required).length;
  const sectionDescriptions: Record<string, string> = {
    'Core setup': 'Start with the resource identity and the minimum information needed to create it.',
    'Placement': 'Choose where the resource should live.',
    'Sizing and capacity': 'Set capacity, compute size, or storage allocation.',
    'Access and bootstrap': 'Capture bootstrap or access-related details only when they are needed.',
    'Networking': 'Define DNS, subnetwork, or routing behavior.',
    'Cluster settings': 'Choose the main cluster posture and defaults.',
    'Node pool': 'Configure worker shape, disk posture, and node scaling.',
    'Maintenance and scaling': 'Control upgrades, autoscaling, and maintenance windows.',
    'Database settings': 'Choose the database engine and runtime settings.',
    'Bucket basics': 'Start with the bucket identity, region, and storage class.',
    'Protection and retention': 'Decide how deletion, recovery, and retention should behave for this resource.',
    'Encryption': 'Choose how data should be encrypted at rest.',
  };
  const serviceFieldSections = Array.from(
    visibleServiceFields.reduce((groups, field) => {
      const sectionName = field.section || 'Configuration';
      const existing = groups.get(sectionName);
      if (existing) {
        existing.push(field);
      } else {
        groups.set(sectionName, [field]);
      }
      return groups;
    }, new Map<string, ServiceField[]>()),
  ).map(([title, fields]) => ({
    title,
    description: sectionDescriptions[title] || 'Review and complete the fields in this section.',
    fields,
  }));
  const serviceSummarySections = serviceFieldSections
    .map((section) => ({
      title: section.title,
      description: section.description,
      items: section.fields
        .map((field) => ({
          label: field.label,
          value: formatServiceFieldSummaryValue(field, formValues[field.name]),
        }))
        .filter((item) => item.value),
    }))
    .filter((section) => section.items.length > 0);
  const primaryIdentityField =
    visibleServiceFields.find((field) => ['bucket_name', 'cluster_name', 'instance_name', 'db_instance_name', 'network_name', 'vpc_name'].includes(field.name)) ||
    visibleServiceFields.find((field) => field.required) ||
    null;
  const placementField =
    visibleServiceFields.find((field) => ['region', 'zone', 'location'].includes(field.name)) || null;
  const postureFields = visibleServiceFields.filter((field) =>
    ['storage_class', 'encryption_type', 'instance_type', 'machine_type', 'tier', 'routing_mode', 'kubernetes_version', 'database_version'].includes(field.name),
  );
  const serviceBlueprintCards = service
    ? [
        {
          icon: 'Build',
          label: 'Resource',
          value: primaryIdentityField
            ? `${selectedServiceLabel} · ${formatServiceFieldSummaryValue(primaryIdentityField, formValues[primaryIdentityField.name])}`
            : selectedServiceLabel,
          detail: 'Primary resource identity',
        },
        {
          icon: 'Pin',
          label: 'Placement',
          value: placementField
            ? `${String(formValues[placementField.name] || placementField.defaultValue || 'Pending selection')} · ${env || 'environment pending'}`
            : `${cloud ? cloud.toUpperCase() : 'Cloud pending'} · ${env || 'environment pending'}`,
          detail: 'Where this resource will live',
        },
        {
          icon: 'Shield',
          label: 'Posture',
          value:
            postureFields.length > 0
              ? postureFields
                  .slice(0, 2)
                  .map((field) => formatServiceFieldSummaryValue(field, formValues[field.name]))
                  .filter(Boolean)
                  .join(' · ') || 'Defaults in progress'
              : serviceSummarySections[0]?.items.slice(0, 2).map((item) => item.value).join(' · ') || 'Defaults in progress',
          detail: 'Key settings before review',
        },
      ]
    : [];
  const reviewImpactNotes = normalizedService ? getReviewImpactNotes(normalizedService) : [];
  const bundledServiceSummary: BundledServiceSummaryEntry[] = requestServices.map((entry, index) => ({
    id: entry.id,
    title: `${index + 1}. ${entry.displayName}`,
    detail: `${formatEnvironmentLabel(entry.env)} · ${entry.cloud.toUpperCase()} · ${getServiceIdentityPreview(entry)}`,
    envLabel: formatEnvironmentLabel(entry.env),
    gitPath: `project/${
      normalizePathPreviewSegment(selectedProject?.code || selectedProject?.name || '', 'project')
    }/${
      normalizePathPreviewSegment(selectedTeamOption?.slug || team || '', 'team')
    }/${
      normalizePathPreviewSegment(entry.cloud, 'cloud')
    }/envs/${
      normalizePathPreviewSegment(entry.env, 'env')
    }/${
      normalizePathPreviewSegment(normalizeServicePathPreviewKey(entry.cloud, entry.normalizedService || entry.service), 'service')
    }/<application-id>/request.json`,
    isCurrentDraft: currentServiceDraft?.id === entry.id,
  }));
  const bundledServiceSummaryGroups = groupBundledServiceSummaryByEnvironment(bundledServiceSummary);
  const bundledServiceCardGroups = Array.from(
    requestServices.reduce((groups, entry, index) => {
      const environment = formatEnvironmentLabel(entry.env);
      const existing = groups.get(environment);
      const card = {
        entry,
        index,
        gitPath: bundledServiceSummary[index]?.gitPath || '',
      };
      if (existing) {
        existing.push(card);
      } else {
        groups.set(environment, [card]);
      }
      return groups;
    }, new Map<string, Array<{ entry: BundledServiceDraft; index: number; gitPath: string }>>()),
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([environment, services]) => ({ environment, services }));

  return (
    <>
      <Head>
        <title>{isIamFlow ? 'Access Request - SetuOps' : 'New Request - SetuOps'}</title>
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          <div className="request-builder">
            <div className="request-builder__header">
              <Stepper steps={wizardSteps} current={step} onSelect={handleStepSelect} />
              <h1 className="request-builder__title">{step === 'review' ? 'Review and send' : pageTitle}</h1>
              <p className="request-builder__subtitle">
                {step === 'review'
                  ? 'Check the details below. Reviewers see exactly this, plus any notes you add.'
                  : pageSubtitle}
              </p>
            </div>

            {canCreatePR === false && (
              <div className="error">
                Your account cannot send requests yet. Verify your email and check your role in <Link href="/profile" style={{ color: 'inherit', textDecoration: 'underline' }}>Profile</Link>.
              </div>
            )}

            {error && (
              <div className="error">
                {error}
              </div>
            )}

            {prUrl && (
              <div className="success" style={{ marginBottom: 0, flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                <strong>{isIamFlow ? 'Access request sent successfully' : 'Request sent successfully'}</strong>
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                  style={{ fontWeight: '600', fontSize: '15px' }}
                >
                  Open Pull Request →
                </a>
              </div>
            )}

            <div className="request-builder__layout">
              <form onSubmit={handleSubmit} className="request-builder__main">
                {step === 'configure' && (
                <>
                <section className="request-builder__section">
                  <div className="request-builder__section-header">
                    <h2>Step 1: Choose the basics</h2>
                    <p>{basicsHelpText}</p>
                  </div>
                  <div className="request-builder__grid">
                <div className="form-group">
                  <label className="label">Project *</label>
                  <select
                    className="select"
                    value={projectId}
                    onChange={(e) => {
                      const nextProjectId = Number(e.target.value);
                      setProjectId(Number.isNaN(nextProjectId) ? '' : nextProjectId);
                      setTeam('');
                      setEnv('');
                      setCloud('');
                      setService('');
                      setFormValues({});
                      setBundledServices([]);
                    }}
                    required
                  >
                    <option value="">{projects.length === 0 ? 'No projects assigned' : 'Select project'}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                    ))}
                  </select>
                  {selectedProject && (
                    <p className="request-builder__note">
                      {selectedProject.description || `${selectedProject.environments.join(', ')} environments available`}
                    </p>
                  )}
                </div>

                <div className="form-group">
                  <label className="label">Team *</label>
                  <select
                    className="select"
                    value={team}
                    onChange={(e) => {
                      const slug = e.target.value;
                      setTeam(slug);
                      const selected = availableTeams.find((t) => t.slug === slug);
                      if (selected) {
                        const defaultEnv = selected.default_env?.trim().toLowerCase();
                        if (defaultEnv && availableEnvironments.includes(defaultEnv)) setEnv(defaultEnv);
                        const defaultCloud = selected.default_cloud?.trim().toLowerCase();
                        if (defaultCloud && (!selectedProject || selectedProject.clouds.includes(defaultCloud))) setCloud(defaultCloud);
                      }
                    }}
                    required
                  >
                    <option value="">{availableTeams.length === 0 ? 'No team access for this project' : 'Select team'}</option>
                    {availableTeams.map((t) => (
                      <option key={t.id} value={t.slug}>{t.name}</option>
                    ))}
                  </select>
                  {selectedProject && availableTeams.length === 0 && (
                    <p className="request-builder__note">None of your teams can request against this project yet.</p>
                  )}
                  {!selectedProject && teams.length === 0 && (
                    <p className="request-builder__note">Ask your admin to add you to a team first.</p>
                  )}
                </div>

                <div className="form-group">
                  <label className="label">Business name or client</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Optional business, client, or internal project name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <span className="label">Environment *</span>
                  {availableEnvironmentOptions.length > 0 ? (
                    <SegmentedControl
                      label="Environment"
                      name="env"
                      options={availableEnvironmentOptions}
                      value={env}
                      onChange={(value) => setEnv(value.trim().toLowerCase())}
                    />
                  ) : (
                    <p className="request-builder__note">Choose a project to see its environments.</p>
                  )}
                </div>

                <div className="form-group">
                  <label className="label">Urgency</label>
                  <select
                    className="select"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high' | 'critical')}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="label">Due date</label>
                  <CalendarDateInput value={dueDate} onChange={setDueDate} />
                </div>
                  </div>
                </section>

                <section className="request-builder__section">
                  <div className="request-builder__section-header">
                    <h2>{platformStepTitle}</h2>
                    <p>{platformStepText}</p>
                  </div>
                  <div className="request-builder__grid">
                <div className="form-group">
                  <label className="label">Cloud provider *</label>
                  <select
                    className="select"
                    value={cloud}
                    onChange={(e) => {
                      setCloud(e.target.value);
                      setService(''); // Reset service when cloud changes
                    }}
                    required={bundledServices.length === 0}
                  >
                    <option value="">Choose cloud</option>
                    {availableCloudOptions.map(cloudOption => (
                      <option key={cloudOption.value} value={cloudOption.value}>
                        {cloudOption.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="label">{isIamFlow ? 'Service or access area *' : 'Service *'}</label>
                  <select
                    className="select"
                    value={service}
                    onChange={(e) => setService(e.target.value)}
                    required={bundledServices.length === 0}
                    disabled={!projectId || !cloud || availableServices.length === 0}
                  >
                    <option value="">{!projectId ? 'Choose project first' : !cloud ? 'Choose cloud first' : 'Choose service'}</option>
                    {availableServices.map(svc => {
                      const config =
                        cloud === 'aws'
                          ? awsServices[svc]
                          : gcpServices[normalizeServiceKey(cloud, svc)];
                      return (
                        <option key={svc} value={svc}>
                          {config?.displayName || svc}
                        </option>
                      );
                    })}
                  </select>
                  {projectId && cloud && availableServices.length === 0 && (
                    <p className="request-builder__note">
                      {isIamFlow
                        ? 'No request targets are set up for this cloud in the selected project yet. Ask the platform team to add one first.'
                        : 'No services are set up for this cloud in the selected project yet.'}
                    </p>
                  )}
                </div>
                  </div>
                </section>

                {serviceConfig && (
                  <section className="request-builder__section">
                    <div className="request-builder__section-header">
                      <h2>{detailsStepTitle}</h2>
                      <p>{detailsStepText}</p>
                    </div>
                    <div className="form-section" style={{ marginTop: 0, background: 'transparent', border: 0, padding: 0 }}>
                  <h3 className="form-section-title">
                    {detailsCardTitle}
                    {cloud && (
                      <span className={`cloud-badge ${cloud}`} style={{ marginLeft: '12px', fontSize: '11px' }}>
                        {cloud.toUpperCase()}
                      </span>
                    )}
                  </h3>
                  {isGcpStorageBucket && (
                    <div className="request-builder__service-spotlight">
                      <strong>Bucket defaults</strong>
                      <p>
                        Start with the standard bucket posture, then turn on only the protections you need. Soft delete stays on the default
                        policy, versioning and retention stay disabled unless you enable them, and encryption uses Google-managed keys by default.
                      </p>
                    </div>
                  )}
                  {serviceFieldSections.length > 0 ? (
                    <div className="request-builder__service-groups">
                      {serviceFieldSections.map((section) => (
                        <section key={section.title} className="request-builder__service-group">
                          <div className="request-builder__service-group-header">
                            <strong>{section.title}</strong>
                            <p>{section.description}</p>
                            {normalizedService && getSectionExample(normalizedService, section.title) && (
                              <div className="request-builder__service-example">
                                {getSectionExample(normalizedService, section.title)}
                              </div>
                            )}
                          </div>
                          <div
                            className={`request-builder__grid${
                              section.fields.length === 1 ? ' request-builder__grid--single' : ''
                            }`}
                          >
                            {section.fields.map((field) => renderConfiguredField(field))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    visibleServiceFields.map((field) => renderConfiguredField(field))
                  )}
                    </div>
                  </section>
                )}

                {(requestServices.length > 0 || serviceConfig) && (
                  <section className="request-builder__section">
                    <div className="request-builder__section-header">
                      <h2>Step 3.5: Build the service bundle</h2>
                      <p>
                        Keep the project and team shared once. Each service card captures the environment selected when you add it.
                      </p>
                    </div>
                    <div className="request-builder__bundle-actions">
                      {currentServiceDraft ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={addCurrentServiceToBundle}
                          >
                            + Add another service
                          </button>
                          <span className="request-builder__bundle-hint">
                            Add this service card, then you can change environment, cloud, or service before adding the next one.
                          </span>
                        </>
                      ) : (
                        <span className="request-builder__bundle-hint">
                          Start by choosing a cloud and service, then add it to the request bundle.
                        </span>
                      )}
                    </div>
                    {multiServiceMode && (
                      <div className="request-builder__service-spotlight">
                        <strong>Bundle request mode</strong>
                        <p>
                          This request now carries multiple services. We will keep the first service as the primary request key for the
                          current backend flow and attach the full service bundle in the request config for review.
                        </p>
                      </div>
                    )}
                    {requestServices.length > 0 && (
                      <div className="request-builder__bundle-card-groups">
                        {bundledServiceCardGroups.map((group) => (
                          <div key={group.environment} className="request-builder__bundle-card-group">
                            <div className="request-builder__bundle-card-group-head">
                              <strong>{group.environment}</strong>
                              <span className="request-builder__bundle-card-group-count">
                                {group.services.length} service{group.services.length === 1 ? '' : 's'}
                              </span>
                            </div>
                            <div className="request-builder__bundle-list">
                              {group.services.map(({ entry, index, gitPath }) => (
                                <article
                                  key={entry.id}
                                  className={`request-builder__bundle-card${
                                    currentServiceDraft?.id === entry.id ? ' request-builder__bundle-card--draft' : ''
                                  }`}
                                >
                                  <div className="request-builder__bundle-card-header">
                                    <div>
                                      <span className="request-builder__summary-label">Service {index + 1}</span>
                                      <h3>{entry.displayName}</h3>
                                    </div>
                                    <div className="request-builder__bundle-meta">
                                      <span className="request-builder__bundle-pill">{formatEnvironmentLabel(entry.env)}</span>
                                      <span className="request-builder__bundle-pill">{entry.cloud.toUpperCase()}</span>
                                      {currentServiceDraft?.id === entry.id ? (
                                        <span className="request-builder__bundle-pill request-builder__bundle-pill--draft">Current draft</span>
                                      ) : (
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => removeBundledService(entry.id)}
                                        >
                                          Remove
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <p className="request-builder__bundle-detail">{getServiceIdentityPreview(entry)}</p>
                                  <code className="request-builder__bundle-path">{gitPath}</code>
                                </article>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {!serviceConfig && cloud && service && (
                  <div className="success request-builder__status">
                    {isIamFlow
                      ? 'This request does not need any extra fields. Continue to review when ready.'
                      : 'This service does not need any extra fields. Continue to review when ready.'}
                  </div>
                )}

                <div className="request-builder__actions ig-wizard-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => router.push('/create-infrastructure')}>
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => submitRequest(true)}
                    className="btn btn-secondary"
                    disabled={canSubmitRequest}
                  >
                    {loading ? <span className="loading"></span> : 'Save draft'}
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={loading || canCreatePR !== true}>
                    Continue to review
                  </button>
                </div>
                </>
                )}

                {step === 'review' && (
                <section className="request-builder__section">
                  <div className="request-builder__section-header">
                    <h2>Summary</h2>
                    <p>{submitStepText}</p>
                  </div>
                  <dl className="ig-review-list">
                    <div>
                      <dt>Project</dt>
                      <dd>{selectedProject ? `${selectedProject.name} (${selectedProject.code})` : 'Not chosen'}</dd>
                    </div>
                    <div>
                      <dt>Team</dt>
                      <dd>{availableTeams.find((t) => t.slug === team)?.name || team || 'Not chosen'}</dd>
                    </div>
                    <div>
                      <dt>Environment</dt>
                      <dd>{env ? formatEnvironmentLabel(env) : 'Per service'}</dd>
                    </div>
                    <div>
                      <dt>Urgency</dt>
                      <dd style={{ textTransform: 'capitalize' }}>{priority}</dd>
                    </div>
                    {dueDate ? (
                      <div>
                        <dt>Due date</dt>
                        <dd>{dueDate}</dd>
                      </div>
                    ) : null}
                    {clientName ? (
                      <div>
                        <dt>Client</dt>
                        <dd>{clientName}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>{requestServices.length === 1 ? 'Service' : 'Services'}</dt>
                      <dd>
                        <ul className="ig-review-services">
                          {requestServices.map((entry) => (
                            <li key={entry.id}>
                              <strong>{entry.displayName}</strong>
                              <span>
                                {entry.cloud.toUpperCase()} · {formatEnvironmentLabel(entry.env)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  </dl>
                  <div className="form-group" style={{ marginTop: 20 }}>
                    <label className="label">Comment / notes (optional)</label>
                    <textarea
                      className="textarea"
                      placeholder="Add any useful background for reviewers"
                      value={initialComment}
                      onChange={(e) => setInitialComment(e.target.value)}
                      rows={3}
                      style={{ resize: 'vertical' }}
                    />
                  </div>

                  <div className="request-builder__actions ig-wizard-actions">
                <button type="button" className="btn btn-ghost" onClick={() => goToStep('configure')} disabled={loading}>
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => submitRequest(true)}
                  className="btn btn-secondary"
                  disabled={canSubmitRequest}
                >
                  {loading ? <span className="loading"></span> : 'Save draft'}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={canSubmitRequest}
                >
                  {loading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <span className="loading"></span>
                      Sending...
                    </span>
                  ) : (
                    'Send for review'
                  )}
                </button>
                  </div>
                </section>
                )}
              </form>

              <aside className="request-builder__side">
                <EstimatePanel estimate={estimate} loading={estimateLoading} ready={!!(cloud && service)} />
                <div className="request-builder__summary">
                  <h3>{requestSummaryTitle}</h3>
                  <p>{requestSummaryText}</p>
                  <div className="request-builder__summary-list">
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-label">Project</span>
                      <span className="request-builder__summary-value">{selectedProject ? `${selectedProject.name} (${selectedProject.code})` : 'Not chosen yet'}</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-label">Team</span>
                      <span className="request-builder__summary-value">{team || 'Not chosen yet'}</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-label">Environment</span>
                      <span className="request-builder__summary-value">
                        {requestServices.length > 0
                          ? Array.from(new Set(requestServices.map((entry) => formatEnvironmentLabel(entry.env)))).join(' · ')
                          : env || 'Not chosen yet'}
                      </span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-label">{targetSummaryLabel}</span>
                      <span className="request-builder__summary-value">
                        {primaryBundledService
                          ? `${formatEnvironmentLabel(primaryBundledService.env)} · ${primaryBundledService.cloud.toUpperCase()} · ${primaryBundledService.displayName}`
                          : 'Not chosen yet'}
                      </span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-label">Services in this request</span>
                      <span className="request-builder__summary-value">
                        {requestServices.length > 0
                          ? `${requestServices.length} service${requestServices.length === 1 ? '' : 's'} selected`
                          : 'Choose a service to see'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="request-builder__summary">
                  <h3>Before you send</h3>
                  <div className="request-builder__summary-list request-builder__summary-list--plain">
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">
                        {isIamFlow
                          ? 'Choose the project and team that should own the access change.'
                          : 'Choose a project and team that match the work.'}
                      </span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">
                        {isIamFlow
                          ? 'Use the note field to explain who needs access, what they need, and why it is needed.'
                          : 'Pick the environment and service carefully, because they shape the approval path.'}
                      </span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">{requestReady ? 'The request is ready to save or send.' : 'Finish the required selections to enable save and send.'}</span>
                    </div>
                  </div>
                </div>

                {serviceBlueprintCards.length > 0 && (
                  <div className="request-builder__summary">
                    <h3>What this request creates</h3>
                    <p>A quick operator view of the resource, where it lands, and the main settings going into review.</p>
                    <div className="request-builder__blueprint-grid">
                      {serviceBlueprintCards.map((card) => (
                        <div key={card.label} className="request-builder__blueprint-card">
                          <span className="request-builder__blueprint-icon">{card.icon}</span>
                          <span className="request-builder__summary-label">{card.label}</span>
                          <strong className="request-builder__blueprint-value">{card.value}</strong>
                          <span className="request-builder__blueprint-detail">{card.detail}</span>
                        </div>
                      ))}
                    </div>
                    {reviewImpactNotes.length > 0 && (
                      <div className="request-builder__impact-list">
                        {reviewImpactNotes.map((note) => (
                          <div key={note} className="request-builder__impact-item">
                            {note}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {bundledServiceSummary.length > 0 && (
                  <div className="request-builder__summary">
                    <h3>Services in this request</h3>
                    <p>Review the service bundle before you save or send it.</p>
                    <div className="request-builder__bundle-summary-groups">
                      {bundledServiceSummaryGroups.map((group) => (
                        <div key={group.environment} className="request-builder__bundle-summary-group">
                          <div className="request-builder__bundle-summary-head">
                            <strong>{group.environment}</strong>
                            <span className="request-builder__bundle-summary-count">
                              {group.services.length} service{group.services.length === 1 ? '' : 's'}
                            </span>
                          </div>
                          <div className="request-builder__service-summary-groups">
                            {group.services.map((entry) => (
                              <div key={entry.id} className="request-builder__service-summary-group">
                                <div className="request-builder__service-summary-header">
                                  <strong>{entry.title}</strong>
                                  <p>{entry.isCurrentDraft ? 'Current service draft' : 'Added to the shared request bundle'}</p>
                                </div>
                                <div className="request-builder__summary-list">
                                  <div className="request-builder__summary-item">
                                    <span className="request-builder__summary-label">Target</span>
                                    <span className="request-builder__summary-value">{entry.detail}</span>
                                  </div>
                                  <div className="request-builder__summary-item">
                                    <span className="request-builder__summary-label">Git path</span>
                                    <code className="request-builder__bundle-path request-builder__bundle-path--summary">{entry.gitPath}</code>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {bucketPolicySummary.length > 0 && (
                  <div className="request-builder__summary">
                    <h3>Bucket configuration</h3>
                    <p>These are the current storage bucket settings that will be sent for review.</p>
                    <div className="request-builder__summary-list">
                      {bucketPolicySummary.map((item) => (
                        <div key={item.label} className="request-builder__summary-item">
                          <span className="request-builder__summary-label">{item.label}</span>
                          <span className="request-builder__summary-value">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!isGcpStorageBucket && serviceSummarySections.length > 0 && (
                  <div className="request-builder__summary">
                    <h3>{selectedServiceLabel} configuration</h3>
                    <p>These are the service-specific values that will be sent for review.</p>
                    <div className="request-builder__service-summary-groups">
                      {serviceSummarySections.map((section) => (
                        <div key={section.title} className="request-builder__service-summary-group">
                          <div className="request-builder__service-summary-header">
                            <strong>{section.title}</strong>
                            <p>{section.description}</p>
                          </div>
                          <div className="request-builder__summary-list">
                            {section.items.map((item) => (
                              <div key={`${section.title}-${item.label}`} className="request-builder__summary-item">
                                <span className="request-builder__summary-label">{item.label}</span>
                                <span className="request-builder__summary-value">{item.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
