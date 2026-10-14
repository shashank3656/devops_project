import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  DeskError,
  DeskStateChip,
  READINESS_COVERAGE,
  READINESS_KINDS,
  READINESS_RESTORE_MESSAGE,
  READINESS_SCOPES,
  deskCanWrite,
  deskErrorText,
  parseReadinessBackup,
  parseReadinessJobs,
  parseReadinessRestore,
  parseReadinessSignal,
  parseReadinessTarget,
  readinessJobBlock,
  readinessObservedState,
  readinessRestoreBlock,
  readinessSignalBlock,
  readinessTargetBlock,
  workspaceScopeBlock,
  type ReadinessBackupView,
  type ReadinessJobView,
  type ReadinessSignalView,
  type ReadinessTargetView,
} from '@infragate/ui';
import { deskCall, sessionRole, useDeskScope } from './deskClient';

function staticError(body: unknown): string {
  const message = deskErrorText(body);
  return message === 'request failed' ? 'readiness request failed' : message;
}

export default function ReadinessDesk() {
  const apiUrl = useApiUrl();
  const scope = useDeskScope();
  const [role, setRole] = useState<'viewer' | 'operator'>(sessionRole());
  const [kind, setKind] = useState<(typeof READINESS_KINDS)[number]>('queue_age');
  const [coverage, setCoverage] = useState<(typeof READINESS_COVERAGE)[number]>('unknown');
  const [count, setCount] = useState('0');
  const [age, setAge] = useState('0');
  const [observed, setObserved] = useState(true);
  const [rpo, setRpo] = useState('60');
  const [rto, setRto] = useState('300');
  const [owner, setOwner] = useState('');
  const [backupScope, setBackupScope] = useState<(typeof READINESS_SCOPES)[number]>('database');
  const [backup, setBackup] = useState<ReadinessBackupView | null>(null);
  const [elapsed, setElapsed] = useState('');
  const [loss, setLoss] = useState('');
  const [elapsedSet, setElapsedSet] = useState(false);
  const [lossSet, setLossSet] = useState(false);
  const [queueOpen, setQueueOpen] = useState(true);
  const [jobKey, setJobKey] = useState('');
  const [signals, setSignals] = useState<ReadinessSignalView[]>([]);
  const [target, setTarget] = useState<ReadinessTargetView | null>(null);
  const [restoreState, setRestoreState] = useState('');
  const [jobs, setJobs] = useState<ReadinessJobView[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canWrite = deskCanWrite(role);

  async function loadJobs() {
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block) {
      setJobs([]);
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, `/api/readiness/jobs?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}`, 'GET');
    if (result.status !== 200) {
      setJobs([]);
      setError(staticError(result.body));
      return;
    }
    setJobs(parseReadinessJobs(result.body));
    setError('');
  }

  useEffect(() => {
    void loadJobs();
  }, [apiUrl, scope.environment, scope.projectId]);

  async function onSignal(event: FormEvent) {
    event.preventDefault();
    const block = readinessSignalBlock(role, scope.projectId, scope.environment, kind, coverage, '', count, age, observed);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/readiness/signals', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      kind,
      coverage: kind === 'scan_coverage' ? coverage : 'unknown',
      detail: '',
      count: observed ? Number(count) : 0,
      age_seconds: observed ? Number(age) : 0,
      observed,
    });
    const saved = parseReadinessSignal(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setSignals((current) => [saved, ...current]);
    setNotice(saved.state === 'recorded' ? 'Signal recorded from numbers.' : 'A missing observation stays Unknown.');
    setError('');
  }

  async function onTarget(event: FormEvent) {
    event.preventDefault();
    const block = readinessTargetBlock(role, scope.projectId, scope.environment, rpo, rto, owner);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/readiness/targets', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      rpo_seconds: Number(rpo),
      rto_seconds: Number(rto),
      owner_user_id: Number(owner),
    });
    const saved = parseReadinessTarget(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setTarget(saved);
    setNotice('Recovery target stays proposed.');
    setError('');
  }

  async function onBackup(event: FormEvent) {
    event.preventDefault();
    const block = readinessTargetBlock(role, scope.projectId, scope.environment, '1', '1', '1');
    if (block && block !== 'RPO, RTO, and an owner user id are required.') {
      setNotice('');
      setError(block);
      return;
    }
    const scopeBlock = workspaceScopeBlock(scope.projectId, scope.environment);
    if (scopeBlock || !canWrite) {
      setNotice('');
      setError(scopeBlock || 'A viewer can read this desk.');
      return;
    }
    const result = await deskCall(apiUrl, '/api/readiness/backups', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      scope: backupScope,
    });
    const saved = parseReadinessBackup(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setBackup(saved);
    setNotice('Backup declared for the restore rehearsal.');
    setError('');
  }

  async function onRestore(event: FormEvent) {
    event.preventDefault();
    if (!backup) return;
    const block = readinessRestoreBlock(role, scope.environment, elapsed, loss, elapsedSet, lossSet);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/readiness/restores', 'POST', {
      backup_id: backup.id,
      elapsed_seconds: elapsedSet ? Number(elapsed) : 0,
      elapsed_set: elapsedSet,
      loss_count: lossSet ? Number(loss) : 0,
      loss_set: lossSet,
    });
    const saved = parseReadinessRestore(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setRestoreState(saved.state);
    setNotice(saved.state === 'restored' ? `Restore recorded ${saved.elapsedSeconds} seconds and loss ${saved.lossCount}.` : READINESS_RESTORE_MESSAGE);
    setError('');
  }

  async function onQueue(event: FormEvent) {
    event.preventDefault();
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block || !canWrite) {
      setNotice('');
      setError(block || 'A viewer can read this desk.');
      return;
    }
    const result = await deskCall(apiUrl, '/api/readiness/queue', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      open: queueOpen,
    });
    if (result.status !== 200) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setNotice(queueOpen ? 'Queue is open.' : 'Queue is closed. Existing jobs stay queued.');
    setError('');
  }

  async function onJob(event: FormEvent) {
    event.preventDefault();
    const block = readinessJobBlock(role, scope.projectId, scope.environment, jobKey);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/readiness/jobs', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      job_key: jobKey.trim(),
    });
    if (result.status !== 200) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setNotice('Job stays queued.');
    setError('');
    await loadJobs();
  }

  return (
    <div className="desk-language">
      <p className="desk-language__intro">Queue age and sync lag show numbers. A missing scan stays Unknown. A restore without elapsed time and loss stays Unknown.</p>
      <div className="desk-language__bar">
        <span>{role === 'viewer' ? 'Viewer' : 'Operator'}</span>
        <button type="button" onClick={() => setRole((item) => (item === 'viewer' ? 'operator' : 'viewer'))}>{role === 'viewer' ? 'Preview operator' : 'Preview viewer'}</button>
        <Link href="/change-monitoring">Change monitoring</Link>
      </div>
      <form className="desk-language__form" onSubmit={onSignal}>
        <label>Signal
          <select value={kind} onChange={(event) => setKind(event.target.value as (typeof READINESS_KINDS)[number])}>
            {READINESS_KINDS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        {kind === 'scan_coverage' ? (
          <label>Coverage
            <select value={coverage} onChange={(event) => setCoverage(event.target.value as (typeof READINESS_COVERAGE)[number])}>
              {READINESS_COVERAGE.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        ) : null}
        <label>Count<input value={count} onChange={(event) => setCount(event.target.value)} /></label>
        <label>Age seconds<input value={age} onChange={(event) => setAge(event.target.value)} /></label>
        <label><input type="checkbox" checked={observed} onChange={(event) => setObserved(event.target.checked)} /> Observation is present</label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Record signal' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onTarget}>
        <label>RPO seconds<input value={rpo} onChange={(event) => setRpo(event.target.value)} /></label>
        <label>RTO seconds<input value={rto} onChange={(event) => setRto(event.target.value)} /></label>
        <label>Owner user id<input value={owner} onChange={(event) => setOwner(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Save target' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onBackup}>
        <label>Backup scope
          <select value={backupScope} onChange={(event) => setBackupScope(event.target.value as (typeof READINESS_SCOPES)[number])}>
            {READINESS_SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Declare backup' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onRestore}>
        <label><input type="checkbox" checked={elapsedSet} onChange={(event) => setElapsedSet(event.target.checked)} /> Elapsed time is set</label>
        <label>Elapsed seconds<input value={elapsed} onChange={(event) => setElapsed(event.target.value)} /></label>
        <label><input type="checkbox" checked={lossSet} onChange={(event) => setLossSet(event.target.checked)} /> Loss count is set</label>
        <label>Loss count<input value={loss} onChange={(event) => setLoss(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite || !backup}>{canWrite ? 'Record restore' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onQueue}>
        <label><input type="checkbox" checked={queueOpen} onChange={(event) => setQueueOpen(event.target.checked)} /> Queue open</label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Set queue' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onJob}>
        <label>Job key<input value={jobKey} onChange={(event) => setJobKey(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Queue job' : 'Read only'}</button>
      </form>
      {error ? <DeskError>{error}</DeskError> : null}
      {notice ? <p className="desk-language__copy">{notice}</p> : null}
      {target ? <p className="desk-language__copy">Target {target.state}. RPO {target.rpoSeconds}. RTO {target.rtoSeconds}.</p> : null}
      {restoreState ? <p className="desk-language__copy">Restore {restoreState}.</p> : null}
      <section className="desk-language__records" aria-label="Readiness signals">
        {signals.length === 0 ? <p>No signals recorded in this session.</p> : null}
        <ul>
          {signals.map((item) => (
            <li key={item.id}>
              <span>{item.kind}</span>
              <span>{item.coverage}</span>
              <span>{item.count}</span>
              <DeskStateChip state={readinessObservedState(item.state)} />
            </li>
          ))}
        </ul>
      </section>
      <section className="desk-language__records" aria-label="Queued jobs">
        {jobs.length === 0 ? <p>No queued jobs in this project.</p> : null}
        <ul>
          {jobs.map((item) => (
            <li key={item.id}><span>{item.jobKey}</span><span>{item.state}</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
