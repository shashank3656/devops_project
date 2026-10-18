import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';
import { CopyButton, formatCalendarDate, formatOperationalTime } from '@infragate/ui';
import { recordReference } from '../../lib/recordRef';
import { approvalLevel, requestPriorityName } from '../../lib/requestPriority';
import { safeReturnPath } from '../../lib/scopeHref';
import { buildRequestTracker, dedupeActivity, publicDetail } from '../../lib/requestTracker';

type RequestRecord = {
  id: number;
  service?: string;
  cloud?: string;
  env?: string;
  team?: string;
  project_name?: string;
  priority?: string;
  due_date?: string;
  status?: string;
  reject_reason?: string;
  created_at?: string;
  created_by_username?: string;
  pr_url?: string;
  application_id?: string;
  approval_context?: { summary?: string; current_stage?: string; next_stage?: string };
  delivery?: {
    pipeline_status?: string;
    pipeline_label?: string;
    ci_result?: string;
    last_sha?: string;
    pipeline_url?: string;
    pr_url?: string;
    image_digest?: string;
    promote_state?: string;
  };
};

type Comment = { id: number; username: string; body: string; created_at?: string };
type TimelineItem = { id: number; action: string; username: string; details?: string; created_at?: string };

function statusLabel(status?: string) {
  switch (status) {
    case 'draft': return 'Draft';
    case 'pending_user_manager_approval': return 'Waiting for manager';
    case 'pending_devops_approval': return 'Waiting for DevOps';
    case 'pending_approval': return 'Waiting for approval';
    case 'in_progress': return 'In progress';
    case 'completed': return 'Completed';
    case 'rejected': return 'Rejected';
    default: return status ? status.replaceAll('_', ' ') : 'Unknown';
  }
}

