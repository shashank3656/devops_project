import Head from 'next/head';
import { useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

function originOf(apiUrl: string) {
  return apiUrl.replace(/\/$/, '').replace(/\/api\/webhooks\/(?:change|alerts)$/, '');
}

const CHANGE_SAMPLE = `{
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

const INCIDENT_SAMPLE = `{
  "title": "Checkout error rate",
  "message": "Error rate stayed above 5% for 5 minutes",
  "service": "checkout",
  "environment": "prod",
  "severity": "high",
  "status": "firing",
  "project_code": "checkout"
}`;

export default function WebhooksPage() {
  const apiUrl = useApiUrl();
  const origin = originOf(apiUrl);
  const changeUrl = `${origin}/api/webhooks/change`;
  const incidentUrl = `${origin}/api/webhooks/alerts`;
  const [copied, setCopied] = useState('');

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  }

  return (
    <DevOpsLayout>
      <Head><title>Webhooks - SetuOps</title></Head>
      <div className="work-page">
        <header className="work-page__head">
          <div>
            <p className="ops-kicker">Operations</p>
            <h1>Webhooks</h1>
            <p>Point CI at these addresses to record a change after deploy, or to open an incident from an alert. Send the secret in <code>X-CI-Secret</code>. The secret stays on the server and is not shown here.</p>
          </div>
        </header>
        <p className="access-hint">The pipeline secret <code>SETUOPS_API_URL</code> should be only <code>{origin}</code>. The samples below already add the webhook path. Pasting the full webhook address into that secret sends the path twice and the call is rejected.</p>
        <div className="request-split">
          <section className="portal-surface request-panel">
            <h2 className="access-form__title">Change request from CI</h2>
            <p className="access-hint">POST after a merge to main. <code>repo</code> and <code>sha</code> are required. The same pair updates the existing change instead of creating another one.</p>
            <p className="changes-page__webhook-url"><code>{changeUrl}</code></p>
            <button type="button" className="btn btn-secondary" onClick={() => void copy('change', changeUrl)}>{copied === 'change' ? 'Copied' : 'Copy change URL'}</button>
            <pre className="code-block">{CHANGE_SAMPLE}</pre>
          </section>
          <section className="portal-surface request-panel">
            <h2 className="access-form__title">Incident from an alert</h2>
            <p className="access-hint">POST when a monitor fires. A title is enough to open the incident. Send <code>status: resolved</code> on the same fingerprint when it clears.</p>
            <p className="changes-page__webhook-url"><code>{incidentUrl}</code></p>
            <button type="button" className="btn btn-secondary" onClick={() => void copy('incident', incidentUrl)}>{copied === 'incident' ? 'Copied' : 'Copy incident URL'}</button>
            <pre className="code-block">{INCIDENT_SAMPLE}</pre>
          </section>
        </div>
      </div>
    </DevOpsLayout>
  );
}
