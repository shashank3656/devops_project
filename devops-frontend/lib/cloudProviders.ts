import type { SegmentedOption } from '@infragate/ui';

export const CLOUD_PROVIDER_IDS = ['aws', 'azure', 'gcp'] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDER_IDS)[number];

export function normalizeCloudProvider(value: string): CloudProviderId {
  const v = value.trim().toLowerCase();
  if (v === 'azure' || v === 'gcp' || v === 'aws') return v;
  return 'aws';
}

export function providerLabel(provider: string): string {
  switch (normalizeCloudProvider(provider)) {
    case 'aws':
      return 'AWS';
    case 'azure':
      return 'Azure';
    case 'gcp':
      return 'GCP';
    default:
      return provider.toUpperCase();
  }
}

export const CLOUD_PROVIDER_SEGMENT: SegmentedOption[] = [
  { value: 'aws', label: 'AWS', hint: 'Amazon Web Services' },
  { value: 'azure', label: 'Azure', hint: 'Microsoft Azure' },
  { value: 'gcp', label: 'GCP', hint: 'Google Cloud Platform' },
];

export type ProviderFormCopy = {
  accountIdLabel: string;
  accountIdPlaceholder: string;
  accountIdHint: string;
  assumeAuthLabel: string;
  staticAuthLabel: string;
  roleLabel: string;
  rolePlaceholder: string;
  externalIdLabel: string;
  externalIdPlaceholder: string;
  onboardBlurb: string;
};

export function providerFormCopy(provider: CloudProviderId): ProviderFormCopy {
  switch (provider) {
    case 'azure':
      return {
        accountIdLabel: 'Subscription ID',
        accountIdPlaceholder: '00000000-0000-0000-0000-000000000000',
        accountIdHint: 'Azure subscription GUID for this team.',
        assumeAuthLabel: 'Federated / app role (recommended)',
        staticAuthLabel: 'Server secret reference (last resort)',
        roleLabel: 'Role or scope ID',
        rolePlaceholder: 'Reader role assignment scope or app role ID',
        externalIdLabel: 'Directory (tenant) ID',
        externalIdPlaceholder: 'Azure AD tenant GUID (recommended)',
        onboardBlurb:
          'Register the subscription and federated trust. Client secrets stay on the API host — use workload identity or a server-side secret reference.',
      };
    case 'gcp':
      return {
        accountIdLabel: 'Project ID',
        accountIdPlaceholder: 'my-platform-prod',
        accountIdHint: 'GCP project that owns resources for this team.',
        assumeAuthLabel: 'Service account impersonation (recommended)',
        staticAuthLabel: 'Server secret reference (last resort)',
        roleLabel: 'Service account email',
        rolePlaceholder: 'inventory@my-platform-prod.iam.gserviceaccount.com',
        externalIdLabel: 'Workload identity pool (optional)',
        externalIdPlaceholder: 'projects/…/locations/…/workloadIdentityPools/…',
        onboardBlurb:
          'Register the project and service account to impersonate. Keys never go to the browser — use WIF or a server-side secret reference.',
      };
    default:
      return {
        accountIdLabel: 'AWS account ID',
        accountIdPlaceholder: '111122223333',
        accountIdHint: '12-digit AWS account number.',
        assumeAuthLabel: 'Assume IAM role (recommended)',
        staticAuthLabel: 'Server secret reference (last resort)',
        roleLabel: 'Role ARN',
        rolePlaceholder: 'arn:aws:iam::111122223333:role/SetuOpsInventory',
        externalIdLabel: 'External ID',
        externalIdPlaceholder: 'Trust external ID (recommended)',
        onboardBlurb:
          'Register the account and cross-account IAM role. Access keys are never sent to the browser — use role assumption or a server-side secret reference.',
      };
  }
}

export function providerChipTone(provider: string): string {
  switch (normalizeCloudProvider(provider)) {
    case 'azure':
      return 'info';
    case 'gcp':
      return 'ok';
    default:
      return 'medium';
  }
}

export function accountIdColumnLabel(provider: string): string {
  switch (normalizeCloudProvider(provider)) {
    case 'azure':
      return 'Subscription';
    case 'gcp':
      return 'Project';
    default:
      return 'Account ID';
  }
}

export function inventoryAccountPlaceholder(provider: CloudProviderId): string {
  switch (provider) {
    case 'azure':
      return 'subscription GUID';
    case 'gcp':
      return 'project id';
    default:
      return '12-digit id';
  }
}

export type TrustSetupStep = { title: string; detail: string };

export function providerTrustSetupSteps(provider: CloudProviderId): TrustSetupStep[] {
  switch (provider) {
    case 'azure':
      return [
        {
          title: 'Create or pick a subscription',
          detail: 'Use the subscription GUID as the account ID in SetuOps. Inventory and tests scope to that subscription.',
        },
        {
          title: 'Federate the API host',
          detail: 'Grant the SetuOps API identity (managed identity or app registration) permission to read resources in the subscription.',
        },
        {
          title: 'Record role or scope ID',
          detail: 'Paste the role definition ID or assignment scope the API should assume. Add the Azure AD tenant ID as external ID when using cross-tenant trust.',
        },
        {
          title: 'Test from the account page',
          detail: 'Run Test connection after save. Status moves to Connected when the server validates trust inputs (live SDK checks when host credentials exist).',
        },
      ];
    case 'gcp':
      return [
        {
          title: 'Choose a project',
          detail: 'Use the GCP project ID that owns the resources your team manages.',
        },
        {
          title: 'Create a read-only service account',
          detail: 'Example: inventory@PROJECT.iam.gserviceaccount.com with roles/browser or custom read-only roles.',
        },
        {
          title: 'Allow impersonation from the API host',
          detail: 'Grant roles/iam.serviceAccountTokenCreator on that SA to the SetuOps API runtime service account (or workload identity pool).',
        },
        {
          title: 'Test from the account page',
          detail: 'Save the service account email as the role field, then run Test connection on the detail page.',
        },
      ];
    default:
      return [
        {
          title: 'Create a cross-account IAM role',
          detail: 'In the member account, create a role (e.g. SetuOpsInventory) with read-only policies for the services you inventory.',
        },
        {
          title: 'Trust the SetuOps API account',
          detail: 'Role trust policy must allow sts:AssumeRole from the API host account or role. Use a unique external ID in the trust condition.',
        },
        {
          title: 'Paste ARN + external ID here',
          detail: 'Role ARN must live in the same 12-digit account ID you onboard. External ID is stored only on the server.',
        },
        {
          title: 'Test from the account page',
          detail: 'After onboard, Test connection runs STS AssumeRole when the API has host AWS credentials; otherwise configuration is validated.',
        },
      ];
  }
}

export function providerInventoryTitle(provider: CloudProviderId): string {
  switch (provider) {
    case 'azure':
      return 'Azure resources';
    case 'gcp':
      return 'GCP resources';
    default:
      return 'AWS resources';
  }
}
