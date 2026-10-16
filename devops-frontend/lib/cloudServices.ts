export type CloudService = { id: string; label: string };
export type ServicePermission = { id: string; label: string };

export const CLOUD_SERVICES: Record<string, CloudService[]> = {
  aws: [
    { id: 'account', label: 'AWS Account' },
    { id: 'organizations', label: 'AWS Organizations' },
    { id: 'organizational-units', label: 'Organizational Units' },
    { id: 'iam', label: 'AWS IAM' },
    { id: 'iam-users', label: 'IAM Users' },
    { id: 'iam-groups', label: 'IAM Groups' },
    { id: 'iam-roles', label: 'IAM Roles' },
    { id: 'iam-policies', label: 'IAM Policies' },
    { id: 'control-tower', label: 'AWS Control Tower' },
    { id: 'resource-groups', label: 'AWS Resource Groups' },
    { id: 'service-control-policies', label: 'AWS Service Control Policies' },
    { id: 'budgets', label: 'AWS Budgets' },
    { id: 'cost-explorer', label: 'AWS Cost Explorer' },
    { id: 'cloudtrail', label: 'AWS CloudTrail' },
    { id: 'ec2', label: 'Amazon EC2' },
    { id: 'eks', label: 'Amazon EKS' },
    { id: 'lambda', label: 'AWS Lambda' },
    { id: 'app-runner', label: 'AWS App Runner' },
    { id: 'fargate', label: 'AWS Fargate' },
    { id: 'ecs', label: 'Amazon ECS' },
    { id: 'auto-scaling', label: 'Amazon EC2 Auto Scaling' },
    { id: 'ecr', label: 'Amazon ECR' },
    { id: 'batch', label: 'AWS Batch' },
    { id: 'vpc', label: 'Amazon VPC' },
    { id: 'security-groups', label: 'Security Groups' },
    { id: 'network-acls', label: 'Network ACLs' },
    { id: 'route-tables', label: 'VPC Route Tables' },
    { id: 'internet-gateway', label: 'Internet Gateway' },
    { id: 'nat-gateway', label: 'NAT Gateway' },
    { id: 'transit-gateway', label: 'AWS Transit Gateway' },
    { id: 'direct-connect', label: 'AWS Direct Connect' },
    { id: 'site-to-site-vpn', label: 'AWS Site-to-Site VPN' },
    { id: 'elastic-load-balancing', label: 'Elastic Load Balancing' },
    { id: 'route53', label: 'Amazon Route 53' },
    { id: 'waf', label: 'AWS WAF' },
    { id: 'shield', label: 'AWS Shield' },
    { id: 'cloudfront', label: 'Amazon CloudFront' },
    { id: 'privatelink', label: 'AWS PrivateLink' },
    { id: 's3', label: 'Amazon S3' },
    { id: 'ebs', label: 'Amazon EBS' },
    { id: 'efs', label: 'Amazon EFS' },
    { id: 'fsx', label: 'Amazon FSx' },
    { id: 'rds', label: 'Amazon RDS' },
    { id: 'aurora', label: 'Amazon Aurora' },
    { id: 'dynamodb', label: 'Amazon DynamoDB' },
    { id: 'elasticache', label: 'Amazon ElastiCache' },
    { id: 'redshift', label: 'Amazon Redshift' },
    { id: 'backup', label: 'AWS Backup' },
    { id: 'cloudwatch', label: 'Amazon CloudWatch' },
    { id: 'cloudwatch-logs', label: 'CloudWatch Logs' },
    { id: 'config', label: 'AWS Config' },
    { id: 'security-hub', label: 'AWS Security Hub' },
    { id: 'guardduty', label: 'Amazon GuardDuty' },
    { id: 'secrets-manager', label: 'AWS Secrets Manager' },
    { id: 'kms', label: 'AWS KMS' },
    { id: 'inspector', label: 'Amazon Inspector' },
    { id: 'certificate-manager', label: 'AWS Certificate Manager' },
    { id: 'glue', label: 'AWS Glue' },
    { id: 'managed-flink', label: 'Amazon Managed Service for Apache Flink' },
    { id: 'sns', label: 'Amazon SNS' },
    { id: 'sqs', label: 'Amazon SQS' },
    { id: 'eventbridge', label: 'Amazon EventBridge' },
    { id: 'kinesis', label: 'Amazon Kinesis' },
    { id: 'step-functions', label: 'AWS Step Functions' },
    { id: 'athena', label: 'Amazon Athena' },
    { id: 'lake-formation', label: 'AWS Lake Formation' },
    { id: 'cloudformation', label: 'AWS CloudFormation' },
    { id: 'codepipeline', label: 'AWS CodePipeline' },
    { id: 'codebuild', label: 'AWS CodeBuild' },
    { id: 'codedeploy', label: 'AWS CodeDeploy' },
    { id: 'systems-manager', label: 'AWS Systems Manager' },
    { id: 'cdk', label: 'AWS CDK' },
    { id: 'api-gateway', label: 'Amazon API Gateway' },
  ],
  azure: [
    { id: 'subscription', label: 'Azure Subscription' },
    { id: 'tenant', label: 'Microsoft Entra ID Tenant' },
    { id: 'management-groups', label: 'Management Groups' },
    { id: 'landing-zones', label: 'Azure Landing Zones' },
    { id: 'entra-id', label: 'Microsoft Entra ID' },
    { id: 'entra-users', label: 'Microsoft Entra ID Users' },
    { id: 'entra-groups', label: 'Microsoft Entra ID Groups' },
    { id: 'service-principal', label: 'Service Principal' },
    { id: 'managed-identities', label: 'Managed Identities' },
    { id: 'rbac', label: 'Azure RBAC' },
    { id: 'role-assignments', label: 'Azure Role Assignments' },
    { id: 'custom-roles', label: 'Custom Roles' },
    { id: 'resource-groups', label: 'Azure Resource Groups' },
    { id: 'resource-locks', label: 'Resource Locks' },
    { id: 'policy', label: 'Azure Policy' },
    { id: 'cost-management', label: 'Azure Cost Management' },
    { id: 'budgets', label: 'Azure Cost Management Budgets' },
    { id: 'activity-log', label: 'Azure Activity Log' },
    { id: 'virtual-machines', label: 'Azure Virtual Machines' },
    { id: 'aks', label: 'Azure Kubernetes Service' },
    { id: 'functions', label: 'Azure Functions' },
    { id: 'container-apps', label: 'Azure Container Apps' },
    { id: 'vm-scale-sets', label: 'Virtual Machine Scale Sets' },
    { id: 'container-registry', label: 'Azure Container Registry' },
    { id: 'batch', label: 'Azure Batch' },
    { id: 'app-service', label: 'Azure App Service' },
    { id: 'virtual-network', label: 'Azure Virtual Network' },
    { id: 'network-security-groups', label: 'Network Security Groups' },
    { id: 'firewall', label: 'Azure Firewall' },
    { id: 'route-tables', label: 'Azure Route Tables' },
    { id: 'nat-gateway', label: 'Azure NAT Gateway' },
    { id: 'virtual-wan', label: 'Azure Virtual WAN' },
    { id: 'expressroute', label: 'Azure ExpressRoute' },
    { id: 'vpn-gateway', label: 'Azure VPN Gateway' },
    { id: 'load-balancer', label: 'Azure Load Balancer' },
    { id: 'application-gateway', label: 'Application Gateway' },
    { id: 'dns', label: 'Azure DNS' },
    { id: 'waf', label: 'Azure WAF' },
    { id: 'ddos-protection', label: 'Azure DDoS Protection' },
    { id: 'front-door', label: 'Azure Front Door' },
    { id: 'private-link', label: 'Azure Private Link' },
    { id: 'storage-account', label: 'Azure Blob Storage' },
    { id: 'managed-disks', label: 'Azure Managed Disks' },
    { id: 'files', label: 'Azure Files' },
    { id: 'netapp-files', label: 'Azure NetApp Files' },
    { id: 'sql', label: 'Azure SQL Database' },
    { id: 'postgresql', label: 'Azure Database for PostgreSQL' },
    { id: 'cosmos-db', label: 'Azure Cosmos DB' },
    { id: 'managed-redis', label: 'Azure Managed Redis' },
    { id: 'synapse', label: 'Azure Synapse Analytics' },
    { id: 'backup', label: 'Azure Backup' },
    { id: 'monitor', label: 'Azure Monitor' },
    { id: 'monitor-logs', label: 'Azure Monitor Logs' },
    { id: 'resource-graph', label: 'Azure Resource Graph' },
    { id: 'defender', label: 'Microsoft Defender for Cloud' },
    { id: 'key-vault', label: 'Azure Key Vault' },
    { id: 'key-vault-keys', label: 'Azure Key Vault Keys' },
    { id: 'key-vault-certificates', label: 'Azure Key Vault Certificates' },
    { id: 'data-factory', label: 'Azure Data Factory' },
    { id: 'stream-analytics', label: 'Azure Stream Analytics' },
    { id: 'event-grid', label: 'Azure Event Grid' },
    { id: 'service-bus', label: 'Azure Service Bus' },
    { id: 'event-hubs', label: 'Azure Event Hubs' },
    { id: 'logic-apps', label: 'Azure Logic Apps' },
    { id: 'purview', label: 'Microsoft Purview' },
    { id: 'arm-templates', label: 'Azure ARM Templates' },
    { id: 'bicep', label: 'Azure Bicep' },
    { id: 'devops-pipelines', label: 'Azure DevOps Pipelines' },
    { id: 'automation', label: 'Azure Automation' },
    { id: 'arc', label: 'Azure Arc' },
    { id: 'developer-cli', label: 'Azure Developer CLI' },
  ],
  gcp: [
    { id: 'project', label: 'Google Cloud Project' },
    { id: 'organization', label: 'Google Cloud Organization' },
    { id: 'folders', label: 'Folders' },
    { id: 'iam', label: 'Cloud IAM' },
    { id: 'cloud-identity-users', label: 'Cloud Identity Users' },
    { id: 'groups', label: 'Google Groups' },
    { id: 'service-accounts', label: 'Service Accounts' },
    { id: 'iam-roles', label: 'IAM Roles' },
    { id: 'role-bindings', label: 'IAM Role Bindings' },
    { id: 'landing-zones', label: 'Landing Zones' },
    { id: 'organization-policy', label: 'Organization Policy Service' },
    { id: 'billing-budgets', label: 'Cloud Billing Budgets' },
    { id: 'billing-reports', label: 'Cloud Billing Reports' },
    { id: 'audit-logs', label: 'Cloud Audit Logs' },
    { id: 'compute', label: 'Compute Engine' },
    { id: 'gke', label: 'Google Kubernetes Engine' },
    { id: 'cloud-functions', label: 'Cloud Functions' },
    { id: 'cloud-run', label: 'Cloud Run' },
    { id: 'instance-groups', label: 'Managed Instance Groups' },
    { id: 'artifact-registry', label: 'Artifact Registry' },
    { id: 'batch', label: 'Batch' },
    { id: 'vpc', label: 'VPC' },
    { id: 'firewall-rules', label: 'VPC Firewall Rules' },
    { id: 'routes', label: 'VPC Routes' },
    { id: 'cloud-nat', label: 'Cloud NAT' },
    { id: 'network-connectivity-center', label: 'Network Connectivity Center' },
    { id: 'interconnect', label: 'Cloud Interconnect' },
    { id: 'cloud-vpn', label: 'Cloud VPN' },
    { id: 'load-balancing', label: 'Cloud Load Balancing' },
    { id: 'dns', label: 'Cloud DNS' },
    { id: 'cloud-armor', label: 'Cloud Armor' },
    { id: 'cdn', label: 'Cloud CDN' },
    { id: 'private-service-connect', label: 'Private Service Connect' },
    { id: 'storage', label: 'Cloud Storage' },
    { id: 'persistent-disk', label: 'Persistent Disk' },
    { id: 'hyperdisk', label: 'Hyperdisk' },
    { id: 'filestore', label: 'Filestore' },
    { id: 'netapp-volumes', label: 'Google Cloud NetApp Volumes' },
    { id: 'cloudsql', label: 'Cloud SQL' },
    { id: 'alloydb', label: 'AlloyDB' },
    { id: 'firestore', label: 'Firestore' },
    { id: 'bigtable', label: 'Bigtable' },
    { id: 'memorystore', label: 'Memorystore' },
    { id: 'bigquery', label: 'BigQuery' },
    { id: 'backup-dr', label: 'Backup and DR' },
    { id: 'monitoring', label: 'Cloud Monitoring' },
    { id: 'logging', label: 'Cloud Logging' },
    { id: 'asset-inventory', label: 'Cloud Asset Inventory' },
    { id: 'security-command-center', label: 'Security Command Center' },
    { id: 'secret-manager', label: 'Secret Manager' },
    { id: 'cloud-kms', label: 'Cloud KMS' },
    { id: 'certificate-manager', label: 'Certificate Manager' },
    { id: 'dataflow', label: 'Dataflow' },
    { id: 'pubsub', label: 'Pub/Sub' },
    { id: 'eventarc', label: 'Eventarc' },
    { id: 'workflows', label: 'Workflows' },
    { id: 'dataplex', label: 'Dataplex' },
    { id: 'infrastructure-manager', label: 'Infrastructure Manager' },
    { id: 'cloud-build', label: 'Cloud Build' },
    { id: 'cloud-deploy', label: 'Cloud Deploy' },
    { id: 'vm-manager', label: 'VM Manager' },
  ],
};

