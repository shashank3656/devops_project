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
  deskWord,
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
  const role = sessionRole();
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
  const scopeNote = workspaceScopeBlock(scope.projectId, scope.environment);
  const failed = !scopeNote && records.length === 0 && error.endsWith('request failed');

  async function load() {
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block) {
      setRecords([]);
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, `/api/backup-records?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}`, 'GET');
    if (result.status === 404) {
      setRecords([]);
      setSelectedId(0);
      setError('');
      return;
    }
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
      <header className="desk-landing">
        <h2>Backup and restore</h2>
        <p>A successful backup stays unverified until a drill validates sample data. A failed drill assigns follow-up and does not launch a restore.</p>
      </header>
      <DeskError message={scopeNote ? '' : error} />
      {notice ? <p className="desk-language__note">{notice}</p> : null}
      <section className="desk-language__panel desk-language__rail" aria-label="Backup">
        <h2>Backup</h2>
        <form className="desk-language__form" onSubmit={onBackup}>
          <label>Service<input value={service} autoComplete="off" onChange={(event) => setService(event.target.value)} /></label>
          <label>Scope
            <select value={backupScope} onChange={(event) => setBackupScope(event.target.value as (typeof BACKUP_SCOPES)[number])}>
              {BACKUP_SCOPES.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
            </select>
          </label>
          <label>Retention days<input value={retention} inputMode="numeric" onChange={(event) => setRetention(event.target.value)} /></label>
          <label>Provider<input value={BACKUP_PROVIDER} readOnly /></label>
          <div className="desk-language__actions">
            <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Record backup' : 'Read only'}</button>
          </div>
        </form>
      </section>
      <section className="desk-language__panel" aria-label="Backups">
        <h2>Backups</h2>
        {scopeNote ? (
          <div className="desk-language__empty"><DeskStateChip value="unknown" /><p>{scopeNote}</p></div>
        ) : failed ? (
          <div className="desk-language__empty"><DeskStateChip value="error" /></div>
        ) : records.length === 0 ? (
          <div className="desk-language__empty"><DeskStateChip value="empty" /><p>No backups in this project.</p></div>
        ) : (
          <ul className="desk-language__records">
            {records.map((item) => (
              <li key={item.id} aria-current={item.id === selectedId ? 'true' : undefined}>
                <button type="button" onClick={() => setSelectedId(item.id)}>
                  <span>
                    <strong>{item.service}</strong>
                    <small>{deskWord(item.scope)} · {item.verified ? 'Verified' : 'Unverified'} · {item.retentionDays} days · Can launch off</small>
                  </span>
                  <DeskStateChip value={item.observed} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected ? (
          <>
            <form className="desk-language__form" onSubmit={onDependency}>
              <label>Dependency<input value={dependency} autoComplete="off" onChange={(event) => setDependency(event.target.value)} /></label>
              <div className="desk-language__actions">
                <button type="submit" className="btn btn-secondary" disabled={!canWrite}>{canWrite ? 'Link dependency' : 'Read only'}</button>
              </div>
            </form>
            <form className="desk-language__form" onSubmit={onDrill}>
              <label><input type="checkbox" checked={isolated} onChange={(event) => setIsolated(event.target.checked)} /> Isolated drill</label>
              {!isolated ? <p className="desk-language__note">{BACKUP_ISOLATED_MESSAGE}</p> : null}
              <label><input type="checkbox" checked={sampleValid} onChange={(event) => setSampleValid(event.target.checked)} /> Sample data validates</label>
              <label>Duration seconds<input value={duration} inputMode="numeric" onChange={(event) => setDuration(event.target.value)} /></label>
              <label>Data gap<input value={gap} inputMode="numeric" onChange={(event) => setGap(event.target.value)} /></label>
              <label>Outcome
                <select value={outcome} onChange={(event) => setOutcome(event.target.value as (typeof BACKUP_OUTCOMES)[number])}>
                  {BACKUP_OUTCOMES.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
                </select>
              </label>
              <label>Reviewer<input value={reviewerId} inputMode="numeric" onChange={(event) => setReviewerId(event.target.value)} /></label>
              <div className="desk-language__actions">
                <button type="submit" className="btn btn-secondary" disabled={!canWrite}>{canWrite ? 'Record drill' : 'Read only'}</button>
              </div>
            </form>
            {drill ? <p className="desk-language__note">Drill {drill.state}. Can launch off.</p> : null}
          </>
        ) : records.length > 0 ? (
          <p className="desk-language__note">Select a backup before linking a dependency or recording a drill.</p>
        ) : null}
      </section>
    </div>
  );
}
