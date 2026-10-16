import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

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
  approval_context?: { summary?: string; current_stage?: string; next_stage?: string };
};

type Comment = { id: number; username: string; body: string; created_at?: string };
type TimelineItem = { id: number; action: string; username: string; created_at?: string };

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

function levelFor(priority?: string) {
  switch ((priority || 'medium').toLowerCase()) {
    case 'low': return 'L1';
    case 'high': return 'L3';
    case 'critical': return 'L4';
    default: return 'L2';
  }
}

export default function RequestDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const requestId = Number(router.query.id);
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
        approval_context: record.approval_context,
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
      setTimeline(events.map((item: TimelineItem) => ({
        id: item.id,
        action: item.action || 'update',
        username: item.username || 'Someone',
        created_at: item.created_at,
      })));
    }).catch(() => setError('This request could not be loaded.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!router.isReady) return;
    load();
  }, [apiUrl, requestId, router.isReady]);

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

  return (
    <>
      <Head>
        <title>{request ? `Request ${request.id} - DevOps` : 'Request - DevOps'}</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Requests</p>
              <h1>{request ? `${request.service || 'Request'} #${request.id}` : 'Request'}</h1>
              <p>{request ? statusLabel(request.status) : 'Open a request from your list.'}</p>
            </div>
            <Link href="/my-requests" className="btn btn-secondary">Back to my requests</Link>
          </header>
          {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          {loading ? <p className="work-empty">Loading request…</p> : null}
          {!loading && request ? (
            <>
              <section className="portal-surface access-form">
                <p className="access-hint">{request.project_name || request.team || 'No project'} · {request.env || 'Unknown environment'}{request.cloud ? ` · ${request.cloud}` : ''}</p>
                <p className="access-hint">Priority {request.priority || 'medium'} goes to {levelFor(request.priority)}.</p>
                {stage?.summary ? <p className="access-hint">{stage.summary}</p> : null}
                {stage?.next_stage ? <p className="access-hint">Next: {stage.next_stage}</p> : null}
                {request.reject_reason ? <p className="access-hint">Rejected: {request.reject_reason}</p> : null}
                {request.due_date ? <p className="access-hint">Needed by {String(request.due_date).slice(0, 10)}</p> : null}
                {request.created_at ? <p className="access-hint">Raised {new Date(request.created_at).toLocaleString()}</p> : null}
                <div className="access-create__end">
                  {canApprove ? <button type="button" className="btn btn-primary" disabled={working} onClick={() => act('approve-by-manager')}>Approve as manager</button> : null}
                  {request.status === 'draft' ? <button type="button" className="btn btn-primary" disabled={working} onClick={() => act('submit')}>Submit for approval</button> : null}
                  {request.status === 'rejected' ? <button type="button" className="btn btn-secondary" disabled={working} onClick={() => act('resubmit')}>Raise again</button> : null}
                  {request.status === 'completed' || request.status === 'in_progress' ? <button type="button" className="btn btn-secondary" disabled={working} onClick={() => act('promote')}>Promote to next environment</button> : null}
                  <button type="button" className="btn btn-secondary" disabled={working} onClick={() => act('clone')}>Copy as draft</button>
                  {request.status === 'draft' || request.status === 'pending_user_manager_approval' || request.status === 'pending_devops_approval' || request.status === 'pending_approval' ? (
                    <button type="button" className="btn btn-secondary" disabled={working} onClick={() => act('cancel')}>Cancel request</button>
                  ) : null}
                </div>
              </section>
              <section className="portal-surface access-form">
                <h2 className="access-form__title">Notes</h2>
                {comments.length === 0 ? <p className="work-empty">No notes yet.</p> : (
                  <ul className="access-members">
                    {comments.map((comment) => (
                      <li key={comment.id}>
                        <span><strong>{comment.username}</strong> {comment.body}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <form onSubmit={addComment}>
                  <label className="label" htmlFor="request-note">Add a note</label>
                  <input id="request-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} />
                  <button type="submit" className="btn btn-primary" disabled={working || !note.trim()}>Add note</button>
                </form>
              </section>
              <section className="portal-surface access-form">
                <h2 className="access-form__title">What happened</h2>
                {timeline.length === 0 ? <p className="work-empty">No activity yet.</p> : (
                  <ul className="access-members">
                    {timeline.map((item) => (
                      <li key={`${item.id}-${item.action}`}>
                        <span>{item.username} · {item.action.replaceAll('_', ' ')}{item.created_at ? ` · ${new Date(item.created_at).toLocaleString()}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
