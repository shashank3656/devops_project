import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BulkBar, ChangeCatalogTable, CopyButton, InspectorDrawer, SavedViews, type RowKey, type SavedView } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import BlockedAction from '../../components/BlockedAction';
import { useApiUrl } from '../../context/ApiUrlContext';

type ChangeView = { query: string; status: string; type: string; mine: string };

const CHANGE_VIEW_PRESETS: SavedView<ChangeView>[] = [
  { name: 'Changes awaiting my approval', filters: { query: '', status: 'new', type: '', mine: '1' } },
  { name: 'Failed changes', filters: { query: '', status: 'failed', type: '', mine: '' } },
];

function currentUsername(): string {
  try {
    const raw = localStorage.getItem(DEVOPS_USER_KEY);
    const user = raw ? JSON.parse(raw) as { username?: string } : null;
    return typeof user?.username === 'string' ? user.username : '';
  } catch {
    return '';
  }
}

function queryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

function storedIsAdmin(): boolean {
  try {
    const raw = localStorage.getItem(DEVOPS_USER_KEY);
    const user = raw ? JSON.parse(raw) as { role?: string } : null;
    return user?.role === 'admin';
  } catch {
    return false;
  }
}

interface ChangeRow {
  id: number;
  change_number: string;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  service: string;
  environment: string;
  repo: string;
  pr_number: number;
  sha: string;
  title: string;
  summary?: string;
  author?: string;
  status: string;
  cab_status?: string;
  change_type: string;
  linked_incidents: number;
  assignee_username?: string;
  priority?: string;
  risk_level?: string;
  created_at: string;
}

const CHANGE_WEBHOOK_SAMPLE = `- name: Record OpsTrellis change
  if: success() && github.ref == 'refs/heads/main'
  env:
    OPSTRELLIS_API: \${{ secrets.OPSTRELLIS_API_URL }}
    OPSTRELLIS_SECRET: \${{ secrets.CHANGE_WEBHOOK_SECRET }}
    CHANGE_TITLE: \${{ github.event.head_commit.message }}
    CHANGE_SUMMARY: \${{ github.event.pull_request.body || github.event.head_commit.message }}
    CHANGE_AUTHOR: \${{ github.actor }}
    PR_NUMBER: \${{ github.event.pull_request.number || 0 }}
    PR_URL: \${{ github.event.pull_request.html_url || '' }}
  run: |
    set -euo pipefail
    SERVICE="\${GITHUB_REPOSITORY##*/}"
    TITLE="$(printf '%s' "$CHANGE_TITLE" | head -n1)"
    SUMMARY="$(printf '%s' "$CHANGE_SUMMARY" | head -c 8000)"
    curl -sf -X POST "\${OPSTRELLIS_API%/}/api/webhooks/change" \\
      -H "Content-Type: application/json" \\
      -H "X-CI-Secret: $OPSTRELLIS_SECRET" \\
      --data "$(jq -n \\
        --arg repo "$GITHUB_REPOSITORY" \\
        --arg sha "$GITHUB_SHA" \\
        --arg previous_sha "\${GITHUB_EVENT_BEFORE:-}" \\
        --arg service "$SERVICE" \\
        --arg title "$TITLE" \\
        --arg summary "$SUMMARY" \\
        --arg author "$CHANGE_AUTHOR" \\
        --arg pr_url "$PR_URL" \\
        --arg pipeline_url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \\
        --arg status "implemented" \\
        --arg sbom_url "\${SBOM_URL:-}" \\
        --arg attestation_url "\${ATTESTATION_URL:-}" \\
        --arg image_digest "\${IMAGE_DIGEST:-}" \\
        --argjson pr_number "\${PR_NUMBER:-0}" \\
        --argjson infracost_report "\${INFRACOST_REPORT:-null}" \\
        '{
          repo: $repo,
          sha: $sha,
          previous_sha: $previous_sha,
          service: $service,
          title: $title,
          summary: $summary,
          author: $author,
          pr_number: $pr_number,
          pr_url: $pr_url,
          pipeline_url: $pipeline_url,
          status: $status,
          change_type: "standard",
          priority: "medium",
          risk_level: "medium",
          watch_minutes: 120,
          sbom_url: $sbom_url,
          attestation_url: $attestation_url,
          image_digest: $image_digest,
          infracost_report: $infracost_report
        }')"`;

