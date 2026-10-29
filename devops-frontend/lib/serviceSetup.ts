export type ServiceSetupStepKey = 'owner' | 'repository' | 'environment' | 'monitoring' | 'oncall';

export type ServiceSetupFields = {
  id?: number;
  service?: string;
  team?: string;
  repo?: string;
  environment?: string;
  project_id?: number;
  grafana_uid?: string;
  dashboard_url?: string;
  metrics_url?: string;
  promql?: string;
  runbook_url?: string;
  support_team?: string;
  escalation_route?: string;
};

export type ServiceSetupStep = {
  key: ServiceSetupStepKey;
  label: string;
  detail: string;
  done: boolean;
  mandatory: boolean;
  href: string;
  actionLabel: string;
};

export type ServiceSetupOptional = {
  key: string;
  label: string;
  done: boolean;
  href: string;
};

function assigned(value?: string): string {
  return (value || '').trim();
}

export function serviceHasOwner(item: ServiceSetupFields): boolean {
  const team = assigned(item.team);
  return Boolean(team) && team.toLowerCase() !== 'unknown';
}

export function serviceHasRepo(item: ServiceSetupFields): boolean {
  return Boolean(assigned(item.repo));
}

export function serviceHasEnvironment(item: ServiceSetupFields): boolean {
  const value = assigned(item.environment).toLowerCase();
  return Boolean(value) && value !== 'unspecified' && value !== 'unknown';
}

export function serviceHasMonitoring(item: ServiceSetupFields): boolean {
  return Boolean(assigned(item.grafana_uid) || assigned(item.dashboard_url) || assigned(item.metrics_url) || assigned(item.promql));
}

export function serviceNeedsSetup(item: ServiceSetupFields, onCallReady = true): boolean {
  return !serviceHasOwner(item) || !serviceHasRepo(item) || !serviceHasEnvironment(item) || !serviceHasMonitoring(item) || !onCallReady;
}

export function buildServiceSetupSteps(item: ServiceSetupFields, onCallReady = false): ServiceSetupStep[] {
  const id = item.id || 0;
  const projectId = item.project_id || 0;
  const base = id ? `/services/${id}` : '/services/new';
  return [
    {
      key: 'owner',
      label: 'Owner / team',
      detail: serviceHasOwner(item) ? assigned(item.team) : 'Assign the service owner team',
      done: serviceHasOwner(item),
      mandatory: true,
      href: id ? `${base}?tab=configuration&focus=owner` : base,
      actionLabel: 'Assign owner',
    },
    {
      key: 'repository',
      label: 'Repository',
      detail: serviceHasRepo(item) ? assigned(item.repo) : 'Connect the source repository',
      done: serviceHasRepo(item),
      mandatory: true,
      href: id ? `${base}?tab=configuration&focus=repo` : base,
      actionLabel: 'Connect repository',
    },
    {
      key: 'environment',
      label: 'Environment',
      detail: serviceHasEnvironment(item) ? 'Production' : 'Record the monitored environment',
      done: serviceHasEnvironment(item),
      mandatory: true,
      href: id ? `${base}?tab=configuration` : base,
      actionLabel: 'Set environment',
    },
    {
      key: 'monitoring',
      label: 'Monitoring',
      detail: serviceHasMonitoring(item) ? 'Dashboard or metrics linked' : 'Link a dashboard or metrics endpoint',
      done: serviceHasMonitoring(item),
      mandatory: true,
      href: id ? `${base}?tab=configuration&focus=monitoring` : base,
      actionLabel: 'Link monitoring',
    },
    {
      key: 'oncall',
      label: 'On-call',
      detail: onCallReady ? 'Project teams are on the roster' : 'Assign on-call coverage for this project',
      done: onCallReady,
      mandatory: true,
      href: projectId ? `/on-call/onboard?project_id=${projectId}` : '/on-call/onboard',
      actionLabel: 'Assign on-call',
    },
  ];
}

export function buildServiceSetupOptional(item: ServiceSetupFields): ServiceSetupOptional[] {
  const id = item.id || 0;
  const name = encodeURIComponent(assigned(item.service));
  return [
    {
      key: 'runbook',
      label: 'Runbook',
      done: Boolean(assigned(item.runbook_url)),
      href: id ? `/services/${id}?tab=configuration&focus=runbook` : '/runbooks/new',
    },
    {
      key: 'support',
      label: 'Support and escalation',
      done: Boolean(assigned(item.support_team) || assigned(item.escalation_route)),
      href: id ? `/services/${id}?tab=configuration&focus=support` : '/services/new',
    },
    {
      key: 'jira',
      label: 'Jira project mapping',
      done: false,
      href: '/integrations/jira',
    },
    {
      key: 'certificates',
      label: 'Certificates and domains',
      done: false,
      href: name ? `/certificates/new?service=${name}` : '/certificates/new',
    },
  ];
}
