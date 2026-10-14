import { FormEvent, useEffect, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  DeskError,
  DeskStateChip,
  PILOT_BLANK_MESSAGE,
  PILOT_ENVIRONMENTS,
  PILOT_EXPANSION_MESSAGE,
  PILOT_FINDING_MESSAGE,
  PILOT_PROVIDERS,
  PILOT_SCENARIOS,
  PILOT_STEPS,
  acceptanceCaseBlock,
  acceptanceCloseBlock,
  acceptanceRiskBlock,
  deskCanWrite,
  deskErrorText,
  deskWord,
  parseAcceptanceCases,
  parsePilotJourney,
  pilotExpansionBlock,
  pilotJourneyBlock,
  pilotPublishBlock,
  pilotStepBlock,
  workspaceScopeBlock,
  type AcceptanceCaseView,
  type PilotJourneyView,
} from '@infragate/ui';
import { actorId, deskCall, sessionRole, useDeskScope } from './deskClient';

function staticError(body: unknown, fallback: string): string {
  const message = deskErrorText(body);
  return message === 'request failed' ? fallback : message;
}

export default function PilotDesk() {
  const apiUrl = useApiUrl();
  const scope = useDeskScope();
  const role = sessionRole();
  const [teamId, setTeamId] = useState('');
  const [service, setService] = useState('');
  const [account, setAccount] = useState('');
  const [journey, setJourney] = useState<PilotJourneyView | null>(null);
  const [stepEnv, setStepEnv] = useState<(typeof PILOT_ENVIRONMENTS)[number]>('staging');
  const [step, setStep] = useState<(typeof PILOT_STEPS)[number]>('provisioning');
  const [evidence, setEvidence] = useState('');
  const [recorded, setRecorded] = useState<Record<string, boolean>>({});
  const [rehearsed, setRehearsed] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState('');
  const [elapsedSet, setElapsedSet] = useState(false);
  const [severity, setSeverity] = useState('normal');
  const [summary, setSummary] = useState('');
  const [criticalOpen, setCriticalOpen] = useState(false);
  const [note, setNote] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [provider, setProvider] = useState<(typeof PILOT_PROVIDERS)[number]>('azure');
  const [expansionScope, setExpansionScope] = useState('staging');
  const [ownerId, setOwnerId] = useState('');
  const [blockerId, setBlockerId] = useState(0);
  const [releaseAccepted, setReleaseAccepted] = useState(false);
  const [expansionId, setExpansionId] = useState(0);
  const [scenario, setScenario] = useState<(typeof PILOT_SCENARIOS)[number]>('out_of_order');
  const [subject, setSubject] = useState('');
  const [revision, setRevision] = useState('1');
  const [partial, setPartial] = useState(false);
  const [detail, setDetail] = useState('');
  const [cases, setCases] = useState<AcceptanceCaseView[]>([]);
  const [selectedCase, setSelectedCase] = useState(0);
  const [riskId, setRiskId] = useState(0);
  const [riskSummary, setRiskSummary] = useState('');
  const [readProject, setReadProject] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canWrite = deskCanWrite(role);
  const actor = actorId();
  const hiddenRead = readProject.trim() !== '' && readProject.trim() !== scope.projectId;

  async function loadCases() {
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block) {
      setCases([]);
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, `/api/acceptance/cases?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}`, 'GET');
    if (result.status === 404) {
      setCases([]);
      setError('');
      return;
    }
    if (result.status !== 200) {
      setCases([]);
      setError(staticError(result.body, 'acceptance request failed'));
      return;
    }
    setCases(parseAcceptanceCases(result.body));
    setError('');
  }

  useEffect(() => {
    void loadCases();
  }, [apiUrl, scope.environment, scope.projectId]);

  async function onJourney(event: FormEvent) {
    event.preventDefault();
    const block = pilotJourneyBlock(role, scope.projectId, scope.environment, teamId, service, account);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/pilot/journeys', 'POST', {
      project_id: Number(scope.projectId),
      team_id: Number(teamId),
      service: service.trim(),
      account: account.trim(),
    });
    const saved = parsePilotJourney(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body, 'pilot request failed'));
      return;
    }
    setJourney(saved);
    setNotice('Pilot journey saved. The account is a label.');
    setError('');
  }

  async function onStep(event: FormEvent) {
    event.preventDefault();
    if (!journey) return;
    const block = pilotStepBlock(role, stepEnv, step, evidence);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/pilot/steps', 'POST', {
      journey_id: journey.id,
      environment: stepEnv,
      step,
      evidence: evidence.trim(),
    });
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') {
      setNotice('');
      setError(staticError(result.body, 'pilot request failed'));
      return;
    }
    const state = String((result.body as { state?: string }).state || 'unknown');
    if (state === 'recorded') setRecorded((current) => ({ ...current, [`${stepEnv}/${step}`]: true }));
    setNotice(state === 'recorded' ? 'Evidence recorded.' : PILOT_BLANK_MESSAGE);
    setError('');
  }

  async function onRollback(event: FormEvent) {
    event.preventDefault();
    if (!journey) return;
    const block = pilotStepBlock(role, stepEnv, 'restore', '');
    if (block && block !== 'That value is not accepted.') {
      setNotice('');
      setError(block);
      return;
    }
    if (elapsedSet && !/^\d+$/.test(elapsed.trim())) {
      setNotice('');
      setError('That value is not accepted.');
      return;
    }
    const result = await deskCall(apiUrl, '/api/pilot/rollbacks', 'POST', {
      journey_id: journey.id,
      environment: stepEnv,
      elapsed_set: elapsedSet,
      elapsed_seconds: elapsedSet ? Number(elapsed) : 0,
    });
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') {
      setNotice('');
      setError(staticError(result.body, 'pilot request failed'));
      return;
    }
    const state = String((result.body as { state?: string }).state || 'unknown');
    if (state === 'rehearsed') setRehearsed((current) => ({ ...current, [stepEnv]: true }));
    setNotice(state === 'rehearsed' ? 'Rollback rehearsed.' : 'Rollback without elapsed time stays Unknown.');
    setError('');
  }

  async function onPublish(event: FormEvent) {
    event.preventDefault();
    if (!journey) return;
    const checklistReady = PILOT_ENVIRONMENTS.every((environment) => PILOT_STEPS.every((name) => recorded[`${environment}/${name}`]));
    const rollbackReady = PILOT_ENVIRONMENTS.every((environment) => rehearsed[environment]);
    const block = pilotPublishBlock(role, scope.environment, reviewerId, actor, checklistReady, rollbackReady, criticalOpen);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/pilot/releases', 'POST', {
      journey_id: journey.id,
      reviewer_id: Number(reviewerId),
    });
    const state = result.body && typeof result.body === 'object' ? (result.body as { state?: string }).state : '';
    if (result.status !== 200 || state !== 'accepted') {
      setNotice('');
      setError(staticError(result.body, 'pilot request failed'));
      return;
    }
    setReleaseAccepted(true);
    setNotice('Release accepted. Self-publish submits nothing.');
    setError('');
  }

  async function onExpansion(event: FormEvent) {
    event.preventDefault();
    if (!journey) return;
    const block = pilotExpansionBlock(role, scope.environment, provider, expansionScope, ownerId);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/pilot/expansions', 'POST', {
      journey_id: journey.id,
      provider,
      scope: expansionScope.trim(),
      owner_id: Number(ownerId),
    });
    const id = result.body && typeof result.body === 'object' ? Number((result.body as { id?: number }).id) : 0;
    if (result.status !== 200 || !Number.isInteger(id) || id <= 0) {
      setNotice('');
      setError(staticError(result.body, 'pilot request failed'));
      return;
    }
    setExpansionId(id);
    setNotice('Expansion stays proposed. No cloud resource was created.');
    setError('');
  }

  async function onAcceptExpansion(event: FormEvent) {
    event.preventDefault();
    if (!expansionId || !releaseAccepted) {
      setNotice('');
      setError('A release must be accepted before expansion.');
      return;
    }
    const block = pilotPublishBlock(role, scope.environment, reviewerId, actor, true, true, false);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/pilot/expansions/accept', 'POST', {
      expansion_id: expansionId,
      reviewer_id: Number(reviewerId),
    });
    const state = result.body && typeof result.body === 'object' ? (result.body as { state?: string }).state : '';
    if (result.status !== 200 || state !== 'accepted') {
      setNotice('');
      setError(staticError(result.body, 'pilot request failed'));
      return;
    }
    setNotice(PILOT_EXPANSION_MESSAGE);
    setError('');
  }

  async function onBlocker(event: FormEvent) {
    event.preventDefault();
    if (!journey) return;
    const block = acceptanceRiskBlock(role, scope.environment, summary, reviewerId, actor, false);
    if (block || (severity !== 'critical' && severity !== 'normal')) {
      setNotice('');
      setError(block || 'That value is not accepted.');
      return;
    }
    const result = await deskCall(apiUrl, '/api/pilot/blockers', 'POST', {
      journey_id: journey.id,
      severity,
      summary: summary.trim(),
    });
    const id = result.body && typeof result.body === 'object' ? Number((result.body as { id?: number }).id) : 0;
    if (result.status !== 200 || id <= 0) {
      setNotice('');
      setError(staticError(result.body, 'pilot request failed'));
      return;
    }
    setBlockerId(id);
    if (severity === 'critical') setCriticalOpen(true);
    setNotice(severity === 'critical' ? 'Critical blocker stays open until a different reviewer resolves it.' : 'Blocker recorded.');
    setError('');
  }

  async function onResolve(event: FormEvent) {
    event.preventDefault();
    if (!blockerId) return;
    const block = pilotPublishBlock(role, scope.environment, reviewerId, actor, true, true, false);
    if (block || evidence.trim() === '') {
      setNotice('');
      setError(block || 'That value is not accepted.');
      return;
    }
    const result = await deskCall(apiUrl, '/api/pilot/blockers/resolve', 'POST', {
      blocker_id: blockerId,
      reviewer_id: Number(reviewerId),
      evidence: evidence.trim(),
    });
    const state = result.body && typeof result.body === 'object' ? (result.body as { state?: string }).state : '';
    if (result.status !== 200 || state !== 'resolved') {
      setNotice('');
      setError(staticError(result.body, 'pilot request failed'));
      return;
    }
    setCriticalOpen(false);
    setNotice('Blocker resolved by a different reviewer.');
    setError('');
  }

  async function onFeedback(event: FormEvent) {
    event.preventDefault();
    if (!journey) return;
    const block = acceptanceRiskBlock(role, scope.environment, note, reviewerId, actor, false);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/pilot/feedback', 'POST', { journey_id: journey.id, note: note.trim() });
    if (result.status !== 200) {
      setNotice('');
      setError(staticError(result.body, 'pilot request failed'));
      return;
    }
    setNotice('Feedback saved.');
    setError('');
  }

  async function onCase(event: FormEvent) {
    event.preventDefault();
    const block = acceptanceCaseBlock(role, scope.projectId, scope.environment, scenario, subject, revision, detail);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/acceptance/cases', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      scenario,
      subject: subject.trim(),
      revision: Number(revision),
      partial,
      detail: detail.trim(),
    });
    if (result.status !== 200) {
      setNotice('');
      setError(staticError(result.body, 'acceptance request failed'));
      return;
    }
    setNotice(partial ? 'Partial result stays open.' : 'Acceptance case recorded. The finding stays open.');
    setError('');
    await loadCases();
  }

  async function onClose(event: FormEvent) {
    event.preventDefault();
    const item = cases.find((row) => row.id === selectedCase);
    if (!item) return;
    const block = acceptanceCloseBlock(item.partial, item.state, item.findingOpen);
    if (block || !canWrite) {
      setNotice('');
      setError(block || 'A viewer can read this desk.');
      return;
    }
    const result = await deskCall(apiUrl, '/api/acceptance/findings/close', 'POST', { case_id: item.id });
    if (result.status !== 200) {
      setNotice('');
      setError(staticError(result.body, 'acceptance request failed'));
      return;
    }
    setNotice('Finding closed.');
    setError('');
    await loadCases();
  }

  async function onRisk(event: FormEvent) {
    event.preventDefault();
    if (!selectedCase) return;
    const block = acceptanceRiskBlock(role, scope.environment, riskSummary, reviewerId, actor, false);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/acceptance/risks', 'POST', { case_id: selectedCase, summary: riskSummary.trim() });
    const id = result.body && typeof result.body === 'object' ? Number((result.body as { id?: number }).id) : 0;
    if (result.status !== 200 || id <= 0) {
      setNotice('');
      setError(staticError(result.body, 'acceptance request failed'));
      return;
    }
    setRiskId(id);
    setNotice(PILOT_FINDING_MESSAGE);
    setError('');
  }

  async function onAcceptRisk(event: FormEvent) {
    event.preventDefault();
    if (!riskId) return;
    const block = acceptanceRiskBlock(role, scope.environment, riskSummary, reviewerId, actor, true);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/acceptance/risks/accept', 'POST', { risk_id: riskId, reviewer_id: Number(reviewerId) });
    const state = result.body && typeof result.body === 'object' ? (result.body as { state?: string }).state : '';
    if (result.status !== 200 || state !== 'accepted') {
      setNotice('');
      setError(staticError(result.body, 'acceptance request failed'));
      return;
    }
    setNotice('Risk accepted. The finding stays open.');
    setError('');
  }

  const visibleCases = hiddenRead ? [] : cases;

  return (
    <div className="desk-language">
      <header className="desk-landing">
        <h2>Pilot and acceptance</h2>
        <p>One team, one service, and an account label. Blank evidence stays Unknown. Accepting an expansion creates no cloud resource.</p>
      </header>
      <section className="desk-language__panel desk-language__rail" aria-label="Journey"><h2>Pilot journey</h2><form className="desk-language__form" onSubmit={onJourney}>
        <label>Team<input value={teamId} onChange={(event) => setTeamId(event.target.value)} /></label>
        <label>Service<input value={service} onChange={(event) => setService(event.target.value)} /></label>
        <label>Account label<input value={account} onChange={(event) => setAccount(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Open journey' : 'Read only'}</button>
      </form></section>
      {journey ? (
      <>
      <form className="desk-language__form" onSubmit={onStep}>
        <label>Step environment
          <select value={stepEnv} onChange={(event) => setStepEnv(event.target.value as (typeof PILOT_ENVIRONMENTS)[number])}>
            {PILOT_ENVIRONMENTS.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
          </select>
        </label>
        <label>Step
          <select value={step} onChange={(event) => setStep(event.target.value as (typeof PILOT_STEPS)[number])}>
            {PILOT_STEPS.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
          </select>
        </label>
        <label>Evidence<input value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !journey}>{canWrite ? 'Record step' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onRollback}>
        <label><input type="checkbox" checked={elapsedSet} onChange={(event) => setElapsedSet(event.target.checked)} /> Elapsed time is set</label>
        <label>Elapsed seconds<input value={elapsed} onChange={(event) => setElapsed(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !journey}>{canWrite ? 'Rehearse rollback' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onPublish}>
        <label>Reviewer<input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !journey}>{canWrite ? 'Publish release' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onExpansion}>
        <label>Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value as (typeof PILOT_PROVIDERS)[number])}>
            {PILOT_PROVIDERS.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
          </select>
        </label>
        <label>Expansion scope<input value={expansionScope} onChange={(event) => setExpansionScope(event.target.value)} /></label>
        <label>Owner<input value={ownerId} onChange={(event) => setOwnerId(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !journey}>{canWrite ? 'Propose expansion' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onAcceptExpansion}>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !expansionId}>{canWrite ? 'Accept expansion' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onBlocker}>
        <label>Blocker severity
          <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="normal">normal</option>
            <option value="critical">critical</option>
          </select>
        </label>
        <label>Blocker summary<input value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !journey}>{canWrite ? 'Open blocker' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onResolve}>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !blockerId}>{canWrite ? 'Resolve blocker' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onFeedback}>
        <label>Feedback<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !journey}>{canWrite ? 'Save feedback' : 'Read only'}</button>
      </form>
      </>
      ) : (
        <p className="desk-language__note">Open a journey before recording a step, rollback, or release.</p>
      )}
      <form className="desk-language__form" onSubmit={onCase}>
        <label>Scenario
          <select value={scenario} onChange={(event) => setScenario(event.target.value as (typeof PILOT_SCENARIOS)[number])}>
            {PILOT_SCENARIOS.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
          </select>
        </label>
        <label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <label>Revision<input value={revision} onChange={(event) => setRevision(event.target.value)} /></label>
        <label><input type="checkbox" checked={partial} onChange={(event) => setPartial(event.target.checked)} /> Partial result</label>
        <label>Detail<input value={detail} onChange={(event) => setDetail(event.target.value)} /></label>
        <label>Read project<input value={readProject} onChange={(event) => setReadProject(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Record case' : 'Read only'}</button>
      </form>
      {selectedCase ? (
      <>
      <form className="desk-language__form" onSubmit={onClose}>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !selectedCase}>{canWrite ? 'Close finding' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onRisk}>
        <label>Residual risk<input value={riskSummary} onChange={(event) => setRiskSummary(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !selectedCase}>{canWrite ? 'Record risk' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onAcceptRisk}>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || !riskId}>{canWrite ? 'Accept risk' : 'Read only'}</button>
      </form>
      </>
      ) : (
        <p className="desk-language__note">Select a case before closing a finding or recording a risk.</p>
      )}
      {error && error !== workspaceScopeBlock(scope.projectId, scope.environment) ? <DeskError message={error} /> : null}
      {notice ? <p className="desk-language__copy">{notice}</p> : null}
      {journey ? <p className="desk-language__copy">{journey.service} · account {journey.account}</p> : null}
      <section className="desk-language__records" aria-label="Acceptance cases">
        {workspaceScopeBlock(scope.projectId, scope.environment) ? (
          <div className="desk-language__empty"><DeskStateChip value="unknown" /><p>{workspaceScopeBlock(scope.projectId, scope.environment)}</p></div>
        ) : !hiddenRead && visibleCases.length === 0 && error.endsWith('request failed') ? (
          <div className="desk-language__empty"><DeskStateChip value="error" /></div>
        ) : visibleCases.length === 0 ? (
          <div className="desk-language__empty"><DeskStateChip value="empty" /><p>No acceptance cases in this project.</p></div>
        ) : null}
        <ul>
          {visibleCases.map((item) => (
            <li key={item.id} aria-current={item.id === selectedCase ? 'true' : undefined}>
              <button type="button" onClick={() => setSelectedCase(item.id)}>{item.subject}</button>
              <span>{item.scenario}</span>
              <span>{item.findingOpen ? 'Finding open' : 'Finding closed'}</span>
              <DeskStateChip value={item.state === 'unknown' ? 'unknown' : 'ready'} />
              {item.reason ? <span>{item.reason}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
