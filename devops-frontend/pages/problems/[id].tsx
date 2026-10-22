import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { buildPortalApiUrl, CopyButton, parsePortalNumericId, portalFetch } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import ITSMClock from '../../components/ITSMClock';
import ITSMJournal from '../../components/ITSMJournal';
import { useApiUrl } from '../../context/ApiUrlContext';
import { ITSMJournalEntry, ITSM_PRIORITIES, IncidentSLA, PROBLEM_STATES, normalizeJournal, normalizeSLA, priorityLabel, problemStateLabel } from '../../lib/itsm';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProblemDetail {
  id: number;
  problem_number: string;
  fingerprint: string;
  service: string;
  environment: string;
  summary: string;
  status: string;
  priority?: string;
  description?: string;
  workaround?: string;
  root_cause?: string;
  occurrence_count: number;
  known_error?: boolean;
  related_incident_id?: number;
  category?: string;
  subcategory?: string;
  assignment_group_name?: string;
  assignee_username?: string;
  caller_username?: string;
  knowledge_article_id?: number;
  sla?: IncidentSLA | null;
}

export default function ProblemDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [item, setItem] = useState<ProblemDetail | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [journal, setJournal] = useState<ITSMJournalEntry[]>([]);
  const [articleId, setArticleId] = useState(0);
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const resourceId = parsePortalNumericId(id);

  const load = () => {
    if (!resourceId) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/problems/${resourceId}`), { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load problem');
          return;
        }
        const problem = data.problem || null;
        if (problem) {
          problem.sla = normalizeSLA(problem.sla);
        }
        setItem(problem);
        setJournal(normalizeJournal(data.journal));
        const article = data.article && typeof data.article === 'object' ? data.article as { id?: number } : {};
        setArticleId(typeof article.id === 'number' ? article.id : (problem?.knowledge_article_id || 0));
      })
      .catch(() => setError('Failed to load problem'));
  };

  useEffect(() => {
    load();
  }, [apiUrl, resourceId]);

  const setStatus = (status: string) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !resourceId) return;
    setSaving(true);
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/problems/${resourceId}`), {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to update problem');
          return;
        }
        setItem(data.problem || item);
      })
      .finally(() => setSaving(false));
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.problem_number || 'Problem'} - OpsTrellis</title>
      </Head>
      <div className="work-page">
        <header className="work-page__head">
          <div>
            <p className="ops-kicker">
              {item?.problem_number || 'Problem'}
              {item?.problem_number ? <CopyButton value={item.problem_number} label="problem number" /> : null}
            </p>
            <h1>{item?.summary || 'Problem'}</h1>
            <p>{item ? [problemStateLabel(item.status), priorityLabel(item.priority || 'p3'), item.assignee_username ? `Owner ${item.assignee_username}` : 'Owner unassigned', item.service || 'No service'].join(' · ') : 'Recurring alert fingerprint.'}</p>
          </div>
          <div className="request-actions" style={{ marginTop: 0 }}>
            <Link
              href={`/changes/new?problem=${encodeURIComponent(item?.problem_number || '')}&title=${encodeURIComponent(item?.summary ? `Fix ${item.summary}` : 'Problem fix')}&incident=${item?.related_incident_id ? encodeURIComponent(String(item.related_incident_id)) : ''}`}
              className="btn btn-primary"
            >
              Create change
            </Link>
            {articleId > 0 ? (
              <Link href={`/knowledge/${articleId}`} className="btn btn-secondary">Open knowledge</Link>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={publishing || !item?.known_error}
                onClick={() => {
                  const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                  if (!token || !resourceId) return;
                  setPublishing(true);
                  portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/problems/${resourceId}/knowledge`), {
                    method: 'POST',
                    token,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                  })
                    .then(async (res) => {
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setError(data?.error || 'Failed to publish knowledge article');
                        return;
                      }
                      const article = data.article && typeof data.article === 'object' ? data.article as { id?: number } : {};
                      if (typeof article.id === 'number') {
                        setArticleId(article.id);
                        void router.push(`/knowledge/${article.id}`);
                      }
                    })
                    .finally(() => setPublishing(false));
                }}
              >
                {publishing ? 'Publishing...' : 'Publish knowledge article'}
              </button>
            )}
            <Link href="/problems" className="btn btn-secondary">Back to problems</Link>
          </div>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {item ? (
          <section className="work-board">
            <div className="request-facts">
              <div><span>Fingerprint</span><strong>{item.fingerprint || '—'}</strong></div>
              <div><span>Service</span><strong>{item.service || '—'}</strong></div>
              <div><span>Environment</span><strong>{item.environment || '—'}</strong></div>
              <div><span>Occurrences</span><strong>{String(item.occurrence_count)}</strong></div>
              <div><span>Priority</span><strong>{priorityLabel(item.priority || 'p3')}</strong></div>
              <div><span>State</span><strong>{problemStateLabel(item.status)}</strong></div>
              <div><span>Known error</span><strong>{item.known_error ? 'Yes' : 'No'}</strong></div>
              <div><span>Category</span><strong>{[item.category, item.subcategory].filter(Boolean).join(' / ') || '—'}</strong></div>
              <div><span>Assignment group</span><strong>{item.assignment_group_name || '—'}</strong></div>
              <div><span>Assignee</span><strong>{item.assignee_username || '—'}</strong></div>
              <div><span>Caller</span><strong>{item.caller_username || '—'}</strong></div>
              <div>
                <span>Related incident</span>
                <strong>
                  {item.related_incident_id ? (
                    <Link href={`/incidents/${item.related_incident_id}/edit`}>Open incident</Link>
                  ) : 'None'}
                </strong>
              </div>
              <ITSMClock sla={item.sla} />
            </div>
            {item.description ? <p className="chg-detail__prose">{item.description}</p> : null}
            {item.workaround ? <p className="chg-detail__prose"><strong>Workaround. </strong>{item.workaround}</p> : null}
            {item.root_cause ? <p className="chg-detail__prose"><strong>Root cause. </strong>{item.root_cause}</p> : null}
            <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <input
                type="checkbox"
                checked={Boolean(item.known_error)}
                disabled={saving}
                onChange={(event) => {
                  const next = event.target.checked;
                  const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                  if (!token || !resourceId) return;
                  setSaving(true);
                  setError('');
                  portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/problems/${resourceId}`), {
                    method: 'PATCH',
                    token,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ known_error: next }),
                  })
                    .then(async (res) => {
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setError(data?.error || 'Failed to update problem');
                        return;
                      }
                      if (data.problem) setItem(data.problem);
                    })
                    .finally(() => setSaving(false));
                }}
              />
              Known error. Publishing a knowledge article copies the workaround and root cause.
            </label>
            <div className="portal-form-grid" style={{ marginTop: 16 }}>
              <label className="label">
                State
              <select
                className="input"
                value={item.status === 'open' ? 'new' : item.status}
                disabled={saving}
                onChange={(event) => setStatus(event.target.value)}
              >
                {PROBLEM_STATES.map((state) => (
                  <option key={state.value} value={state.value}>{state.label}</option>
                ))}
              </select>
              </label>
              <label className="label">
                Priority
              <select
                className="input"
                value={item.priority || 'p3'}
                disabled={saving}
                onChange={(event) => {
                  const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                  if (!token || !resourceId) return;
                  setSaving(true);
                  portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/problems/${resourceId}`), {
                    method: 'PATCH',
                    token,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ priority: event.target.value }),
                  })
                    .then(async (res) => {
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setError(data?.error || 'Failed to update problem');
                        return;
                      }
                      setItem(data.problem || item);
                    })
                    .finally(() => setSaving(false));
                }}
              >
                {ITSM_PRIORITIES.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
              </label>
            </div>
            <ITSMJournal
              apiUrl={apiUrl}
              path={`/api/devops/problems/${id}/journal`}
              entries={journal}
              onPosted={setJournal}
            />
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
