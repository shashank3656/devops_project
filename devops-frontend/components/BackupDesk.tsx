import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  BACKUP_ISOLATED_MESSAGE,
  BACKUP_OUTCOMES,
  BACKUP_PROVIDER,
  BACKUP_SCOPES,
  DeskError,
  DeskStateChip,
  backupDependencyBlock,
  backupDrillBlock,
  backupRecordBlock,
  deskCanWrite,
  deskErrorText,
  parseBackupDrill,
  parseBackupRecord,
  parseBackupRecords,
  workspaceScopeBlock,
  type BackupDrillView,
  type BackupRecordView,
} from '@infragate/ui';
import { actorId, deskCall, sessionRole, useDeskScope } from './deskClient';

function staticError(body: unknown): string {
  const message = deskErrorText(body);
  return message === 'request failed' ? 'backup request failed' : message;
}

export default function BackupDesk() {
  const apiUrl = useApiUrl();
  const scope = useDeskScope();
  const [role, setRole] = useState<'viewer' | 'operator'>(sessionRole());
  const [service, setService] = useState('');
  const [backupScope, setBackupScope] = useState<(typeof BACKUP_SCOPES)[number]>('database');
  const [retention, setRetention] = useState('7');
  const [dependency, setDependency] = useState('');
  const [selectedId, setSelectedId] = useState(0);
  const [isolated, setIsolated] = useState(true);
  const [sampleValid, setSampleValid] = useState(false);
  const [duration, setDuration] = useState('');
  const [gap, setGap] = useState('');
  const [outcome, setOutcome] = useState<(typeof BACKUP_OUTCOMES)[number]>('succeeded');
  const [reviewerId, setReviewerId] = useState('');
  const [records, setRecords] = useState<BackupRecordView[]>([]);
  const [drill, setDrill] = useState<BackupDrillView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const actor = actorId();
  const canWrite = deskCanWrite(role);
  const selected = records.find((item) => item.id === selectedId) || null;

  async function load() {
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block) {
      setRecords([]);
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, `/api/backup-records?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}`, 'GET');
    if (result.status !== 200) {
      setRecords([]);
      setError(staticError(result.body));
      return;
    }
    setRecords(parseBackupRecords(result.body));
    setError('');
  }

  useEffect(() => {
    void load();
  }, [apiUrl, scope.environment, scope.projectId]);

  async function onBackup(event: FormEvent) {
    event.preventDefault();
    const block = backupRecordBlock(role, scope.projectId, scope.environment, service, backupScope, retention);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/backup-records', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      service: service.trim(),
      scope: backupScope,
      provider: BACKUP_PROVIDER,
      retention_days: Number(retention),
    });
    const saved = parseBackupRecord(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setSelectedId(saved.id);
    setNotice('Backup recorded. It stays unverified until a drill validates sample data.');
    setError('');
    await load();
  }

  async function onDependency(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const block = backupDependencyBlock(role, scope.environment, selected.service, dependency);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/backup-records/dependencies', 'POST', {
      backup_id: selected.id,
      service: dependency.trim(),
    });
    if (result.status !== 200) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setNotice('Dependency linked. No restore was launched.');
    setError('');
  }

  async function onDrill(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const block = backupDrillBlock(role, scope.environment, isolated, reviewerId, actor, outcome, duration, gap);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/backup-records/drills', 'POST', {
      backup_id: selected.id,
      reviewer_id: Number(reviewerId),
      isolated: true,
      sample_valid: sampleValid,
      duration_set: duration.trim() !== '',
      duration_seconds: duration.trim() ? Number(duration) : 0,
      gap_set: gap.trim() !== '',
      data_gap: gap.trim() ? Number(gap) : 0,
      outcome,
    });
    const saved = parseBackupDrill(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setDrill(saved);
    setNotice(saved.followUp ? 'Failed drill assigned follow-up. Can launch stays off.' : 'Drill recorded. Can launch stays off.');
    setError('');
    await load();
  }

  return (
    <div className="desk-language">
      <p className="desk-language__intro">A successful backup stays unverified until a drill validates sample data. A failed drill assigns follow-up and does not launch a restore.</p>
      <div className="desk-language__bar">
        <span>{role === 'viewer' ? 'Viewer' : 'Operator'}</span>
        <button type="button" onClick={() => setRole((item) => (item === 'viewer' ? 'operator' : 'viewer'))}>
          {role === 'viewer' ? 'Preview operator' : 'Preview viewer'}
        </button>
        <Link href="/infrastructure-drift">Infrastructure drift</Link>
      </div>
      <form className="desk-language__form" onSubmit={onBackup}>
        <label>Backup service<input value={service} onChange={(event) => setService(event.target.value)} /></label>
        <label>Scope
          <select value={backupScope} onChange={(event) => setBackupScope(event.target.value as (typeof BACKUP_SCOPES)[number])}>
            {BACKUP_SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Retention days<input value={retention} onChange={(event) => setRetention(event.target.value)} /></label>
        <label>Provider<input value={BACKUP_PROVIDER} readOnly /></label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Record backup' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onDependency}>
        <label>Dependency service<input value={dependency} onChange={(event) => setDependency(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite || !selected}>{canWrite ? 'Link dependency' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onDrill}>
        <label><input type="checkbox" checked={isolated} onChange={(event) => setIsolated(event.target.checked)} /> Isolated drill</label>
        {!isolated ? <p>{BACKUP_ISOLATED_MESSAGE}</p> : null}
        <label><input type="checkbox" checked={sampleValid} onChange={(event) => setSampleValid(event.target.checked)} /> Sample data validates</label>
        <label>Duration seconds<input value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
        <label>Data gap<input value={gap} onChange={(event) => setGap(event.target.value)} /></label>
        <label>Outcome
          <select value={outcome} onChange={(event) => setOutcome(event.target.value as (typeof BACKUP_OUTCOMES)[number])}>
            {BACKUP_OUTCOMES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Reviewer user id<input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite || !selected}>{canWrite ? 'Record drill' : 'Read only'}</button>
      </form>
      {!selected ? <p className="desk-language__copy">Select a backup before linking a dependency or recording a drill.</p> : null}
      {error ? <DeskError message={error} /> : null}
      {notice ? <p className="desk-language__copy">{notice}</p> : null}
      {drill ? <p className="desk-language__copy">Drill {drill.state}. Can launch off.</p> : null}
      <section className="desk-language__records" aria-label="Backups">
        {records.length === 0 ? <p>No backups in this project.</p> : null}
        <ul>
          {records.map((item) => (
            <li key={item.id} aria-current={item.id === selectedId ? 'true' : undefined}>
              <button type="button" onClick={() => setSelectedId(item.id)}>{item.service}</button>
              <span>{item.scope}</span>
              <span>{item.verified ? 'Verified' : 'Unverified'}</span>
              <span>{item.retentionDays} days</span>
              <DeskStateChip value={item.observed} />
              <span>Can launch off</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
