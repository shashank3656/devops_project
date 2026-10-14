import Head from 'next/head';
import { useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { deskCall, sessionRole, useDeskScope } from '../components/deskClient';
import { useApiUrl } from '../context/ApiUrlContext';

type Notice = {
  state?: string;
  overlap?: string;
  audience_count?: number;
  delivery?: string;
  correction?: string;
  incident_open?: boolean;
  change_open?: boolean;
  approved?: boolean;
};

function noticeLabel(value?: string) {
  if (value === 'reviewed') return 'Reviewed';
  if (value === 'published') return 'Published';
  if (value === 'corrected') return 'Corrected';
  if (value === 'cancelled') return 'Cancelled';
  return 'Unknown';
}

export default function MaintenancePage() {
  const apiUrl = useApiUrl();
  const { projectId, environment } = useDeskScope();
  const canWrite = sessionRole() !== 'viewer';
  const [service, setService] = useState('checkout');
  const [timezone, setTimezone] = useState('America/New_York');
  const [impact, setImpact] = useState('checkout writes pause');
  const [body, setBody] = useState('Planned maintenance for checkout.');
  const [owner, setOwner] = useState('Ada');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error' | 'denied'>('idle');
  const [message, setMessage] = useState('');

  const scopeReady = Boolean(projectId && environment);

  async function submit(action: 'preview' | 'approve' | 'cancel') {
    setMessage('');
    if (!scopeReady) {
      setState('error');
      setMessage('Choose one project and one environment first.');
      return;
    }
    setState('loading');
    const now = Date.now();
    const response = await deskCall(apiUrl, '/api/maintenance/notices', 'POST', {
      action,
      project_id: Number(projectId),
      environment,
      subscribers: [{ service: service.trim(), opted_out: false }],
      notice: {
        id: `notice-${projectId}-${service.trim()}`,
        service: service.trim(),
        timezone,
        impact: impact.trim(),
        body: body.trim(),
        owner: owner.trim(),
        change_id: 'change-9',
        incident_id: 'incident-4',
        start: new Date(now).toISOString(),
        end: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
        incident_open: true,
        change_open: true,
      },
    });
    if (response.status === 403) {
      setState('denied');
      setNotice(null);
      return;
    }
    if (response.status === 404) {
      setState('empty');
      setNotice(null);
      return;
    }
    if (response.status !== 200) {
      setState('error');
      setMessage('The notice could not be reviewed. A missing notice stays unknown.');
      return;
    }
    const payload = response.body as { notice?: Notice };
    setNotice(payload.notice || { state: 'draft' });
    setState('idle');
    if (action === 'preview') setMessage('Review only. This did not publish the notice.');
    if (action === 'approve') setMessage('Notice approved for this audience. It was not published to a public page.');
    if (action === 'cancel') setMessage('Cancellation recorded. The linked change and incident stay open. This does not mean the service recovered.');
  }

  return (
    <DevOpsLayout>
      <Head><title>Maintenance</title></Head>
      <div className="portal-page desk-landing">
        <header className="portal-page__header">
          <div>
            <h1 className="portal-page__title">Maintenance</h1>
            <p className="portal-page__subtitle">Planned notice for this project. Audience is a count. A notice does not close the linked change or incident.</p>
          </div>
        </header>
        {state === 'error' ? <div className="alert alert-error">{message || 'The notice could not be reviewed.'}</div> : null}
        {state === 'denied' ? <div className="alert alert-error">You can read notices. You cannot change this notice.</div> : null}
        {state === 'empty' ? <div className="alert">No maintenance notice is visible for this project.</div> : null}
        {message && state !== 'error' ? <div className="alert">{message}</div> : null}
        <dl className="security-facts">
          <div><dt>Project</dt><dd>{projectId || 'Unknown'}</dd></div>
          <div><dt>Environment</dt><dd>{environment || 'Unknown'}</dd></div>
          <div><dt>State</dt><dd>{state === 'loading' ? 'Loading' : noticeLabel(notice?.state)}</dd></div>
          <div><dt>Audience</dt><dd>{notice ? notice.audience_count ?? 0 : 'Unknown'}</dd></div>
          <div><dt>Overlap</dt><dd>{notice?.overlap || 'None'}</dd></div>
          <div><dt>Delivery</dt><dd>{notice?.delivery === 'failed' ? 'Failed' : notice?.delivery === 'sent' ? 'Sent' : 'Unknown'}</dd></div>
          <div><dt>Linked records</dt><dd>{notice?.incident_open || notice?.change_open ? 'Open' : notice ? 'Open' : 'Unknown'}</dd></div>
        </dl>
        <form className="portal-surface" onSubmit={(event) => { event.preventDefault(); void submit('preview'); }}>
          <div className="portal-field-grid portal-field-grid--two">
            <label className="label">Service
              <input className="input" value={service} onChange={(event) => setService(event.target.value)} required />
            </label>
            <label className="label">Timezone
              <input className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)} required />
            </label>
            <label className="label">Impact
              <input className="input" value={impact} onChange={(event) => setImpact(event.target.value)} required />
            </label>
            <label className="label">Owner
              <input className="input" value={owner} onChange={(event) => setOwner(event.target.value)} required />
            </label>
            <label className="label">Notice
              <input className="input" value={body} onChange={(event) => setBody(event.target.value)} required />
            </label>
          </div>
          {notice?.correction ? <p>Correction {notice.correction}. The linked change and incident stay open.</p> : null}
          <div className="portal-page__actions">
            <button className="btn btn-secondary" type="submit">Review notice</button>
            <button className="btn btn-primary" type="button" disabled={!canWrite} onClick={() => void submit('approve')}>Approve notice</button>
            <button className="btn btn-secondary" type="button" disabled={!canWrite} onClick={() => void submit('cancel')}>Cancel maintenance</button>
          </div>
        </form>
      </div>
    </DevOpsLayout>
  );
}
