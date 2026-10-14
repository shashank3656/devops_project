import Head from 'next/head';
import { useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { deskCall, sessionRole, useDeskScope } from '../components/deskClient';
import { useApiUrl } from '../context/ApiUrlContext';

type RetirementCase = {
  state?: string;
  blockers?: string[];
  approved?: boolean;
  needs_preview?: boolean;
  history_readable?: boolean;
  resources?: { id?: string; state?: string; retained?: boolean }[];
  steps?: { name?: string; state?: string; attempts?: number }[];
};

function caseLabel(value?: string) {
  if (value === 'blocked') return 'Blocked';
  if (value === 'review') return 'Review';
  if (value === 'approved') return 'Approved';
  if (value === 'incomplete') return 'Incomplete';
  if (value === 'archived') return 'Archived';
  return 'Unknown';
}

export default function RetirementPage() {
  const apiUrl = useApiUrl();
  const { projectId, environment } = useDeskScope();
  const canWrite = sessionRole() !== 'viewer';
  const [service, setService] = useState('checkout');
  const [consumersKnown, setConsumersKnown] = useState('yes');
  const [retention, setRetention] = useState('retain');
  const [resource, setResource] = useState('logs-bucket');
  const [item, setItem] = useState<RetirementCase | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error' | 'denied'>('idle');
  const [message, setMessage] = useState('');

  const scopeReady = Boolean(projectId && environment);

  async function submit(action: 'preview' | 'approve') {
    setMessage('');
    if (!scopeReady) {
      setState('error');
      setMessage('Choose one project and one environment first.');
      return;
    }
    setState('loading');
    const response = await deskCall(apiUrl, '/api/retirement/cases', 'POST', {
      action,
      project_id: Number(projectId),
      environment,
      case: {
        id: `case-${projectId}-${service.trim()}`,
        service: service.trim(),
        consumers_known: consumersKnown === 'yes',
        retention_decision: retention === 'missing' ? '' : retention,
        backup_known: true,
        evidence_at: new Date().toISOString(),
        resources: [{ id: resource.trim(), kind: 'resource', retained: true, state: 'retained' }],
      },
    });
    if (response.status === 403) {
      setState('denied');
      setItem(null);
      return;
    }
    if (response.status === 404) {
      setState('empty');
      setItem(null);
      return;
    }
    if (response.status !== 200) {
      setState('error');
      setMessage('Retirement could not be reviewed. Missing evidence stays unknown.');
      return;
    }
    const payload = response.body as { case?: RetirementCase; deleted?: boolean };
    setItem(payload.case || { state: 'unknown' });
    setState('idle');
    if (action === 'preview') setMessage('Preview only. This did not approve retirement or delete a resource.');
    if (payload.case?.approved && payload.deleted !== true) setMessage('Retirement approved for this project. A retained resource stays retained.');
  }

  const resourceState = item?.resources?.[0]?.state === 'retained' ? 'Retained' : item ? 'Present' : 'Unknown';
  const blockers = item?.blockers?.length ? item.blockers.join(', ') : item ? 'None' : 'Unknown';

  return (
    <DevOpsLayout>
      <Head><title>Retirement</title></Head>
      <div className="portal-page desk-landing">
        <header className="portal-page__header">
          <div>
            <h1 className="portal-page__title">Retirement</h1>
            <p className="portal-page__subtitle">Retirement case for this project. Backup and consumer evidence are not assumed. A retained resource is not deleted.</p>
          </div>
        </header>
        {state === 'error' ? <div className="alert alert-error">{message || 'Retirement could not be reviewed.'}</div> : null}
        {state === 'denied' ? <div className="alert alert-error">You can read this case. You cannot approve it.</div> : null}
        {state === 'empty' ? <div className="alert">No retirement case is visible for this project.</div> : null}
        {message && state !== 'error' ? <div className="alert">{message}</div> : null}
        <dl className="security-facts">
          <div><dt>Project</dt><dd>{projectId || 'Unknown'}</dd></div>
          <div><dt>Environment</dt><dd>{environment || 'Unknown'}</dd></div>
          <div><dt>State</dt><dd>{state === 'loading' ? 'Loading' : caseLabel(item?.state)}</dd></div>
          <div><dt>Resource</dt><dd>{resourceState}</dd></div>
          <div><dt>Blockers</dt><dd>{blockers}</dd></div>
          <div><dt>Preview</dt><dd>{item?.needs_preview ? 'Required' : item ? 'Current' : 'Unknown'}</dd></div>
        </dl>
        {item?.steps?.length ? (
          <ul>
            {item.steps.map((step) => (
              <li key={step.name}>{step.name}: {step.state} · Attempt {step.attempts ?? 'Unknown'}</li>
            ))}
          </ul>
        ) : null}
        <form className="portal-surface" onSubmit={(event) => { event.preventDefault(); void submit('preview'); }}>
          <div className="portal-field-grid portal-field-grid--two">
            <label className="label">Service
              <input className="input" value={service} onChange={(event) => setService(event.target.value)} required />
            </label>
            <label className="label">Resource
              <input className="input" value={resource} onChange={(event) => setResource(event.target.value)} required />
            </label>
            <label className="label">Consumers known
              <input className="input" value={consumersKnown} onChange={(event) => setConsumersKnown(event.target.value)} />
            </label>
            <label className="label">Retention
              <input className="input" value={retention} onChange={(event) => setRetention(event.target.value)} />
            </label>
          </div>
          <p>Steps stay pending until a verified run. A failed teardown leaves the case incomplete and does not repeat a verified step.</p>
          <div className="portal-page__actions">
            <button className="btn btn-secondary" type="submit">Preview retirement</button>
            <button className="btn btn-primary" type="button" disabled={!canWrite} onClick={() => void submit('approve')}>Approve retirement</button>
          </div>
        </form>
      </div>
    </DevOpsLayout>
  );
}
