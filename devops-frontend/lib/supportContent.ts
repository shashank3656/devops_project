export type { SupportAction, SupportArticle } from '@infragate/ui';
import type { SupportArticle } from '@infragate/ui';

export const supportQuickPrompts = [
  'How do promotions and gate approvals work?',
  'Where should I look for Kubernetes issues?',
  'How do incidents and runbooks fit together?',
  'How should I use command center and project views?',
];

export const supportArticles: SupportArticle[] = [
  {
    id: 'promotions-gates',
    category: 'Deployments',
    title: 'Promotions and deployment gates',
    summary: 'Promotion Center manages release movement between environments, and gate approvals control when attention items can proceed.',
    content:
      'Use Promotion Center to move change candidates across environments. If a gate is blocked, promotion cannot continue. If a gate needs attention, approve it first, then promote. Gate Audit and Gate Policies help explain why a promotion is waiting.',
    keywords: ['promotion', 'gate', 'approve gate', 'deployment', 'release'],
    routePrefixes: ['/promotions', '/gate-approvals', '/gate-policies'],
    actions: [
      { label: 'Open promotions', href: '/promotions' },
      { label: 'Open gate audit', href: '/gate-approvals' },
    ],
  },
  {
    id: 'k8s-command-center',
    category: 'Operations',
    title: 'Kubernetes health and command center',
    summary: 'K8s and Ops Command Center are the fastest pages for spotting unhealthy workloads, drift, incidents, and stuck retries.',
    content:
      'Use K8s for workload, namespace, and health summaries. Use Ops Command Center for cross-cutting triage: failed jobs, expiring items, pending approvals, and operational hotspots. If something feels wrong system-wide, start in Command Center and drill into K8s from there.',
    keywords: ['k8s', 'kubernetes', 'ops command center', 'workload', 'cluster', 'namespace', 'health'],
    routePrefixes: ['/k8s', '/ops-command-center', '/workload', '/retry-center'],
    actions: [
      { label: 'Open K8s', href: '/k8s' },
      { label: 'Open command center', href: '/ops-command-center' },
    ],
  },
  {
    id: 'incidents-runbooks',
    category: 'Incidents',
    title: 'Incidents, workspace, and runbooks',
    summary: 'Incidents track active operational events, and Runbooks provide the recovery or response playbooks.',
    content:
      'Use Incidents to create or triage response tickets and Incident Workspace to review timelines and postmortem details. Runbooks are the operational playbooks that support recovery. Start with incidents for active issues and jump to runbooks when you need the execution guidance.',
    keywords: ['incident', 'runbook', 'workspace', 'postmortem', 'response'],
    routePrefixes: ['/incidents', '/incident-workspace', '/runbooks'],
    actions: [
      { label: 'Open incidents', href: '/incidents' },
      { label: 'Open runbooks', href: '/runbooks' },
    ],
  },
  {
    id: 'rollback-credentials',
    category: 'Recovery',
    title: 'Rollback and credential audit',
    summary: 'Rollback Console handles controlled recovery, and Credential Audit helps catch expiring secrets and certificates before they cause incidents.',
    content:
      'Use Rollback Console when a change needs controlled reversal with audit context. Use Credential Audit to review expiring secrets, certificates, and ownership actions. These views work well together when release instability is caused by expiring credentials or failed deployment changes.',
    keywords: ['rollback', 'credentials', 'secret expiry', 'certificate', 'recovery'],
    routePrefixes: ['/rollback-console', '/credential-audit'],
    actions: [
      { label: 'Open rollback console', href: '/rollback-console' },
      { label: 'Open credential audit', href: '/credential-audit' },
    ],
  },
];
