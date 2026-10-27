export type PortalAccount = {
  user_type?: string;
  role?: string;
  devops_profile?: { is_manager?: boolean } | null;
  grants?: Partial<PortalGrants> | null;
};

export type PortalGrants = {
  requests: boolean;
  daily: boolean;
  operations: boolean;
  cost: boolean;
  infrastructure: boolean;
  security: boolean;
  records: boolean;
  portalAccess: boolean;
  manager: boolean;
  pages?: Record<string, boolean> | null;
};

function allPortalGrants(): PortalGrants {
  return {
    requests: true,
    daily: true,
    operations: true,
    cost: true,
    infrastructure: true,
    security: true,
    records: true,
    portalAccess: true,
    manager: true,
  };
}

export function portalGrants(user: PortalAccount | null | undefined): PortalGrants {
  const admin = user?.role === 'admin';
  if (admin) return allPortalGrants();
  if (user?.grants) {
    const manager = Boolean(user.grants.manager) || Boolean(user.devops_profile?.is_manager);
    return {
      requests: Boolean(user.grants.requests),
      daily: Boolean(user.grants.daily),
      operations: Boolean(user.grants.operations),
      cost: Object.prototype.hasOwnProperty.call(user.grants, 'cost')
        ? Boolean(user.grants.cost)
        : Boolean(user.grants.operations) && user.grants.pages?.cost !== false,
      infrastructure: Boolean(user.grants.infrastructure),
      security: Boolean(user.grants.security),
      records: Boolean(user.grants.records),
      portalAccess: false,
      manager,
      pages: user.grants.pages || null,
    };
  }
  const devops = user?.user_type === 'devops_user';
  const manager = devops && Boolean(user?.devops_profile?.is_manager);
  return {
    requests: user?.user_type === 'portal_user',
    daily: devops,
    operations: devops,
    cost: devops,
    infrastructure: devops,
    security: devops,
    records: manager,
    portalAccess: false,
    manager,
  };
}

