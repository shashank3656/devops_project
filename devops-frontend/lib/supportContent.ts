export type { SupportAction, SupportArticle } from '@infragate/ui';
import type { SupportArticle } from '@infragate/ui';

import { COST_COPILOT_CHIPS } from './cost';

export const supportQuickPrompts = [
  'How do promotions and gate approvals work?',
  'Where should I look for Kubernetes issues?',
  'How do incidents and runbooks fit together?',
  'How should I use command center and project views?',
];

export function supportQuickPromptsForPath(path: string) {
  if (path === '/cost' || path.startsWith('/cost/')) {
    return COST_COPILOT_CHIPS;
  }
  return supportQuickPrompts;
}

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
    summary: 'K8s is the page for spotting unhealthy workloads, namespaces, and stuck retries.',
    content:
      'Use K8s for workload, namespace, and cluster summaries. If a retry is stuck, open the retry center from Alerts.',
    keywords: ['k8s', 'kubernetes', 'workload', 'cluster', 'namespace'],
    routePrefixes: ['/k8s', '/workload', '/retry-center'],
    actions: [
      { label: 'Open K8s', href: '/k8s' },
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
    id: 'operating-cost',
    category: 'Cost',
    title: 'Operating cost versus request estimates',
    summary: 'Cost is its own sidebar section. It shows billed AWS spend. Ticket Infracost figures stay on a separate card.',
    content:
      'Open Cost in the sidebar to see the operating bill for onboarded AWS accounts. Enable Cost on an existing account, then ingest billed data or a labelled CUR export. Incomplete windows stay Unknown, never zero. Actual and amortized are different columns. Explorer, budgets, anomalies, and CSV use the same window. Missing metrics block rightsizing. Overlapping savings are not summed. Budgets never stop workloads. Request estimates from tickets are not the invoice. Bind an existing Kubernetes cluster under Cost → Kubernetes. Inventory, metrics, allocation, and billing reconciled stay independent. This product does not install OpenCost. Cluster spend is a breakdown of the cloud bill, never an extra line.',
    keywords: ['cost', 'bill', 'cur', 'infracost', 'operating spend'],
    routePrefixes: ['/cost'],
    actions: [
      { label: 'Open Cost', href: '/cost' },
      { label: 'Open explorer', href: '/cost/explorer' },
      { label: 'Open optimization', href: '/cost/optimization' },
      { label: 'Open anomalies', href: '/cost/anomalies' },
      { label: 'Open budgets', href: '/cost/budgets' },
      { label: 'Open savings', href: '/cost/savings' },
      { label: 'Open Kubernetes cost', href: '/cost/kubernetes' },
      { label: 'Open configuration', href: '/cost/configuration' },
    ],
  },
  {
    id: 'rollback-credentials',
    category: 'Recovery',
    title: 'Credential audit',
    summary: 'Credential Audit helps catch expiring secrets and certificates before they cause incidents.',
    content:
      'Use Credential Audit to review expiring secrets, certificates, and ownership actions.',
    keywords: ['credentials', 'secret expiry', 'certificate', 'recovery'],
    routePrefixes: ['/credential-audit'],
    actions: [
      { label: 'Open credential audit', href: '/credential-audit' },
    ],
  },
];