const COMMON_PERMISSIONS: Record<string, ServicePermission[]> = {
  gcp: [
    { id: 'roles/viewer', label: 'Viewer' },
    { id: 'roles/editor', label: 'Editor' },
    { id: 'roles/owner', label: 'Owner' },
    { id: 'roles/iam.securityReviewer', label: 'Security Reviewer' },
    { id: 'roles/resourcemanager.projectIamAdmin', label: 'Project IAM Admin' },
  ],
  aws: [
    { id: 'ReadOnlyAccess', label: 'ReadOnlyAccess' },
    { id: 'PowerUserAccess', label: 'PowerUserAccess' },
    { id: 'AdministratorAccess', label: 'AdministratorAccess' },
    { id: 'SecurityAudit', label: 'SecurityAudit' },
    { id: 'Billing', label: 'Billing' },
  ],
  azure: [
    { id: 'Reader', label: 'Reader' },
    { id: 'Contributor', label: 'Contributor' },
    { id: 'Owner', label: 'Owner' },
    { id: 'Security Reader', label: 'Security Reader' },
    { id: 'Role Based Access Control Administrator', label: 'Role Based Access Control Administrator' },
    { id: 'User Access Administrator', label: 'User Access Administrator' },
    { id: 'Billing Administrator', label: 'Billing Administrator' },
  ],
};

