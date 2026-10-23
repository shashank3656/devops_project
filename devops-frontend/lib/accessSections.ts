export type SectionKey = 'requests' | 'daily' | 'operations' | 'infrastructure' | 'security' | 'records';
export type SectionGrants = Record<SectionKey, boolean> & { pages: Record<string, boolean> };

export const ACCESS_SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'requests', label: 'Requests' },
  { key: 'daily', label: 'Daily' },
  { key: 'operations', label: 'Operations' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'security', label: 'Security' },
  { key: 'records', label: 'Records' },
];

export const SECTION_PAGES: { section: SectionKey; key: string; label: string }[] = [
  { section: 'requests', key: 'my-requests', label: 'My requests' },
  { section: 'requests', key: 'new-request', label: 'New request' },
  { section: 'requests', key: 'my-projects', label: 'My projects' },
  { section: 'requests', key: 'my-teams', label: 'My teams' },
  { section: 'daily', key: 'overview', label: 'Overview' },
  { section: 'daily', key: 'my-work', label: 'My work' },
  { section: 'daily', key: 'service-desk', label: 'Service desk' },
  { section: 'daily', key: 'incidents', label: 'Incidents' },
  { section: 'daily', key: 'changes', label: 'Change requests' },
  { section: 'daily', key: 'problems', label: 'Problems' },
  { section: 'daily', key: 'tickets', label: 'Requests' },
  { section: 'daily', key: 'knowledge', label: 'Knowledge' },
  { section: 'daily', key: 'services', label: 'Service inventory' },
  { section: 'operations', key: 'on-call', label: 'On-call' },
  { section: 'operations', key: 'maintenance', label: 'Maintenance' },
  { section: 'operations', key: 'reports', label: 'Reports' },
  { section: 'operations', key: 'webhooks', label: 'Webhooks' },
  { section: 'infrastructure', key: 'projects', label: 'Projects' },
  { section: 'infrastructure', key: 'environments', label: 'Environments' },
  { section: 'infrastructure', key: 'cloud-accounts', label: 'Cloud accounts' },
  { section: 'infrastructure', key: 'cloud-inventory', label: 'Cloud inventory' },
  { section: 'infrastructure', key: 'iam', label: 'IAM' },
  { section: 'infrastructure', key: 'kubernetes', label: 'Kubernetes' },
  { section: 'infrastructure', key: 'releases', label: 'Releases' },
  { section: 'security', key: 'cloud-scan', label: 'Cloud scan' },
  { section: 'security', key: 'code-scan', label: 'Code scan' },
  { section: 'security', key: 'findings', label: 'Findings' },
  { section: 'security', key: 'secrets', label: 'Secrets' },
  { section: 'records', key: 'previews', label: 'Previews' },
  { section: 'records', key: 'scorecards', label: 'Scorecards' },
  { section: 'records', key: 'evidence', label: 'Evidence' },
  { section: 'records', key: 'templates', label: 'Templates' },
];

export function pagesFor(section: SectionKey) {
  return SECTION_PAGES.filter((page) => page.section === section);
}

export function emptyGrants(): SectionGrants {
  return {
    requests: false,
    daily: false,
    operations: false,
    infrastructure: false,
    security: false,
    records: false,
    pages: {},
  };
}

function withPages(grants: SectionGrants, saved?: Record<string, boolean> | null): SectionGrants {
  const pageMap = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : null;
  const explicit = Boolean(pageMap && Object.keys(pageMap).length);
  const pages: Record<string, boolean> = {};
  for (const page of SECTION_PAGES) {
    if (!grants[page.section]) pages[page.key] = false;
    else if (!explicit || !pageMap || !(page.key in pageMap)) pages[page.key] = true;
    else pages[page.key] = Boolean(pageMap[page.key]);
  }
  return { ...grants, pages };
}

export function grantsForTeam(team: { team_type?: string; grants?: Partial<SectionGrants> | null }): SectionGrants {
  if (team.grants && typeof team.grants === 'object') return grantsFrom(team.grants);
  if (team.team_type === 'devops') {
    return withPages({
      requests: false,
      daily: true,
      operations: true,
      infrastructure: true,
      security: true,
      records: false,
      pages: {},
    }, null);
  }
  return withPages({
    requests: true,
    daily: false,
    operations: false,
    infrastructure: false,
    security: false,
    records: false,
    pages: {},
  }, null);
}

export function grantsFrom(saved: Partial<SectionGrants> | undefined): SectionGrants {
  const grants = emptyGrants();
  for (const section of ACCESS_SECTIONS) grants[section.key] = Boolean(saved?.[section.key]);
  return withPages(grants, saved?.pages);
}

export function sameGrants(left: SectionGrants, right: SectionGrants) {
  return ACCESS_SECTIONS.every((section) => Boolean(left?.[section.key]) === Boolean(right?.[section.key]))
    && SECTION_PAGES.every((page) => Boolean(left?.pages?.[page.key]) === Boolean(right?.pages?.[page.key]));
}

export function grantSummary(grants: SectionGrants) {
  const names = ACCESS_SECTIONS.filter((section) => grants[section.key]).map((section) => {
    const children = pagesFor(section.key);
    const open = children.filter((page) => grants.pages?.[page.key]);
    if (children.length && open.length && open.length < children.length) {
      return `${section.label} (${open.map((page) => page.label).join(', ')})`;
    }
    return section.label;
  });
  return names.length ? names.join(', ') : 'No sections';
}
