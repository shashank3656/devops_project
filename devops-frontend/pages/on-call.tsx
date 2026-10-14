import Head from 'next/head';
import { useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { deskCall, sessionRole, useDeskScope } from '../components/deskClient';
import { useApiUrl } from '../context/ApiUrlContext';

type Resolution = {
  state?: string;
  name?: string;
  role?: string;
  next?: string;
  reason?: string;
};

export default function OnCallPage() {
  const apiUrl = useApiUrl();
  const { projectId, environment } = useDeskScope();
  const canWrite = sessionRole() !== 'viewer';
  const [timezone, setTimezone] = useState('America/New_York');
  const [primary, setPrimary] = useState('');
  const [backup, setBackup] = useState('');
  const [overrideName, setOverrideName] = useState('');
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error' | 'denied'>('idle');
  const [notice, setNotice] = useState('');

  const scopeReady = Boolean(projectId && environment);

  async function submit(action: 'preview' | 'activate') {
    setNotice('');
    if (!scopeReady) {
      setState('error');
      setNotice('Choose one project and one environment first.');
      return;
    }
    setState('loading');
    const now = Date.now();
    const result = await deskCall(apiUrl, '/api/oncall/coverage', 'POST', {
      action,
      project_id: Number(projectId),
      environment,
      version: {
        timezone,
        shifts: [
          primary.trim() ? { role: 'primary', name: primary.trim(), start: new Date(now - 3600000).toISOString(), end: new Date(now + 3600000).toISOString() } : null,
          backup.trim() ? { role: 'backup', name: backup.trim(), start: new Date(now + 3600000).toISOString(), end: new Date(now + 7200000).toISOString() } : null,
        ].filter(Boolean),
        overrides: overrideName.trim() ? [{ name: overrideName.trim(), start: new Date(now - 60000).toISOString(), end: new Date(now + 3600000).toISOString(), actor: 'operator', reason }] : [],
        gaps: [],
      },
    });
    if (result.status === 403) {
      setState('denied');
      setResolution(null);
      return;
    }
    if (result.status === 404) {
      setState('empty');
      setResolution({ state: 'empty', reason: 'No schedule is visible for this project.' });
      return;
    }
    if (result.status !== 200) {
      setState('error');
      setNotice('Coverage could not be loaded. Missing coverage stays unknown.');
      return;
    }
    const body = result.body as { resolution?: Resolution; activated?: boolean };
    setResolution(body.resolution || { state: 'empty', reason: 'No schedule is active for this project.' });
    setState(body.resolution?.state === 'empty' ? 'empty' : 'idle');
    if (action === 'preview') setNotice('Preview only. This did not activate the schedule.');
    if (body.activated) setNotice('Schedule activated for this project. It does not page a private number.');
  }

  const label = resolution?.state === 'responder' ? resolution.name || 'Unknown' : resolution?.state === 'gap' ? 'Coverage gap' : 'Unknown';

  return (
    <DevOpsLayout>
      <Head><title>On-call</title></Head>
      <div className="portal-page desk-landing">
        <header className="portal-page__header">
          <div>
            <h1 className="portal-page__title">On-call</h1>
            <p className="portal-page__subtitle">Current and next responder for this project. Private contact details are not shown. A gap stays a gap.</p>
          </div>
        </header>
        {state === 'error' ? <div className="alert alert-error">{notice || 'Coverage could not be loaded.'}</div> : null}
        {state === 'denied' ? <div className="alert alert-error">You can read coverage. You cannot change this schedule.</div> : null}
        {notice && state !== 'error' ? <div className="alert">{notice}</div> : null}
        <dl className="security-facts">
          <div><dt>Project</dt><dd>{projectId || 'Unknown'}</dd></div>
          <div><dt>Environment</dt><dd>{environment || 'Unknown'}</dd></div>
          <div><dt>Now</dt><dd>{state === 'loading' ? 'Loading' : label}</dd></div>
          <div><dt>Next</dt><dd>{resolution?.next || 'Unknown'}</dd></div>
          <div><dt>Reason</dt><dd>{resolution?.reason || 'Unknown'}</dd></div>
        </dl>
        <form className="portal-surface" onSubmit={(event) => { event.preventDefault(); void submit('preview'); }}>
          <div className="portal-field-grid portal-field-grid--two">
            <label className="label">Timezone
              <input className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)} required />
            </label>
            <label className="label">Primary
              <input className="input" value={primary} onChange={(event) => setPrimary(event.target.value)} placeholder="Display name" />
            </label>
            <label className="label">Backup
              <input className="input" value={backup} onChange={(event) => setBackup(event.target.value)} placeholder="Display name" />
            </label>
            <label className="label">Override
              <input className="input" value={overrideName} onChange={(event) => setOverrideName(event.target.value)} placeholder="Display name" />
            </label>
            <label className="label">Override reason
              <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          </div>
          <div className="portal-page__actions">
            <button className="btn btn-secondary" type="submit">Preview coverage</button>
            <button className="btn btn-primary" type="button" disabled={!canWrite} onClick={() => void submit('activate')}>Activate schedule</button>
          </div>
        </form>
        <section className="portal-surface">
          <h2 className="portal-surface__title">Escalation</h2>
          <p>{resolution?.state === 'gap' ? 'No responder is on duty. Escalation does not start from a gap.' : 'A failed delivery stays failed. It is not an acknowledgement. A repeated step does not send a second notification.'}</p>
        </section>
      </div>
    </DevOpsLayout>
  );
}
