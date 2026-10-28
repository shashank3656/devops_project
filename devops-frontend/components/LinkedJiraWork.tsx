import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { InspectorDrawer, buildPortalApiUrl, portalFetch } from '@infragate/ui';
import {
  JIRA_RELATIONSHIPS,
  jiraHealthLabel,
  jiraHealthTone,
  jiraRelationshipLabel,
  type JiraIssue,
  type JiraLink,
  type JiraRemediationRule,
  type JiraSpace,
  type JiraSource,
  type JiraSuggestion,
} from '../lib/jira';

const TOKEN_KEY = 'devops_token';

function authToken() {
  return typeof window === 'undefined' ? '' : localStorage.getItem(TOKEN_KEY) || '';
}

export default function LinkedJiraWork({
  apiUrl,
  source,
  compact = true,
  allowActions = true,
  browseAll = false,
}: {
  apiUrl: string;
  source?: JiraSource;
  compact?: boolean;
  allowActions?: boolean;
  browseAll?: boolean;
}) {
  const [links, setLinks] = useState<JiraLink[]>([]);
  const [spaces, setSpaces] = useState<JiraSpace[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'closed' | 'link' | 'create' | 'comment' | 'transition' | 'attach' | 'details'>('closed');
  const [suggestions, setSuggestions] = useState<JiraSuggestion[]>([]);
  const [rules, setRules] = useState<JiraRemediationRule[]>([]);
  const [commentTarget, setCommentTarget] = useState<JiraLink | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [actionTarget, setActionTarget] = useState<JiraLink | null>(null);
  const [transitions, setTransitions] = useState<Array<{ id: string; name: string; to?: string }>>([]);
  const [transitionId, setTransitionId] = useState('');
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const [spaceId, setSpaceId] = useState(0);
  const [issueRef, setIssueRef] = useState('');
  const [relationship, setRelationship] = useState(source?.sourceType === 'security_finding' || source?.sourceType === 'cost_recommendation' ? 'remediates' : source?.sourceType === 'change' || source?.sourceType === 'pull_request' ? 'implements' : 'follow_up');
  const [summary, setSummary] = useState(source?.defaultSummary || '');
  const [description, setDescription] = useState(source?.defaultDescription || source?.defaultSummary || '');
  const [issueTypeId, setIssueTypeId] = useState('');
  const [issueTypes, setIssueTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [requiredFields, setRequiredFields] = useState<Array<{ id: string; name: string; required: boolean; schema?: string }>>([]);
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  const [hits, setHits] = useState<JiraIssue[]>([]);
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => {
    if (browseAll || !source) return 'assigned=1';
    const params = new URLSearchParams({ source_type: source.sourceType });
    if (source.sourceId) params.set('source_id', String(source.sourceId));
    if (source.sourceKey) params.set('source_key', source.sourceKey);
    return params.toString();
  }, [browseAll, source]);

  const load = useCallback(() => {
    const token = authToken();
    if (!token || !apiUrl) return;
    setLoading(true);
    setError('');
    Promise.all([
      portalFetch(buildPortalApiUrl(apiUrl, query ? `/api/devops/integrations/jira/links?${query}` : '/api/devops/integrations/jira/links'), { token }),
      portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/spaces'), { token }),
    ])
      .then(async ([linkRes, spaceRes]) => {
        const linkBody = await linkRes.json().catch(() => ({}));
        const spaceBody = await spaceRes.json().catch(() => ({}));
        if (!linkRes.ok) throw new Error(linkBody.error || 'Linked Jira work could not be loaded');
        setLinks(Array.isArray(linkBody.links) ? linkBody.links : []);
        setSpaces(Array.isArray(spaceBody.spaces) ? spaceBody.spaces : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Linked Jira work could not be loaded'))
      .finally(() => setLoading(false));
  }, [apiUrl, query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSummary(source?.defaultSummary || '');
    setDescription(source?.defaultDescription || source?.defaultSummary || '');
  }, [source?.defaultDescription, source?.defaultSummary]);
  useEffect(() => {
    const token = authToken();
    if (!token || !apiUrl || !source || browseAll) return;
    const title = source.suggestTitle || source.defaultSummary || '';
    const bodyText = source.suggestBody || source.defaultDescription || '';
    if (title || source.suggestBranch || bodyText) {
      const params = new URLSearchParams({
        source_type: source.sourceType,
        source_id: String(source.sourceId || 0),
        source_key: source.sourceKey || '',
        title,
        branch: source.suggestBranch || '',
        body: bodyText,
      });
      void portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/suggestions?${params}`), { token })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          setSuggestions(Array.isArray(body.suggestions) ? body.suggestions : []);
        })
        .catch(() => setSuggestions([]));
    }
    if (source.sourceType === 'security_finding' || source.sourceType === 'cost_recommendation') {
      void portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/remediation-rules?source_type=${encodeURIComponent(source.sourceType)}`), { token })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          setRules((Array.isArray(body.rules) ? body.rules as JiraRemediationRule[] : []).filter((rule) => rule.enabled));
        })
        .catch(() => setRules([]));
    }
  }, [apiUrl, browseAll, source]);

  const selectedSpace = spaces.find((space) => space.id === spaceId);
  const canLink = spaces.some((space) => space.can_link);
  const canCreate = spaces.some((space) => space.can_create);

  async function searchIssues() {
    const token = authToken();
    if (!token || !spaceId || !issueRef.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/search?space_id=${spaceId}&q=${encodeURIComponent(issueRef.trim())}`), { token });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Search failed');
      setHits(Array.isArray(body.issues) ? body.issues : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  async function loadTypes(id: number) {
    const token = authToken();
    if (!token || !id) return;
    const space = spaces.find((item) => item.id === id);
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/spaces/${id}/issue-types`), { token });
    const body = await res.json().catch(() => ({}));
    const types = Array.isArray(body.issue_types) ? body.issue_types : [];
    setIssueTypes(types);
    const mappedId = space?.default_issue_type_id && types.some((type: { id: string }) => type.id === space.default_issue_type_id)
      ? space.default_issue_type_id
      : types[0]?.id || '';
    if (space?.default_relationship) setRelationship(space.default_relationship);
    if (space?.field_defaults_json) {
      try {
        const parsed = JSON.parse(space.field_defaults_json) as Record<string, unknown>;
        const next: Record<string, string> = {};
        Object.entries(parsed || {}).forEach(([key, value]) => {
          if (value != null && String(value).trim()) next[key] = String(value);
        });
        if (Object.keys(next).length) setExtraFields(next);
      } catch {
        /* mapping JSON is optional */
      }
    }
    if (mappedId) {
      setIssueTypeId(mappedId);
      void loadMeta(id, mappedId);
    }
  }

  async function loadMeta(id: number, typeId: string) {
    const token = authToken();
    if (!token || !id || !typeId) return;
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/spaces/${id}/create-meta?issue_type_id=${encodeURIComponent(typeId)}`), { token });
    const body = await res.json().catch(() => ({}));
    const fields = Array.isArray(body.preview?.fields) ? body.preview.fields as Array<{ id: string; name: string; required: boolean; schema?: string }> : [];
    setRequiredFields(fields.filter((field) => field.required && !['summary', 'description', 'project', 'issuetype', 'reporter', 'parent'].includes(field.id)));
  }

  async function waitForOperation(operationId?: string) {
    if (!operationId) {
      load();
      return;
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      const token = authToken();
      const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/operations/${encodeURIComponent(operationId)}`), { token });
      const body = await res.json().catch(() => ({}));
      const state = body.operation?.state;
      if (state === 'succeeded') {
        setNotice('Jira accepted the operation.');
        load();
        return;
      }
      if (state === 'failed') {
        setError(body.operation?.last_error || 'Jira rejected the operation.');
        load();
        return;
      }
    }
    setNotice('The operation is still running. Check Activity if it does not appear here.');
    load();
  }

  async function submitLink(ref = issueRef, nextSpace = spaceId, nextRelationship = relationship) {
    const token = authToken();
    if (!token || !nextSpace || !ref.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/links'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space_id: nextSpace,
          issue_ref: ref.trim(),
          relationship: nextRelationship,
          source_type: source?.sourceType,
          source_id: source?.sourceId || 0,
          source_key: source?.sourceKey || '',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Link could not be queued');
      setNotice('Link queued. Waiting for Jira to confirm the issue.');
      setMode('closed');
      await waitForOperation(body.operation?.operation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link could not be queued');
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    const token = authToken();
    if (!token || !spaceId || !summary.trim() || !issueTypeId) return;
    setBusy(true);
    setError('');
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/issues'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space_id: spaceId,
          issue_type_id: issueTypeId,
          summary: summary.trim(),
          description: description.trim(),
          relationship,
          source_type: source?.sourceType,
          source_id: source?.sourceId || 0,
          source_key: source?.sourceKey || '',
          fields: extraFields,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Create could not be queued');
      setNotice('Create queued. Waiting for Jira to confirm the issue.');
      setMode('closed');
      await waitForOperation(body.operation?.operation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create could not be queued');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSuggestion(item: JiraSuggestion) {
    if (!item.validated) {
      setIssueRef(item.key);
      setRelationship(item.relationship || 'implements');
      setMode('link');
      setNotice(item.note || 'Search a permitted space to confirm this key before linking.');
      return;
    }
    setSpaceId(item.space_id);
    setRelationship(item.relationship || 'implements');
    await submitLink(item.issue.issue_key, item.space_id, item.relationship || 'implements');
    setSuggestions((current) => current.filter((row) => !(row.issue.cloud_id === item.issue.cloud_id && row.issue.issue_id === item.issue.issue_id)));
  }

  async function dismissSuggestion(item: JiraSuggestion) {
    const token = authToken();
    if (!token) return;
    await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/suggestions/dismiss'), {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_type: source?.sourceType,
        source_id: source?.sourceId || 0,
        source_key: source?.sourceKey || '',
        cloud_id: item.issue.cloud_id,
        issue_id: item.issue.issue_id,
      }),
    });
    setSuggestions((current) => current.filter((row) => !(row.issue.cloud_id === item.issue.cloud_id && row.issue.issue_id === item.issue.issue_id)));
  }

  async function applyRule(rule: JiraRemediationRule) {
    const token = authToken();
    if (!token || !source) return;
    setBusy(true);
    setError('');
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/remediation-rules/${rule.id}/apply`), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: source.sourceType,
          source_id: source.sourceId || 0,
          source_key: source.sourceKey || '',
          summary: (source.defaultSummary || '').trim(),
          description: (source.defaultDescription || source.defaultSummary || '').trim(),
          approved: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Remediation could not be queued');
      setNotice(body.note || 'Remediation queued. Jira Done will not mark this record Fixed.');
      await waitForOperation(body.operation?.operation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remediation could not be queued');
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    const token = authToken();
    if (!token || !commentTarget || !commentBody.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/comments'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloud_id: commentTarget.issue.cloud_id,
          issue_id: commentTarget.issue.issue_id,
          body: commentBody.trim(),
          source_type: source?.sourceType,
          source_id: source?.sourceId || 0,
          source_key: source?.sourceKey || '',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Comment could not be queued');
      setNotice('Comment queued. It will not be mirrored back here.');
      setMode('closed');
      setCommentBody('');
      await waitForOperation(body.operation?.operation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comment could not be queued');
    } finally {
      setBusy(false);
    }
  }

  async function submitBulkLink() {
    const token = authToken();
    const keys = issueRef.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    if (!token || !spaceId || keys.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/bulk'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'link',
          items: keys.map((key) => ({
            space_id: spaceId,
            issue_ref: key,
            relationship,
            source_type: source?.sourceType,
            source_id: source?.sourceId || 0,
            source_key: source?.sourceKey || '',
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Bulk link could not be queued');
      const failed = (Array.isArray(body.results) ? body.results : []).filter((item: { ok?: boolean }) => !item.ok);
      setNotice(failed.length ? `${keys.length - failed.length} queued, ${failed.length} failed.` : `${keys.length} links queued.`);
      setMode('closed');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk link could not be queued');
    } finally {
      setBusy(false);
    }
  }

  async function openTransition(link: JiraLink) {
    const token = authToken();
    setActionTarget(link);
    setMode('transition');
    setTransitions([]);
    setTransitionId('');
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/transitions?cloud_id=${encodeURIComponent(link.issue.cloud_id)}&issue_id=${encodeURIComponent(link.issue.issue_id)}`), { token });
    const body = await res.json().catch(() => ({}));
    const next = Array.isArray(body.transitions) ? body.transitions : [];
    setTransitions(next);
    if (next[0]?.id) setTransitionId(next[0].id);
  }

  async function submitTransition() {
    const token = authToken();
    if (!token || !actionTarget || !transitionId) return;
    setBusy(true);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/transitions'), {
        method: 'POST', token, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloud_id: actionTarget.issue.cloud_id,
          issue_id: actionTarget.issue.issue_id,
          transition_id: transitionId,
          source_type: source?.sourceType,
          source_id: source?.sourceId || 0,
          source_key: source?.sourceKey || '',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Transition could not be queued');
      setNotice('Transition queued. Done in Jira does not close this record.');
      setMode('closed');
      await waitForOperation(body.operation?.operation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transition could not be queued');
    } finally {
      setBusy(false);
    }
  }

  async function submitAttach() {
    const token = authToken();
    if (!token || !actionTarget || !attachFile) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('cloud_id', actionTarget.issue.cloud_id);
      form.append('issue_id', actionTarget.issue.issue_id);
      form.append('file', attachFile);
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/attachments'), { method: 'POST', token, body: form, timeoutMs: 60000 });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Attachment was rejected');
      setNotice(body.note || 'File sent to Jira and not stored here.');
      setMode('closed');
      setAttachFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attachment was rejected');
    } finally {
      setBusy(false);
    }
  }

  async function bulkTransitionSelected() {
    const token = authToken();
    const chosen = links.filter((link) => selectedIds[link.id]);
    if (!token || !transitionId || chosen.length === 0) return;
    setBusy(true);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/bulk'), {
        method: 'POST', token, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transition',
          items: chosen.map((link) => ({
            cloud_id: link.issue.cloud_id,
            issue_id: link.issue.issue_id,
            transition_id: transitionId,
            source_type: source?.sourceType,
            source_id: source?.sourceId || 0,
            source_key: source?.sourceKey || '',
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Bulk transition could not be queued');
      const failed = (Array.isArray(body.results) ? body.results : []).filter((item: { ok?: boolean }) => !item.ok);
      setNotice(failed.length ? `Some transitions failed (${failed.length}).` : 'Selected transitions queued.');
      setSelectedIds({});
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk transition could not be queued');
    } finally {
      setBusy(false);
    }
  }

  async function refreshIssues(items: JiraLink[]) {
    const token = authToken();
    const chosen = items.slice(0, 25);
    if (!token || chosen.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/bulk'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refresh',
          items: chosen.map((link) => ({
            cloud_id: link.issue.cloud_id,
            issue_id: link.issue.issue_id,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Refresh could not be queued');
      const failed = (Array.isArray(body.results) ? body.results : []).filter((item: { ok?: boolean }) => !item.ok);
      setNotice(failed.length ? `${chosen.length - failed.length} refreshed, ${failed.length} failed.` : 'Refresh queued for linked issues.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh could not be queued');
    } finally {
      setBusy(false);
    }
  }

  async function unlink(id: number) {
    const token = authToken();
    if (!token) return;
    setBusy(true);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/links/${id}`), { method: 'DELETE', token });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Unlink failed');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlink failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={compact ? 'jira-panel' : 'portal-surface jira-panel'}>
      <div className="portal-surface__header">
        <div>
          <h2 className="portal-surface__title">Linked Jira work</h2>
          <p className="portal-surface__subtitle">{browseAll ? 'Assigned Jira work uses verified Jira account identifiers. This list does not create a second queue.' : 'Jira status is informational. Done in Jira does not close this record.'}</p>
        </div>
        {allowActions && source ? (
          <div className="request-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={loading || !canLink} onClick={() => { setMode('link'); setHits([]); }}>Link existing</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={loading || !canCreate} onClick={() => { setMode('create'); const first = spaces.find((s) => s.can_create); if (first) { setSpaceId(first.id); void loadTypes(first.id); } }}>Create issue</button>
            {links.some((link) => link.issue.stale) ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void refreshIssues(links.filter((link) => link.issue.stale))}>Refresh stale</button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {allowActions && source && !loading && (!canLink || !canCreate) ? (
        <p className="form-section__copy">
          Connect Jira and enable a space to continue.{' '}
          <Link href="/integrations/jira">Open Jira setup</Link>
          . If you cannot add a connection, contact your administrator.
        </p>
      ) : null}
      {allowActions && suggestions.length ? (
        <div className="portal-surface" style={{ marginBottom: 16 }}>
          <h3 className="portal-surface__title">Suggested Jira work</h3>
          <p className="form-section__copy">Matched from the title, branch, or description. Nothing is linked until you confirm.</p>
          <ul className="jira-link-list">
            {suggestions.map((item) => (
              <li key={`${item.issue.cloud_id || 'pending'}:${item.issue.issue_id || item.key}`} className="jira-link-card">
                <div>
                  <strong>{item.issue.issue_key || item.key} {item.issue.summary}</strong>
                  <p className="form-section__copy">{item.validated ? `Matched in ${item.reason}. ${item.issue.site_name} / ${item.issue.space_key}` : item.note}</p>
                </div>
                <div className="request-actions" style={{ marginTop: 0 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void confirmSuggestion(item)}>{item.validated ? 'Confirm link' : 'Search to confirm'}</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void dismissSuggestion(item)}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {allowActions && rules.length ? (
        <div className="portal-surface" style={{ marginBottom: 16 }}>
          <h3 className="portal-surface__title">Approved remediation rules</h3>
          <p className="form-section__copy">Creating Jira work does not mark this record Fixed or treat ticket completion as verified savings.</p>
          <ul className="jira-link-list">
            {rules.map((rule) => (
              <li key={rule.id} className="jira-link-card">
                <span>{rule.site_name} / {rule.space_key} · {rule.issue_type_name || rule.issue_type_id}{rule.auto_create ? ' · auto for approved records' : ''}</span>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void applyRule(rule)}>Create from rule</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {loading ? <p className="work-empty">Loading linked Jira work…</p> : null}
      {!loading && links.length === 0 ? <p className="form-section__copy">No Jira issues are linked yet.</p> : null}
      {links.length && allowActions && Object.values(selectedIds).some(Boolean) ? (
        <div className="request-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { const first = links.find((link) => selectedIds[link.id]); if (first) void openTransition(first); }}>Transition selected</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void refreshIssues(links.filter((link) => selectedIds[link.id]))}>Refresh selected</button>
        </div>
      ) : null}
      {links.length ? (
        <ul className="jira-link-list">
          {links.map((link) => (
            <li key={link.id} className="jira-link-card">
              <div>
                {allowActions ? (
                  <label>
                    <input type="checkbox" checked={Boolean(selectedIds[link.id])} onChange={(event) => setSelectedIds((current) => ({ ...current, [link.id]: event.target.checked }))} />
                    {' '}
                  </label>
                ) : null}
                <strong>
                  {link.issue.browse_url ? <a href={link.issue.browse_url} target="_blank" rel="noreferrer">{link.issue.issue_key}</a> : link.issue.issue_key}
                  {' '}{link.issue.summary}
                </strong>
                <p>
                  <span className={`jira-health jira-health--${jiraHealthTone(link.issue.stale ? 'delayed' : 'synced')}`}>{link.issue.status || 'Unknown'}</span>
                  {' · '}{link.issue.assignee || 'Unassigned'}
                  {' · '}{link.issue.site_name || 'Jira'} / {link.issue.space_key || link.issue.space_name || 'Space'}
                  {' · '}{jiraRelationshipLabel(link.relationship)}
                </p>
                <p className="form-section__copy">
                  Last successful sync {link.issue.last_success_at ? new Date(link.issue.last_success_at).toLocaleString() : 'Unknown'}
                  {link.issue.stale ? ` · ${jiraHealthLabel(link.issue.freshness || 'stale')}` : ''}
                </p>
              </div>
              <div className="request-actions" style={{ marginTop: 0 }}>
                {link.issue.browse_url ? <a className="btn btn-secondary btn-sm" href={link.issue.browse_url} target="_blank" rel="noreferrer">Open in Jira</a> : null}
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setActionTarget(link); setMode('details'); }}>View details</button>
                {allowActions ? (
                  <>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void openTransition(link)}>Transition</button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setActionTarget(link); setAttachFile(null); setMode('attach'); }}>Attach</button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setCommentTarget(link); setCommentBody(''); setMode('comment'); }}>Comment</button>
                  </>
                ) : null}
                {link.can_unlink ? (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void unlink(link.id)}>Unlink</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <InspectorDrawer
        open={mode !== 'closed'}
        onClose={() => setMode('closed')}
        eyebrow={mode === 'create' ? 'Create Jira issue' : mode === 'comment' ? 'Publish a Jira comment' : mode === 'transition' ? 'Apply a Jira transition' : mode === 'attach' ? 'Attach a file' : mode === 'details' ? 'Jira issue details' : 'Link existing issue'}
        title={mode === 'create' ? 'Send a selected summary to Jira' : mode === 'comment' ? 'Preview the exact text Jira will receive' : mode === 'transition' ? 'Choose a supported Jira transition' : mode === 'attach' ? 'Send a file to Jira' : mode === 'details' ? (actionTarget?.issue.issue_key || 'Linked issue') : 'Search by key or title'}
        subtitle={mode === 'comment' ? 'Comments are not mirrored back. AI summaries are not included unless you paste them.' : mode === 'transition' ? 'Done in Jira does not close this portal record.' : mode === 'attach' ? 'The file is sent to Jira and is not stored in OpsTrellis. Logs and secrets are blocked.' : mode === 'details' ? 'Jira owns title, status, assignee, and priority after creation.' : 'Preview the destination before anything is sent. Logs, attachments, and internal notes stay here.'}
        footer={(
          <div className="request-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setMode('closed')}>Cancel</button>
            {mode === 'link' ? (
              <button type="button" className="btn btn-primary" disabled={busy || !spaceId || !issueRef.trim()} onClick={() => { const keys = issueRef.split(/[\s,]+/).filter(Boolean); if (keys.length > 1) void submitBulkLink(); else void submitLink(); }}>Queue link</button>
            ) : null}
            {mode === 'transition' ? (
              <button type="button" className="btn btn-primary" disabled={busy || !transitionId} onClick={() => { const chosen = Object.values(selectedIds).filter(Boolean).length; if (chosen > 1) void bulkTransitionSelected(); else void submitTransition(); }}>Apply transition</button>
            ) : null}
            {mode === 'attach' ? (
              <button type="button" className="btn btn-primary" disabled={busy || !attachFile} onClick={() => void submitAttach()}>Send to Jira</button>
            ) : null}
            {mode === 'create' ? (
              <button type="button" className="btn btn-primary" disabled={busy || !spaceId || !summary.trim() || !issueTypeId || requiredFields.some((field) => !String(extraFields[field.id] || '').trim())} onClick={() => void submitCreate()}>Queue create</button>
            ) : null}
            {mode === 'comment' ? (
              <button type="button" className="btn btn-primary" disabled={busy || !commentBody.trim()} onClick={() => void submitComment()}>Publish comment</button>
            ) : null}
          </div>
        )}
      >
        {mode === 'details' ? (
          <>
            <p><strong>{actionTarget?.issue.issue_key} {actionTarget?.issue.summary}</strong></p>
            <p>{actionTarget?.issue.status || 'Unknown'} · {actionTarget?.issue.assignee || 'Unassigned'} · {actionTarget?.issue.site_name} / {actionTarget?.issue.space_key}</p>
            <p className="form-section__copy">Relationship {jiraRelationshipLabel(actionTarget?.relationship || 'related')}. Last successful sync {actionTarget?.issue.last_success_at ? new Date(actionTarget.issue.last_success_at).toLocaleString() : 'Unknown'}.</p>
            {actionTarget?.issue.browse_url ? <a className="btn btn-secondary btn-sm" href={actionTarget.issue.browse_url} target="_blank" rel="noreferrer">Open in Jira</a> : null}
          </>
        ) : mode === 'comment' ? (
          <>
            <p className="form-section__copy">Publishing to {commentTarget?.issue.issue_key} on {commentTarget?.issue.site_name} / {commentTarget?.issue.space_key}.</p>
            <label className="label">Comment sent to Jira
              <textarea className="input" rows={6} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Write the update that should appear in Jira" />
            </label>
            {commentBody.trim() ? <p className="form-section__copy">Preview: {commentBody.trim()}</p> : null}
          </>
        ) : mode === 'transition' ? (
          <>
            <p className="form-section__copy">Updating {actionTarget?.issue.issue_key}. Only transitions Jira allows for the connection owner are listed.</p>
            <label className="label">Transition
              <select className="input" value={transitionId} onChange={(event) => setTransitionId(event.target.value)}>
                {transitions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.to ? ` → ${item.to}` : ''}</option>)}
              </select>
            </label>
          </>
        ) : mode === 'attach' ? (
          <>
            <p className="form-section__copy">Attaching to {actionTarget?.issue.issue_key}. Maximum 10 MB. PDF, images, and text are allowed. Logs and credential files are not.</p>
            <input type="file" onChange={(event) => setAttachFile(event.target.files?.[0] || null)} />
          </>
        ) : (
        <>
        <label className="label">Jira space
          <select className="input" value={spaceId || ''} onChange={(event) => { const nextId = Number(event.target.value); setSpaceId(nextId); if (mode === 'create') void loadTypes(nextId); }}>
            <option value="">Select a space</option>
            {spaces.filter((space) => (mode === 'create' ? space.can_create : space.can_link)).map((space) => (
              <option key={space.id} value={space.id}>{space.site_name || 'Jira'} / {space.name} ({space.jira_project_key})</option>
            ))}
          </select>
        </label>
        {selectedSpace ? (
          <p className="form-section__copy">Destination: {selectedSpace.site_name} · {selectedSpace.name} ({selectedSpace.jira_project_key}). Issue identity uses this site plus the Jira issue ID.</p>
        ) : null}
        <label className="label">Relationship
          <select className="input" value={relationship} onChange={(event) => setRelationship(event.target.value)}>
            {JIRA_RELATIONSHIPS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        {mode === 'link' ? (
          <>
            <label className="label">Issue key or title
              <textarea className="input" rows={3} value={issueRef} onChange={(event) => setIssueRef(event.target.value)} placeholder="PAY-245 or one key per line" />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !spaceId || !issueRef.trim()} onClick={() => void searchIssues()}>{busy ? 'Searching…' : 'Search'}</button>
            {hits.length ? (
              <ul className="jira-link-list">
                {hits.map((issue) => (
                  <li key={`${issue.cloud_id}:${issue.issue_id}`}>
                    <button type="button" className="btn btn-secondary" onClick={() => { setIssueRef(issue.issue_key); void submitLink(issue.issue_key); }}>
                      {issue.issue_key} {issue.summary}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <>
            <label className="label">Issue type
              <select className="input" value={issueTypeId} onChange={(event) => { setIssueTypeId(event.target.value); void loadMeta(spaceId, event.target.value); }}>
                {issueTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </label>
            <label className="label">Summary
              <input className="input" value={summary} onChange={(event) => setSummary(event.target.value)} />
            </label>
            <label className="label">Description sent to Jira
              <textarea className="input" rows={5} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            {requiredFields.map((field) => (
              <label key={field.id} className="label">{field.name} (required)
                <input className="input" value={extraFields[field.id] || ''} onChange={(event) => setExtraFields((current) => ({ ...current, [field.id]: event.target.value }))} />
              </label>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" disabled={!spaceId} onClick={() => void loadTypes(spaceId)}>Refresh required fields</button>
            <p className="form-section__copy">Sending to {selectedSpace ? `${selectedSpace.site_name} / ${selectedSpace.name} (${selectedSpace.jira_project_key})` : 'the selected space'}. Remove any sensitive details before queueing. Internal notes, logs, and attachments are not included.</p>
          </>
        )}
        </>
        )}
      </InspectorDrawer>
    </section>
  );
}
