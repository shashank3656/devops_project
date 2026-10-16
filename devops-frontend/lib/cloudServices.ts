export type CloudService = { id: string; label: string };
export type ServicePermission = { id: string; label: string };

export const CLOUD_SERVICES: Record<string, CloudService[]> = {
  aws: [
    { id: 's3', label: 'S3' },
    { id: 'rds', label: 'RDS' },
    { id: 'dynamodb', label: 'DynamoDB' },
    { id: 'ec2', label: 'EC2' },
    { id: 'eks', label: 'EKS' },
    { id: 'lambda', label: 'Lambda' },
    { id: 'vpc', label: 'VPC' },
    { id: 'iam', label: 'IAM' },
    { id: 'sqs', label: 'SQS' },
    { id: 'sns', label: 'SNS' },
    { id: 'cloudwatch', label: 'CloudWatch' },
    { id: 'secrets-manager', label: 'Secrets Manager' },
    { id: 'ecs', label: 'ECS' },
    { id: 'elasticache', label: 'ElastiCache' },
    { id: 'api-gateway', label: 'API Gateway' },
  ],
  azure: [
    { id: 'storage-account', label: 'Storage Account' },
    { id: 'sql', label: 'Azure SQL' },
    { id: 'cosmos-db', label: 'Cosmos DB' },
    { id: 'postgresql', label: 'PostgreSQL' },
    { id: 'aks', label: 'AKS' },
    { id: 'virtual-network', label: 'Virtual Network' },
    { id: 'key-vault', label: 'Key Vault' },
    { id: 'app-service', label: 'App Service' },
    { id: 'functions', label: 'Functions' },
    { id: 'monitor', label: 'Monitor' },
    { id: 'service-bus', label: 'Service Bus' },
    { id: 'container-registry', label: 'Container Registry' },
    { id: 'load-balancer', label: 'Load Balancer' },
  ],
  gcp: [
    { id: 'storage', label: 'Cloud Storage' },
    { id: 'cloudsql', label: 'Cloud SQL' },
    { id: 'bigquery', label: 'BigQuery' },
    { id: 'gke', label: 'GKE' },
    { id: 'compute', label: 'Compute Engine' },
    { id: 'vpc', label: 'VPC' },
    { id: 'iam', label: 'IAM' },
    { id: 'cloud-functions', label: 'Cloud Functions' },
    { id: 'pubsub', label: 'Pub/Sub' },
    { id: 'cloud-run', label: 'Cloud Run' },
    { id: 'monitoring', label: 'Cloud Monitoring' },
    { id: 'secret-manager', label: 'Secret Manager' },
    { id: 'memorystore', label: 'Memorystore' },
  ],
};

const PERMISSIONS: ServicePermission[] = [
  { id: 'READ', label: 'Read' },
  { id: 'DEVELOPER', label: 'Developer' },
  { id: 'ADMIN', label: 'Admin' },
];

export function servicesForCloud(cloud: string): CloudService[] {
  return CLOUD_SERVICES[cloud.toLowerCase()] || [];
}

export function serviceLabel(cloud: string, id: string): string {
  return servicesForCloud(cloud).find((item) => item.id === id)?.label || id;
}

export function permissionsForService(serviceId: string): ServicePermission[] {
  if (!serviceId) return [];
  return PERMISSIONS;
}
