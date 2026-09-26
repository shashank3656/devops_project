import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { buildPortalApiUrl, parsePortalNumericId, portalFetch } from '@infragate/ui';
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
        <title>{item?.problem_number || 'Problem'} - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Problem</span>
            <h1 className="portal-page__title">{item?.problem_number || 'Problem'}</h1>
            <p className="portal-page__subtitle">{item?.summary || 'Recurring alert fingerprint.'}</p>
          </div>
          <div className="portal-page__actions">
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
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {item ? (
          <section className="portal-surface">
            <div className="portal-form-grid">
              <label className="label">Fingerprint<input className="input" readOnly value={item.fingerprint} /></label>
              <label className="label">Service<input className="input" readOnly value={item.service || '—'} /></label>
              <label className="label">Occurrences<input className="input" readOnly value={String(item.occurrence_count)} /></label>
              <label className="label">Priority<input className="input" readOnly value={priorityLabel(item.priority || 'p3')} /></label>
              <label className="label">State<input className="input" readOnly value={problemStateLabel(item.status)} /></label>
              <label className="label">Known error<input className="input" readOnly value={item.known_error ? 'Yes' : 'No'} /></label>
              <label className="label">Category<input className="input" readOnly value={[item.category, item.subcategory].filter(Boolean).join(' / ') || '—'} /></label>
              <label className="label">Assignment group<input className="input" readOnly value={item.assignment_group_name || '—'} /></label>
              <label className="label">Assignee<input className="input" readOnly value={item.assignee_username || '—'} /></label>
              <label className="label">Caller<input className="input" readOnly value={item.caller_username || '—'} /></label>
              <label className="label">
                Related incident
                {item.related_incident_id ? (
                  <Link href={`/incidents/${item.related_incident_id}/edit`} className="input" style={{ display: 'block' }}>
                    Open INC record
                  </Link>
                ) : (
                  <input className="input" readOnly value="None" />
                )}
              </label>
            </div>
            <ITSMClock sla={item.sla} />
            {item.description ? <p className="portal-page__subtitle">{item.description}</p> : null}
            {item.workaround ? <p className="portal-page__subtitle">Workaround: {item.workaround}</p> : null}
            <p className="portal-surface__subtitle">
              Publish a knowledge article after this is a known error. The article copies the workaround and root cause.
            </p>
            <div className="portal-form-actions">
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
