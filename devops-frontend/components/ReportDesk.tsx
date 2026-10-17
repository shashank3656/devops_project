import { FormEvent, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  AUTOMATION_ACTION,
  AUTOMATION_NOTIFY_MESSAGE,
  AUTOMATION_RESULTS,
  AUTOMATION_SOURCES,
  AUTOMATION_TRIGGERS,
  DeskError,
  DeskStateChip,
  REPORT_DRAFT_MESSAGE,
  REPORT_METRICS,
  REPORT_TIMEZONE,
  automationRuleBlock,
  automationRunBlock,
  deskCanWrite,
  deskErrorText,
  deskWord,
  parseAutomationRule,
  parseReportView,
  reportCoverageState,
  reportDefinitionBlock,
  reportDraftBlock,
  reportPublishBlock,
  type AutomationRuleView,
  type ReportViewModel,
} from '@infragate/ui';
import { actorId, deskCall, sessionRole, useDeskScope } from './deskClient';

function staticError(body: unknown, fallback: string): string {
  const message = deskErrorText(body);
  return message === 'request failed' ? fallback : message;
}

export default function ReportDesk() {
  const apiUrl = useApiUrl();
  const scope = useDeskScope();
  const role = sessionRole();
  const [metric, setMetric] = useState<(typeof REPORT_METRICS)[number]>('delivery');
  const [view, setView] = useState<ReportViewModel | null>(null);
  const [draftText, setDraftText] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [trigger, setTrigger] = useState<(typeof AUTOMATION_TRIGGERS)[number]>('assignment');
  const [sourceKind, setSourceKind] = useState<(typeof AUTOMATION_SOURCES)[number]>('finding');
  const [sourceId, setSourceId] = useState('');
  const [resultName, setResultName] = useState<(typeof AUTOMATION_RESULTS)[number]>('delivered');
  const [depth, setDepth] = useState('0');
  const [rule, setRule] = useState<AutomationRuleView | null>(null);
  const [runId, setRunId] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canWrite = deskCanWrite(role);

  async function onDefine(event: FormEvent) {
    event.preventDefault();
    const block = reportDefinitionBlock(role, scope.projectId, scope.environment, metric);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/reports/definitions', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      metric,
    });
    if (result.status !== 200) {
      setNotice('');
      setError(staticError(result.body, 'report request failed'));
      return;
    }
    setNotice(`Report saved in ${REPORT_TIMEZONE}.`);
    setError('');
  }

  async function onView(event?: FormEvent) {
    event?.preventDefault();
    const block = reportDefinitionBlock('operator', scope.projectId, scope.environment, metric);
    if (block && block !== 'A viewer can read this desk.') {
      setView(null);
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, `/api/reports/views?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}&metric=${metric}`, 'GET');
    const saved = parseReportView(result.body);
    if (result.status !== 200 || !saved) {
      setView(null);
      setError(staticError(result.body, 'report request failed'));
      return;
    }
    setView(saved);
    setNotice(saved.denominator === 0 ? 'A zero denominator stays empty.' : 'Report view loaded.');
    setError('');
  }

  function onDraft(event: FormEvent) {
    event.preventDefault();
    const block = reportDraftBlock(role, scope.environment, draftText);
    setNotice('');
    setError(block || REPORT_DRAFT_MESSAGE);
  }

  function onPublish(event?: FormEvent) {
    event?.preventDefault();
    const block = reportPublishBlock(role, scope.environment, reviewerId, actorId(), actorId());
    setNotice('');
    setError(block || REPORT_DRAFT_MESSAGE);
  }

  async function onRule(event: FormEvent) {
    event.preventDefault();
    const block = automationRuleBlock(role, scope.projectId, scope.environment, trigger, AUTOMATION_ACTION);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/automation/rules', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      trigger,
      action: AUTOMATION_ACTION,
    });
    const saved = parseAutomationRule(result.body);
    if (result.status !== 200 || !saved) {
      setNotice('');
      setError(staticError(result.body, 'automation request failed'));
      return;
    }
    setRule(saved);
    setNotice(AUTOMATION_NOTIFY_MESSAGE);
    setError('');
  }

  async function onRun(event: FormEvent) {
    event.preventDefault();
    const block = automationRunBlock(role, scope.environment, sourceKind, sourceId, depth);
    if (block) {
      setNotice('');
      setError(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/automation/runs', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      trigger,
      source_kind: sourceKind,
      source_id: sourceId.trim(),
      result: resultName,
      depth: Number(depth),
    });
    const id = result.body && typeof result.body === 'object' ? Number((result.body as { id?: number }).id) : 0;
    if (result.status !== 200 || id <= 0) {
      setNotice('');
      setError(staticError(result.body, 'automation request failed'));
      return;
    }
    setRunId(id);
    setNotice('Notification recorded. Nothing was executed.');
    setError('');
  }

  return (
    <div className="alert-page">
      <header className="work-page__head">
        <div>
          <h1>Reports and automation</h1>
          <p>A report is a count over a count, in UTC. A rule can notify. It cannot run a change.</p>
        </div>
      </header>
      {error ? <DeskError message={error} /> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}
      <div className="alert-board">
        <section className="portal-surface" aria-label="Report">
          <div className="portal-surface__header">
            <h2 className="portal-surface__title">Report</h2>
          </div>
          <form className="alert-channels" onSubmit={onDefine}>
            <label className="label">Metric
              <select className="input" value={metric} onChange={(event) => setMetric(event.target.value as (typeof REPORT_METRICS)[number])}>
                {REPORT_METRICS.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
              </select>
            </label>
            <label className="label">Timezone<input className="input" value={REPORT_TIMEZONE} readOnly /></label>
            <div className="alert-channel--wide portal-page__actions">
              <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Save report' : 'Read only'}</button>
              <button type="button" className="btn btn-secondary" onClick={() => void onView()}>Read view</button>
            </div>
          </form>
          <form className="alert-channels" onSubmit={onDraft}>
            <label className="label alert-channel--wide">Draft
              <input className="input" value={draftText} onChange={(event) => setDraftText(event.target.value)} />
            </label>
            <label className="label">Reviewer
              <input className="input" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} />
            </label>
            <div className="portal-page__actions" style={{ alignSelf: 'end' }}>
              <button type="submit" className="btn btn-secondary" disabled={!canWrite}>{canWrite ? 'Save draft' : 'Read only'}</button>
              <button type="button" className="btn btn-primary" disabled={!canWrite} onClick={() => onPublish()}>{canWrite ? 'Publish' : 'Read only'}</button>
            </div>
          </form>
          {view ? (
            <p className="alert-hint">
              {view.numeratorName} {view.numerator} / {view.denominatorName} {view.denominator}. {view.timezone}.{' '}
              <DeskStateChip value={reportCoverageState(view.coverage)} />
            </p>
          ) : null}
        </section>
        <section className="portal-surface" aria-label="Automation">
          <div className="portal-surface__header">
            <h2 className="portal-surface__title">Automation</h2>
          </div>
          <form className="alert-channels alert-channels--stack" onSubmit={onRule}>
            <label className="label">Trigger
              <select className="input" value={trigger} onChange={(event) => setTrigger(event.target.value as (typeof AUTOMATION_TRIGGERS)[number])}>
                {AUTOMATION_TRIGGERS.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
              </select>
            </label>
            <label className="label">Action<input className="input" value={AUTOMATION_ACTION} readOnly /></label>
            <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Save rule' : 'Read only'}</button>
          </form>
          <form className="alert-channels alert-channels--stack" onSubmit={onRun}>
            <label className="label">Source
              <select className="input" value={sourceKind} onChange={(event) => setSourceKind(event.target.value as (typeof AUTOMATION_SOURCES)[number])}>
                {AUTOMATION_SOURCES.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
              </select>
            </label>
            <label className="label">Source id<input className="input" value={sourceId} onChange={(event) => setSourceId(event.target.value)} /></label>
            <label className="label">Result
              <select className="input" value={resultName} onChange={(event) => setResultName(event.target.value as (typeof AUTOMATION_RESULTS)[number])}>
                {AUTOMATION_RESULTS.map((item) => <option key={item} value={item}>{deskWord(item)}</option>)}
              </select>
            </label>
            <label className="label">Depth<input className="input" value={depth} onChange={(event) => setDepth(event.target.value)} /></label>
            <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Record notification' : 'Read only'}</button>
          </form>
          {rule ? <p className="alert-hint">{rule.trigger}, version {rule.version}. Notify only.</p> : null}
          {runId ? <p className="alert-hint">Notification {runId} recorded. Nothing was executed.</p> : null}
        </section>
      </div>
    </div>
  );
}
