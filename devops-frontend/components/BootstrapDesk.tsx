import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  BOOTSTRAP_LANGUAGE,
  BOOTSTRAP_MAX_ATTEMPTS,
  BOOTSTRAP_PRODUCTION_MESSAGE,
  BOOTSTRAP_STEPS,
  DeskError,
  DeskStateChip,
  bootstrapProduction,
  bootstrapRecordBlock,
  bootstrapReviewBlock,
  bootstrapStepBlock,
  deskCanWrite,
  deskErrorText,
  parseBootstrap,
  parseBootstrapStep,
  parseBootstraps,
  workspaceScopeBlock,
  type BootstrapStepView,
  type BootstrapView,
} from '@infragate/ui';
import { actorId, deskCall, sessionRole, useDeskScope } from './deskClient';

function staticError(body: unknown): string {
  const message = deskErrorText(body);
  return message === 'request failed' ? 'bootstrap request failed' : message;
}

export default function BootstrapDesk() {
  const apiUrl = useApiUrl();
  const scope = useDeskScope();
  const [role, setRole] = useState<'viewer' | 'operator'>(sessionRole());
  const [service, setService] = useState('');
  const [version, setVersion] = useState('1');
  const [selectedId, setSelectedId] = useState(0);
  const [stepName, setStepName] = useState<(typeof BOOTSTRAP_STEPS)[number]>('catalog');
  const [passed, setPassed] = useState(true);
  const [steps, setSteps] = useState<Record<number, BootstrapStepView[]>>({});
  const [reviewerId, setReviewerId] = useState('');
  const [records, setRecords] = useState<BootstrapView[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const actor = actorId();
  const canWrite = deskCanWrite(role);
  const selected = records.find((item) => item.id === selectedId) || null;
  const selectedSteps = steps[selectedId] || [];

  function priorPassed(name: string): boolean {
    if (name === 'catalog') return true;
    const prior = name === 'telemetry' ? 'catalog' : 'telemetry';
    return selectedSteps.some((item) => item.name === prior && item.state === 'passed');
  }

  async function load() {
    if (bootstrapProduction(scope.environment)) {
      setRecords([]);
      setError(BOOTSTRAP_PRODUCTION_MESSAGE);
      return;
    }
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block) {
      setRecords([]);
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, `/api/service-bootstraps?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}`, 'GET');
    if (result.status !== 200) {
      setRecords([]);
      setError(staticError(result.body));
      return;
    }
    setRecords(parseBootstraps(result.body));
    setError('');
  }

  useEffect(() => {
    void load();
  }, [apiUrl, scope.environment, scope.projectId]);

  async function onRecord(event: FormEvent) {
    event.preventDefault();
    const block = bootstrapRecordBlock(role, scope.projectId, scope.environment, service, version);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/service-bootstraps', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      service: service.trim(),
      language: BOOTSTRAP_LANGUAGE,
      version: Number(version),
    });
    const saved = parseBootstrap(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setSelectedId(saved.id);
    setNotice(saved.applied ? 'Service staged.' : 'Service staged. A retry keeps this same row.');
    setError('');
    await load();
  }

  async function onStep(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const block = bootstrapStepBlock(role, scope.environment, stepName, priorPassed(stepName));
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/service-bootstraps/steps', 'POST', {
      bootstrap_id: selected.id,
      name: stepName,
      passed,
    });
    const saved = parseBootstrapStep(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setSteps((current) => {
      const existing = current[selected.id] || [];
      const next = existing.filter((item) => item.name !== saved.name);
      return { ...current, [selected.id]: [...next, saved] };
    });
    setNotice(saved.reason === 'retry bound reached' ? 'Attempts stopped at 3. The same row stays staged.' : `Step ${saved.name} is ${saved.state}. Attempts ${saved.attempts} of ${BOOTSTRAP_MAX_ATTEMPTS}.`);
    setError('');
  }

  async function onPipeline(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const ready = BOOTSTRAP_STEPS.every((name) => selectedSteps.some((item) => item.name === name && item.state === 'passed'));
    if (!canWrite) {
      setNotice('');
      setError('A viewer can read this desk.');
      return;
    }
    if (!ready) {
      setNotice('');
      setError('Generated CI validates only after catalog, telemetry, and security.');
      return;
    }
    const result = await deskCall(apiUrl, '/api/service-bootstraps/pipeline', 'POST', { bootstrap_id: selected.id });
    const saved = parseBootstrap(result.body);
    if (result.status !== 200 || !saved || !saved.ciValid) {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setNotice('Pipeline validated. Can apply stays off.');
    setError('');
    await load();
  }

  async function onReview(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const block = bootstrapReviewBlock(role, scope.environment, selected.ciValid, reviewerId, actor);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/service-bootstraps/reviews', 'POST', {
      bootstrap_id: selected.id,
      reviewer_id: Number(reviewerId),
    });
    const state = result.body && typeof result.body === 'object' ? (result.body as { state?: unknown }).state : '';
    if (result.status !== 200 || state !== 'proposed') {
      setNotice('');
      setError(staticError(result.body));
      return;
    }
    setNotice('Review proposed. Can apply stays off.');
    setError('');
  }

  return (
    <div className="desk-language">
      <p className="desk-language__intro">One staged Go service. Catalog, telemetry, and security pass in order. Generated CI validates only after those three. A failed step resumes on the same row.</p>
      <div className="desk-language__bar">
        <span>{role === 'viewer' ? 'Viewer' : 'Operator'}</span>
        <button type="button" onClick={() => setRole((item) => (item === 'viewer' ? 'operator' : 'viewer'))}>
          {role === 'viewer' ? 'Preview operator' : 'Preview viewer'}
        </button>
        <Link href="/templates">Request templates</Link>
      </div>
      <form className="desk-language__form" onSubmit={onRecord}>
        <label>Service<input value={service} onChange={(event) => setService(event.target.value)} /></label>
        <label>Language<input value={BOOTSTRAP_LANGUAGE} readOnly /></label>
        <label>Version<input value={version} onChange={(event) => setVersion(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Stage service' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onStep}>
        <label>Step
          <select value={stepName} onChange={(event) => setStepName(event.target.value as (typeof BOOTSTRAP_STEPS)[number])}>
            {BOOTSTRAP_STEPS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={passed} onChange={(event) => setPassed(event.target.checked)} /> Step passed</label>
        <button type="submit" disabled={!canWrite || !selected}>{canWrite ? 'Record step' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onPipeline}>
        <button type="submit" disabled={!canWrite || !selected}>{canWrite ? 'Validate pipeline' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onReview}>
        <label>Reviewer user id<input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite || !selected || !selected.ciValid}>{canWrite ? 'Propose review' : 'Read only'}</button>
      </form>
      {!selected ? <p className="desk-language__copy">Select a staged service before recording a step.</p> : null}
      {error ? <DeskError>{error}</DeskError> : null}
      {notice ? <p className="desk-language__copy">{notice}</p> : null}
      <section className="desk-language__records" aria-label="Bootstraps">
        {records.length === 0 ? <p>No staged services in this project.</p> : null}
        <ul>
          {records.map((item) => (
            <li key={item.id} aria-current={item.id === selectedId ? 'true' : undefined}>
              <button type="button" onClick={() => setSelectedId(item.id)}>{item.service}</button>
              <span>{item.language}</span>
              <span>Version {item.version}</span>
              <span>{item.state}</span>
              <span>{item.ciValid ? 'CI validated' : 'CI not validated'}</span>
              <DeskStateChip state={item.observed} />
              <span>Can apply off</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
