.DEFAULT_GOAL := help

GO ?= go
NPM ?= npm
DOCKER_COMPOSE ?= docker-compose
COMPOSE_ENV_FILE ?= config/.env
COMPOSE := $(DOCKER_COMPOSE) --env-file $(COMPOSE_ENV_FILE)
HELM ?= helm
HELM_RELEASE ?= infragate
HELM_NAMESPACE ?= infragate
HELM_CHART ?= ./helm/infragate
HELM_DEV_VALUES ?= $(HELM_CHART)/values-dev.yaml
HELM_UAT_VALUES ?= $(HELM_CHART)/values-uat.yaml
HELM_PROD_VALUES ?= $(HELM_CHART)/values-prod.yaml
HELM_ARGS ?=

.PHONY: help env-sync backend-deps backend-build backend-test backend-run \
	frontend-install frontend-build frontend-lint frontend-dev \
	admin-install admin-build admin-lint admin-dev \
	devops-install devops-build devops-lint devops-dev \
	install-all build-all lint-all test compose-dev compose-prod compose-down compose-logs compose-ps \
	helm-lint helm-template helm-install helm-upgrade helm-uninstall \
	helm-template-dev helm-template-uat helm-template-prod \
	helm-upgrade-dev helm-upgrade-uat helm-upgrade-prod

help: ## Show available commands
	@printf "\nInfraGate workspace commands\n\n"
	@awk '/^[a-zA-Z0-9_.-]+:.*## / {split($$0, parts, ":"); target = parts[1]; desc = $$0; sub(/^.*## /, "", desc); printf "  %-20s %s\n", target, desc}' $(MAKEFILE_LIST)

env-sync: ## Sync config/.env values for docker-compose consumption
	./scripts/sync-env.sh

backend-deps: ## Download and tidy backend Go modules
	$(MAKE) -C backend deps

backend-build: ## Build the backend binary
	$(MAKE) -C backend build

backend-test: ## Run backend tests
	$(MAKE) -C backend test

backend-run: ## Run the backend directly from source (loads ../config/.env)
	cd backend && $(GO) run .

frontend-install: ## Install user portal dependencies
	cd frontend && $(NPM) install

frontend-build: ## Build the user portal
	bash -lc 'set -a; [ -f config/.env ] && . ./config/.env; set +a; cd frontend && exec $(NPM) run build'

frontend-lint: ## Lint the user portal
	cd frontend && $(NPM) run lint

frontend-dev: ## Run the user portal locally
	bash -lc 'set -a; [ -f config/.env ] && . ./config/.env; set +a; cd frontend && exec $(NPM) run dev'

admin-install: ## Install admin portal dependencies
	cd admin-frontend && $(NPM) install

admin-build: ## Build the admin portal
	bash -lc 'set -a; [ -f config/.env ] && . ./config/.env; set +a; cd admin-frontend && exec $(NPM) run build'

admin-lint: ## Lint the admin portal
	cd admin-frontend && $(NPM) run lint

admin-dev: ## Run the admin portal locally
	bash -lc 'set -a; [ -f config/.env ] && . ./config/.env; set +a; cd admin-frontend && exec $(NPM) run dev'

devops-install: ## Install DevOps portal dependencies
	cd devops-frontend && $(NPM) install

devops-build: ## Build the DevOps portal
	bash -lc 'set -a; [ -f config/.env ] && . ./config/.env; set +a; cd devops-frontend && exec $(NPM) run build'

devops-lint: ## Lint the DevOps portal
	cd devops-frontend && $(NPM) run lint

devops-dev: ## Run the DevOps portal locally
	bash -lc 'set -a; [ -f config/.env ] && . ./config/.env; set +a; cd devops-frontend && exec $(NPM) run dev'

install-all: frontend-install admin-install devops-install ## Install dependencies for all frontends

build-all: backend-build frontend-build admin-build devops-build ## Build backend and all frontends

lint-all: frontend-lint admin-lint devops-lint ## Run lint across all frontends

test: backend-test ## Run the test suite that exists today

compose-dev: env-sync ## Start the development stack with docker-compose
	$(COMPOSE) --profile dev up -d --build

compose-prod: env-sync ## Start the production-like stack with docker-compose
	$(COMPOSE) --profile prod up -d --build

compose-down: ## Stop and remove docker-compose services
	$(COMPOSE) down

compose-logs: ## Tail docker-compose logs
	$(COMPOSE) logs -f

compose-ps: ## Show docker-compose service status
	$(COMPOSE) ps

helm-lint: ## Lint the Helm chart
	$(HELM) lint $(HELM_CHART)

helm-template: ## Render the Helm chart locally
	$(HELM) template $(HELM_RELEASE) $(HELM_CHART) --namespace $(HELM_NAMESPACE) $(HELM_ARGS)

helm-install: ## Install the Helm chart into Kubernetes
	$(HELM) install $(HELM_RELEASE) $(HELM_CHART) --namespace $(HELM_NAMESPACE) --create-namespace $(HELM_ARGS)

helm-upgrade: ## Upgrade or install the Helm chart into Kubernetes
	$(HELM) upgrade --install $(HELM_RELEASE) $(HELM_CHART) --namespace $(HELM_NAMESPACE) --create-namespace $(HELM_ARGS)

helm-uninstall: ## Remove the Helm release from Kubernetes
	$(HELM) uninstall $(HELM_RELEASE) --namespace $(HELM_NAMESPACE)

helm-template-dev: ## Render the dev Helm release locally
	$(MAKE) helm-template HELM_RELEASE=$(HELM_RELEASE)-dev HELM_NAMESPACE=$(HELM_NAMESPACE)-dev HELM_ARGS="-f $(HELM_DEV_VALUES) $(HELM_ARGS)"

helm-template-uat: ## Render the UAT Helm release locally
	$(MAKE) helm-template HELM_RELEASE=$(HELM_RELEASE)-uat HELM_NAMESPACE=$(HELM_NAMESPACE)-uat HELM_ARGS="-f $(HELM_UAT_VALUES) $(HELM_ARGS)"

helm-template-prod: ## Render the prod Helm release locally
	$(MAKE) helm-template HELM_RELEASE=$(HELM_RELEASE)-prod HELM_NAMESPACE=$(HELM_NAMESPACE)-prod HELM_ARGS="-f $(HELM_PROD_VALUES) $(HELM_ARGS)"

helm-upgrade-dev: ## Upgrade or install the dev Helm release
	$(MAKE) helm-upgrade HELM_RELEASE=$(HELM_RELEASE)-dev HELM_NAMESPACE=$(HELM_NAMESPACE)-dev HELM_ARGS="-f $(HELM_DEV_VALUES) $(HELM_ARGS)"

helm-upgrade-uat: ## Upgrade or install the UAT Helm release
	$(MAKE) helm-upgrade HELM_RELEASE=$(HELM_RELEASE)-uat HELM_NAMESPACE=$(HELM_NAMESPACE)-uat HELM_ARGS="-f $(HELM_UAT_VALUES) $(HELM_ARGS)"

helm-upgrade-prod: ## Upgrade or install the prod Helm release
	$(MAKE) helm-upgrade HELM_RELEASE=$(HELM_RELEASE)-prod HELM_NAMESPACE=$(HELM_NAMESPACE)-prod HELM_ARGS="-f $(HELM_PROD_VALUES) $(HELM_ARGS)"
