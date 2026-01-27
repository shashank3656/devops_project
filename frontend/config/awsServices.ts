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
}

export const awsServices: Record<string, AWSService> = {
  'ec2': {
    name: 'ec2',
    displayName: 'EC2 Instance',
    fields: [
      { name: 'instance_name', label: 'Instance Name', type: 'text', required: true, placeholder: 'my-ec2-instance' },
      { name: 'instance_type', label: 'Instance Type', type: 'select', required: true, options: ['t2.micro', 't2.small', 't2.medium', 't3.medium'], defaultValue: 't2.micro' },
      { name: 'ami_id', label: 'AMI ID', type: 'text', defaultValue: 'ami-0c55b159cbfafe1f0' },
      { name: 'key_name', label: 'Key Pair Name', type: 'text', placeholder: 'my-key-pair' }
    ]
  },
  'vpc': {
    name: 'vpc',
    displayName: 'VPC',
    fields: [
      { name: 'vpc_name', label: 'VPC Name', type: 'text', required: true, placeholder: 'my-vpc' },
      { name: 'cidr_block', label: 'CIDR Block', type: 'text', required: true, defaultValue: '10.0.0.0/16' },
      { name: 'enable_dns_hostnames', label: 'Enable DNS Hostnames', type: 'boolean', defaultValue: true },
      { name: 'enable_dns_support', label: 'Enable DNS Support', type: 'boolean', defaultValue: true }
    ]
  },
  'eks': {
    name: 'eks',
    displayName: 'Elastic Kubernetes Service (EKS)',
    fields: [
      { name: 'cluster_name', label: 'Cluster Name', type: 'text', required: true, placeholder: 'my-eks-cluster' },
      { name: 'kubernetes_version', label: 'Kubernetes Version', type: 'select', options: ['1.27', '1.28', '1.29'], defaultValue: '1.28' },
      { name: 'node_group_name', label: 'Node Group Name', type: 'text', required: true, placeholder: 'my-node-group' },
      { name: 'instance_types', label: 'Instance Types', type: 'select', options: ['t3.medium', 't3.large', 'm5.large'], defaultValue: 't3.medium' },
      { name: 'desired_size', label: 'Desired Size', type: 'number', defaultValue: 2 },
      { name: 'min_size', label: 'Min Size', type: 'number', defaultValue: 1 },
      { name: 'max_size', label: 'Max Size', type: 'number', defaultValue: 4 }
    ]
  },
  'rds': {
    name: 'rds',
    displayName: 'RDS Database',
    fields: [
      { name: 'db_instance_name', label: 'DB Instance Name', type: 'text', required: true, placeholder: 'my-rds-instance' },
      { name: 'engine', label: 'Engine', type: 'select', required: true, options: ['postgres', 'mysql', 'mariadb'], defaultValue: 'postgres' },
      { name: 'engine_version', label: 'Engine Version', type: 'text', defaultValue: '14.9' },
      { name: 'instance_class', label: 'Instance Class', type: 'select', options: ['db.t3.micro', 'db.t3.small', 'db.t3.medium'], defaultValue: 'db.t3.micro' },
      { name: 'allocated_storage', label: 'Allocated Storage (GB)', type: 'number', defaultValue: 20 },
      { name: 'db_name', label: 'Database Name', type: 'text', placeholder: 'mydb' }
    ]
  }
};

export const awsServiceList = Object.keys(awsServices);
