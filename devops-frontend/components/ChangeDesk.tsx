import { FormEvent, useEffect, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  DeskError,
  DeskStateChip,
  changeEventBlock,
  changeScanBlock,
  changeVerifyBlock,
  deskCanWrite,
  deskErrorText,
  parseChangeEvent,
  parseChangeEvents,
  workspaceScopeBlock,
  type ChangeEventView,
} from '@infragate/ui';
import { actorId, deskCall, sessionRole, useDeskScope } from './deskClient';

function staticError(body: unknown): string {
  const message = deskErrorText(body);
  return message === 'request failed' ? 'monitor request failed' : message;
}

export default function ChangeDesk() {
  const apiUrl = useApiUrl();
  const scope = useDeskScope();
  const role = sessionRole();
  const [eventKey, setEventKey] = useState('');
  const [identity, setIdentity] = useState('');
  const [resource, setResource] = useState('');
  const [revision, setRevision] = useState('1');
  const [authenticated, setAuthenticated] = useState(true);
  const [seen, setSeen] = useState(false);
  const [reviewerId, setReviewerId] = useState('');
  const [selectedId, setSelectedId] = useState(0);
  const [events, setEvents] = useState<ChangeEventView[]>([]);
  const [partial, setPartial] = useState<Record<number, boolean>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canWrite = deskCanWrite(role);
  const selected = events.find((item) => item.id === selectedId) || null;

  async function load() {
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block) {
      setEvents([]);
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, `/api/change-events?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}`, 'GET');
    if (result.status !== 200) {
      setEvents([]);
      setError(staticError(result.body));
      return;
    }
    setEvents(parseChangeEvents(result.body));
    setError('');
  }

  useEffect(() => {
    void load();
  }, [apiUrl, scope.environment, scope.projectId]);

  async function onEvent(event: FormEvent) {
    event.preventDefault();
    const block = changeEventBlock(role, scope.projectId, scope.environment, eventKey, identity, resource, revision, authenticated);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/change-events', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      event_key: eventKey.trim(),
      identity: identity.trim(),
      resource: resource.trim(),
      revision: Number(revision),
      authenticated: true,
    });
    const saved = parseChangeEvent(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setSelectedId(saved.id);
    setNotice(saved.reason === 'older revision' ? 'Older revision kept. No extra work was scheduled.' : saved.applied ? 'One rescan scheduled.' : 'A repeat adds no work.');
    setError('');
    await load();
  }

  async function onScan(event: FormEvent) {
    event.preventDefault();
    const known = events.find((item) => item.eventKey === eventKey.trim());
    const block = changeScanBlock(role, scope.environment, eventKey, seen, known?.state || '');
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/change-events/scans', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      event_key: eventKey.trim(),
      seen,
    });
    const saved = parseChangeEvent(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    if (seen) setPartial((current) => ({ ...current, [saved.id]: true }));
    setSelectedId(saved.id);
    setNotice(saved.reason === 'delivery loss' ? 'Delivery loss stays visible.' : 'Periodic scan reconciled the existing rescan.');
    setError('');
    await load();
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const block = changeVerifyBlock(role, scope.environment, partial[selected.id] === true, reviewerId, actorId());
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/change-events/verify', 'POST', {
      event_id: selected.id,
      reviewer_id: Number(reviewerId),
    });
    const saved = parseChangeEvent(result.body);
    if (result.status !== 200 || !saved || saved.state !== 'verified') {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setNotice('Finding verified from partial scan coverage.');
    setError('');
    await load();
  }

  return (
    <div className="desk-language">
      <header className="desk-landing">
        <h2>Change monitoring</h2>
        <p>An authenticated event schedules one rescan. A missed event stays visible until a different reviewer verifies it.</p>
      </header>
      <section className="desk-language__panel desk-language__rail" aria-label="Event"><h2>Change event</h2><form className="desk-language__form" onSubmit={onEvent}>
        <label>Event key<input value={eventKey} onChange={(event) => setEventKey(event.target.value)} /></label>
        <label>Identity<input value={identity} onChange={(event) => setIdentity(event.target.value)} /></label>
        <label>Resource<input value={resource} onChange={(event) => setResource(event.target.value)} /></label>
        <label>Revision<input value={revision} onChange={(event) => setRevision(event.target.value)} /></label>
        <label><input type="checkbox" checked={authenticated} onChange={(event) => setAuthenticated(event.target.checked)} /> Authenticated</label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Record event' : 'Read only'}</button>
      </form></section>
      <form className="desk-language__form" onSubmit={onScan}>
        <label><input type="checkbox" checked={seen} onChange={(event) => setSeen(event.target.checked)} /> Scan saw the event</label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Record scan' : 'Read only'}</button>
      </form>
      {error && error !== workspaceScopeBlock(scope.projectId, scope.environment) ? <DeskError message={error} /> : null}
      {notice ? <p className="desk-language__copy">{notice}</p> : null}
      <section className="desk-language__records" aria-label="Change events">
        <h2>Events</h2>
        {workspaceScopeBlock(scope.projectId, scope.environment) ? (
          <div className="desk-language__empty"><DeskStateChip value="unknown" /><p>{workspaceScopeBlock(scope.projectId, scope.environment)}</p></div>
        ) : events.length === 0 && error.endsWith('request failed') ? (
          <div className="desk-language__empty"><DeskStateChip value="error" /></div>
        ) : events.length === 0 ? (
          <div className="desk-language__empty"><DeskStateChip value="empty" /><p>No change events in this project.</p></div>
        ) : null}
        <ul>
          {events.map((item) => (
            <li key={item.id} aria-current={item.id === selectedId ? 'true' : undefined}>
              <button type="button" onClick={() => setSelectedId(item.id)}>{item.eventKey}</button>
              <span>{item.state}</span>
              <span>{item.suspected ? 'Suspected' : 'Not suspected'}</span>
              <span>Work {item.workCount}</span>
              <DeskStateChip value={item.observed} />
              {item.reason ? <span>{item.reason}</span> : null}
            </li>
          ))}
        </ul>
      </section>
      {selected ? (
        <form className="desk-language__form" onSubmit={onVerify}>
          <label>Reviewer<input value={reviewerId} inputMode="numeric" onChange={(event) => setReviewerId(event.target.value)} /></label>
          <button type="submit" className="btn btn-secondary" disabled={!canWrite}>{canWrite ? 'Verify finding' : 'Read only'}</button>
        </form>
      ) : events.length > 0 ? (
        <p className="desk-language__note">Select an event before verifying the finding.</p>
      ) : null}
    </div>
  );
}
