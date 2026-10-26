export const WEBHOOK_USES = [
  { id: 'change', label: 'Change request', path: '/api/webhooks/change' },
  { id: 'alert', label: 'Incident', path: '/api/webhooks/alerts' },
  { id: 'grafana', label: 'Grafana', path: '/api/webhooks/alerts' },
  { id: 'alertmanager', label: 'Alertmanager', path: '/api/webhooks/alerts' },
  { id: 'generic_log', label: 'Logs', path: '/api/webhooks/alerts' },
  { id: 'zenduty', label: 'Zenduty', path: '/api/webhooks/zenduty' },
] as const;

export type WebhookUse = (typeof WEBHOOK_USES)[number]['id'];

export function webhookOrigin(apiUrl: string) {
  return apiUrl.replace(/\/$/, '').replace(/\/api\/webhooks\/(?:change|alerts)$/, '');
}

export function webhookUseLabel(kind: string) {
  return WEBHOOK_USES.find((item) => item.id === kind)?.label || kind;
}

export function webhookUsePath(kind: string) {
  return WEBHOOK_USES.find((item) => item.id === kind)?.path || '/api/webhooks/alerts';
}

export function webhookSample(kind: string) {
  if (kind === 'change') return WEBHOOK_CHANGE_SAMPLE;
  if (kind === 'zenduty') return WEBHOOK_ZENDUTY_SAMPLE;
  return WEBHOOK_INCIDENT_SAMPLE;
}

export const WEBHOOK_CHANGE_SAMPLE = `{
  "repo": "org/checkout",
  "sha": "abc123def456",
  "service": "checkout",
  "title": "Deploy main",
  "summary": "Ship the checkout fix",
  "author": "ci",
  "status": "implemented",
  "change_type": "standard",
  "environment": "prod"
}`;

export const WEBHOOK_INCIDENT_SAMPLE = `{
  "title": "Checkout error rate",
  "message": "Error rate stayed above 5% for 5 minutes",
  "service": "checkout",
  "environment": "prod",
  "severity": "high",
  "status": "firing",
  "project_code": "checkout"
}`;

export const WEBHOOK_ZENDUTY_SAMPLE = `{
  "payload": { "event_type": "create" },
  "incident": {
    "unique_id": "inc_sample",
    "title": "Checkout error rate",
    "status": 0,
    "service": { "name": "checkout" }
  }
}`;
