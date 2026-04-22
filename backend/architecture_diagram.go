package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// architectureDiagramJob is one submitted diagram + generated Terraform artifact.
type architectureDiagramJob struct {
	ID                  int                         `json:"id"`
	ProjectName         string                      `json:"project_name"`
	Environment         string                      `json:"environment"`
	Cloud               string                      `json:"cloud"`
	Region              string                      `json:"region"`
	DueDate             *string                     `json:"due_date,omitempty"`
	Notes               string                      `json:"notes"`
	ImageFilename       string                      `json:"image_filename"`
	ImageMime           string                      `json:"image_mime"`
	ImageSize           int                         `json:"image_size"`
	ImageBucket         string                      `json:"image_bucket,omitempty"`
	ImageObjectKey      string                      `json:"image_object_key,omitempty"`
	ImageURL            string                      `json:"image_url,omitempty"`
	DetectedComponents  []architectureComponent     `json:"detected_components"`
	DetectionSource     string                      `json:"detection_source"`
	TerraformCode       string                      `json:"terraform_code"`
	Status              string                      `json:"status"`
	CreatedBy           *int                        `json:"created_by,omitempty"`
	CreatedByUsername   string                      `json:"created_by_username,omitempty"`
	CreatedAt           time.Time                   `json:"created_at"`
	UpdatedAt           time.Time                   `json:"updated_at"`
}

type architectureComponent struct {
	Kind       string            `json:"kind"`
	Name       string            `json:"name"`
	Label      string            `json:"label"`
	Properties map[string]string `json:"properties,omitempty"`
}

var validArchitectureClouds = map[string]bool{"aws": true, "azure": true, "gcp": true}
var validArchitectureEnvs = map[string]bool{"dev": true, "staging": true, "prod": true, "qa": true}
var architectureComponentKinds = []string{"vpc", "load_balancer", "database", "compute", "cache", "queue", "storage", "cdn", "dns"}

// normalizeArchitectureCloud lowercases and validates.
func normalizeArchitectureCloud(raw string) (string, bool) {
	c := strings.ToLower(strings.TrimSpace(raw))
	if validArchitectureClouds[c] {
		return c, true
	}
	return "", false
}

func normalizeArchitectureEnv(raw string) (string, bool) {
	e := strings.ToLower(strings.TrimSpace(raw))
	if validArchitectureEnvs[e] {
		return e, true
	}
	return "", false
}

// detectArchitectureComponentsFromHints looks at the filename + notes + optional hints
// to decide which infra components are present in the diagram. This keeps the
// feature fully working even when no external Vision LLM is configured.
// If OPENAI_API_KEY is set we could augment with a real vision call, but we
// keep a deterministic baseline so the UX always produces useful output.
func detectArchitectureComponentsFromHints(filename, notes string, hints []string) ([]architectureComponent, string) {
	haystack := strings.ToLower(filename + " " + notes)
	for _, h := range hints {
		haystack += " " + strings.ToLower(h)
	}

	has := func(keywords ...string) bool {
		for _, k := range keywords {
			if strings.Contains(haystack, k) {
				return true
			}
		}
		return false
	}

	components := []architectureComponent{}
	add := func(kind, name, label string, props map[string]string) {
		components = append(components, architectureComponent{Kind: kind, Name: name, Label: label, Properties: props})
	}

	// VPC / network is almost always required; default to true unless obviously a
	// serverless-only diagram.
	if has("vpc", "network", "subnet", "cidr") || !has("only lambda", "lambda only", "functions only") {
		add("vpc", "main", "Primary VPC", map[string]string{"cidr": "10.0.0.0/16"})
	}

	if has("alb", "elb", "load balancer", "load-balancer", "loadbalancer", "nginx", "traffic manager", "app gateway", "application gateway", "front door", "cloud load balancing") {
		add("load_balancer", "app_lb", "Application Load Balancer", map[string]string{"scheme": "internet-facing"})
	}

	if has("rds", "postgres", "postgresql", "mysql", "aurora", "sql", "database", "db", "cloud sql", "spanner", "cosmos", "dynamo", "dynamodb") {
		engine := "postgres"
		if has("mysql") {
			engine = "mysql"
		}
		add("database", "primary_db", "Primary relational DB", map[string]string{"engine": engine, "size": "db.t3.medium"})
	}

	if has("ec2", "vm", "gce", "compute engine", "app server", "ecs", "fargate", "eks", "aks", "gke", "kubernetes", "container") {
		add("compute", "app_compute", "Application compute", map[string]string{"count": "2"})
	}

	if has("redis", "elasticache", "memcached", "cache", "cloud memorystore") {
		add("cache", "app_cache", "In-memory cache", map[string]string{"engine": "redis"})
	}

	if has("sqs", "queue", "kafka", "sns", "pub/sub", "pubsub", "service bus", "event hub", "event grid") {
		add("queue", "app_queue", "Message queue", map[string]string{"type": "standard"})
	}

	if has("s3", "blob", "gcs", "bucket", "object storage") {
		add("storage", "app_storage", "Object storage bucket", nil)
	}

	if has("cloudfront", "cdn", "cloud cdn", "akamai", "fastly") {
		add("cdn", "app_cdn", "Edge CDN", nil)
	}

	if has("route53", "route 53", "dns", "cloud dns") {
		add("dns", "app_dns", "Managed DNS", nil)
	}

	// If nothing was matched apart from VPC, add a sensible starter trio so the
	// first-time experience still produces a working Terraform.
	if len(components) <= 1 {
		add("load_balancer", "app_lb", "Application Load Balancer", map[string]string{"scheme": "internet-facing"})
		add("database", "primary_db", "Primary relational DB", map[string]string{"engine": "postgres", "size": "db.t3.medium"})
	}

	return components, "heuristic"
}

// mergeArchitectureComponents lets the UI override/append detected components before saving.
func mergeArchitectureComponents(detected, overrides []architectureComponent) []architectureComponent {
	if len(overrides) == 0 {
		return detected
	}
	byKind := make(map[string]architectureComponent)
	for _, c := range detected {
		byKind[c.Kind+"::"+c.Name] = c
	}
	for _, c := range overrides {
		byKind[c.Kind+"::"+c.Name] = c
	}
	result := make([]architectureComponent, 0, len(byKind))
	for _, c := range byKind {
		result = append(result, c)
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Kind == result[j].Kind {
			return result[i].Name < result[j].Name
		}
		return result[i].Kind < result[j].Kind
	})
	return result
}

// terraformIdentifier returns a safe HCL identifier fragment.
func terraformIdentifier(raw string) string {
	re := regexp.MustCompile(`[^a-zA-Z0-9_]+`)
	id := re.ReplaceAllString(strings.ToLower(strings.TrimSpace(raw)), "_")
	id = strings.Trim(id, "_")
	if id == "" {
		id = "resource"
	}
	if id[0] >= '0' && id[0] <= '9' {
		id = "r_" + id
	}
	return id
}

