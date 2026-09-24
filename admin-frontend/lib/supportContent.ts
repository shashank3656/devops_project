export interface SupportAction {
  label: string;
  href?: string;
  externalHref?: string;
}

export interface SupportArticle {
  id: string;
  category: string;
  title: string;
  summary: string;
  content: string;
  keywords: string[];
  routePrefixes: string[];
  actions: SupportAction[];
}

export const supportQuickPrompts = [
  'How do I review pending approvals?',
  'Where do I manage teams and users?',
  'How do templates and governance work?',
  'How should I use activity and SLA dashboards?',
];

export const supportArticles: SupportArticle[] = [
  {
    id: 'approval-center',
    category: 'Approvals',
    title: 'Review pending approvals',
    summary: 'Approval Center is the fastest place to review incoming requests, urgency, and approval decisions.',
    content:
      'Use Approval Center when you need to process queue work quickly. Start with pending requests, review project, team, environment, and requested service, then approve, reject, or redirect based on governance policy and operational readiness.',
    keywords: ['approval', 'approve', 'queue', 'review requests', 'pending'],
    routePrefixes: ['/approval-center'],
    actions: [
      { label: 'Open approval center', href: '/approval-center' },
      { label: 'Open requests', href: '/requests' },
    ],
  },
  {
    id: 'users-teams',
    category: 'Access and ownership',
    title: 'Manage teams and users',
    summary: 'Use Teams and Users to control ownership, assignment, and portal access.',
    content:
      'Teams define ownership and request routing. Users define who can log in, what team they belong to, and which portal capabilities they can access. If approvals or incidents are not reaching the right person, start by checking the team and user mapping.',
    keywords: ['teams', 'users', 'ownership', 'assignment', 'portal access', 'member'],
    routePrefixes: ['/teams', '/users', '/team-ownership'],
    actions: [
      { label: 'Open teams', href: '/teams' },
      { label: 'Open users', href: '/users' },
    ],
  },
  {
    id: 'governance-projects',
    category: 'Governance',
    title: 'Project governance and policy',
    summary: 'Project Governance and Projects help define the rules, inventory, and review posture for each project.',
    content:
      'Use Project Governance for policy-driven review and Projects for inventory-level management. These views are helpful when you need to confirm project ownership, active environments, allowed services, or governance posture before approving a request.',
    keywords: ['governance', 'project', 'policy', 'compliance', 'inventory'],
    routePrefixes: ['/project-governance', '/projects', '/dashboard'],
    actions: [
      { label: 'Open project governance', href: '/project-governance' },
      { label: 'Open projects', href: '/projects' },
    ],
  },
  {
    id: 'templates-webhooks',
    category: 'Automation',
    title: 'Templates and webhooks',
    summary: 'Templates standardize requested infrastructure, and webhooks connect admin events to external systems.',
    content:
      'Use Templates to create reusable request blueprints and Webhooks to notify downstream systems when admin actions occur. Templates reduce manual review effort, while webhooks help keep external ticketing, chat, or automation systems in sync.',
    keywords: ['templates', 'webhooks', 'blueprint', 'automation', 'standard request'],
    routePrefixes: ['/templates', '/webhooks'],
    actions: [
      { label: 'Open templates', href: '/templates' },
      { label: 'Open webhooks', href: '/webhooks' },
    ],
  },
  {
    id: 'sla-activity',
    category: 'Audit and SLA',
    title: 'Use SLA and activity views',
    summary: 'SLA Dashboard and Activity help monitor delivery performance and audit what happened over time.',
    content:
      'SLA Dashboard is best for response and delivery trends. Activity is useful when you need an audit-style event timeline. Together they help answer what changed, who handled it, and whether the platform is meeting review and delivery expectations.',
    keywords: ['sla', 'activity', 'audit', 'history', 'performance'],
    routePrefixes: ['/sla', '/activity'],
    actions: [
      { label: 'Open SLA dashboard', href: '/sla' },
      { label: 'Open activity', href: '/activity' },
    ],
  },
  {
    id: 'changes-incidents',
    category: 'Operations',
    title: 'Review change requests and incidents',
    summary: 'Changes and Incidents show application deploys and alert-driven issues across projects.',
    content:
      'Change Requests are created by CI when code merges to main. Incidents appear from Grafana or logging alerts, tickets, or post-deploy regressions. Admin can review both catalogs and jump between a change and any linked incident. DevOps still owns CAB, close, and queue edits. Use Integrations to manage inbound webhook sources.',
    keywords: ['change', 'change request', 'incident', 'alert', 'grafana', 'deploy', 'chg', 'inc'],
    routePrefixes: ['/changes', '/incidents', '/webhooks'],
    actions: [
      { label: 'Open change requests', href: '/changes' },
      { label: 'Open incidents', href: '/incidents' },
      { label: 'Open integrations', href: '/webhooks' },
    ],
  },
];