function shared(ids: string[], permissions: ServicePermission[]): Record<string, ServicePermission[]> {
  return Object.fromEntries(ids.map((id) => [id, permissions]));
}

const SERVICE_PERMISSIONS: Record<string, Record<string, ServicePermission[]>> = {
  gcp: {
    ...shared(['compute', 'instance-groups'], [
      { id: 'roles/compute.viewer', label: 'Compute Viewer' },
      { id: 'roles/compute.instanceAdmin.v1', label: 'Compute Instance Admin' },
      { id: 'roles/compute.admin', label: 'Compute Admin' },
    ]),
    ...shared(['gke'], [
      { id: 'roles/container.viewer', label: 'Kubernetes Engine Viewer' },
      { id: 'roles/container.developer', label: 'Kubernetes Engine Developer' },
      { id: 'roles/container.clusterAdmin', label: 'Kubernetes Engine Cluster Admin' },
      { id: 'roles/container.admin', label: 'Kubernetes Engine Admin' },
    ]),
    ...shared(['cloud-functions'], [
      { id: 'roles/cloudfunctions.viewer', label: 'Cloud Functions Viewer' },
      { id: 'roles/cloudfunctions.developer', label: 'Cloud Functions Developer' },
      { id: 'roles/cloudfunctions.admin', label: 'Cloud Functions Admin' },
    ]),
    ...shared(['cloud-run'], [
      { id: 'roles/run.viewer', label: 'Cloud Run Viewer' },
      { id: 'roles/run.invoker', label: 'Cloud Run Invoker' },
      { id: 'roles/run.developer', label: 'Cloud Run Developer' },
      { id: 'roles/run.admin', label: 'Cloud Run Admin' },
    ]),
    ...shared(['storage'], [
      { id: 'roles/storage.objectViewer', label: 'Storage Object Viewer' },
      { id: 'roles/storage.objectCreator', label: 'Storage Object Creator' },
      { id: 'roles/storage.objectAdmin', label: 'Storage Object Admin' },
      { id: 'roles/storage.admin', label: 'Storage Admin' },
    ]),
    ...shared(['cloudsql'], [
      { id: 'roles/cloudsql.viewer', label: 'Cloud SQL Viewer' },
      { id: 'roles/cloudsql.client', label: 'Cloud SQL Client' },
      { id: 'roles/cloudsql.instanceUser', label: 'Cloud SQL Instance User' },
      { id: 'roles/cloudsql.admin', label: 'Cloud SQL Admin' },
    ]),
    ...shared(['filestore', 'netapp-volumes'], [
      { id: 'roles/file.viewer', label: 'Filestore Viewer' },
      { id: 'roles/file.editor', label: 'Filestore Editor' },
    ]),
    ...shared(['bigquery'], [
      { id: 'roles/bigquery.dataViewer', label: 'BigQuery Data Viewer' },
      { id: 'roles/bigquery.user', label: 'BigQuery User' },
      { id: 'roles/bigquery.jobUser', label: 'BigQuery Job User' },
      { id: 'roles/bigquery.dataEditor', label: 'BigQuery Data Editor' },
      { id: 'roles/bigquery.admin', label: 'BigQuery Admin' },
    ]),
    ...shared(['firewall-rules', 'cloud-armor'], [
      { id: 'roles/compute.securityAdmin', label: 'Compute Security Admin' },
      { id: 'roles/compute.networkAdmin', label: 'Compute Network Admin' },
    ]),
    ...shared(['vpc', 'routes', 'cloud-nat', 'cloud-vpn', 'interconnect', 'network-connectivity-center', 'private-service-connect'], [
      { id: 'roles/compute.networkViewer', label: 'Compute Network Viewer' },
      { id: 'roles/compute.networkUser', label: 'Compute Network User' },
      { id: 'roles/compute.networkAdmin', label: 'Compute Network Admin' },
    ]),
    ...shared(['load-balancing'], [
      { id: 'roles/compute.viewer', label: 'Compute Viewer' },
      { id: 'roles/compute.loadBalancerAdmin', label: 'Load Balancer Admin' },
      { id: 'roles/compute.networkAdmin', label: 'Compute Network Admin' },
    ]),
    ...shared(['logging', 'audit-logs'], [
      { id: 'roles/logging.viewer', label: 'Logs Viewer' },
      { id: 'roles/logging.logWriter', label: 'Logs Writer' },
      { id: 'roles/logging.configWriter', label: 'Logs Configuration Writer' },
      { id: 'roles/logging.admin', label: 'Logging Admin' },
    ]),
    ...shared(['monitoring'], [
      { id: 'roles/monitoring.viewer', label: 'Monitoring Viewer' },
      { id: 'roles/monitoring.metricWriter', label: 'Monitoring Metric Writer' },
      { id: 'roles/monitoring.editor', label: 'Monitoring Editor' },
      { id: 'roles/monitoring.admin', label: 'Monitoring Admin' },
    ]),
    ...shared(['dataflow'], [
      { id: 'roles/dataflow.viewer', label: 'Dataflow Viewer' },
      { id: 'roles/dataflow.worker', label: 'Dataflow Worker' },
      { id: 'roles/dataflow.developer', label: 'Dataflow Developer' },
      { id: 'roles/dataflow.admin', label: 'Dataflow Admin' },
    ]),
    ...shared(['pubsub'], [
      { id: 'roles/pubsub.viewer', label: 'Pub/Sub Viewer' },
      { id: 'roles/pubsub.publisher', label: 'Pub/Sub Publisher' },
      { id: 'roles/pubsub.subscriber', label: 'Pub/Sub Subscriber' },
      { id: 'roles/pubsub.editor', label: 'Pub/Sub Editor' },
      { id: 'roles/pubsub.admin', label: 'Pub/Sub Admin' },
    ]),
    ...shared(['artifact-registry'], [
      { id: 'roles/artifactregistry.reader', label: 'Artifact Registry Reader' },
      { id: 'roles/artifactregistry.writer', label: 'Artifact Registry Writer' },
      { id: 'roles/artifactregistry.repoAdmin', label: 'Artifact Registry Repository Admin' },
      { id: 'roles/artifactregistry.admin', label: 'Artifact Registry Admin' },
    ]),
    ...shared(['project'], [
      { id: 'roles/viewer', label: 'Viewer' },
      { id: 'roles/editor', label: 'Editor' },
      { id: 'roles/owner', label: 'Owner' },
      { id: 'roles/resourcemanager.projectIamAdmin', label: 'Project IAM Admin' },
    ]),
    ...shared(['organization', 'folders'], [
      { id: 'roles/iam.securityReviewer', label: 'Security Reviewer' },
      { id: 'roles/resourcemanager.projectIamAdmin', label: 'Project IAM Admin' },
    ]),
    ...shared(['iam', 'iam-roles', 'role-bindings', 'service-accounts', 'groups', 'cloud-identity-users'], [
      { id: 'roles/iam.securityReviewer', label: 'Security Reviewer' },
      { id: 'roles/resourcemanager.projectIamAdmin', label: 'Project IAM Admin' },
    ]),
    ...shared(['organization-policy'], [
      { id: 'roles/iam.securityReviewer', label: 'Security Reviewer' },
    ]),
    ...shared(['billing-budgets', 'billing-reports'], [
      { id: 'roles/viewer', label: 'Viewer' },
    ]),
  },
  aws: {
    ...shared(['ec2', 'auto-scaling'], [
      { id: 'AmazonEC2ReadOnlyAccess', label: 'AmazonEC2ReadOnlyAccess' },
      { id: 'AmazonEC2FullAccess', label: 'AmazonEC2FullAccess' },
    ]),
    ...shared(['eks'], [
      { id: 'AmazonEKSClusterPolicy', label: 'AmazonEKSClusterPolicy' },
    ]),
    ...shared(['lambda'], [
      { id: 'AWSLambda_ReadOnlyAccess', label: 'AWSLambda_ReadOnlyAccess' },
      { id: 'AWSLambda_FullAccess', label: 'AWSLambda_FullAccess' },
    ]),
    ...shared(['app-runner', 'fargate', 'ecs'], [
      { id: 'AWSAppRunnerFullAccess', label: 'AWSAppRunnerFullAccess' },
    ]),
    ...shared(['s3'], [
      { id: 'AmazonS3ReadOnlyAccess', label: 'AmazonS3ReadOnlyAccess' },
      { id: 'AmazonS3FullAccess', label: 'AmazonS3FullAccess' },
    ]),
    ...shared(['rds', 'aurora'], [
      { id: 'AmazonRDSReadOnlyAccess', label: 'AmazonRDSReadOnlyAccess' },
      { id: 'AmazonRDSFullAccess', label: 'AmazonRDSFullAccess' },
    ]),
    ...shared(['efs', 'fsx'], [
      { id: 'AmazonElasticFileSystemReadOnlyAccess', label: 'AmazonElasticFileSystemReadOnlyAccess' },
      { id: 'AmazonElasticFileSystemFullAccess', label: 'AmazonElasticFileSystemFullAccess' },
    ]),
    ...shared(['redshift', 'athena'], [
      { id: 'AmazonRedshiftReadOnlyAccess', label: 'AmazonRedshiftReadOnlyAccess' },
      { id: 'AmazonRedshiftFullAccess', label: 'AmazonRedshiftFullAccess' },
    ]),
    ...shared(['vpc', 'security-groups', 'network-acls', 'route-tables', 'internet-gateway', 'nat-gateway', 'transit-gateway', 'direct-connect', 'site-to-site-vpn', 'privatelink'], [
      { id: 'AmazonVPCReadOnlyAccess', label: 'AmazonVPCReadOnlyAccess' },
      { id: 'AmazonVPCFullAccess', label: 'AmazonVPCFullAccess' },
    ]),
    ...shared(['elastic-load-balancing'], [
      { id: 'AWSElasticLoadBalancingReadOnly', label: 'AWSElasticLoadBalancingReadOnly' },
      { id: 'AWSElasticLoadBalancingFullAccess', label: 'AWSElasticLoadBalancingFullAccess' },
    ]),
    ...shared(['waf', 'shield'], [
      { id: 'AWSWAFReadOnlyAccess', label: 'AWSWAFReadOnlyAccess' },
      { id: 'AWSWAFFullAccess', label: 'AWSWAFFullAccess' },
    ]),
    ...shared(['cloudwatch-logs'], [
      { id: 'CloudWatchLogsReadOnlyAccess', label: 'CloudWatchLogsReadOnlyAccess' },
      { id: 'CloudWatchLogsFullAccess', label: 'CloudWatchLogsFullAccess' },
    ]),
    ...shared(['cloudwatch'], [
      { id: 'CloudWatchReadOnlyAccess', label: 'CloudWatchReadOnlyAccess' },
      { id: 'CloudWatchFullAccess', label: 'CloudWatchFullAccess' },
    ]),
    ...shared(['glue', 'managed-flink'], [
      { id: 'AWSGlueConsoleFullAccess', label: 'AWSGlueConsoleFullAccess' },
    ]),
    ...shared(['sns', 'eventbridge'], [
      { id: 'AmazonSNSFullAccess', label: 'AmazonSNSFullAccess' },
    ]),
    ...shared(['sqs', 'kinesis'], [
      { id: 'AmazonSQSFullAccess', label: 'AmazonSQSFullAccess' },
    ]),
    ...shared(['ecr'], [
      { id: 'AmazonEC2ContainerRegistryReadOnly', label: 'AmazonEC2ContainerRegistryReadOnly' },
      { id: 'AmazonEC2ContainerRegistryFullAccess', label: 'AmazonEC2ContainerRegistryFullAccess' },
    ]),
    ...shared(['cloudtrail'], [
      { id: 'SecurityAudit', label: 'SecurityAudit' },
    ]),
    ...shared(['budgets', 'cost-explorer'], [
      { id: 'Billing', label: 'Billing' },
    ]),
    ...shared(['iam', 'iam-users', 'iam-groups', 'iam-roles', 'iam-policies'], [
      { id: 'SecurityAudit', label: 'SecurityAudit' },
    ]),
    ...shared(['account', 'organizations', 'organizational-units'], [
      { id: 'ReadOnlyAccess', label: 'ReadOnlyAccess' },
    ]),
  },
  azure: {
    ...shared(['virtual-machines', 'vm-scale-sets'], [
      { id: 'Reader', label: 'Reader' },
      { id: 'Virtual Machine Contributor', label: 'Virtual Machine Contributor' },
      { id: 'Virtual Machine Administrator Login', label: 'Virtual Machine Administrator Login' },
    ]),
    ...shared(['aks'], [
      { id: 'Azure Kubernetes Service Cluster User Role', label: 'Azure Kubernetes Service Cluster User Role' },
      { id: 'Azure Kubernetes Service Cluster Admin Role', label: 'Azure Kubernetes Service Cluster Admin Role' },
      { id: 'Azure Kubernetes Service Contributor Role', label: 'Azure Kubernetes Service Contributor Role' },
    ]),
    ...shared(['functions', 'app-service'], [
      { id: 'Reader', label: 'Reader' },
      { id: 'Website Contributor', label: 'Website Contributor' },
      { id: 'Contributor', label: 'Contributor' },
    ]),
    ...shared(['container-apps'], [
      { id: 'Reader', label: 'Reader' },
      { id: 'Container Apps Contributor', label: 'Container Apps Contributor' },
    ]),
    ...shared(['storage-account'], [
      { id: 'Storage Blob Data Reader', label: 'Storage Blob Data Reader' },
      { id: 'Storage Blob Data Contributor', label: 'Storage Blob Data Contributor' },
      { id: 'Storage Blob Data Owner', label: 'Storage Blob Data Owner' },
    ]),
    ...shared(['sql', 'postgresql'], [
      { id: 'Reader', label: 'Reader' },
      { id: 'SQL DB Contributor', label: 'SQL DB Contributor' },
      { id: 'SQL Server Contributor', label: 'SQL Server Contributor' },
    ]),
    ...shared(['files', 'netapp-files'], [
      { id: 'Storage File Data SMB Share Reader', label: 'Storage File Data SMB Share Reader' },
      { id: 'Storage File Data SMB Share Contributor', label: 'Storage File Data SMB Share Contributor' },
    ]),
    ...shared(['synapse'], [
      { id: 'Synapse SQL Administrator', label: 'Synapse SQL Administrator' },
      { id: 'Synapse Administrator', label: 'Synapse Administrator' },
      { id: 'Synapse Contributor', label: 'Synapse Contributor' },
    ]),
    ...shared(['network-security-groups', 'firewall', 'waf'], [
      { id: 'Network Security Group Contributor', label: 'Network Security Group Contributor' },
      { id: 'WAF Reader', label: 'WAF Reader' },
      { id: 'WAF Policy Contributor', label: 'WAF Policy Contributor' },
      { id: 'Network Contributor', label: 'Network Contributor' },
    ]),
    ...shared(['virtual-network', 'route-tables', 'nat-gateway', 'virtual-wan', 'expressroute', 'vpn-gateway', 'private-link', 'dns'], [
      { id: 'Reader', label: 'Reader' },
      { id: 'Network Contributor', label: 'Network Contributor' },
    ]),
    ...shared(['load-balancer'], [
      { id: 'Load Balancer Contributor', label: 'Load Balancer Contributor' },
    ]),
    ...shared(['application-gateway', 'front-door'], [
      { id: 'Application Gateway Contributor', label: 'Application Gateway Contributor' },
    ]),
    ...shared(['monitor-logs', 'activity-log'], [
      { id: 'Log Analytics Reader', label: 'Log Analytics Reader' },
      { id: 'Log Analytics Contributor', label: 'Log Analytics Contributor' },
      { id: 'Monitoring Reader', label: 'Monitoring Reader' },
    ]),
    ...shared(['monitor'], [
      { id: 'Monitoring Reader', label: 'Monitoring Reader' },
      { id: 'Monitoring Metrics Publisher', label: 'Monitoring Metrics Publisher' },
      { id: 'Monitoring Contributor', label: 'Monitoring Contributor' },
    ]),
    ...shared(['data-factory'], [
      { id: 'Data Factory Contributor', label: 'Data Factory Contributor' },
    ]),
    ...shared(['stream-analytics'], [
      { id: 'Stream Analytics Contributor', label: 'Stream Analytics Contributor' },
    ]),
    ...shared(['service-bus', 'event-hubs'], [
      { id: 'Azure Service Bus Data Receiver', label: 'Azure Service Bus Data Receiver' },
      { id: 'Azure Service Bus Data Sender', label: 'Azure Service Bus Data Sender' },
      { id: 'Azure Service Bus Data Owner', label: 'Azure Service Bus Data Owner' },
    ]),
    ...shared(['event-grid'], [
      { id: 'EventGrid Contributor', label: 'EventGrid Contributor' },
    ]),
    ...shared(['container-registry'], [
      { id: 'AcrPull', label: 'AcrPull' },
      { id: 'AcrPush', label: 'AcrPush' },
      { id: 'Container Registry Repository Contributor', label: 'Container Registry Repository Contributor' },
    ]),
    ...shared(['tenant', 'entra-id'], [
      { id: 'Global Administrator', label: 'Global Administrator' },
    ]),
    ...shared(['subscription'], [
      { id: 'Reader', label: 'Reader' },
      { id: 'Contributor', label: 'Contributor' },
      { id: 'Owner', label: 'Owner' },
    ]),
    ...shared(['management-groups', 'landing-zones'], [
      { id: 'Management Group Reader', label: 'Management Group Reader' },
      { id: 'Management Group Contributor', label: 'Management Group Contributor' },
    ]),
    ...shared(['resource-groups'], [
      { id: 'Reader', label: 'Reader' },
      { id: 'Resource Group Contributor', label: 'Resource Group Contributor' },
    ]),
    ...shared(['entra-users'], [
      { id: 'User Administrator', label: 'User Administrator' },
    ]),
    ...shared(['entra-groups'], [
      { id: 'Directory Readers', label: 'Directory Readers' },
      { id: 'Groups Administrator', label: 'Groups Administrator' },
    ]),
    ...shared(['service-principal'], [
      { id: 'Cloud Application Administrator', label: 'Cloud Application Administrator' },
      { id: 'Application Administrator', label: 'Application Administrator' },
    ]),
    ...shared(['managed-identities'], [
      { id: 'Managed Identity Contributor', label: 'Managed Identity Contributor' },
    ]),
    ...shared(['rbac', 'role-assignments', 'custom-roles'], [
      { id: 'User Access Administrator', label: 'User Access Administrator' },
      { id: 'Role Based Access Control Administrator', label: 'Role Based Access Control Administrator' },
    ]),
    ...shared(['policy', 'resource-locks'], [
      { id: 'Policy Contributor', label: 'Policy Contributor' },
      { id: 'Resource Policy Contributor', label: 'Resource Policy Contributor' },
    ]),
    ...shared(['budgets', 'cost-management'], [
      { id: 'Cost Management Contributor', label: 'Cost Management Contributor' },
      { id: 'Billing Administrator', label: 'Billing Administrator' },
    ]),
  },
};

export function servicesForCloud(cloud: string): CloudService[] {
  return CLOUD_SERVICES[cloud.toLowerCase()] || [];
}

export function serviceLabel(cloud: string, id: string): string {
  return servicesForCloud(cloud).find((item) => item.id === id)?.label || id;
}

export function permissionsForService(cloud: string, serviceId: string): ServicePermission[] {
  if (!serviceId) return [];
  const key = cloud.toLowerCase();
  const specific = SERVICE_PERMISSIONS[key]?.[serviceId] || [];
  const common = COMMON_PERMISSIONS[key] || [];
  const seen = new Set<string>();
  return [...specific, ...common].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
