import { normalizeCloudProvider, type CloudProviderId } from './cloudProviders';

export type K8sAuthModeId =
  | 'eks_iam'
  | 'aks_workload_identity'
  | 'gke_workload_identity'
  | 'secret_ref'
  | 'kubeconfig'
  | 'service_account'
  | 'token'
  | 'oidc'
  | 'in_cluster';

export type K8sTrustFields = {
  role_arn: string;
  external_id: string;
  tenant_id: string;
  subscription_id: string;
  resource_group: string;
  service_account_email: string;
  project_id: string;
  region: string;
};

export function emptyK8sTrustFields(): K8sTrustFields {
  return {
    role_arn: '',
    external_id: '',
    tenant_id: '',
    subscription_id: '',
    resource_group: '',
    service_account_email: '',
    project_id: '',
    region: '',
  };
}

const AUTH_LABELS: Record<string, string> = {
  eks_iam: 'EKS IAM role (recommended)',
  aks_workload_identity: 'AKS workload identity (recommended)',
  gke_workload_identity: 'GKE workload identity (recommended)',
  secret_ref: 'Server secret reference (recommended for tokens)',
  kubeconfig: 'Kubeconfig (encrypted at rest)',
  service_account: 'Service account token (encrypted at rest)',
  token: 'Bearer token (encrypted at rest)',
  oidc: 'OIDC token (encrypted at rest)',
  in_cluster: 'In-cluster (API runs inside cluster)',
};

export function k8sAuthModeLabel(mode: string): string {
  return AUTH_LABELS[mode] || mode.replace(/_/g, ' ');
}

export function k8sAuthModesForCloud(cloud: string, byCloud?: Record<string, string[]>): string[] {
  const id = normalizeCloudProvider(cloud);
  const fromApi = byCloud?.[id];
  if (fromApi?.length) return fromApi;
  switch (id) {
    case 'aws':
      return ['eks_iam', 'secret_ref', 'kubeconfig', 'service_account', 'token', 'in_cluster'];
    case 'azure':
      return ['aks_workload_identity', 'secret_ref', 'kubeconfig', 'service_account', 'token', 'in_cluster'];
    case 'gcp':
      return ['gke_workload_identity', 'secret_ref', 'kubeconfig', 'service_account', 'token', 'in_cluster'];
    default:
      return ['secret_ref', 'kubeconfig', 'service_account', 'token', 'in_cluster'];
  }
}

export function k8sAuthModeUsesTrustJson(mode: string): boolean {
  return mode === 'eks_iam' || mode === 'aks_workload_identity' || mode === 'gke_workload_identity';
}

export function k8sAuthModeUsesSecretRef(mode: string): boolean {
  return mode === 'secret_ref';
}

export function k8sAuthModeRequiresCredential(mode: string): boolean {
  return mode !== 'in_cluster';
}

export function buildK8sTrustCredentialJson(cloud: string, mode: string, fields: K8sTrustFields): string {
  const id = normalizeCloudProvider(cloud);
  if (mode === 'eks_iam') {
    return JSON.stringify({
      role_arn: fields.role_arn.trim(),
      external_id: fields.external_id.trim(),
      region: fields.region.trim(),
    });
  }
  if (mode === 'aks_workload_identity') {
    return JSON.stringify({
      tenant_id: fields.tenant_id.trim(),
      subscription_id: fields.subscription_id.trim(),
      resource_group: fields.resource_group.trim(),
      region: fields.region.trim(),
    });
  }
  if (mode === 'gke_workload_identity') {
    return JSON.stringify({
      service_account_email: fields.service_account_email.trim(),
      project_id: fields.project_id.trim(),
      region: fields.region.trim(),
    });
  }
  if (id === 'aws' && mode === 'eks_iam') {
    return JSON.stringify({ role_arn: fields.role_arn.trim() });
  }
  return '';
}

export type K8sSetupStep = { title: string; detail: string };

export function k8sClusterSetupSteps(cloud: string, authMode: string): K8sSetupStep[] {
  const id = normalizeCloudProvider(cloud) as CloudProviderId;
  const common: K8sSetupStep[] = [
    {
      title: 'Use HTTPS only',
      detail: 'Cluster API endpoints must be public HTTPS URLs. Private IPs and localhost are rejected by the server.',
    },
    {
      title: 'Keep secrets off the browser when possible',
      detail: 'Prefer cloud IAM / workload identity or a server secret reference. Pasted tokens are encrypted at rest on the API host.',
    },
  ];

  if (authMode === 'secret_ref') {
    return [
      ...common,
      {
        title: 'Configure the API host',
        detail:
          'Set env K8S_SECRET_REF_<YOUR_REF> or map refs in K8S_SECRET_REFS JSON on the server. The portal stores only the reference name.',
      },
      {
        title: 'Test before save',
        detail: 'Run Test connection to verify the reference resolves and the cluster endpoint is reachable.',
      },
    ];
  }

  switch (id) {
    case 'aws':
      return [
        ...common,
        {
          title: 'Map the EKS cluster',
          detail: 'Use the EKS API server URL (https://….eks.amazonaws.com) as the endpoint.',
        },
        {
          title: 'Grant sts:AssumeRole',
          detail: 'For eks_iam, create a role the SetuOps API can assume with a unique external ID. Paste role ARN + external ID — not access keys.',
        },
        {
          title: 'Test connection',
          detail: 'Validates trust JSON, secret refs, and TLS reachability to the API server.',
        },
      ];
    case 'azure':
      return [
        ...common,
        {
          title: 'AKS API server URL',
          detail: 'Use the AKS fqdn from Azure portal (https://….hcp.<region>.azmk8s.io).',
        },
        {
          title: 'Workload identity',
          detail: 'For aks_workload_identity, supply tenant ID, subscription ID, and resource group. Tokens are minted on the server.',
        },
        {
          title: 'Test connection',
          detail: 'Confirms configuration before the connection is saved to the inventory.',
        },
      ];
    case 'gcp':
      return [
        ...common,
        {
          title: 'GKE control plane endpoint',
          detail: 'Use the public endpoint from gcloud container clusters describe (https://….googleapis.com).',
        },
        {
          title: 'Impersonation SA',
          detail: 'For gke_workload_identity, paste the GCP project ID and service account email the API host can impersonate.',
        },
        {
          title: 'Test connection',
          detail: 'Confirms configuration before the connection is saved to the inventory.',
        },
      ];
    default:
      return common;
  }
}
