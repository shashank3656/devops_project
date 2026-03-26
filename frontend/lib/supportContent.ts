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
  'How do I create a new infrastructure request?',
  'How can I track my request status?',
  'When should I raise an incident?',
  'What does due date and priority affect?',
];

export const supportArticles: SupportArticle[] = [
  {
    id: 'create-request',
    category: 'Requests',
    title: 'Create a new infrastructure request',
    summary: 'Start from your assigned project, choose cloud and service, then submit with the right due date and context.',
    content:
      'Open Create Infrastructure, select your project and team, then pick environment, cloud, and service. Use the due date when the request has a delivery expectation, and add notes if approvers need context. Templates are the fastest path if your team already uses standard configurations.',
    keywords: ['create', 'request', 'infrastructure', 'new request', 'cloud', 'service', 'template'],
    routePrefixes: ['/create-infrastructure', '/select-service', '/custom-json'],
    actions: [
      { label: 'Create infrastructure', href: '/create-infrastructure/new' },
      { label: 'Browse templates', href: '/templates' },
    ],
  },
  {
    id: 'history-status',
    category: 'Requests',
    title: 'Track request history and status',
    summary: 'Use Request History to follow approval progress, delivery status, and recent updates.',
    content:
      'Request History shows every request raised from your portal account. Open a request to review approval state, comments, status changes, and any updates from admin or DevOps teams. If you manage teams, approval-related updates also surface in your notification drawer.',
    keywords: ['history', 'status', 'track', 'request history', 'updates', 'approval progress'],
    routePrefixes: ['/history'],
    actions: [
      { label: 'Open request history', href: '/history' },
      { label: 'View my projects', href: '/my-projects' },
    ],
  },
  {
    id: 'incidents',
    category: 'Incidents',
    title: 'Raise or review incidents',
    summary: 'Use Incidents when there is service impact, user-facing degradation, or urgent operational risk.',
    content:
      'Incidents are best used for active operational problems, failed changes, or urgent blockers. If an incident is assigned to your team, it will appear in the portal so you can track ownership, severity, and updates. Use normal requests for planned work and incidents for active disruption.',
    keywords: ['incident', 'issue', 'outage', 'sev', 'severity', 'problem', 'assigned incident'],
    routePrefixes: ['/incidents'],
    actions: [
      { label: 'Open incidents', href: '/incidents' },
      { label: 'Open request history', href: '/history' },
    ],
  },
  {
    id: 'projects-teams',
    category: 'Access and projects',
    title: 'Projects, teams, and access',
    summary: 'Your available projects and actions depend on the teams you are assigned to.',
    content:
      'If a project, environment, or service is missing, it usually means your team assignment or project mapping needs to be updated. My Projects shows what you can operate on, and My Teams shows the team context available to your account when that feature is enabled for you.',
    keywords: ['project', 'team', 'access', 'missing project', 'permissions', 'environment missing'],
    routePrefixes: ['/my-projects', '/my-teams'],
    actions: [
      { label: 'Open my projects', href: '/my-projects' },
      { label: 'Open my teams', href: '/my-teams' },
    ],
  },
  {
    id: 'due-date-priority',
    category: 'Request guidance',
    title: 'Due date and priority guidance',
    summary: 'Use due dates for delivery expectations and priority to signal urgency to reviewing teams.',
    content:
      'Due date helps reviewers understand when the work is expected. Priority helps teams triage the request against others in the queue. High priority should be reserved for urgent operational needs, while routine requests should usually stay medium or low.',
    keywords: ['due date', 'priority', 'urgent', 'sla', 'delivery expectation'],
    routePrefixes: ['/create-infrastructure', '/select-service', '/custom-json'],
    actions: [
      { label: 'Open request form', href: '/create-infrastructure/new' },
    ],
  },
];
