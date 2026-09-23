import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, EmptyState, InspectorDrawer, PRImpactBrief, type DataTableColumn, type PRImpactBriefData } from '@infragate/ui';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface DeployEvent {
  id: number;
  pr_number: number;
  request_id?: number;
  title: string;
  author: string;
  base_branch: string;
  head_branch: string;
  merged_at: string;
  commit_count: number;
  file_count: number;
  additions: number;
  deletions: number;
  score: number;
  risk_level: string;
  summary: string;
  pr_url: string;
  impact: PRImpactBriefData;
}

interface OnboardedRepo {
  owner: string;
  name: string;
  base: string;
  onboarded: boolean;
}

function riskChipTone(level: string): 'low' | 'medium' | 'high' | 'danger' | 'ok' | 'info' | 'neutral' {
  if (level === 'high') return 'danger';
  if (level === 'medium') return 'medium';
  if (level === 'low') return 'low';
  return 'neutral';
}

export default function DeployIntelligencePage() {
  const apiUrl = useApiUrl();
  const [events, setEvents] = useState<DeployEvent[]>([]);
  const [repo, setRepo] = useState<OnboardedRepo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DeployEvent | null>(null);
  const [refreshPR, setRefreshPR] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refreshNumber?: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (refreshNumber && refreshNumber > 0) query.set('refresh_pr', String(refreshNumber));
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to load deploy intelligence');
        return;
      }
      setRepo(data?.onboarded_repo || null);
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (_) {
      setError('Failed to load deploy intelligence');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl]);

  const columns: DataTableColumn<DeployEvent>[] = useMemo(
    () => [
      {
        id: 'pr',
        header: 'Pull request',
        cell: (row) => (
          <div className="ig-cell-stack">
            <span className="ig-cell-title">{row.title || `PR #${row.pr_number}`}</span>
            <span className="ig-cell-meta">
              #{row.pr_number} · {row.author || 'unknown'} · {row.head_branch} → {row.base_branch}
            </span>
          </div>
        ),
      },
      {
        id: 'commits',
        header: 'Commits',
        align: 'right',
        className: 'ig-cell-num',
        cell: (row) => row.commit_count,
      },
      {
        id: 'files',
        header: 'Files',
        align: 'right',
        className: 'ig-cell-num',
        cell: (row) => row.file_count,
      },
      {
        id: 'diff',
        header: 'Diff',
        align: 'right',
        className: 'ig-cell-num',
        cell: (row) => `+${row.additions}/-${row.deletions}`,
      },
      {
        id: 'risk',
        header: 'Risk',
        cell: (row) => <span className={`ig-chip ig-chip--${riskChipTone(row.risk_level)}`}>{row.risk_level} · {row.score}</span>,
      },
      {
        id: 'merged',
        header: 'Merged',
        cell: (row) => new Date(row.merged_at).toLocaleString(),
      },
      {
        id: 'request',
        header: 'Request',
        cell: (row) =>
          row.request_id ? (
            <Link href={`/tickets?id=${row.request_id}`} className="ig-cell-link">
              #{row.request_id}
            </Link>
          ) : (
            '—'
          ),
      },
    ],
    [],
  );

  const brief: PRImpactBriefData | null = selected?.impact?.pr_number
    ? selected.impact
    : selected
      ? {
          request_id: selected.request_id,
          pr_number: selected.pr_number,
          pr_url: selected.pr_url,
          title: selected.title,
          author: selected.author,
          base_branch: selected.base_branch,
          head_branch: selected.head_branch,
          merge_state: 'merged',
          deploy_status: 'merged',
          commit_count: selected.commit_count,
          file_count: selected.file_count,
          additions: selected.additions,
          deletions: selected.deletions,
          blast_radius: selected.impact?.blast_radius || [],
          score: selected.score,
          risk_level: selected.risk_level as PRImpactBriefData['risk_level'],
          summary: selected.summary,
          recommended_action: selected.impact?.recommended_action || '',
          factors: selected.impact?.factors || [],
          commits: selected.impact?.commits,
          files: selected.impact?.files,
        }
      : null;

  return (
    <DevOpsLayout>
      <Head>
        <title>Deploy intelligence - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Deploy</span>
            <h1 className="portal-page__title">Merge intelligence</h1>
            <p className="portal-page__subtitle">
              When a pull request merges to {repo?.base || 'main'} on your onboarded GitHub repo, InfraGate analyzes commit count,
              diff size, sensitive paths, and links the result to InfraGate requests when possible.
            </p>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Onboarded repository</span>
              <h2 className="portal-surface__title">
                {repo ? `${repo.owner}/${repo.name}` : 'GitHub repository'}
              </h2>
              <p className="portal-surface__subtitle">
                {repo?.onboarded
                  ? `Listening for merged pull requests into ${repo.base}. Configure the GitHub webhook to POST pull_request events to /api/webhooks/github.`
                  : 'Set GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN and add at least one GitOps project so merges can be analyzed.'}
              </p>
            </div>
            <form
              className="ig-lifecycle__row"
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(refreshPR, 10);
                if (!n) return;
                setRefreshing(true);
                void load(n);
              }}
            >
              <input
                className="ig-lifecycle__select"
                placeholder="PR #"
                value={refreshPR}
                onChange={(e) => setRefreshPR(e.target.value)}
                aria-label="Pull request number to analyze"
              />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={refreshing || !refreshPR.trim()}>
                {refreshing ? 'Analyzing…' : 'Analyze PR'}
              </button>
            </form>
          </div>

          <div className="ig-legacy-table">
            <DataTable<DeployEvent>
              label="Recent merges to production branch"
              columns={columns}
              rows={events}
              rowKey={(row) => row.id}
              loading={loading}
              activeKey={selected?.id ?? null}
              onRowOpen={setSelected}
              empty={
                <EmptyState
                  title="No merge analyses yet"
                  body="Merge a pull request to main on the onboarded repo, or use Analyze PR to backfill an existing merge."
                />
              }
            />
          </div>
        </section>
      </div>

      <InspectorDrawer
        open={Boolean(selected)}
        title={selected ? `PR #${selected.pr_number}` : 'Merge analysis'}
        onClose={() => setSelected(null)}
      >
        {brief ? <PRImpactBrief brief={brief} /> : null}
      </InspectorDrawer>
    </DevOpsLayout>
  );
}
