import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { ChangeCatalogTable } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ChangeRow {
  id: number;
  change_number: string;
  project_name?: string;
  project_code?: string;
  service: string;
  environment: string;
  repo: string;
  pr_number: number;
  sha: string;
  title: string;
  author?: string;
  status: string;
  change_type: string;
  linked_incidents: number;
  assignee_username?: string;
  priority?: string;
  risk_level?: string;
  created_at: string;
}

const CHANGE_WEBHOOK_SAMPLE = `- name: Record SetuOps change
  if: success() && github.ref == 'refs/heads/main'
  env:
    SETUOPS_API: \${{ secrets.SETUOPS_API_URL }}
    SETUOPS_SECRET: \${{ secrets.CHANGE_WEBHOOK_SECRET }}
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
    curl -sf -X POST "\${SETUOPS_API%/}/api/webhooks/change" \\
      -H "Content-Type: application/json" \\
      -H "X-CI-Secret: $SETUOPS_SECRET" \\
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
- name: SetuOps — deploy started
  if: success() && github.ref == 'refs/heads/main'
  env:
    SETUOPS_API: \${{ secrets.SETUOPS_API_URL }}
    SETUOPS_SECRET: \${{ secrets.CHANGE_WEBHOOK_SECRET }}
    CHANGE_TITLE: \${{ github.event.head_commit.message }}
    CHANGE_SUMMARY: \${{ github.event.pull_request.body || github.event.head_commit.message }}
    CHANGE_AUTHOR: \${{ github.actor }}
  run: |
    curl -sf -X POST "\${SETUOPS_API%/}/api/webhooks/change" -H "Content-Type: application/json" -H "X-CI-Secret: $SETUOPS_SECRET" \\
      --data "$(jq -n --arg repo "$GITHUB_REPOSITORY" --arg sha "$GITHUB_SHA" \\
        --arg service "\${GITHUB_REPOSITORY##*/}" --arg title "$(printf '%s' "$CHANGE_TITLE" | head -n1)" \\
        --arg summary "$(printf '%s' "$CHANGE_SUMMARY" | head -c 8000)" --arg author "$CHANGE_AUTHOR" \\
        --arg status "implementing" \\
        '{ repo: $repo, sha: $sha, service: $service, title: $title, summary: $summary, author: $author, status: $status, change_type: "standard", watch_minutes: 120 }')"
# … deploy …
- name: SetuOps — deploy finished
  if: success() && github.ref == 'refs/heads/main'
  env:
    SETUOPS_API: \${{ secrets.SETUOPS_API_URL }}
    SETUOPS_SECRET: \${{ secrets.CHANGE_WEBHOOK_SECRET }}
  run: |
    curl -sf -X POST "\${SETUOPS_API%/}/api/webhooks/change" -H "Content-Type: application/json" -H "X-CI-Secret: $SETUOPS_SECRET" \\
      --data "$(jq -n --arg repo "$GITHUB_REPOSITORY" --arg sha "$GITHUB_SHA" --arg service "\${GITHUB_REPOSITORY##*/}" \\
        --arg status "implemented" \\
        '{ repo: $repo, sha: $sha, service: $service, status: $status, change_type: "standard", watch_minutes: 120 }')"`;

function parseProjectID(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export default function ChangesCatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/change`;
  const projectID = parseProjectID(router.query.project_id);
  const environment = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment || '';

  const load = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (projectID) params.set('project_id', String(projectID));
      if (environment) params.set('environment', environment);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('change_type', typeFilter);
      if (query.trim()) params.set('q', query.trim());
      const res = await fetch(`${apiUrl}/api/devops/changes?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to load changes');
        return;
      }
      setItems(Array.isArray(data?.changes) ? data.changes : []);
    } catch {
      setError('Failed to load changes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl, projectID, environment, statusFilter, typeFilter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.change_number} ${item.repo} ${item.title} ${item.service} ${item.sha} ${item.pr_number}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  const implementedCount = items.filter((item) => item.status === 'implemented' || item.status === 'monitoring' || item.status === 'resolved' || item.status === 'closed').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const watchingCount = items.filter((item) => item.status === 'monitoring' || item.status === 'implemented').length;

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
        <title>Changes - DevOps</title>
      </Head>
      <div className="portal-page changes-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Deployments</span>
            <h1 className="portal-page__title">Changes</h1>
            <p className="portal-page__subtitle">
              Application deploys recorded from CI, plus change requests created here. The catalog is the landing page — use the button to open the form.
            </p>
          </div>
          <div className="portal-page__actions">
            <button type="button" className="btn btn-primary" onClick={() => void router.push('/changes/new')}>
              New change
            </button>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="k8s-summary-strip">
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Changes</span>
            <strong className="k8s-summary-card__value">{items.length}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Shipped</span>
            <strong className="k8s-summary-card__value">{implementedCount}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Watching</span>
            <strong className="k8s-summary-card__value">{watchingCount}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Failed</span>
            <strong className="k8s-summary-card__value">{failedCount}</strong>
          </div>
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Recorded changes</h2>
            </div>
            <div className="ig-filter-bar devops-incident-filter-row">
              <input
                className="input"
                placeholder="Search repo, PR, SHA, title"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All status</option>
                <option value="new">New</option>
                <option value="implementing">Implementing</option>
                <option value="implemented">Implemented</option>
                <option value="monitoring">Monitoring</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
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
            empty={
              <div className="empty-state">
                No changes yet. Create one here or point a CI job at the webhook when code merges to main.
              </div>
            }
            onOpen={(item) => void router.push(`/changes/${item.id}`)}
          />
        </section>

        <section className="portal-surface">
          <details>
            <summary className="portal-surface__title" style={{ cursor: 'pointer' }}>
              Change webhook
            </summary>
            <div className="portal-surface__header" style={{ marginTop: 16 }}>
              <p className="portal-surface__subtitle">
                POST from GitHub Actions after merge to main. Send <code>X-CI-Secret</code> or HMAC. Map PR body to JSON <code>summary</code>. Omit <code>environment</code> so the Services catalog fills service, project, and env. Approve and schedule in the CHG UI first when CAB applies; CI then sends <code>status</code> (<code>implementing</code> → <code>implemented</code>). Full doc: <code>docs/CICD.md</code>.
              </p>
              <button type="button" className="btn btn-secondary" onClick={() => void copyWebhook()}>
                {copied ? 'Copied' : 'Copy webhook URL'}
              </button>
            </div>
            <p className="portal-surface__subtitle" style={{ marginBottom: 8 }}>
              <code className="changes-page__webhook-url">{webhookUrl}</code>
            </p>
            <p className="portal-surface__subtitle" style={{ marginTop: 12, fontWeight: 600 }}>
              Single POST (after deploy)
            </p>
            <pre className="code-block changes-page__sample">{CHANGE_WEBHOOK_SAMPLE}</pre>
            <p className="portal-surface__subtitle" style={{ marginTop: 12, fontWeight: 600 }}>
              Two-phase lifecycle
            </p>
            <pre className="code-block changes-page__sample">{CHANGE_WEBHOOK_LIFECYCLE_SAMPLE}</pre>
          </details>
        </section>
      </div>
    </DevOpsLayout>
  );
}