// generateTerraformForJob produces HCL using the chosen cloud + detected components.
// The output is wired end-to-end: VPC -> subnets -> security groups -> LB -> compute -> DB.
func generateTerraformForJob(projectName, environment, cloud, region string, components []architectureComponent) string {
	projectID := terraformIdentifier(projectName)
	envID := terraformIdentifier(environment)
	namePrefix := fmt.Sprintf("%s-%s", projectID, envID)

	has := func(kind string) bool {
		for _, c := range components {
			if c.Kind == kind {
				return true
			}
		}
		return false
	}
	find := func(kind string) *architectureComponent {
		for i := range components {
			if components[i].Kind == kind {
				return &components[i]
			}
		}
		return nil
	}
	propOr := func(c *architectureComponent, key, fallback string) string {
		if c == nil {
			return fallback
		}
		if v, ok := c.Properties[key]; ok && strings.TrimSpace(v) != "" {
			return v
		}
		return fallback
	}

	if region == "" {
		switch cloud {
		case "aws":
			region = "us-east-1"
		case "azure":
			region = "eastus"
		case "gcp":
			region = "us-central1"
		}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# Auto-generated from architecture diagram\n# project: %s  env: %s  cloud: %s\n\n", projectName, environment, cloud)
	fmt.Fprintf(&b, "terraform {\n  required_version = \">= 1.5.0\"\n  required_providers {\n")

	switch cloud {
	case "aws":
		b.WriteString("    aws = {\n      source  = \"hashicorp/aws\"\n      version = \"~> 5.0\"\n    }\n")
	case "azure":
		b.WriteString("    azurerm = {\n      source  = \"hashicorp/azurerm\"\n      version = \"~> 3.100\"\n    }\n")
	case "gcp":
		b.WriteString("    google = {\n      source  = \"hashicorp/google\"\n      version = \"~> 5.0\"\n    }\n")
	}
	b.WriteString("  }\n}\n\n")

	fmt.Fprintf(&b, "locals {\n  project     = \"%s\"\n  environment = \"%s\"\n  name_prefix = \"%s\"\n  common_tags = {\n    Project     = local.project\n    Environment = local.environment\n    ManagedBy   = \"setuops-diagram-generator\"\n  }\n}\n\n", projectID, envID, namePrefix)

	switch cloud {
	case "aws":
		fmt.Fprintf(&b, "provider \"aws\" {\n  region = \"%s\"\n}\n\n", region)

		if has("vpc") {
			vpc := find("vpc")
			cidr := propOr(vpc, "cidr", "10.0.0.0/16")
			b.WriteString("resource \"aws_vpc\" \"main\" {\n")
			fmt.Fprintf(&b, "  cidr_block           = \"%s\"\n", cidr)
			b.WriteString("  enable_dns_hostnames = true\n  enable_dns_support   = true\n  tags = merge(local.common_tags, { Name = \"${local.name_prefix}-vpc\" })\n}\n\n")

			b.WriteString("resource \"aws_internet_gateway\" \"main\" {\n  vpc_id = aws_vpc.main.id\n  tags   = merge(local.common_tags, { Name = \"${local.name_prefix}-igw\" })\n}\n\n")

			b.WriteString("data \"aws_availability_zones\" \"available\" { state = \"available\" }\n\n")

			b.WriteString("resource \"aws_subnet\" \"public\" {\n  count                   = 2\n  vpc_id                  = aws_vpc.main.id\n  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 4, count.index)\n  availability_zone       = data.aws_availability_zones.available.names[count.index]\n  map_public_ip_on_launch = true\n  tags                    = merge(local.common_tags, { Name = \"${local.name_prefix}-public-${count.index}\" })\n}\n\n")

			b.WriteString("resource \"aws_subnet\" \"private\" {\n  count             = 2\n  vpc_id            = aws_vpc.main.id\n  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 4, count.index + 8)\n  availability_zone = data.aws_availability_zones.available.names[count.index]\n  tags              = merge(local.common_tags, { Name = \"${local.name_prefix}-private-${count.index}\" })\n}\n\n")

			b.WriteString("resource \"aws_route_table\" \"public\" {\n  vpc_id = aws_vpc.main.id\n  route {\n    cidr_block = \"0.0.0.0/0\"\n    gateway_id = aws_internet_gateway.main.id\n  }\n  tags = merge(local.common_tags, { Name = \"${local.name_prefix}-public-rt\" })\n}\n\nresource \"aws_route_table_association\" \"public\" {\n  count          = length(aws_subnet.public)\n  subnet_id      = aws_subnet.public[count.index].id\n  route_table_id = aws_route_table.public.id\n}\n\n")
		}

		if has("load_balancer") {
			b.WriteString("resource \"aws_security_group\" \"lb\" {\n  name        = \"${local.name_prefix}-lb-sg\"\n  description = \"Allow HTTP/HTTPS to the load balancer\"\n  vpc_id      = aws_vpc.main.id\n\n  ingress {\n    from_port   = 80\n    to_port     = 80\n    protocol    = \"tcp\"\n    cidr_blocks = [\"0.0.0.0/0\"]\n  }\n  ingress {\n    from_port   = 443\n    to_port     = 443\n    protocol    = \"tcp\"\n    cidr_blocks = [\"0.0.0.0/0\"]\n  }\n  egress {\n    from_port   = 0\n    to_port     = 0\n    protocol    = \"-1\"\n    cidr_blocks = [\"0.0.0.0/0\"]\n  }\n  tags = merge(local.common_tags, { Name = \"${local.name_prefix}-lb-sg\" })\n}\n\n")

			b.WriteString("resource \"aws_lb\" \"app\" {\n  name               = \"${local.name_prefix}-alb\"\n  internal           = false\n  load_balancer_type = \"application\"\n  security_groups    = [aws_security_group.lb.id]\n  subnets            = aws_subnet.public[*].id\n  tags               = merge(local.common_tags, { Name = \"${local.name_prefix}-alb\" })\n}\n\nresource \"aws_lb_target_group\" \"app\" {\n  name        = \"${local.name_prefix}-tg\"\n  port        = 80\n  protocol    = \"HTTP\"\n  vpc_id      = aws_vpc.main.id\n  target_type = \"instance\"\n  health_check {\n    path                = \"/\"\n    matcher             = \"200-399\"\n    interval            = 30\n    timeout             = 5\n    healthy_threshold   = 2\n    unhealthy_threshold = 3\n  }\n}\n\nresource \"aws_lb_listener\" \"http\" {\n  load_balancer_arn = aws_lb.app.arn\n  port              = 80\n  protocol          = \"HTTP\"\n  default_action {\n    type             = \"forward\"\n    target_group_arn = aws_lb_target_group.app.arn\n  }\n}\n\n")
		}

		if has("compute") {
			comp := find("compute")
			count := propOr(comp, "count", "2")
			b.WriteString("resource \"aws_security_group\" \"app\" {\n  name   = \"${local.name_prefix}-app-sg\"\n  vpc_id = aws_vpc.main.id\n\n  ingress {\n    from_port       = 80\n    to_port         = 80\n    protocol        = \"tcp\"\n    security_groups = [aws_security_group.lb.id]\n  }\n  egress {\n    from_port   = 0\n    to_port     = 0\n    protocol    = \"-1\"\n    cidr_blocks = [\"0.0.0.0/0\"]\n  }\n  tags = merge(local.common_tags, { Name = \"${local.name_prefix}-app-sg\" })\n}\n\ndata \"aws_ami\" \"amzn2\" {\n  most_recent = true\n  owners      = [\"amazon\"]\n  filter {\n    name   = \"name\"\n    values = [\"amzn2-ami-hvm-*-x86_64-gp2\"]\n  }\n}\n\n")
			fmt.Fprintf(&b, "resource \"aws_instance\" \"app\" {\n  count                  = %s\n  ami                    = data.aws_ami.amzn2.id\n  instance_type          = \"t3.micro\"\n  subnet_id              = aws_subnet.private[count.index %% length(aws_subnet.private)].id\n  vpc_security_group_ids = [aws_security_group.app.id]\n  tags                   = merge(local.common_tags, { Name = \"${local.name_prefix}-app-${count.index}\" })\n}\n\nresource \"aws_lb_target_group_attachment\" \"app\" {\n  count            = length(aws_instance.app)\n  target_group_arn = aws_lb_target_group.app.arn\n  target_id        = aws_instance.app[count.index].id\n  port             = 80\n}\n\n", count)
		}

		if has("database") {
			db := find("database")
			engine := propOr(db, "engine", "postgres")
			size := propOr(db, "size", "db.t3.medium")
			b.WriteString("resource \"aws_security_group\" \"db\" {\n  name   = \"${local.name_prefix}-db-sg\"\n  vpc_id = aws_vpc.main.id\n  ingress {\n    from_port       = 5432\n    to_port         = 5432\n    protocol        = \"tcp\"\n    security_groups = [aws_security_group.app.id]\n  }\n  egress {\n    from_port   = 0\n    to_port     = 0\n    protocol    = \"-1\"\n    cidr_blocks = [\"0.0.0.0/0\"]\n  }\n  tags = merge(local.common_tags, { Name = \"${local.name_prefix}-db-sg\" })\n}\n\nresource \"aws_db_subnet_group\" \"primary\" {\n  name       = \"${local.name_prefix}-db-subnets\"\n  subnet_ids = aws_subnet.private[*].id\n  tags       = local.common_tags\n}\n\n")
			fmt.Fprintf(&b, "resource \"aws_db_instance\" \"primary\" {\n  identifier             = \"${local.name_prefix}-db\"\n  engine                 = \"%s\"\n  instance_class         = \"%s\"\n  allocated_storage      = 20\n  db_subnet_group_name   = aws_db_subnet_group.primary.name\n  vpc_security_group_ids = [aws_security_group.db.id]\n  skip_final_snapshot    = true\n  username               = \"admin\"\n  password               = var.db_password\n  publicly_accessible    = false\n  tags                   = merge(local.common_tags, { Name = \"${local.name_prefix}-db\" })\n}\n\nvariable \"db_password\" {\n  type        = string\n  description = \"Master password for the primary database\"\n  sensitive   = true\n}\n\n", engine, size)
		}

		if has("cache") {
			b.WriteString("resource \"aws_elasticache_subnet_group\" \"cache\" {\n  name       = \"${local.name_prefix}-cache-subnets\"\n  subnet_ids = aws_subnet.private[*].id\n}\n\nresource \"aws_elasticache_cluster\" \"cache\" {\n  cluster_id           = \"${local.name_prefix}-cache\"\n  engine               = \"redis\"\n  node_type            = \"cache.t3.micro\"\n  num_cache_nodes      = 1\n  subnet_group_name    = aws_elasticache_subnet_group.cache.name\n  tags                 = local.common_tags\n}\n\n")
		}
		if has("queue") {
			b.WriteString("resource \"aws_sqs_queue\" \"app\" {\n  name                      = \"${local.name_prefix}-queue\"\n  message_retention_seconds = 86400\n  tags                      = local.common_tags\n}\n\n")
		}
		if has("storage") {
			b.WriteString("resource \"aws_s3_bucket\" \"app\" {\n  bucket = \"${local.name_prefix}-storage\"\n  tags   = local.common_tags\n}\n\nresource \"aws_s3_bucket_public_access_block\" \"app\" {\n  bucket                  = aws_s3_bucket.app.id\n  block_public_acls       = true\n  block_public_policy     = true\n  ignore_public_acls      = true\n  restrict_public_buckets = true\n}\n\n")
		}
		if has("cdn") {
			b.WriteString("resource \"aws_cloudfront_distribution\" \"app\" {\n  enabled             = true\n  default_root_object = \"index.html\"\n  origin {\n    domain_name = aws_lb.app.dns_name\n    origin_id   = \"alb-origin\"\n    custom_origin_config {\n      http_port              = 80\n      https_port             = 443\n      origin_protocol_policy = \"http-only\"\n      origin_ssl_protocols   = [\"TLSv1.2\"]\n    }\n  }\n  default_cache_behavior {\n    target_origin_id       = \"alb-origin\"\n    viewer_protocol_policy = \"redirect-to-https\"\n    allowed_methods        = [\"GET\", \"HEAD\"]\n    cached_methods         = [\"GET\", \"HEAD\"]\n    forwarded_values {\n      query_string = true\n      cookies { forward = \"none\" }\n    }\n  }\n  restrictions { geo_restriction { restriction_type = \"none\" } }\n  viewer_certificate { cloudfront_default_certificate = true }\n  tags = local.common_tags\n}\n\n")
		}
		if has("dns") {
			b.WriteString("# Provide the hosted zone name via var.hosted_zone_name to enable DNS records.\nvariable \"hosted_zone_name\" {\n  type    = string\n  default = \"\"\n}\n\ndata \"aws_route53_zone\" \"primary\" {\n  count = var.hosted_zone_name == \"\" ? 0 : 1\n  name  = var.hosted_zone_name\n}\n\nresource \"aws_route53_record\" \"app\" {\n  count   = length(data.aws_route53_zone.primary)\n  zone_id = data.aws_route53_zone.primary[0].zone_id\n  name    = \"${local.name_prefix}.${var.hosted_zone_name}\"\n  type    = \"A\"\n  alias {\n    name                   = aws_lb.app.dns_name\n    zone_id                = aws_lb.app.zone_id\n    evaluate_target_health = true\n  }\n}\n\n")
		}

		if has("load_balancer") {
			b.WriteString("output \"load_balancer_dns\" { value = aws_lb.app.dns_name }\n")
		}
		if has("database") {
			b.WriteString("output \"database_endpoint\" { value = aws_db_instance.primary.address }\n")
		}

	case "azure":
		fmt.Fprintf(&b, "provider \"azurerm\" {\n  features {}\n}\n\nresource \"azurerm_resource_group\" \"main\" {\n  name     = \"${local.name_prefix}-rg\"\n  location = \"%s\"\n  tags     = local.common_tags\n}\n\n", region)

		if has("vpc") {
			vpc := find("vpc")
			cidr := propOr(vpc, "cidr", "10.0.0.0/16")
			fmt.Fprintf(&b, "resource \"azurerm_virtual_network\" \"main\" {\n  name                = \"${local.name_prefix}-vnet\"\n  address_space       = [\"%s\"]\n  location            = azurerm_resource_group.main.location\n  resource_group_name = azurerm_resource_group.main.name\n  tags                = local.common_tags\n}\n\nresource \"azurerm_subnet\" \"app\" {\n  name                 = \"${local.name_prefix}-app-subnet\"\n  resource_group_name  = azurerm_resource_group.main.name\n  virtual_network_name = azurerm_virtual_network.main.name\n  address_prefixes     = [cidrsubnet(\"%s\", 8, 1)]\n}\n\nresource \"azurerm_subnet\" \"db\" {\n  name                 = \"${local.name_prefix}-db-subnet\"\n  resource_group_name  = azurerm_resource_group.main.name\n  virtual_network_name = azurerm_virtual_network.main.name\n  address_prefixes     = [cidrsubnet(\"%s\", 8, 2)]\n  service_endpoints    = [\"Microsoft.Sql\"]\n}\n\n", cidr, cidr, cidr)
		}

		if has("load_balancer") {
			b.WriteString("resource \"azurerm_public_ip\" \"lb\" {\n  name                = \"${local.name_prefix}-lb-pip\"\n  location            = azurerm_resource_group.main.location\n  resource_group_name = azurerm_resource_group.main.name\n  allocation_method   = \"Static\"\n  sku                 = \"Standard\"\n  tags                = local.common_tags\n}\n\nresource \"azurerm_lb\" \"app\" {\n  name                = \"${local.name_prefix}-lb\"\n  location            = azurerm_resource_group.main.location\n  resource_group_name = azurerm_resource_group.main.name\n  sku                 = \"Standard\"\n  frontend_ip_configuration {\n    name                 = \"frontend\"\n    public_ip_address_id = azurerm_public_ip.lb.id\n  }\n  tags = local.common_tags\n}\n\nresource \"azurerm_lb_backend_address_pool\" \"app\" {\n  loadbalancer_id = azurerm_lb.app.id\n  name            = \"backend-pool\"\n}\n\n")
		}
		if has("database") {
			b.WriteString("resource \"azurerm_postgresql_flexible_server\" \"primary\" {\n  name                   = \"${local.name_prefix}-pg\"\n  resource_group_name    = azurerm_resource_group.main.name\n  location               = azurerm_resource_group.main.location\n  version                = \"14\"\n  administrator_login    = \"pgadmin\"\n  administrator_password = var.db_password\n  storage_mb             = 32768\n  sku_name               = \"B_Standard_B1ms\"\n  tags                   = local.common_tags\n}\n\nvariable \"db_password\" {\n  type        = string\n  description = \"PostgreSQL administrator password\"\n  sensitive   = true\n}\n\n")
		}
		if has("compute") {
			comp := find("compute")
			count := propOr(comp, "count", "2")
			fmt.Fprintf(&b, "resource \"azurerm_linux_virtual_machine_scale_set\" \"app\" {\n  name                = \"${local.name_prefix}-vmss\"\n  resource_group_name = azurerm_resource_group.main.name\n  location            = azurerm_resource_group.main.location\n  sku                 = \"Standard_B2s\"\n  instances           = %s\n  admin_username      = \"azureuser\"\n  disable_password_authentication = false\n  admin_password      = var.vmss_password\n  source_image_reference {\n    publisher = \"Canonical\"\n    offer     = \"0001-com-ubuntu-server-jammy\"\n    sku       = \"22_04-lts\"\n    version   = \"latest\"\n  }\n  os_disk {\n    storage_account_type = \"Standard_LRS\"\n    caching              = \"ReadWrite\"\n  }\n  network_interface {\n    name    = \"primary\"\n    primary = true\n    ip_configuration {\n      name      = \"primary\"\n      primary   = true\n      subnet_id = azurerm_subnet.app.id\n      load_balancer_backend_address_pool_ids = [azurerm_lb_backend_address_pool.app.id]\n    }\n  }\n  tags = local.common_tags\n}\n\nvariable \"vmss_password\" {\n  type      = string\n  sensitive = true\n}\n\n", count)
		}
		if has("storage") {
			b.WriteString("resource \"azurerm_storage_account\" \"app\" {\n  name                     = replace(\"${local.name_prefix}stg\", \"-\", \"\")\n  resource_group_name      = azurerm_resource_group.main.name\n  location                 = azurerm_resource_group.main.location\n  account_tier             = \"Standard\"\n  account_replication_type = \"LRS\"\n  tags                     = local.common_tags\n}\n\n")
		}

	case "gcp":
		fmt.Fprintf(&b, "provider \"google\" {\n  project = var.gcp_project\n  region  = \"%s\"\n}\n\nvariable \"gcp_project\" { type = string }\n\n", region)

		if has("vpc") {
			b.WriteString("resource \"google_compute_network\" \"main\" {\n  name                    = \"${local.name_prefix}-vpc\"\n  auto_create_subnetworks = false\n}\n\nresource \"google_compute_subnetwork\" \"app\" {\n  name          = \"${local.name_prefix}-app-subnet\"\n  ip_cidr_range = \"10.0.1.0/24\"\n  region        = var.region\n  network       = google_compute_network.main.id\n}\n\nvariable \"region\" {\n  type    = string\n  default = \"" + region + "\"\n}\n\n")
		}

		if has("load_balancer") {
			b.WriteString("resource \"google_compute_global_address\" \"lb\" {\n  name = \"${local.name_prefix}-lb-ip\"\n}\n\nresource \"google_compute_health_check\" \"app\" {\n  name = \"${local.name_prefix}-hc\"\n  http_health_check { port = 80 }\n}\n\nresource \"google_compute_backend_service\" \"app\" {\n  name          = \"${local.name_prefix}-backend\"\n  health_checks = [google_compute_health_check.app.id]\n  protocol      = \"HTTP\"\n  load_balancing_scheme = \"EXTERNAL\"\n}\n\nresource \"google_compute_url_map\" \"app\" {\n  name            = \"${local.name_prefix}-url-map\"\n  default_service = google_compute_backend_service.app.id\n}\n\nresource \"google_compute_target_http_proxy\" \"app\" {\n  name    = \"${local.name_prefix}-http-proxy\"\n  url_map = google_compute_url_map.app.id\n}\n\nresource \"google_compute_global_forwarding_rule\" \"app\" {\n  name       = \"${local.name_prefix}-forwarding\"\n  target     = google_compute_target_http_proxy.app.id\n  port_range = \"80\"\n  ip_address = google_compute_global_address.lb.address\n}\n\n")
		}
		if has("database") {
			b.WriteString("resource \"google_sql_database_instance\" \"primary\" {\n  name             = \"${local.name_prefix}-sql\"\n  database_version = \"POSTGRES_14\"\n  region           = var.region\n  settings {\n    tier = \"db-f1-micro\"\n  }\n  deletion_protection = false\n}\n\nresource \"google_sql_user\" \"app\" {\n  name     = \"appuser\"\n  instance = google_sql_database_instance.primary.name\n  password = var.db_password\n}\n\nvariable \"db_password\" {\n  type      = string\n  sensitive = true\n}\n\n")
		}
		if has("compute") {
			b.WriteString("resource \"google_compute_instance_template\" \"app\" {\n  name_prefix  = \"${local.name_prefix}-tmpl-\"\n  machine_type = \"e2-small\"\n  disk {\n    source_image = \"debian-cloud/debian-12\"\n    auto_delete  = true\n    boot         = true\n  }\n  network_interface {\n    subnetwork = google_compute_subnetwork.app.id\n    access_config {}\n  }\n  lifecycle { create_before_destroy = true }\n}\n\nresource \"google_compute_region_instance_group_manager\" \"app\" {\n  name               = \"${local.name_prefix}-mig\"\n  base_instance_name = \"${local.name_prefix}-app\"\n  region             = var.region\n  version {\n    instance_template = google_compute_instance_template.app.id\n  }\n  target_size = 2\n}\n\n")
		}
		if has("storage") {
			b.WriteString("resource \"google_storage_bucket\" \"app\" {\n  name     = \"${var.gcp_project}-${local.name_prefix}-storage\"\n  location = var.region\n  uniform_bucket_level_access = true\n}\n\n")
		}
	}

	return b.String()
}

// --- Persistence helpers ---

func saveArchitectureDiagramJob(createdBy int, job architectureDiagramJob) (architectureDiagramJob, error) {
	if DB == nil {
		return job, fmt.Errorf("database not initialized")
	}
	compBytes, err := json.Marshal(job.DetectedComponents)
	if err != nil {
		return job, fmt.Errorf("encode components: %w", err)
	}
	var dueDate sql.NullString
	if job.DueDate != nil && strings.TrimSpace(*job.DueDate) != "" {
		dueDate = sql.NullString{String: strings.TrimSpace(*job.DueDate), Valid: true}
	}
	row := DB.QueryRow(`
		INSERT INTO architecture_diagram_jobs
			(project_name, environment, cloud, region, due_date, notes,
			 image_filename, image_mime, image_size,
			 image_bucket, image_object_key, image_url,
			 detected_components, detection_source, terraform_code,
			 status, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)
		RETURNING id, created_at, updated_at
	`,
		job.ProjectName, job.Environment, job.Cloud, job.Region, dueDate, job.Notes,
		job.ImageFilename, job.ImageMime, job.ImageSize,
		job.ImageBucket, job.ImageObjectKey, job.ImageURL,
		string(compBytes), job.DetectionSource, job.TerraformCode,
		job.Status, createdBy,
	)
	if err := row.Scan(&job.ID, &job.CreatedAt, &job.UpdatedAt); err != nil {
		return job, fmt.Errorf("insert architecture job: %w", err)
	}
	job.CreatedBy = &createdBy
	return job, nil
}

func listArchitectureDiagramJobs() ([]architectureDiagramJob, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	rows, err := DB.Query(`
		SELECT j.id, j.project_name, j.environment, j.cloud, j.region,
			j.due_date, j.notes, j.image_filename, j.image_mime, j.image_size,
			j.image_bucket, j.image_object_key, j.image_url,
			COALESCE(j.detected_components::text, '[]'), j.detection_source,
			j.terraform_code, j.status, j.created_by,
			COALESCE(u.username, ''), j.created_at, j.updated_at
		FROM architecture_diagram_jobs j
		LEFT JOIN users u ON u.id = j.created_by
		ORDER BY j.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []architectureDiagramJob{}
	for rows.Next() {
		var (
			job      architectureDiagramJob
			dueDate  sql.NullString
			compStr  string
			username string
			createdBy sql.NullInt64
		)
		if err := rows.Scan(&job.ID, &job.ProjectName, &job.Environment, &job.Cloud, &job.Region,
			&dueDate, &job.Notes, &job.ImageFilename, &job.ImageMime, &job.ImageSize,
			&job.ImageBucket, &job.ImageObjectKey, &job.ImageURL,
			&compStr, &job.DetectionSource, &job.TerraformCode, &job.Status, &createdBy,
			&username, &job.CreatedAt, &job.UpdatedAt); err != nil {
			return nil, err
		}
		if dueDate.Valid {
			v := dueDate.String
			job.DueDate = &v
		}
		if createdBy.Valid {
			id := int(createdBy.Int64)
			job.CreatedBy = &id
		}
		job.CreatedByUsername = username
		_ = json.Unmarshal([]byte(compStr), &job.DetectedComponents)
		if job.DetectedComponents == nil {
			job.DetectedComponents = []architectureComponent{}
		}
		out = append(out, job)
	}
	return out, rows.Err()
}

func getArchitectureDiagramJob(id int) (*architectureDiagramJob, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	row := DB.QueryRow(`
		SELECT j.id, j.project_name, j.environment, j.cloud, j.region,
			j.due_date, j.notes, j.image_filename, j.image_mime, j.image_size,
			j.image_bucket, j.image_object_key, j.image_url,
			COALESCE(j.detected_components::text, '[]'), j.detection_source,
			j.terraform_code, j.status, j.created_by,
			COALESCE(u.username, ''), j.created_at, j.updated_at
		FROM architecture_diagram_jobs j
		LEFT JOIN users u ON u.id = j.created_by
		WHERE j.id = $1
	`, id)
	var (
		job       architectureDiagramJob
		dueDate   sql.NullString
		compStr   string
		username  string
		createdBy sql.NullInt64
	)
	if err := row.Scan(&job.ID, &job.ProjectName, &job.Environment, &job.Cloud, &job.Region,
		&dueDate, &job.Notes, &job.ImageFilename, &job.ImageMime, &job.ImageSize,
		&job.ImageBucket, &job.ImageObjectKey, &job.ImageURL,
		&compStr, &job.DetectionSource, &job.TerraformCode, &job.Status, &createdBy,
		&username, &job.CreatedAt, &job.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if dueDate.Valid {
		v := dueDate.String
		job.DueDate = &v
	}
	if createdBy.Valid {
		id := int(createdBy.Int64)
		job.CreatedBy = &id
	}
	job.CreatedByUsername = username
	_ = json.Unmarshal([]byte(compStr), &job.DetectedComponents)
	if job.DetectedComponents == nil {
		job.DetectedComponents = []architectureComponent{}
	}
	return &job, nil
}

func deleteArchitectureDiagramJob(id int) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	_, err := DB.Exec(`DELETE FROM architecture_diagram_jobs WHERE id = $1`, id)
	return err
}

// updateArchitectureDiagramJob persists changes to an existing job. Every
// column that can be edited through the UI is set explicitly – callers are
// expected to merge the updated values onto the previously-loaded job.
func updateArchitectureDiagramJob(job architectureDiagramJob) (architectureDiagramJob, error) {
	if DB == nil {
		return job, fmt.Errorf("database not initialized")
	}
	compBytes, err := json.Marshal(job.DetectedComponents)
	if err != nil {
		return job, fmt.Errorf("marshal components: %w", err)
	}
	var dueDate sql.NullString
	if job.DueDate != nil && strings.TrimSpace(*job.DueDate) != "" {
		dueDate = sql.NullString{String: strings.TrimSpace(*job.DueDate), Valid: true}
	}
	row := DB.QueryRow(`
		UPDATE architecture_diagram_jobs SET
			project_name = $1,
			environment = $2,
			cloud = $3,
			region = $4,
			due_date = $5,
			notes = $6,
			image_filename = $7,
			image_mime = $8,
			image_size = $9,
			image_bucket = $10,
			image_object_key = $11,
			image_url = $12,
			detected_components = $13::jsonb,
			detection_source = $14,
			terraform_code = $15,
			status = $16,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $17
		RETURNING updated_at
	`,
		job.ProjectName, job.Environment, job.Cloud, job.Region, dueDate, job.Notes,
		job.ImageFilename, job.ImageMime, job.ImageSize,
		job.ImageBucket, job.ImageObjectKey, job.ImageURL,
		string(compBytes), job.DetectionSource, job.TerraformCode,
		job.Status, job.ID,
	)
	if err := row.Scan(&job.UpdatedAt); err != nil {
		return job, fmt.Errorf("update architecture job: %w", err)
	}
	return job, nil
}

// --- HTTP handlers ---

// devopsArchitectureDiagramRouter routes /api/devops/architecture-diagram(/id).
func devopsArchitectureDiagramRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeDevopsJSON(w, map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")

	path := strings.TrimPrefix(r.URL.Path, "/api/devops/architecture-diagram")
	path = strings.Trim(path, "/")

	if path == "" {
		switch r.Method {
		case "GET":
			jobs, err := listArchitectureDiagramJobs()
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				encodeDevopsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
				return
			}
			encodeDevopsJSON(w, map[string]interface{}{"jobs": jobs, "status": "ok"})
			return
		case "POST":
			handleArchitectureDiagramCreate(w, r, userID)
			return
		default:
			writeMethodNotAllowed(w, r)
			return
		}
	}

	// /:id  or  /:id/image
	segments := strings.Split(path, "/")
	id, convErr := strconv.Atoi(segments[0])
	if convErr != nil || id <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]interface{}{"error": "invalid job id", "status": "error"})
		return
	}

	if len(segments) >= 2 && segments[1] == "image" {
		if r.Method != "GET" {
			writeMethodNotAllowed(w, r)
			return
		}
		serveArchitectureDiagramImage(w, r, id)
		return
	}

	switch r.Method {
	case "GET":
		job, err := getArchitectureDiagramJob(id)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			encodeDevopsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		if job == nil {
			w.WriteHeader(http.StatusNotFound)
			encodeDevopsJSON(w, map[string]interface{}{"error": "job not found", "status": "error"})
			return
		}
		encodeDevopsJSON(w, map[string]interface{}{"job": job, "status": "ok"})
	case "PATCH", "PUT":
		handleArchitectureDiagramUpdate(w, r, id)
	case "DELETE":
		job, _ := getArchitectureDiagramJob(id)
		if err := deleteArchitectureDiagramJob(id); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			encodeDevopsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
			return
		}
		if job != nil && job.ImageObjectKey != "" {
			_ = DeleteDiagramFromSupabase(r.Context(), job.ImageObjectKey)
		}
		encodeDevopsJSON(w, map[string]interface{}{"status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

// serveArchitectureDiagramImage proxies the stored diagram from Supabase Storage
// back to the authenticated DevOps user. The storage credentials never leave the
// backend, and the bucket can stay private.
func serveArchitectureDiagramImage(w http.ResponseWriter, r *http.Request, id int) {
	job, err := getArchitectureDiagramJob(id)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if job == nil || job.ImageObjectKey == "" {
		w.WriteHeader(http.StatusNotFound)
		encodeDevopsJSON(w, map[string]interface{}{"error": "image not available", "status": "error"})
		return
	}
	body, ct, size, err := DownloadDiagramFromSupabase(r.Context(), job.ImageObjectKey)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		encodeDevopsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	defer body.Close()
	if ct == "" {
		ct = job.ImageMime
	}
	if ct == "" {
		ct = guessMimeFromFilename(job.ImageFilename)
	}
	w.Header().Set("Content-Type", ct)
	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = io.Copy(w, body)
}

// handleArchitectureDiagramCreate parses multipart form with image + metadata,
// runs detection, generates Terraform, and persists the job.
func handleArchitectureDiagramCreate(w http.ResponseWriter, r *http.Request, userID int) {
	const maxSize = 12 << 20 // 12MB cap for uploaded diagram
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)

	contentType := r.Header.Get("Content-Type")
	var (
		projectName  string
		environment  string
		cloud        string
		region       string
		dueDate      string
		notes        string
		hintsRaw     string
		overridesRaw string
		filename     string
		mime         string
		imageSize    int
		imageBytes   []byte
	)

	if strings.HasPrefix(contentType, "multipart/") {
		if err := r.ParseMultipartForm(maxSize); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "invalid form: " + err.Error(), "status": "error"})
			return
		}
		projectName = r.FormValue("project_name")
		environment = r.FormValue("environment")
		cloud = r.FormValue("cloud")
		region = r.FormValue("region")
		dueDate = r.FormValue("due_date")
		notes = r.FormValue("notes")
		hintsRaw = r.FormValue("component_hints")
		overridesRaw = r.FormValue("component_overrides")

		file, header, err := r.FormFile("diagram")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "diagram file is required", "status": "error"})
			return
		}
		defer file.Close()
		body, err := io.ReadAll(file)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "failed to read diagram: " + err.Error(), "status": "error"})
			return
		}
		imageSize = len(body)
		imageBytes = body
		filename = filepath.Base(header.Filename)
		mime = header.Header.Get("Content-Type")
		if mime == "" {
			mime = guessMimeFromFilename(filename)
		}
	} else {
		// JSON fallback (no image) - allows regenerate-style flow.
		var body struct {
			ProjectName        string                  `json:"project_name"`
			Environment        string                  `json:"environment"`
			Cloud              string                  `json:"cloud"`
			Region             string                  `json:"region"`
			DueDate            string                  `json:"due_date"`
			Notes              string                  `json:"notes"`
			ComponentHints     []string                `json:"component_hints"`
			ComponentOverrides []architectureComponent `json:"component_overrides"`
			Filename           string                  `json:"filename"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		projectName = body.ProjectName
		environment = body.Environment
		cloud = body.Cloud
		region = body.Region
		dueDate = body.DueDate
		notes = body.Notes
		hintsRaw = strings.Join(body.ComponentHints, ",")
		if len(body.ComponentOverrides) > 0 {
			if b, err := json.Marshal(body.ComponentOverrides); err == nil {
				overridesRaw = string(b)
			}
		}
		filename = body.Filename
		if filename == "" {
			filename = "diagram.png"
		}
	}

	projectName = strings.TrimSpace(projectName)
	environment = strings.TrimSpace(environment)
	region = strings.TrimSpace(region)
	notes = strings.TrimSpace(notes)
	if projectName == "" {
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]interface{}{"error": "project_name required", "status": "error"})
		return
	}
	envNormalized, ok := normalizeArchitectureEnv(environment)
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]interface{}{"error": "environment must be dev|staging|prod|qa", "status": "error"})
		return
	}
	cloudNormalized, ok := normalizeArchitectureCloud(cloud)
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]interface{}{"error": "cloud must be aws|azure|gcp", "status": "error"})
		return
	}

	hints := []string{}
	for _, piece := range strings.FieldsFunc(hintsRaw, func(r rune) bool { return r == ',' || r == '\n' }) {
		if s := strings.TrimSpace(piece); s != "" {
			hints = append(hints, s)
		}
	}

	var overrides []architectureComponent
	if strings.TrimSpace(overridesRaw) != "" {
		if err := json.Unmarshal([]byte(overridesRaw), &overrides); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "component_overrides must be a JSON array", "status": "error"})
			return
		}
	}

	detected, source := detectArchitectureComponentsFromHints(filename, notes, hints)
	components := mergeArchitectureComponents(detected, overrides)
	terraform := generateTerraformForJob(projectName, envNormalized, cloudNormalized, region, components)

	var dueDatePtr *string
	if s := strings.TrimSpace(dueDate); s != "" {
		dueDatePtr = &s
	}

	var (
		storedBucket    string
		storedObjectKey string
		storedURL       string
	)
	if len(imageBytes) > 0 && supabaseStorageConfigured() {
		key, publicURL, uploadErr := UploadDiagramToSupabase(r.Context(), projectName, envNormalized, filename, mime, imageBytes)
		if uploadErr != nil {
			w.WriteHeader(http.StatusBadGateway)
			encodeDevopsJSON(w, map[string]interface{}{"error": "supabase storage upload failed: " + uploadErr.Error(), "status": "error"})
			return
		}
		storedBucket = supabaseStorageConfig.Bucket
		storedObjectKey = key
		storedURL = publicURL
	}

	job := architectureDiagramJob{
		ProjectName:        projectName,
		Environment:        envNormalized,
		Cloud:              cloudNormalized,
		Region:             region,
		DueDate:            dueDatePtr,
		Notes:              notes,
		ImageFilename:      filename,
		ImageMime:          mime,
		ImageSize:          imageSize,
		ImageBucket:        storedBucket,
		ImageObjectKey:     storedObjectKey,
		ImageURL:           storedURL,
		DetectedComponents: components,
		DetectionSource:    source,
		TerraformCode:      terraform,
		Status:             "analyzed",
	}

	saved, err := saveArchitectureDiagramJob(userID, job)
	if err != nil {
		if storedObjectKey != "" {
			_ = DeleteDiagramFromSupabase(r.Context(), storedObjectKey)
		}
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	encodeDevopsJSON(w, map[string]interface{}{"job": saved, "status": "ok"})
}