const CHANGE_WEBHOOK_LIFECYCLE_SAMPLE = `# Two-phase: same repo + sha — implementing before deploy, implemented after.
- name: OpsTrellis — deploy started
  if: success() && github.ref == 'refs/heads/main'
  env:
    OPSTRELLIS_API: \${{ secrets.OPSTRELLIS_API_URL }}
    OPSTRELLIS_SECRET: \${{ secrets.CHANGE_WEBHOOK_SECRET }}
    CHANGE_TITLE: \${{ github.event.head_commit.message }}
    CHANGE_SUMMARY: \${{ github.event.pull_request.body || github.event.head_commit.message }}
    CHANGE_AUTHOR: \${{ github.actor }}
  run: |
    curl -sf -X POST "\${OPSTRELLIS_API%/}/api/webhooks/change" -H "Content-Type: application/json" -H "X-CI-Secret: $OPSTRELLIS_SECRET" \\
      --data "$(jq -n --arg repo "$GITHUB_REPOSITORY" --arg sha "$GITHUB_SHA" \\
        --arg service "\${GITHUB_REPOSITORY##*/}" --arg title "$(printf '%s' "$CHANGE_TITLE" | head -n1)" \\
        --arg summary "$(printf '%s' "$CHANGE_SUMMARY" | head -c 8000)" --arg author "$CHANGE_AUTHOR" \\
        --arg status "implementing" \\
        '{ repo: $repo, sha: $sha, service: $service, title: $title, summary: $summary, author: $author, status: $status, change_type: "standard", watch_minutes: 120 }')"
# … deploy …
- name: OpsTrellis — deploy finished
  if: success() && github.ref == 'refs/heads/main'
  env:
    OPSTRELLIS_API: \${{ secrets.OPSTRELLIS_API_URL }}
    OPSTRELLIS_SECRET: \${{ secrets.CHANGE_WEBHOOK_SECRET }}
  run: |
    curl -sf -X POST "\${OPSTRELLIS_API%/}/api/webhooks/change" -H "Content-Type: application/json" -H "X-CI-Secret: $OPSTRELLIS_SECRET" \\
      --data "$(jq -n --arg repo "$GITHUB_REPOSITORY" --arg sha "$GITHUB_SHA" --arg service "\${GITHUB_REPOSITORY##*/}" \\
        --arg status "implemented" \\
        '{ repo: $repo, sha: $sha, service: $service, status: $status, change_type: "standard", watch_minutes: 120 }')"`;

