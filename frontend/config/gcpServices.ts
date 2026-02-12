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
}

export const gcpServices: Record<string, GCPService> = {
  'gke': {
    name: 'gke',
    displayName: 'Google Kubernetes Engine (GKE)',
    fields: [
      { name: 'cluster_name', label: 'Cluster Name', type: 'text', required: true, placeholder: 'my-gke-cluster' },
      { name: 'regional', label: 'Regional Cluster', type: 'boolean', defaultValue: true },
      { name: 'region', label: 'Region', type: 'select', required: true, options: ['us-central1', 'us-east1', 'europe-west1', 'asia-southeast1', 'asia-east2'], defaultValue: 'asia-east2' },
      { name: 'zones', label: 'Zones (comma-separated)', type: 'text', placeholder: 'a,b or us-central1-a', defaultValue: 'b' },
      { name: 'maintenance_start_time', label: 'Maintenance Window Start', type: 'text', placeholder: '18:00', defaultValue: '18:00' },
      { name: 'cluster_autoscaling_enabled', label: 'Cluster Autoscaling', type: 'boolean', defaultValue: false },
      { name: 'autoscaling_profile', label: 'Autoscaling Profile', type: 'select', options: ['BALANCED', 'OPTIMIZE_UTILIZATION'], defaultValue: 'OPTIMIZE_UTILIZATION' },
      { name: 'max_cpu_cores', label: 'Max CPU Cores', type: 'number', defaultValue: 32 },
      { name: 'min_cpu_cores', label: 'Min CPU Cores', type: 'number', defaultValue: 0 },
      { name: 'max_memory_gb', label: 'Max Memory (GB)', type: 'number', defaultValue: 130 },
      { name: 'min_memory_gb', label: 'Min Memory (GB)', type: 'number', defaultValue: 0 },
      { name: 'machine_type', label: 'Node Pool Machine Type', type: 'select', required: true, options: ['e2-medium', 'e2-standard-2', 'e2-standard-4', 'e2-standard-8'], defaultValue: 'e2-standard-4' },
      { name: 'disk_type', label: 'Disk Type', type: 'select', options: ['pd-standard', 'pd-balanced', 'pd-ssd'], defaultValue: 'pd-standard' },
      { name: 'disk_size_gb', label: 'Disk Size (GB)', type: 'number', defaultValue: 50 },
      { name: 'node_autoscaling', label: 'Node Pool Autoscaling', type: 'boolean', defaultValue: true },
      { name: 'min_count', label: 'Min Nodes', type: 'number', defaultValue: 3 },
      { name: 'max_count', label: 'Max Nodes', type: 'number', defaultValue: 3 },
      { name: 'auto_upgrade', label: 'Auto Upgrade Nodes', type: 'boolean', defaultValue: true }
    ]
  },
  'compute-engine': {
    name: 'compute-engine',
    displayName: 'Compute Engine (VM)',
    fields: [
      { name: 'instance_name', label: 'Instance Name', type: 'text', required: true, placeholder: 'my-vm-instance' },
      { name: 'machine_type', label: 'Machine Type', type: 'select', required: true, options: ['e2-micro', 'e2-small', 'e2-medium', 'e2-standard-2'], defaultValue: 'e2-medium' },
      { name: 'zone', label: 'Zone', type: 'select', required: true, options: ['us-central1-a', 'us-central1-b', 'us-east1-a', 'europe-west1-a'] },
      { name: 'disk_size_gb', label: 'Disk Size (GB)', type: 'number', defaultValue: 20 },
      { name: 'image', label: 'Image', type: 'text', defaultValue: 'ubuntu-os-cloud/ubuntu-2204-lts' }
    ]
  },
  'cloud-sql': {
    name: 'cloud-sql',
    displayName: 'Cloud SQL (Database)',
    fields: [
      { name: 'instance_name', label: 'Instance Name', type: 'text', required: true, placeholder: 'my-sql-instance' },
      { name: 'database_version', label: 'Database Version', type: 'select', required: true, options: ['MYSQL_8_0', 'POSTGRES_14', 'POSTGRES_15'], defaultValue: 'POSTGRES_14' },
      { name: 'tier', label: 'Tier', type: 'select', required: true, options: ['db-f1-micro', 'db-g1-small', 'db-n1-standard-1'], defaultValue: 'db-f1-micro' },
      { name: 'region', label: 'Region', type: 'select', required: true, options: ['us-central1', 'us-east1', 'europe-west1'] },
      { name: 'disk_size_gb', label: 'Disk Size (GB)', type: 'number', defaultValue: 10 }
    ]
  },
  'vpc': {
    name: 'vpc',
    displayName: 'Virtual Private Cloud (VPC)',
    fields: [
      { name: 'network_name', label: 'Network Name', type: 'text', required: true, placeholder: 'my-vpc-network' },
      { name: 'auto_create_subnetworks', label: 'Auto Create Subnetworks', type: 'boolean', defaultValue: false },
      { name: 'routing_mode', label: 'Routing Mode', type: 'select', options: ['REGIONAL', 'GLOBAL'], defaultValue: 'REGIONAL' }
    ]
  },
  'cloud-storage': {
    name: 'cloud-storage',
    displayName: 'Cloud Storage (Bucket)',
    fields: [
      { name: 'bucket_name', label: 'Bucket Name', type: 'text', required: true, placeholder: 'my-storage-bucket' },
      { name: 'location', label: 'Location', type: 'select', required: true, options: ['US', 'EU', 'ASIA', 'us-central1', 'europe-west1'], defaultValue: 'US' },
      { name: 'storage_class', label: 'Storage Class', type: 'select', options: ['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE'], defaultValue: 'STANDARD' },
      { name: 'versioning_enabled', label: 'Versioning Enabled', type: 'boolean', defaultValue: false }
    ]
  }
};

export const gcpServiceList = Object.keys(gcpServices);
