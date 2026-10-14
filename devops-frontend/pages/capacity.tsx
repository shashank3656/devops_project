import Head from 'next/head';
import { useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { deskCall, sessionRole, useDeskScope } from '../components/deskClient';
import { useApiUrl } from '../context/ApiUrlContext';

type CapacityResult = {
  readiness?: string;
  minimum?: number;
  maximum?: number;
  formula?: string;
  limitation?: string;
  blockers?: string[];
  approved?: boolean;
  executed?: boolean;
  change_ref?: string;
};

function readinessLabel(value?: string) {
  if (value === 'blocked') return 'Blocked';
  if (value === 'review') return 'Review';
  if (value === 'approved') return 'Approved';
  return 'Unknown';
}

export default function CapacityPage() {
  const apiUrl = useApiUrl();
  const { projectId, environment } = useDeskScope();
  const canWrite = sessionRole() !== 'viewer';
  const [service, setService] = useState('checkout');
  const [timezone, setTimezone] = useState('America/New_York');
  const [source, setSource] = useState('campaign');
  const [revision, setRevision] = useState('rev-1');
  const [expected, setExpected] = useState('250');
  const [stress, setStress] = useState('400');
  const [sustainable, setSustainable] = useState('100');
  const [headroom, setHeadroom] = useState('0.2');
  const [quota, setQuota] = useState('200');
  const [result, setResult] = useState<CapacityResult | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error' | 'denied'>('idle');
  const [notice, setNotice] = useState('');

  const scopeReady = Boolean(projectId && environment);

  async function submit(action: 'preview' | 'approve') {
    setNotice('');
    if (!scopeReady) {
      setState('error');
      setNotice('Choose one project and one environment first.');
      return;
    }
    setState('loading');
    const hasEvidence = sustainable.trim() !== '';
    const response = await deskCall(apiUrl, '/api/capacity/plan', 'POST', {
      action,
      project_id: Number(projectId),
      environment,
      change_key: action === 'approve' ? `capacity-${projectId}-${service.trim()}-${revision.trim()}` : '',
      input: {
        service: service.trim(),
        timezone,
        traffic_source: source.trim(),
        workload_revision: revision.trim(),
        assumptions: {
          headroom: Number(headroom),
          expected_rps: Number(expected),
          stress_rps: Number(stress || 0),
          note: 'campaign peak',
        },
        evidence: hasEvidence ? {
          unit: 'rps',
          sustainable_rps: Number(sustainable),
          observed_at: new Date().toISOString(),
          workload_revision: revision.trim(),
          bottleneck: 'database pool',
          failed: false,
        } : null,
        limits: {
          node_capacity: 8,
          database_quota: Number(quota || 0),
          dependency_limit: 4,
        },
      },
    });
    if (response.status === 403) {
      setState('denied');
      setResult(null);
      return;
    }
    if (response.status === 404) {
      setState('empty');
      setResult({ readiness: 'unknown', blockers: ['No capacity plan is visible for this project.'] });
      return;
    }
    if (response.status !== 200) {
      setState('error');
      setNotice('Capacity could not be reviewed. Missing evidence stays unknown.');
      return;
    }
    const body = response.body as { result?: CapacityResult; executed?: boolean };
    setResult(body.result || { readiness: 'unknown' });
    setState('idle');
    if (action === 'preview') setNotice('Review only. This did not approve the plan or change production.');
    if (body.result?.approved && body.executed !== true) setNotice('Plan approved for this project. It did not change production.');
  }

  const blockers = result?.blockers?.length ? result.blockers.join(', ') : 'None';

  return (
    <DevOpsLayout>
      <Head><title>Capacity</title></Head>
      <div className="portal-page desk-landing">
        <header className="portal-page__header">
          <div>
            <h1 className="portal-page__title">Capacity</h1>
            <p className="portal-page__subtitle">Suggested replicas for this project. Missing evidence stays unknown. Approval does not scale production.</p>
          </div>
        </header>
        {state === 'error' ? <div className="alert alert-error">{notice || 'Capacity could not be reviewed.'}</div> : null}
        {state === 'denied' ? <div className="alert alert-error">You can read this plan. You cannot approve it.</div> : null}
        {state === 'empty' ? <div className="alert">No capacity plan is visible for this project.</div> : null}
        {notice && state !== 'error' ? <div className="alert">{notice}</div> : null}
        <dl className="security-facts">
          <div><dt>Project</dt><dd>{projectId || 'Unknown'}</dd></div>
          <div><dt>Environment</dt><dd>{environment || 'Unknown'}</dd></div>
          <div><dt>Readiness</dt><dd>{state === 'loading' ? 'Loading' : readinessLabel(result?.readiness)}</dd></div>
          <div><dt>Minimum replicas</dt><dd>{result?.minimum ?? 'Unknown'}</dd></div>
          <div><dt>Maximum replicas</dt><dd>{result?.maximum ?? 'Unknown'}</dd></div>
          <div><dt>Blockers</dt><dd>{result ? blockers : 'Unknown'}</dd></div>
        </dl>
        <form className="portal-surface" onSubmit={(event) => { event.preventDefault(); void submit('preview'); }}>
          <div className="portal-field-grid portal-field-grid--two">
            <label className="label">Service
              <input className="input" value={service} onChange={(event) => setService(event.target.value)} required />
            </label>
            <label className="label">Timezone
              <input className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)} required />
            </label>
            <label className="label">Traffic source
              <input className="input" value={source} onChange={(event) => setSource(event.target.value)} />
            </label>
            <label className="label">Workload revision
              <input className="input" value={revision} onChange={(event) => setRevision(event.target.value)} required />
            </label>
            <label className="label">Expected requests per second
              <input className="input" value={expected} onChange={(event) => setExpected(event.target.value)} inputMode="decimal" />
            </label>
            <label className="label">Stress requests per second
              <input className="input" value={stress} onChange={(event) => setStress(event.target.value)} inputMode="decimal" />
            </label>
            <label className="label">Sustainable requests per second
              <input className="input" value={sustainable} onChange={(event) => setSustainable(event.target.value)} inputMode="decimal" />
            </label>
            <label className="label">Headroom
              <input className="input" value={headroom} onChange={(event) => setHeadroom(event.target.value)} inputMode="decimal" />
            </label>
            <label className="label">Database quota
              <input className="input" value={quota} onChange={(event) => setQuota(event.target.value)} inputMode="numeric" />
            </label>
          </div>
          <p>{result?.formula || 'ceil(target_rps / sustainable_rps * (1 + headroom))'}</p>
          <p>{result?.limitation || 'Replicas round up from measured throughput and declared headroom. This does not guarantee linear scaling and does not change production.'}</p>
          {result?.change_ref ? <p>Linked change {result.change_ref}. Execution evidence is empty.</p> : null}
          <div className="portal-page__actions">
            <button className="btn btn-secondary" type="submit">Review plan</button>
            <button className="btn btn-primary" type="button" disabled={!canWrite} onClick={() => void submit('approve')}>Approve plan</button>
          </div>
        </form>
      </div>
    </DevOpsLayout>
  );
}