export default function ChangesCatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkActing, setBulkActing] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [mine, setMine] = useState(false);
  const [preview, setPreview] = useState<ChangeRow | null>(null);
  const [filtersReady, setFiltersReady] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<RowKey>>(new Set());
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/change`;

  const load = useCallback(async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const projectId = queryValue(router.query.project_id);
      const environment = queryValue(router.query.environment);
      if (projectId) params.set('project_id', projectId);
      if (environment) params.set('environment', environment);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('change_type', typeFilter);
      if (query.trim()) params.set('q', query.trim());
      const search = params.toString();
      const headers = { Authorization: `Bearer ${token}` };
      const res = await fetch(`${apiUrl}/api/devops/changes?${search}`, { headers });
      const data = await res.json().catch(() => ({}));
      let changes = Array.isArray(data?.changes) ? data.changes : [];
      if (storedIsAdmin()) {
        const adminRes = await fetch(`${apiUrl}/api/admin/changes?${search}`, { headers });
        if (adminRes.ok) {
          const adminData = await adminRes.json().catch(() => ({}));
          if (Array.isArray(adminData?.changes)) changes = adminData.changes;
        }
      }
      if (!res.ok && changes.length === 0) {
        setError(data?.error || 'Failed to load changes');
        return;
      }
      setItems(changes);
    } catch {
      setError('Failed to load changes');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, query, router.query.environment, router.query.project_id, statusFilter, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!router.isReady || filtersReady) return;
    setStatusFilter(queryValue(router.query.status));
    setTypeFilter(queryValue(router.query.change_type));
    setQuery(queryValue(router.query.q));
    setMine(router.query.mine === '1');
    setFiltersReady(true);
  }, [filtersReady, router.isReady, router.query]);

  useEffect(() => {
    if (!router.isReady || !filtersReady) return;
    const next: Record<string, string> = {};
    const projectId = queryValue(router.query.project_id);
    const environment = queryValue(router.query.environment);
    if (projectId) next.project_id = projectId;
    if (environment) next.environment = environment;
    if (statusFilter) next.status = statusFilter;
    if (typeFilter) next.change_type = typeFilter;
    if (query.trim()) next.q = query.trim();
    if (mine) next.mine = '1';
    const current = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => current.set(key, value));
    const existing = new URLSearchParams();
    ['project_id', 'environment', 'status', 'change_type', 'q', 'mine'].forEach((key) => {
      const value = queryValue(router.query[key]);
      if (value) existing.set(key, value);
    });
    if (current.toString() === existing.toString()) return;
    void router.replace({ pathname: '/changes', query: next }, undefined, { shallow: true });
  }, [filtersReady, mine, query, router, statusFilter, typeFilter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const environment = queryValue(router.query.environment).toLowerCase();
    const username = currentUsername().toLowerCase();
    return items.filter((item) => {
      if (environment) {
        const env = (item.environment || '').toLowerCase();
        const matches = environment === 'prod' ? env.startsWith('prod') : env === environment;
        if (!matches) return false;
      }
      if (mine) {
        const assignee = (item.assignee_username || '').toLowerCase();
        if (!username || assignee !== username) return false;
      }
      if (!needle) return true;
      return `${item.change_number} ${item.repo} ${item.title} ${item.summary || ''} ${item.service} ${item.sha} ${item.pr_number}`
        .toLowerCase()
        .includes(needle);
    });
  }, [items, mine, query, router.query.environment]);

  const implementedCount = items.filter((item) => item.status === 'implemented' || item.status === 'monitoring' || item.status === 'resolved' || item.status === 'closed').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const watchingCount = items.filter((item) => item.status === 'monitoring' || item.status === 'implemented').length;
  const pendingApprove = items.filter((item) => item.status === 'new' && item.cab_status !== 'approved').length;

  const runBulk = async (action: string) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const ids = Array.from(selectedKeys).map((key) => Number(key)).filter((id) => id > 0);
    if (!token || ids.length === 0) return;
    setBulkActing(action);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/changes?mode=bulk`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Change-Bulk': '1',
        },
        body: JSON.stringify({ ids, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Bulk ${action} failed`);
        return;
      }
      if (Array.isArray(data.errors) && data.errors.length) {
        setError(data.errors.slice(0, 3).join('; '));
      }
      setSelectedKeys(new Set());
      await load();
    } catch {
      setError(`Bulk ${action} failed`);
    } finally {
      setBulkActing('');
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Changes - OpsTrellis</title>
      </Head>
      <div className="portal-page changes-page">
        <div className="portal-page__header">
          <div>
            <h1 className="portal-page__title">Changes</h1>
          </div>
          <div className="portal-page__actions">
            <button type="button" className="btn btn-primary" onClick={() => void router.push('/changes/new')}>
              New change
            </button>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="changes-facts" aria-label="Change summary">
          <div><span>Changes</span><strong>{loading ? 'Unknown' : items.length}</strong></div>
          <div><span>Awaiting approval</span><strong>{loading ? 'Unknown' : pendingApprove}</strong></div>
          <div><span>Watching</span><strong>{loading ? 'Unknown' : watchingCount}</strong></div>
          <div><span>Shipped</span><strong>{loading ? 'Unknown' : implementedCount}</strong></div>
          <div><span>Failed</span><strong>{loading ? 'Unknown' : failedCount}</strong></div>
        </section>

        <SavedViews<ChangeView>
          storageKey="opstrellis.changes.views"
          current={{ query, status: statusFilter, type: typeFilter, mine: mine ? '1' : '' }}
          onApply={(next) => {
            setQuery(next.query);
            setStatusFilter(next.status);
            setTypeFilter(next.type);
            setMine(next.mine === '1');
          }}
          presets={CHANGE_VIEW_PRESETS}
          canSave={Boolean(query.trim() || statusFilter || typeFilter || mine)}
        />

        <BulkBar count={selectedKeys.size} noun="change" onClear={() => setSelectedKeys(new Set())}>
          <BlockedAction blocked={!!bulkActing} reason="Wait for the current action to finish.">
          <button type="button" className="btn btn-primary" disabled={!!bulkActing} title={bulkActing ? 'Wait for the current action to finish.' : 'Approve the selected changes'} onClick={() => void runBulk('approve')}>
            {bulkActing === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!!bulkActing} onClick={() => void runBulk('schedule')}>
            {bulkActing === 'schedule' ? 'Scheduling…' : 'Schedule'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!!bulkActing} onClick={() => void runBulk('implement')}>
            {bulkActing === 'implement' ? 'Starting…' : 'Implement'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!!bulkActing} onClick={() => void runBulk('cancel')}>
            {bulkActing === 'cancel' ? 'Cancelling…' : 'Cancel'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!!bulkActing} onClick={() => void runBulk('close')}>
            {bulkActing === 'close' ? 'Closing…' : 'Close'}
          </button>
          </BlockedAction>
        </BulkBar>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Recorded changes</h2>
            </div>
            <div className="ig-filter-bar devops-incident-filter-row">
              <input aria-label="Search changes"
                className="input"
                placeholder="Search repo, PR, SHA, title, summary"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select aria-label="Filter by status" className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All status</option>
                <option value="new">New</option>
                <option value="scheduled">Scheduled</option>
                <option value="implementing">Implementing</option>
                <option value="implemented">Implemented</option>
                <option value="monitoring">Monitoring</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select aria-label="Filter by type" className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="">All types</option>
                <option value="standard">Standard</option>
                <option value="normal">Normal</option>
                <option value="emergency">Emergency</option>
                <option value="preview">Preview</option>
                <option value="flag">Feature flag</option>
              </select>
            </div>
          </div>
          <ChangeCatalogTable
            rows={visible}
            loading={loading}
            showRisk
            selectable
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            empty={
              <div className="empty-state">
                No changes yet. Create one here or point a CI job at the webhook when code merges to main.
              </div>
            }
            onOpen={(item) => setPreview(item)}
          />
        </section>

        <section className="portal-surface">
          <details>
            <summary className="portal-surface__title" style={{ cursor: 'pointer' }}>
              Change webhook
            </summary>
            <div className="portal-surface__header" style={{ marginTop: 16 }}>
              <p className="portal-surface__subtitle">
                POST from GitHub Actions after merge to main. Send <code>X-CI-Secret</code> or HMAC. Map PR body to JSON <code>summary</code>. Omit <code>environment</code> so the Services catalog fills service, project, and env. Manual Approve / Schedule / Implement / Close are available in the catalog and detail pages. Full doc: <code>docs/CICD.md</code>.
              </p>
              <button type="button" className="btn btn-secondary" onClick={() => void copyWebhook()}>
                {copied ? 'Copied' : 'Copy webhook URL'}
              </button>
            </div>
            <p className="portal-surface__subtitle" style={{ marginBottom: 8 }}>
              <code className="changes-page__webhook-url">{webhookUrl}</code>
            </p>
            <p className="portal-surface__subtitle" style={{ marginTop: 12, fontWeight: 600 }}>
              Sample payload, single POST after deploy. This is not a recorded event.
            </p>
            <pre className="code-block changes-page__sample">{CHANGE_WEBHOOK_SAMPLE}</pre>
            <p className="portal-surface__subtitle" style={{ marginTop: 12, fontWeight: 600 }}>
              Sample payload, two-phase lifecycle. This is not a recorded event.
            </p>
            <pre className="code-block changes-page__sample">{CHANGE_WEBHOOK_LIFECYCLE_SAMPLE}</pre>
          </details>
        </section>
        <InspectorDrawer
          open={Boolean(preview)}
          onClose={() => setPreview(null)}
          resetKey={preview?.id}
          label="Change preview"
          eyebrow="Change"
          title={preview?.change_number || 'Change'}
          subtitle={preview ? [preview.service || 'Service unknown', preview.environment && preview.environment !== 'unspecified' ? preview.environment : 'Environment unknown', preview.status].filter(Boolean).join(' · ') : undefined}
          headerActions={preview ? <CopyButton value={preview.change_number || String(preview.id)} label="change number" /> : null}
          footer={preview ? <Link className="btn btn-primary" href={`/changes/${preview.id}`}>Open change</Link> : null}
        >
          {preview ? (
            <div className="portal-stack">
              <p>{preview.title || 'No title was saved.'}</p>
              <p>{preview.summary || 'No summary was saved.'}</p>
              <p>Service: {preview.service || 'Unknown'} · Environment: {preview.environment && preview.environment !== 'unspecified' ? preview.environment : 'Unknown'}</p>
              <p>Assigned to: {preview.assignee_username || 'Unassigned'} · Status: {preview.status || 'Unknown'}</p>
              {preview.sha ? <p>Commit <code>{preview.sha}</code> <CopyButton value={preview.sha} label="commit SHA" /></p> : <p>Commit SHA is unknown.</p>}
            </div>
          ) : null}
        </InspectorDrawer>
      </div>
    </DevOpsLayout>
  );
}