export function sessionAuthHeaders(): HeadersInit {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem('devops_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const PAGE_PATHS: { prefix: string; key: string }[] = [
  { prefix: '/iam', key: 'iam' },
  { prefix: '/k8s', key: 'kubernetes' },
  { prefix: '/projects', key: 'projects' },
  { prefix: '/environments', key: 'environments' },
  { prefix: '/cloud-accounts', key: 'cloud-accounts' },
  { prefix: '/cloud-resources', key: 'cloud-inventory' },
  { prefix: '/promotions', key: 'releases' },
  { prefix: '/dashboard', key: 'overview' },
  { prefix: '/my-work', key: 'my-work' },
  { prefix: '/service-desk', key: 'service-desk' },
  { prefix: '/incidents', key: 'incidents' },
  { prefix: '/changes', key: 'changes' },
  { prefix: '/change-calendar', key: 'changes' },
  { prefix: '/approval-center', key: 'tickets' },
  { prefix: '/approval-sla', key: 'tickets' },
  { prefix: '/deploy-intelligence', key: 'releases' },
  { prefix: '/gitops-projects', key: 'releases' },
  { prefix: '/gitops-control', key: 'releases' },
  { prefix: '/gate-approvals', key: 'releases' },
  { prefix: '/gate-policies', key: 'releases' },
  { prefix: '/problems', key: 'problems' },
  { prefix: '/tickets', key: 'tickets' },
  { prefix: '/knowledge', key: 'knowledge' },
  { prefix: '/services', key: 'services' },
  { prefix: '/slos', key: 'services' },
  { prefix: '/on-call', key: 'on-call' },
  { prefix: '/certificates', key: 'certificates' },
  { prefix: '/cost', key: 'cost' },
  { prefix: '/operations/webhooks', key: 'webhooks' },
  { prefix: '/maintenance', key: 'maintenance' },
  { prefix: '/reports-automation', key: 'reports' },
  { prefix: '/security/vulnerabilities', key: 'vulnerabilities' },
  { prefix: '/security/cloud-scan', key: 'cloud-scan' },
  { prefix: '/security/code-scan', key: 'vulnerabilities' },
  { prefix: '/security/findings', key: 'findings' },
  { prefix: '/credential-audit', key: 'secrets' },
  { prefix: '/previews', key: 'previews' },
  { prefix: '/scorecards', key: 'scorecards' },
  { prefix: '/evidence', key: 'evidence' },
  { prefix: '/templates', key: 'templates' },
  { prefix: '/my-projects', key: 'my-projects' },
  { prefix: '/my-teams', key: 'my-teams' },
  { prefix: '/my-requests', key: 'my-requests' },
];

export function pageKeyForPath(pathname: string): string {
  if (pathname === '/' ) return 'overview';
  if (pathname === '/requests/new' || pathname.startsWith('/requests/new/')) return 'new-request';
  if (pathname === '/requests' || pathname.startsWith('/requests/')) return 'my-requests';
  const match = PAGE_PATHS.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`));
  return match?.key || '';
}

function pageMap(pages: PortalGrants['pages']): Record<string, boolean> | null {
  if (!pages || typeof pages !== 'object' || Array.isArray(pages)) return null;
  return pages;
}

export function pageAllowed(pathname: string, grants: PortalGrants): boolean {
  const key = pageKeyForPath(pathname);
  const pages = pageMap(grants.pages);
  if (!key || !pages) return true;
  if (!(key in pages)) return true;
  return Boolean(pages[key]);
}

export function homeFor(grants: PortalGrants): string {
  if (grants.daily && pageAllowed('/dashboard', grants)) return '/dashboard';
  if (grants.requests && pageAllowed('/my-requests', grants)) return '/my-requests';
  if (grants.cost && pageAllowed('/cost', grants)) return '/cost';
  if (grants.operations && pageAllowed('/on-call', grants)) return '/on-call';
  if (grants.infrastructure && pageAllowed('/iam', grants)) return '/iam';
  if (grants.infrastructure && pageAllowed('/k8s', grants)) return '/k8s';
  if (grants.security && pageAllowed('/security/vulnerabilities', grants)) return '/security/vulnerabilities';
  if (grants.security && pageAllowed('/security/cloud-scan', grants)) return '/security/cloud-scan';
  if (grants.records && pageAllowed('/previews', grants)) return '/previews';
  if (grants.portalAccess) return '/portal-access';
  return '/profile';
}

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function pageOn(grants: PortalGrants, key: string, fallback: boolean): boolean {
  const pages = pageMap(grants.pages);
  if (!pages || !(key in pages)) return fallback;
  return Boolean(pages[key]);
}

export function pathAllowed(pathname: string, grants: PortalGrants): boolean {
  if (pathname === '/profile' || pathname.startsWith('/profile/')) return true;
  const prefixes: string[] = [];
  if (grants.requests) {
    if (pageOn(grants, 'my-requests', true)) prefixes.push('/my-requests', '/requests');
    if (pageOn(grants, 'new-request', true)) prefixes.push('/requests/new');
    if (pageOn(grants, 'my-projects', true)) prefixes.push('/my-projects');
    if (pageOn(grants, 'my-teams', true)) prefixes.push('/my-teams');
  }
  if (grants.daily) {
    if (pageOn(grants, 'overview', true)) prefixes.push('/dashboard');
    if (pageOn(grants, 'my-work', true)) prefixes.push('/my-work');
    if (pageOn(grants, 'service-desk', true)) prefixes.push('/service-desk');
    if (pageOn(grants, 'incidents', true)) prefixes.push('/incidents');
    if (pageOn(grants, 'changes', true)) prefixes.push('/changes', '/change-calendar');
    prefixes.push('/incident-workspace', '/activity');
    if (pageOn(grants, 'problems', true)) prefixes.push('/problems');
    if (pageOn(grants, 'tickets', true)) prefixes.push('/tickets');
    if (pageOn(grants, 'knowledge', true)) prefixes.push('/knowledge');
    if (pageOn(grants, 'services', true)) prefixes.push('/services', '/slos');
  }
  if (grants.cost) {
    if (pageOn(grants, 'cost', true)) prefixes.push('/cost');
  }
  if (grants.operations) {
    if (pageOn(grants, 'on-call', true)) prefixes.push('/on-call');
    if (pageOn(grants, 'certificates', true)) prefixes.push('/certificates');
    if (pageOn(grants, 'maintenance', true)) prefixes.push('/maintenance');
    if (pageOn(grants, 'reports', true)) prefixes.push('/reports-automation');
    if (pageOn(grants, 'webhooks', true)) prefixes.push('/operations/webhooks');
    if (grants.manager) prefixes.push('/runbooks', '/notification-settings', '/retry-center', '/approval-notification-analytics', '/approval-center', '/approval-sla');
  }
  if (grants.infrastructure) {
    if (pageOn(grants, 'iam', true)) prefixes.push('/iam');
    if (pageOn(grants, 'kubernetes', true)) prefixes.push('/k8s');
    if (pageOn(grants, 'projects', grants.manager)) prefixes.push('/projects');
    if (pageOn(grants, 'environments', grants.manager)) prefixes.push('/environments');
    if (pageOn(grants, 'cloud-accounts', grants.manager)) prefixes.push('/cloud-accounts');
    if (pageOn(grants, 'cloud-inventory', grants.manager)) prefixes.push('/cloud-resources');
    if (pageOn(grants, 'releases', grants.manager)) prefixes.push('/promotions', '/deploy-intelligence', '/gitops-projects', '/gitops-control', '/release-notes', '/project-operations');
    if (grants.manager) prefixes.push('/gate-approvals', '/gate-policies');
  }
  if (grants.security) {
    prefixes.push('/security');
    if (pageOn(grants, 'secrets', grants.manager)) prefixes.push('/credential-audit');
  }
  if (grants.records) prefixes.push('/previews', '/scorecards', '/evidence', '/templates');
  if (grants.portalAccess) {
    prefixes.push(
      '/portal-access',
      '/approval-center',
      '/approval-sla',
      '/change-calendar',
      '/deploy-intelligence',
      '/gitops-projects',
      '/gitops-control',
      '/gate-approvals',
      '/gate-policies',
      '/release-notes',
      '/activity',
      '/incident-workspace',
      '/project-operations',
    );
  }
  return prefixes.some((prefix) => matches(pathname, prefix)) && pageAllowed(pathname, grants);
}

export function accessRequirement(pathname: string): string {
  if (matches(pathname, '/approval-center') || matches(pathname, '/approval-sla')) {
    return 'Needs the manager grant.';
  }
  if (matches(pathname, '/change-calendar')) return 'Needs Daily access, including change requests.';
  if (
    matches(pathname, '/deploy-intelligence')
    || matches(pathname, '/gitops-projects')
    || matches(pathname, '/gitops-control')
    || matches(pathname, '/gate-approvals')
    || matches(pathname, '/gate-policies')
  ) {
    return 'Needs Infrastructure access.';
  }
  if (matches(pathname, '/scorecards')) return 'Needs Records access.';
  if (matches(pathname, '/slos')) return 'Needs Daily access, including services.';
  if (matches(pathname, '/cost')) return 'Needs the Cost grant.';
  if (matches(pathname, '/portal-access')) return 'Needs portal administrator access.';
  return 'This page is not included for your group.';
}
