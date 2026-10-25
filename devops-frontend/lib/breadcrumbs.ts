import { recordReference, type RecordPrefix } from './recordRef';

// Every route under pages/. A breadcrumb links only to entries here, so add new routes to this list.
export const KNOWN_PAGES: ReadonlySet<string> = new Set([
  '/',
  '/activity',
  '/approval-center',
  '/approval-notification-analytics',
  '/approval-sla',
  '/change-calendar',
  '/change-risk',
  '/changes',
  '/changes/[id]',
  '/changes/new',
  '/cloud-accounts',
  '/cloud-accounts/[id]',
  '/cloud-accounts/new',
  '/cloud-resources',
  '/cloud-resources/[id]',
  '/cloud-resources/account',
  '/credential-audit',
  '/dashboard',
  '/deploy-intelligence',
  '/deploy-intelligence/[owner]/[repo]',
  '/deploy-intelligence/onboard',
  '/environments',
  '/evidence',
  '/forgot-password',
  '/gate-approvals',
  '/gate-policies',
  '/gate-policies/[id]',
  '/gitops-control',
  '/gitops-control/[id]/edit',
  '/gitops-control/new',
  '/gitops-projects',
  '/iam',
  '/iam/approvals',
  '/iam/audit',
  '/iam/permissions',
  '/iam/policy',
  '/iam/request',
  '/iam/requests',
  '/incident-workspace',
  '/incidents',
  '/incidents/[id]/edit',
  '/incidents/new',
  '/k8s',
  '/k8s/certificates',
  '/k8s/clusters/[cluster]',
  '/k8s/configmaps',
  '/k8s/events',
  '/k8s/ingresses',
  '/k8s/ingresses/[ingress]',
  '/k8s/logs',
  '/k8s/namespaces/[name]',
  '/k8s/onboard',
  '/k8s/onboard/new',
  '/k8s/pods',
  '/k8s/pods/[pod]',
  '/k8s/pods/[pod]/terminal',
  '/k8s/rollouts',
  '/k8s/secrets',
  '/k8s/services',
  '/k8s/services/[name]',
  '/k8s/storage',
  '/k8s/workloads',
  '/k8s/workloads/[workload]/rollout',
  '/k8s/workspace',
  '/knowledge',
  '/knowledge/[id]',
  '/login',
  '/maintenance',
  '/maintenance/[id]',
  '/maintenance/new',
  '/my-projects',
  '/my-requests',
  '/my-teams',
  '/my-work',
  '/notification-settings',
  '/notifications',
  '/on-call',
  '/on-call/[id]',
  '/on-call/new',
  '/on-call/onboard',
  '/on-call/project/[id]',
  '/on-call/project/[id]/team/[teamId]',
  '/on-call/projects',
  '/operations/webhooks',
  '/operations/webhooks/new',
  '/portal-access',
  '/portal-access/sso',
  '/portal-access/teams',
  '/portal-access/teams/[id]',
  '/portal-access/teams/new',
  '/portal-access/users',
  '/portal-access/users/[id]',
  '/portal-access/users/new',
  '/previews',
  '/problems',
  '/problems/[id]',
  '/problems/new',
  '/profile',
  '/profile/api-keys',
  '/profile/notifications',
  '/profile/password',
  '/project-dependencies',
  '/project-operations',
  '/projects',
  '/projects/[id]',
  '/projects/[id]/edit',
  '/projects/new',
  '/promotions',
  '/release-notes',
  '/reports-automation',
  '/requests/[id]',
  '/requests/new',
  '/reset-password',
  '/retry-center',
  '/runbooks',
  '/runbooks/[id]/edit',
  '/runbooks/new',
  '/scorecards',
  '/security/cloud-scan',
  '/security/findings',
  '/security/vulnerabilities',
  '/security/vulnerabilities/advisories/[id]',
  '/security/vulnerabilities/findings/[id]',
  '/security/vulnerabilities/policy',
  '/security/vulnerabilities/policy/[id]',
  '/security/vulnerabilities/services/[id]',
  '/service-desk',
  '/service-heatmap',
  '/services',
  '/services/[id]',
  '/services/new',
  '/team',
  '/templates',
  '/templates/[id]',
  '/templates/[id]/edit',
  '/templates/cloud/[cloud]',
  '/templates/new',
  '/tickets',
  '/verify-required',
  '/workload',
]);

export interface Crumb {
  label: string;
  href?: string;
}

function canonicalRecord(pattern: string, value: string): string | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  let prefix: RecordPrefix | null = null;
  if (pattern === '/requests/[id]') prefix = 'REQ';
  else if (pattern.startsWith('/incidents/')) prefix = 'INC';
  else if (pattern.startsWith('/changes/') && pattern.includes('[')) prefix = 'CHG';
  else if (pattern.startsWith('/problems/') && pattern.includes('[')) prefix = 'PRB';
  return prefix ? recordReference(prefix, id) : null;
}

function humanize(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  const text = decoded.replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : segment;
}

/**
 * Builds breadcrumbs from the route pattern (pathname) and the real URL (asPath).
 * A crumb links only when a page exists for that prefix.
 */
export function buildBreadcrumbs(pathname: string, asPath: string, titles: Record<string, string>): Crumb[] {
  const patternParts = pathname.split('/').filter(Boolean);
  const realParts = asPath.split(/[?#]/)[0].split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ label: 'Home', href: '/dashboard' }];
  if (pathname === '/dashboard') return [{ label: 'Home' }];
  for (let index = 0; index < patternParts.length; index += 1) {
    const pattern = `/${patternParts.slice(0, index + 1).join('/')}`;
    const real = `/${realParts.slice(0, index + 1).join('/')}`;
    const part = patternParts[index];
    const value = realParts[index] || part;
    const dynamic = part.startsWith('[');
    let label = titles[pattern] || '';
    const canonical = dynamic ? canonicalRecord(pattern, value) : null;
    if (canonical) label = canonical;
    else if (!label) {
      if (dynamic) label = value.startsWith('[') ? '…' : /^\d+$/.test(value) ? `#${value}` : humanize(value);
      else label = humanize(part);
    }
    const isLast = index === patternParts.length - 1;
    crumbs.push({ label, href: !isLast && KNOWN_PAGES.has(pattern) ? real : undefined });
  }
  return crumbs;
}
