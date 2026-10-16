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
  infrastructure: boolean;
  security: boolean;
  records: boolean;
  portalAccess: boolean;
  manager: boolean;
};

function allPortalGrants(): PortalGrants {
  return {
    requests: true,
    daily: true,
    operations: true,
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
      infrastructure: Boolean(user.grants.infrastructure),
      security: Boolean(user.grants.security),
      records: Boolean(user.grants.records),
      portalAccess: false,
      manager,
    };
  }
  const devops = user?.user_type === 'devops_user';
  const manager = devops && Boolean(user?.devops_profile?.is_manager);
  return {
    requests: user?.user_type === 'portal_user',
    daily: devops,
    operations: devops,
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

export function homeFor(grants: PortalGrants): string {
  if (grants.daily) return '/dashboard';
  if (grants.requests) return '/my-requests';
  if (grants.operations) return '/on-call';
  if (grants.infrastructure) return '/k8s';
  if (grants.security) return '/security/cloud-scan';
  if (grants.records) return '/previews';
  if (grants.portalAccess) return '/portal-access';
  return '/profile';
}

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function pathAllowed(pathname: string, grants: PortalGrants): boolean {
  if (pathname === '/profile' || pathname.startsWith('/profile/')) return true;
  const prefixes: string[] = [];
  if (grants.requests) prefixes.push('/my-requests', '/requests', '/my-projects', '/my-teams');
  if (grants.daily) {
    prefixes.push('/dashboard', '/my-work', '/service-desk', '/incidents', '/changes', '/problems', '/tickets', '/knowledge', '/services');
  }
  if (grants.operations) {
    prefixes.push('/on-call', '/maintenance', '/reports-automation');
    if (grants.manager) prefixes.push('/runbooks', '/notification-settings', '/retry-center', '/approval-notification-analytics');
  }
  if (grants.infrastructure) {
    prefixes.push('/k8s', '/iam');
    if (grants.manager) prefixes.push('/projects', '/environments', '/cloud-accounts', '/cloud-resources', '/promotions');
  }
  if (grants.security) {
    prefixes.push('/security');
    if (grants.manager) prefixes.push('/credential-audit');
  }
  if (grants.records) prefixes.push('/previews', '/scorecards', '/evidence', '/templates');
  if (grants.portalAccess) prefixes.push('/portal-access');
  return prefixes.some((prefix) => matches(pathname, prefix));
}