export default function RequestDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const requestId = Number(router.query.id);
  const returnPath = safeReturnPath(router.query.from);
  const backHref = returnPath || '/my-requests';
  const backLabel = returnPath.startsWith('/service-desk') ? 'Back to Service Desk' : returnPath ? 'Back' : 'Back to my requests';
  const [canOpenRetries, setCanOpenRetries] = useState(false);
  const [request, setRequest] = useState<RequestRecord | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  function load() {
    if (!Number.isFinite(requestId) || requestId <= 0) return;
    const headers = sessionAuthHeaders();
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/history/${requestId}`, { headers }).then((response) => response.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/request/${requestId}/comments`, { headers }).then((response) => response.ok ? response.json() : { comments: [] }),
      fetch(`${apiUrl}/api/request/${requestId}/timeline`, { headers }).then((response) => response.ok ? response.json() : { timeline: [] }),
    ]).then(([detail, commentBody, timelineBody]) => {
      const record = detail?.request;
      if (!record || typeof record.id !== 'number') {
        setError('This request was not found.');
        setRequest(null);
        return;
      }
      setRequest({
        id: record.id,
        service: record.service,
        cloud: record.cloud,
        env: record.env,
        team: record.team,
        project_name: record.project_name,
        priority: record.priority,
        due_date: record.due_date,
        status: record.status,
        reject_reason: record.reject_reason,
        created_at: record.created_at,
        created_by_username: record.created_by_username,
        pr_url: record.pr_url,
        application_id: record.application_id,
        approval_context: record.approval_context,
        delivery: detail.delivery,
      });
      setCanApprove(Boolean(detail.can_approve_by_manager));
      const notes = Array.isArray(commentBody?.comments) ? commentBody.comments : [];
      setComments(notes.map((item: Comment) => ({
        id: item.id,
        username: item.username || 'Someone',
        body: item.body,
        created_at: item.created_at,
      })));
      const events = Array.isArray(timelineBody?.timeline) ? timelineBody.timeline : [];
      setTimeline(dedupeActivity(events.map((item: TimelineItem) => ({
        id: item.id,
        action: item.action || 'update',
        username: item.username || 'Someone',
        details: item.details,
        created_at: item.created_at,
      }))));
    }).catch(() => setError('This request could not be loaded.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem('devops_user');
      const user = raw ? JSON.parse(raw) as { role?: string; devops_profile?: { is_manager?: boolean } } : null;
      setCanOpenRetries(Boolean(user?.devops_profile?.is_manager) || user?.role === 'admin');
    } catch {
      setCanOpenRetries(false);
    }
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    load();
  }, [apiUrl, requestId, router.isReady]);

  const pipelineFailed = request?.delivery?.pipeline_status === 'failed';

  async function act(path: string) {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/request/${requestId}/${path}`, {
        method: 'POST',
        headers: sessionAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'That action was not saved.');
        return;
      }
      if ((path === 'resubmit' || path === 'clone' || path === 'promote') && body?.id) {
        await router.push(`/requests/${body.id}`);
        return;
      }
      setNotice(typeof body?.message === 'string' ? body.message : 'Saved.');
      load();
    } catch {
      setError('That action could not be saved.');
    } finally {
      setWorking(false);
    }
  }

  async function addComment(event: React.FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    setWorking(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/request/${requestId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({ body: note.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'The note was not added.');
        return;
      }
      setNote('');
      load();
    } catch {
      setError('The note could not be added.');
    } finally {
      setWorking(false);
    }
  }

  const stage = request?.approval_context;
  const tracker = request ? buildRequestTracker({
    status: request.status,
    team: request.team,
    owner: request.created_by_username,
    prUrl: request.delivery?.pr_url || request.pr_url,
    pipelineUrl: request.delivery?.pipeline_url,
    pipelineStatus: request.delivery?.pipeline_status,
    pipelineLabel: request.delivery?.pipeline_label,
    ciResult: request.delivery?.ci_result,
    sha: request.delivery?.last_sha,
    imageDigest: request.delivery?.image_digest,
    applicationId: request.application_id,
    promoteState: request.delivery?.promote_state,
    rejectReason: request.reject_reason,
  }) : null;

  return (
    <>
      <Head>
        <title>{request ? `${recordReference('REQ', request.id)} - OpsTrellis` : 'Request - OpsTrellis'}</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Requests</p>
              <p className="ig-cell-meta">
                {request ? recordReference('REQ', request.id) : 'Request'}
                {request ? <CopyButton value={recordReference('REQ', request.id)} label="request number" /> : null}
              </p>
              <h1>{request ? (request.service || 'Request') : 'Request'}</h1>
              <p>{request ? `${statusLabel(request.status)} · ${request.env || 'Unknown'} · Owner ${request.created_by_username || request.team || 'Unassigned'} · ${request.project_name || 'No project'}` : 'Open a request from your list.'}</p>
              {tracker ? (
                <ol className="request-tracker" aria-label="Request progress">
                  {tracker.stages.map((item) => (
                    <li key={item.id} className={`request-tracker__step is-${item.state}`} aria-current={item.state === 'current' || item.state === 'failed' ? 'step' : undefined}>
                      <strong>{item.label}</strong>
                      <span>{item.id === 'verification' && item.state !== 'done' && item.state !== 'cancelled' ? 'Not recorded' : item.state === 'done' ? 'Done' : item.state === 'failed' ? 'Failed' : item.state === 'cancelled' ? 'Cancelled' : item.state === 'current' ? 'Current' : 'Waiting'}</span>
                      <small>{item.who}. {item.detail}</small>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            <Link href={backHref} className="btn btn-secondary">{backLabel}</Link>
          </header>
          {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          {loading ? <p className="work-empty">Loading request…</p> : null}
          {!loading && request ? (
            <>
              <section className="portal-surface request-summary">
                <div className="request-facts">
                  <div><span>Project</span><strong>{request.project_name || request.team || 'No project'}</strong></div>
                  <div><span>Environment</span><strong>{request.env || 'Unknown'}</strong></div>
                  <div><span>Cloud</span><strong>{request.cloud || '—'}</strong></div>
                  <div><span>Priority</span><strong>{requestPriorityName(request.priority)}</strong></div>
                  <div><span>Approval level</span><strong>{approvalLevel(request.priority)}</strong></div>
                  <div><span>Needed by</span><strong>{formatCalendarDate(request.due_date)}</strong></div>
                  <div><span>Raised</span><strong>{formatOperationalTime(request.created_at)}</strong></div>
                </div>
                {stage?.summary ? <p className="access-hint">{stage.summary}</p> : null}
                {stage?.next_stage ? <p className="access-hint">Next: {stage.next_stage}</p> : null}
                {request.reject_reason ? <p className="access-hint">{/cancel/i.test(request.reject_reason) ? 'Cancelled' : 'Rejected'}: {request.reject_reason}</p> : null}
                {tracker ? (
                  <div className="request-blocker" role="status">
                    <strong>{tracker.blockerTitle}</strong>
                    <p>Who can resolve it: {tracker.blockerWho}</p>
                    <p>Next permitted action: {tracker.blockerNext}</p>
                  </div>
                ) : null}
                {tracker ? (
                  <div className="request-facts">
                    <div><span>Resource</span><strong>{tracker.verification.resourceId}</strong></div>
                    <div><span>Verification check</span><strong>{tracker.verification.check}</strong></div>
                    <div><span>Result</span><strong>{tracker.verification.result}</strong></div>
                    <div><span>Verified at</span><strong>{tracker.verification.recorded ? formatOperationalTime(tracker.verification.at) : tracker.verification.at}</strong></div>
                    <div>
                      <span>Evidence</span>
                      <strong>{tracker.verification.href ? <a href={tracker.verification.href} target="_blank" rel="noreferrer">Open evidence</a> : 'Verification not recorded'}</strong>
                    </div>
                    {tracker.evidence.map((item) => (
                      <div key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.href ? <a href={item.href} target="_blank" rel="noreferrer">{item.value}</a> : item.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="request-actions">
                  {canApprove ? <button type="button" className="btn btn-primary" disabled={working} onClick={() => act('approve-by-manager')}>Approve as manager</button> : null}
                  {request.status === 'draft' ? <button type="button" className="btn btn-primary" disabled={working} onClick={() => act('submit')}>Submit for approval</button> : null}
                  {request.status === 'rejected' ? <button type="button" className="btn btn-secondary" disabled={working} onClick={() => act('resubmit')}>Raise again</button> : null}
                  {request.status === 'completed' || (request.status === 'in_progress' && !pipelineFailed) ? <button type="button" className="btn btn-secondary" disabled={working} onClick={() => act('promote')}>Promote to next environment</button> : null}
                  {pipelineFailed && canOpenRetries ? <Link href="/retry-center" className="btn btn-secondary">Open retries</Link> : null}
                  <button type="button" className="btn btn-secondary" disabled={working} onClick={() => act('clone')}>Copy as draft</button>
                  {request.status === 'draft' || request.status === 'pending_user_manager_approval' || request.status === 'pending_devops_approval' || request.status === 'pending_approval' ? (
                    <button type="button" className="btn btn-secondary" disabled={working} onClick={() => act('cancel')}>Cancel request</button>
                  ) : null}
                </div>
              </section>
              <div className="request-split">
                <section className="portal-surface request-panel">
                  <h2 className="access-form__title">Notes</h2>
                  {comments.length === 0 ? <p className="work-empty">No notes yet.</p> : (
                    <ul className="request-timeline">
                      {comments.map((comment) => (
                        <li key={comment.id}>
                          <strong>{comment.username}</strong>
                          <span>{comment.body}</span>
                          {comment.created_at ? <small>{formatOperationalTime(comment.created_at)}</small> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form className="request-note" onSubmit={addComment}>
                    <label className="label" htmlFor="request-note">Add a note
                      <input id="request-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} />
                    </label>
                    <button type="submit" className="btn btn-primary" disabled={working || !note.trim()}>Add note</button>
                  </form>
                </section>
                <section className="portal-surface request-panel">
                  <h2 className="access-form__title">What happened</h2>
                  {timeline.length === 0 ? <p className="work-empty">No activity yet.</p> : (
                    <ul className="request-timeline">
                      {timeline.map((item) => (
                        <li key={`${item.id}-${item.action}-${item.created_at || ''}`}>
                          <strong>{item.username}</strong>
                          <span>{publicDetail(item.action) || 'Update'}</span>
                          {item.details ? <span>{publicDetail(item.details)}</span> : null}
                          {item.created_at ? <small>{formatOperationalTime(item.created_at)}</small> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