// handleArchitectureDiagramUpdate accepts PATCH/PUT to edit an existing job.
// Any field not provided keeps its previous value. A new diagram image is
// optional; when supplied it replaces the stored object. Terraform is
// regenerated from the (possibly updated) metadata and components.
func handleArchitectureDiagramUpdate(w http.ResponseWriter, r *http.Request, id int) {
	existing, err := getArchitectureDiagramJob(id)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}
	if existing == nil {
		w.WriteHeader(http.StatusNotFound)
		encodeDevopsJSON(w, map[string]interface{}{"error": "job not found", "status": "error"})
		return
	}

	const maxSize = 12 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)

	// Snapshot presence via pointers so we only overwrite fields the caller sent.
	var (
		projectNamePtr *string
		environmentPtr *string
		cloudPtr       *string
		regionPtr      *string
		dueDatePtr     *string
		notesPtr       *string
		statusPtr      *string
		hintsProvided  bool
		hintsRaw       string
		overridesRaw   string
		imageBytes     []byte
		imageFilename  string
		imageMime      string
	)

	contentType := r.Header.Get("Content-Type")
	setStr := func(dst **string, raw string, ok bool) {
		if !ok {
			return
		}
		s := raw
		*dst = &s
	}

	if strings.HasPrefix(contentType, "multipart/") {
		if err := r.ParseMultipartForm(maxSize); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "invalid form: " + err.Error(), "status": "error"})
			return
		}
		form := r.MultipartForm
		if form != nil {
			_, ok := form.Value["project_name"]
			setStr(&projectNamePtr, r.FormValue("project_name"), ok)
			_, ok = form.Value["environment"]
			setStr(&environmentPtr, r.FormValue("environment"), ok)
			_, ok = form.Value["cloud"]
			setStr(&cloudPtr, r.FormValue("cloud"), ok)
			_, ok = form.Value["region"]
			setStr(&regionPtr, r.FormValue("region"), ok)
			_, ok = form.Value["due_date"]
			setStr(&dueDatePtr, r.FormValue("due_date"), ok)
			_, ok = form.Value["notes"]
			setStr(&notesPtr, r.FormValue("notes"), ok)
			_, ok = form.Value["status"]
			setStr(&statusPtr, r.FormValue("status"), ok)
			if _, ok := form.Value["component_hints"]; ok {
				hintsProvided = true
				hintsRaw = r.FormValue("component_hints")
			}
			if _, ok := form.Value["component_overrides"]; ok {
				overridesRaw = r.FormValue("component_overrides")
			}
		}
		if file, header, err := r.FormFile("diagram"); err == nil {
			defer file.Close()
			body, readErr := io.ReadAll(file)
			if readErr != nil {
				w.WriteHeader(http.StatusBadRequest)
				encodeDevopsJSON(w, map[string]interface{}{"error": "failed to read diagram: " + readErr.Error(), "status": "error"})
				return
			}
			imageBytes = body
			imageFilename = filepath.Base(header.Filename)
			imageMime = header.Header.Get("Content-Type")
			if imageMime == "" {
				imageMime = guessMimeFromFilename(imageFilename)
			}
		}
	} else {
		var body struct {
			ProjectName        *string                 `json:"project_name"`
			Environment        *string                 `json:"environment"`
			Cloud              *string                 `json:"cloud"`
			Region             *string                 `json:"region"`
			DueDate            *string                 `json:"due_date"`
			Notes              *string                 `json:"notes"`
			Status             *string                 `json:"status"`
			ComponentHints     *[]string               `json:"component_hints"`
			ComponentOverrides []architectureComponent `json:"component_overrides"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "invalid json", "status": "error"})
			return
		}
		projectNamePtr = body.ProjectName
		environmentPtr = body.Environment
		cloudPtr = body.Cloud
		regionPtr = body.Region
		dueDatePtr = body.DueDate
		notesPtr = body.Notes
		statusPtr = body.Status
		if body.ComponentHints != nil {
			hintsProvided = true
			hintsRaw = strings.Join(*body.ComponentHints, ",")
		}
		if len(body.ComponentOverrides) > 0 {
			if b, err := json.Marshal(body.ComponentOverrides); err == nil {
				overridesRaw = string(b)
			}
		}
	}

	// Apply the patch on top of the existing job.
	updated := *existing

	if projectNamePtr != nil {
		v := strings.TrimSpace(*projectNamePtr)
		if v == "" {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "project_name cannot be empty", "status": "error"})
			return
		}
		updated.ProjectName = v
	}
	if environmentPtr != nil {
		env, ok := normalizeArchitectureEnv(*environmentPtr)
		if !ok {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "environment must be dev|staging|prod|qa", "status": "error"})
			return
		}
		updated.Environment = env
	}
	if cloudPtr != nil {
		c, ok := normalizeArchitectureCloud(*cloudPtr)
		if !ok {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "cloud must be aws|azure|gcp", "status": "error"})
			return
		}
		updated.Cloud = c
	}
	if regionPtr != nil {
		updated.Region = strings.TrimSpace(*regionPtr)
	}
	if dueDatePtr != nil {
		v := strings.TrimSpace(*dueDatePtr)
		if v == "" {
			updated.DueDate = nil
		} else {
			updated.DueDate = &v
		}
	}
	if notesPtr != nil {
		updated.Notes = strings.TrimSpace(*notesPtr)
	}
	if statusPtr != nil {
		s := strings.TrimSpace(*statusPtr)
		if s != "" {
			updated.Status = s
		}
	}

	// Replace image if a new one was uploaded.
	previousObjectKey := updated.ImageObjectKey
	imageReplaced := false
	if len(imageBytes) > 0 {
		if !supabaseStorageConfigured() {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "supabase storage not configured – cannot replace diagram", "status": "error"})
			return
		}
		key, publicURL, uploadErr := UploadDiagramToSupabase(r.Context(), updated.ProjectName, updated.Environment, imageFilename, imageMime, imageBytes)
		if uploadErr != nil {
			w.WriteHeader(http.StatusBadGateway)
			encodeDevopsJSON(w, map[string]interface{}{"error": "supabase storage upload failed: " + uploadErr.Error(), "status": "error"})
			return
		}
		updated.ImageBucket = supabaseStorageConfig.Bucket
		updated.ImageObjectKey = key
		updated.ImageURL = publicURL
		updated.ImageFilename = imageFilename
		updated.ImageMime = imageMime
		updated.ImageSize = len(imageBytes)
		imageReplaced = true
	}

	// Recompute components:
	//   - explicit overrides (if supplied) always win
	//   - otherwise, re-run detection when hints/notes/image changed
	//   - else keep whatever was previously stored.
	var overrides []architectureComponent
	if strings.TrimSpace(overridesRaw) != "" {
		if err := json.Unmarshal([]byte(overridesRaw), &overrides); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]interface{}{"error": "component_overrides must be a JSON array", "status": "error"})
			return
		}
	}

	hints := []string{}
	if hintsProvided {
		for _, piece := range strings.FieldsFunc(hintsRaw, func(r rune) bool { return r == ',' || r == '\n' }) {
			if s := strings.TrimSpace(piece); s != "" {
				hints = append(hints, s)
			}
		}
	}

	shouldRedetect := hintsProvided || imageReplaced || notesPtr != nil || len(overrides) > 0
	if shouldRedetect {
		detected, source := detectArchitectureComponentsFromHints(updated.ImageFilename, updated.Notes, hints)
		components := mergeArchitectureComponents(detected, overrides)
		updated.DetectedComponents = components
		updated.DetectionSource = source
	}

	// Always regenerate Terraform so project/env/cloud/region changes propagate.
	updated.TerraformCode = generateTerraformForJob(updated.ProjectName, updated.Environment, updated.Cloud, updated.Region, updated.DetectedComponents)

	saved, err := updateArchitectureDiagramJob(updated)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	// Best-effort: if the image was replaced, remove the stale object.
	if imageReplaced && previousObjectKey != "" && previousObjectKey != saved.ImageObjectKey {
		_ = DeleteDiagramFromSupabase(r.Context(), previousObjectKey)
	}

	encodeDevopsJSON(w, map[string]interface{}{"job": saved, "status": "ok"})
}

func guessMimeFromFilename(name string) string {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(lower, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(lower, ".xml"), strings.HasSuffix(lower, ".drawio"):
		return "application/xml"
	default:
		return "application/octet-stream"
	}
}

// architectureComponentKindsResponse exposes the taxonomy used in the UI.
func architectureComponentKindsResponse() []map[string]string {
	out := make([]map[string]string, 0, len(architectureComponentKinds))
	for _, k := range architectureComponentKinds {
		out = append(out, map[string]string{"kind": k, "label": titleCaseWords(strings.ReplaceAll(k, "_", " "))})
	}
	return out
}

func titleCaseWords(s string) string {
	parts := strings.Fields(s)
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, " ")
}
