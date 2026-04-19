// config/gcpServices.ts
export interface GCPService {
  name: string;
  displayName: string;
  fields: ServiceField[];
}

export interface ServiceField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  required?: boolean;
  placeholder?: string;
  options?: string[];
  defaultValue?: string | number | boolean;
  description?: string;
  section?: string;
  showWhen?: {
    field: string;
    equals: string | number | boolean;
  };
}

export const gcpServices: Record<string, GCPService> = {
  'gke': {
    name: 'gke',
    displayName: 'Google Kubernetes Engine (GKE)',
    fields: [
      { name: 'cluster_name', label: 'Cluster Name', type: 'text', required: true, placeholder: 'my-gke-cluster', section: 'Cluster settings' },
      { name: 'regional', label: 'Regional Cluster', type: 'boolean', defaultValue: true, section: 'Cluster settings', description: 'Recommended default: Enabled' },
      { name: 'region', label: 'Region', type: 'select', required: true, options: ['us-central1', 'us-east1', 'europe-west1', 'asia-southeast1', 'asia-east2'], defaultValue: 'asia-east2', section: 'Placement', description: 'Recommended default: asia-east2' },
      { name: 'zones', label: 'Zones (comma-separated)', type: 'text', placeholder: 'a,b or us-central1-a', defaultValue: 'b', section: 'Placement', description: 'Used when you need to pin or review zone spread.' },
      { name: 'maintenance_start_time', label: 'Maintenance Window Start', type: 'text', placeholder: '18:00', defaultValue: '18:00', section: 'Maintenance and scaling', description: 'Recommended default: 18:00' },
      { name: 'cluster_autoscaling_enabled', label: 'Cluster Autoscaling', type: 'boolean', defaultValue: false, section: 'Maintenance and scaling', description: 'Recommended default: Disabled' },
      { name: 'autoscaling_profile', label: 'Autoscaling Profile', type: 'select', options: ['BALANCED', 'OPTIMIZE_UTILIZATION'], defaultValue: 'OPTIMIZE_UTILIZATION', section: 'Maintenance and scaling', description: 'Recommended default: OPTIMIZE_UTILIZATION' },
      { name: 'max_cpu_cores', label: 'Max CPU Cores', type: 'number', defaultValue: 32, section: 'Maintenance and scaling', description: 'Recommended default: 32' },
      { name: 'min_cpu_cores', label: 'Min CPU Cores', type: 'number', defaultValue: 0, section: 'Maintenance and scaling', description: 'Recommended default: 0' },
      { name: 'max_memory_gb', label: 'Max Memory (GB)', type: 'number', defaultValue: 130, section: 'Maintenance and scaling', description: 'Recommended default: 130 GB' },
      { name: 'min_memory_gb', label: 'Min Memory (GB)', type: 'number', defaultValue: 0, section: 'Maintenance and scaling', description: 'Recommended default: 0 GB' },
      { name: 'machine_type', label: 'Node Pool Machine Type', type: 'select', required: true, options: ['e2-medium', 'e2-standard-2', 'e2-standard-4', 'e2-standard-8'], defaultValue: 'e2-standard-4', section: 'Node pool', description: 'Recommended default: e2-standard-4' },
      { name: 'disk_type', label: 'Disk Type', type: 'select', options: ['pd-standard', 'pd-balanced', 'pd-ssd'], defaultValue: 'pd-standard', section: 'Node pool', description: 'Recommended default: pd-standard' },
      { name: 'disk_size_gb', label: 'Disk Size (GB)', type: 'number', defaultValue: 50, section: 'Node pool', description: 'Recommended default: 50 GB' },
      { name: 'node_autoscaling', label: 'Node Pool Autoscaling', type: 'boolean', defaultValue: true, section: 'Node pool', description: 'Recommended default: Enabled' },
      { name: 'min_count', label: 'Min Nodes', type: 'number', defaultValue: 3, section: 'Node pool', description: 'Recommended default: 3' },
      { name: 'max_count', label: 'Max Nodes', type: 'number', defaultValue: 3, section: 'Node pool', description: 'Recommended default: 3' },
      { name: 'auto_upgrade', label: 'Auto Upgrade Nodes', type: 'boolean', defaultValue: true, section: 'Maintenance and scaling', description: 'Recommended default: Enabled' }
    ]
  },
  'compute-engine': {
    name: 'compute-engine',
    displayName: 'Compute Engine (VM)',
    fields: [
      { name: 'instance_name', label: 'Instance Name', type: 'text', required: true, placeholder: 'my-vm-instance', section: 'Core setup' },
      { name: 'machine_type', label: 'Machine Type', type: 'select', required: true, options: ['e2-micro', 'e2-small', 'e2-medium', 'e2-standard-2'], defaultValue: 'e2-medium', section: 'Sizing and capacity', description: 'Recommended default: e2-medium' },
      { name: 'zone', label: 'Zone', type: 'select', required: true, options: ['us-central1-a', 'us-central1-b', 'us-east1-a', 'europe-west1-a'], section: 'Placement' },
      { name: 'disk_size_gb', label: 'Disk Size (GB)', type: 'number', defaultValue: 20, section: 'Sizing and capacity', description: 'Recommended default: 20 GB' },
      { name: 'image', label: 'Image', type: 'text', defaultValue: 'ubuntu-os-cloud/ubuntu-2204-lts', section: 'Core setup', description: 'Recommended default: ubuntu-os-cloud/ubuntu-2204-lts' }
    ]
  },
  'cloud-sql': {
    name: 'cloud-sql',
    displayName: 'Cloud SQL (Database)',
    fields: [
      { name: 'instance_name', label: 'Instance Name', type: 'text', required: true, placeholder: 'my-sql-instance', section: 'Core setup' },
      { name: 'database_version', label: 'Database Version', type: 'select', required: true, options: ['MYSQL_8_0', 'POSTGRES_14', 'POSTGRES_15'], defaultValue: 'POSTGRES_14', section: 'Database settings', description: 'Recommended default: POSTGRES_14' },
      { name: 'tier', label: 'Tier', type: 'select', required: true, options: ['db-f1-micro', 'db-g1-small', 'db-n1-standard-1'], defaultValue: 'db-f1-micro', section: 'Sizing and capacity', description: 'Recommended default: db-f1-micro' },
      { name: 'region', label: 'Region', type: 'select', required: true, options: ['us-central1', 'us-east1', 'europe-west1'], section: 'Placement' },
      { name: 'disk_size_gb', label: 'Disk Size (GB)', type: 'number', defaultValue: 10, section: 'Sizing and capacity', description: 'Recommended default: 10 GB' }
    ]
  },
  'vpc': {
    name: 'vpc',
    displayName: 'Virtual Private Cloud (VPC)',
    fields: [
      { name: 'network_name', label: 'Network Name', type: 'text', required: true, placeholder: 'my-vpc-network', section: 'Core setup' },
      { name: 'auto_create_subnetworks', label: 'Auto Create Subnetworks', type: 'boolean', defaultValue: false, section: 'Networking', description: 'Recommended default: Disabled' },
      { name: 'routing_mode', label: 'Routing Mode', type: 'select', options: ['REGIONAL', 'GLOBAL'], defaultValue: 'REGIONAL', section: 'Networking', description: 'Recommended default: REGIONAL' }
    ]
  },
  'cloud-storage': {
    name: 'cloud-storage',
    displayName: 'Cloud Storage Bucket',
    fields: [
      {
        name: 'bucket_name',
        label: 'Storage Bucket Name',
        type: 'text',
        required: true,
        placeholder: 'setuops-app-assets',
        section: 'Bucket basics',
        description: 'Use a globally unique bucket name with lowercase letters, numbers, and hyphens.'
      },
      {
        name: 'region',
        label: 'Region',
        type: 'select',
        required: true,
        options: ['asia-east2', 'asia-south1', 'asia-southeast1', 'us-central1', 'us-east1', 'europe-west1'],
        defaultValue: 'asia-east2',
        section: 'Bucket basics',
        description: 'Choose the primary region for the bucket.'
      },
      {
        name: 'storage_class',
        label: 'Storage Class',
        type: 'select',
        required: true,
        options: ['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE'],
        defaultValue: 'STANDARD',
        section: 'Bucket basics',
        description: 'Default: STANDARD'
      },
      {
        name: 'soft_delete_policy',
        label: 'Soft Delete Policy',
        type: 'select',
        options: ['Default', 'Disabled'],
        defaultValue: 'Default',
        section: 'Protection and retention',
        description: 'Default: Default'
      },
      {
        name: 'versioning_enabled',
        label: 'Object Versioning',
        type: 'boolean',
        defaultValue: false,
        section: 'Protection and retention',
        description: 'Default: Disabled'
      },
      {
        name: 'bucket_retention_policy_enabled',
        label: 'Bucket Retention Policy',
        type: 'boolean',
        defaultValue: false,
        section: 'Protection and retention',
        description: 'Default: Disabled'
      },
      {
        name: 'object_retention_enabled',
        label: 'Object Retention',
        type: 'boolean',
        defaultValue: false,
        section: 'Protection and retention',
        description: 'Default: Disabled'
      },
      {
        name: 'encryption_type',
        label: 'Encryption Type',
        type: 'select',
        options: ['Google-managed', 'Customer-managed (CMEK)'],
        defaultValue: 'Google-managed',
        section: 'Encryption',
        description: 'Default: Google-managed'
      },
      {
        name: 'kms_key_name',
        label: 'CMEK Key Resource',
        type: 'text',
        required: true,
        placeholder: 'projects/my-project/locations/asia-east2/keyRings/main/cryptoKeys/storage',
        section: 'Encryption',
        showWhen: { field: 'encryption_type', equals: 'Customer-managed (CMEK)' },
        description: 'Only needed when you select customer-managed encryption.'
      }
    ]
  }
};

export const gcpServiceList = Object.keys(gcpServices);
