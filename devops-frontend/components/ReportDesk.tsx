import Link from 'next/link';
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
  const [role, setRole] = useState<'viewer' | 'operator'>(sessionRole());
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

  async function onView(event: FormEvent) {
    event.preventDefault();
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

  function onPublish(event: FormEvent) {
    event.preventDefault();
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
    <div className="desk-language">
      <p className="desk-language__intro">A report names a numerator and a denominator in UTC. Drafts stay off until the gate is enabled. Automation can notify and cannot execute.</p>
      <div className="desk-language__bar">
        <span>{role === 'viewer' ? 'Viewer' : 'Operator'}</span>
        <button type="button" onClick={() => setRole((item) => (item === 'viewer' ? 'operator' : 'viewer'))}>{role === 'viewer' ? 'Preview operator' : 'Preview viewer'}</button>
        <Link href="/dashboard">Overview</Link>
      </div>
      <form className="desk-language__form" onSubmit={onDefine}>
        <label>Metric
          <select value={metric} onChange={(event) => setMetric(event.target.value as (typeof REPORT_METRICS)[number])}>
            {REPORT_METRICS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Timezone<input value={REPORT_TIMEZONE} readOnly /></label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Save report' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onView}>
        <button type="submit">Read view</button>
      </form>
      <form className="desk-language__form" onSubmit={onDraft}>
        <label>Draft text<input value={draftText} onChange={(event) => setDraftText(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Save draft' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onPublish}>
        <label>Reviewer user id<input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Publish draft' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onRule}>
        <label>Trigger
          <select value={trigger} onChange={(event) => setTrigger(event.target.value as (typeof AUTOMATION_TRIGGERS)[number])}>
            {AUTOMATION_TRIGGERS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Action<input value={AUTOMATION_ACTION} readOnly /></label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Save rule' : 'Read only'}</button>
      </form>
      <form className="desk-language__form" onSubmit={onRun}>
        <label>Source
          <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as (typeof AUTOMATION_SOURCES)[number])}>
            {AUTOMATION_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Source id<input value={sourceId} onChange={(event) => setSourceId(event.target.value)} /></label>
        <label>Result
          <select value={resultName} onChange={(event) => setResultName(event.target.value as (typeof AUTOMATION_RESULTS)[number])}>
            {AUTOMATION_RESULTS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Depth<input value={depth} onChange={(event) => setDepth(event.target.value)} /></label>
        <button type="submit" disabled={!canWrite}>{canWrite ? 'Record notification' : 'Read only'}</button>
      </form>
      {error ? <DeskError message={error} /> : null}
      {notice ? <p className="desk-language__copy">{notice}</p> : null}
      {view ? (
        <p className="desk-language__copy">
          {view.numeratorName} {view.numerator} / {view.denominatorName} {view.denominator}. {view.timezone}.
          <DeskStateChip value={reportCoverageState(view.coverage)} />
          {view.coverage === 'partial' ? <span>Partial</span> : null}
        </p>
      ) : null}
      {rule ? <p className="desk-language__copy">{rule.trigger} version {rule.version}. Action notify. Can execute off.</p> : null}
      {runId ? <p className="desk-language__copy">Notification {runId}. Can execute off.</p> : null}
    </div>
  );
}
