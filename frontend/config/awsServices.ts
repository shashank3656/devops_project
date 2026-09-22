// config/awsServices.ts
export interface AWSService {
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

export const awsServices: Record<string, AWSService> = {
  'ec2': {
    name: 'ec2',
    displayName: 'EC2 Instance',
    fields: [
      { name: 'instance_name', label: 'Instance Name', type: 'text', required: true, placeholder: 'my-ec2-instance', section: 'Core setup', description: 'Choose a clear workload name for reviewers and operators.' },
      { name: 'instance_type', label: 'Instance Type', type: 'select', required: true, options: ['t2.micro', 't2.small', 't2.medium', 't3.medium'], defaultValue: 't2.micro', section: 'Sizing and capacity', description: 'Recommended default: t2.micro' },
      { name: 'ami_id', label: 'AMI ID', type: 'text', defaultValue: 'ami-0c55b159cbfafe1f0', section: 'Core setup', description: 'Use the base image your team already supports unless you need a different image.' },
      { name: 'key_name', label: 'Key Pair Name', type: 'text', placeholder: 'my-key-pair', section: 'Access and bootstrap', description: 'Optional if your image or launch flow already handles access.' }
    ]
  },
  'vpc': {
    name: 'vpc',
    displayName: 'VPC',
    fields: [
      { name: 'vpc_name', label: 'VPC Name', type: 'text', required: true, placeholder: 'my-vpc', section: 'Core setup' },
      { name: 'cidr_block', label: 'CIDR Block', type: 'text', required: true, defaultValue: '10.0.0.0/16', section: 'Networking', description: 'Recommended default: 10.0.0.0/16' },
      { name: 'enable_dns_hostnames', label: 'Enable DNS Hostnames', type: 'boolean', defaultValue: true, section: 'Networking', description: 'Recommended default: Enabled' },
      { name: 'enable_dns_support', label: 'Enable DNS Support', type: 'boolean', defaultValue: true, section: 'Networking', description: 'Recommended default: Enabled' }
    ]
  },
  'eks': {
    name: 'eks',
    displayName: 'Elastic Kubernetes Service (EKS)',
    fields: [
      { name: 'cluster_name', label: 'Cluster Name', type: 'text', required: true, placeholder: 'my-eks-cluster', section: 'Cluster settings' },
      { name: 'kubernetes_version', label: 'Kubernetes Version', type: 'select', options: ['1.27', '1.28', '1.29'], defaultValue: '1.28', section: 'Cluster settings', description: 'Recommended default: 1.28' },
      { name: 'node_group_name', label: 'Node Group Name', type: 'text', required: true, placeholder: 'my-node-group', section: 'Node pool' },
      { name: 'instance_types', label: 'Instance Types', type: 'select', options: ['t3.medium', 't3.large', 'm5.large'], defaultValue: 't3.medium', section: 'Node pool', description: 'Recommended default: t3.medium' },
      { name: 'desired_size', label: 'Desired Size', type: 'number', defaultValue: 2, section: 'Sizing and capacity', description: 'Recommended default: 2' },
      { name: 'min_size', label: 'Min Size', type: 'number', defaultValue: 1, section: 'Sizing and capacity', description: 'Recommended default: 1' },
      { name: 'max_size', label: 'Max Size', type: 'number', defaultValue: 4, section: 'Sizing and capacity', description: 'Recommended default: 4' }
    ]
  },
  'rds': {
    name: 'rds',
    displayName: 'RDS Database',
    fields: [
      { name: 'db_instance_name', label: 'DB Instance Name', type: 'text', required: true, placeholder: 'my-rds-instance', section: 'Core setup' },
      { name: 'engine', label: 'Engine', type: 'select', required: true, options: ['postgres', 'mysql', 'mariadb'], defaultValue: 'postgres', section: 'Database settings', description: 'Recommended default: postgres' },
      { name: 'engine_version', label: 'Engine Version', type: 'text', defaultValue: '14.9', section: 'Database settings', description: 'Use the version your team has already validated.' },
      { name: 'instance_class', label: 'Instance Class', type: 'select', options: ['db.t3.micro', 'db.t3.small', 'db.t3.medium'], defaultValue: 'db.t3.micro', section: 'Sizing and capacity', description: 'Recommended default: db.t3.micro' },
      { name: 'allocated_storage', label: 'Allocated Storage (GB)', type: 'number', defaultValue: 20, section: 'Sizing and capacity', description: 'Recommended default: 20 GB' },
      { name: 'db_name', label: 'Database Name', type: 'text', placeholder: 'mydb', section: 'Database settings' }
    ]
  },
  'elasticache': {
    name: 'elasticache',
    displayName: 'ElastiCache / Redis',
    fields: [
      { name: 'cluster_name', label: 'Cluster Name', type: 'text', required: true, placeholder: 'app-cache', section: 'Core setup' },
      { name: 'engine', label: 'Engine', type: 'select', required: true, options: ['redis', 'valkey'], defaultValue: 'redis', section: 'Core setup' },
      { name: 'node_type', label: 'Node Type', type: 'select', required: true, options: ['cache.t3.micro', 'cache.t3.small'], defaultValue: 'cache.t3.micro', section: 'Sizing and capacity' }
    ]
  },
  'alb': {
    name: 'alb',
    displayName: 'Application Load Balancer',
    fields: [
      { name: 'name', label: 'Load balancer name', type: 'text', required: true, placeholder: 'public-api', section: 'Core setup' },
      { name: 'scheme', label: 'Scheme', type: 'select', required: true, options: ['internet-facing', 'internal'], defaultValue: 'internet-facing', section: 'Networking' },
      { name: 'target_port', label: 'Target port', type: 'number', defaultValue: 443, section: 'Networking' }
    ]
  }
};

export const awsServiceList = Object.keys(awsServices);
