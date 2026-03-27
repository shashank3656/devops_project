import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ApprovalSLABreakdownItem {
  key: string;
  label: string;
  pending_count: number;
  overdue_count: number;
  avg_age_hours: number;
  oldest_age_hours: number;
}

interface ApprovalSLABucket {
  key: string;
  label: string;
  count: number;
}

interface ApprovalSLA {
  summary: {
    pending_count: number;
    overdue_count: number;
    due_soon_count: number;
    avg_age_hours: number;
    oldest_age_hours: number;
    manager_queue: number;
    devops_queue: number;
    final_review_queue: number;
  };
  by_project: ApprovalSLABreakdownItem[];
  by_environment: ApprovalSLABreakdownItem[];
  by_team: ApprovalSLABreakdownItem[];
  by_approver: ApprovalSLABreakdownItem[];
  aging_buckets: ApprovalSLABucket[];
}

function normalizeSLA(value: Partial<ApprovalSLA> | null | undefined): ApprovalSLA | null {
  if (!value || !value.summary) return null;
  return {
    summary: {
      pending_count: typeof value.summary.pending_count === 'number' ? value.summary.pending_count : 0,
      overdue_count: typeof value.summary.overdue_count === 'number' ? value.summary.overdue_count : 0,
      due_soon_count: typeof value.summary.due_soon_count === 'number' ? value.summary.due_soon_count : 0,
      avg_age_hours: typeof value.summary.avg_age_hours === 'number' ? value.summary.avg_age_hours : 0,
      oldest_age_hours: typeof value.summary.oldest_age_hours === 'number' ? value.summary.oldest_age_hours : 0,
      manager_queue: typeof value.summary.manager_queue === 'number' ? value.summary.manager_queue : 0,
      devops_queue: typeof value.summary.devops_queue === 'number' ? value.summary.devops_queue : 0,
      final_review_queue: typeof value.summary.final_review_queue === 'number' ? value.summary.final_review_queue : 0,
    },
    by_project: Array.isArray(value.by_project) ? value.by_project : [],
    by_environment: Array.isArray(value.by_environment) ? value.by_environment : [],
    by_team: Array.isArray(value.by_team) ? value.by_team : [],
    by_approver: Array.isArray(value.by_approver) ? value.by_approver : [],
    aging_buckets: Array.isArray(value.aging_buckets) ? value.aging_buckets : [],
  };
}

export default function DevOpsApprovalSLAPage() {
  const apiUrl = useApiUrl();
  const [sla, setSla] = useState<ApprovalSLA | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const clearSessionAndRedirect = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    window.location.assign('/login');
  };

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    fetch(`${apiUrl}/api/devops/approval-sla`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          clearSessionAndRedirect();
          return null;
        }
        const payload = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(payload.error, 'Failed to load approval SLA'));
        }
        return payload;
      })
      .then((payload) => {
        const data = asRecord(payload);
        const nextValue = normalizeSLA(data.sla as Partial<ApprovalSLA> | null | undefined);
        if (nextValue) setSla(nextValue);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Approval SLA - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Approvals</span>
            <h1 className="portal-page__title">Approval SLA Dashboard</h1>
            <p className="portal-page__subtitle">Track approval aging by project, environment, team, and approval owner.</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/approval-center" className="btn btn-secondary">Approval center</Link>
            <Link href="/tickets" className="btn btn-primary">Open tickets</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading approval SLA...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && sla ? (
          <>
            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-pill-row">
                <span className="portal-pill">Pending approvals {sla.summary.pending_count}</span>
                <span className="portal-pill">Overdue {sla.summary.overdue_count}</span>
                <span className="portal-pill">Average age {sla.summary.avg_age_hours.toFixed(1)}h</span>
                <span className="portal-pill">Oldest item {sla.summary.oldest_age_hours.toFixed(1)}h</span>
              </div>
            </section>

            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Queue split</span>
                  <h2 className="portal-surface__title">Approval lanes</h2>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span className="portal-pill">Manager: {sla.summary.manager_queue}</span>
                <span className="portal-pill">DevOps: {sla.summary.devops_queue}</span>
                <span className="portal-pill">Final review: {sla.summary.final_review_queue}</span>
                <span className="portal-pill">Due soon: {sla.summary.due_soon_count}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                {sla.aging_buckets.map((bucket) => (
                  <span key={bucket.key} className="portal-pill">{bucket.label}: {bucket.count}</span>
                ))}
              </div>
            </section>

            <div className="portal-grid" style={{ alignItems: 'start' }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Projects</span>
                    <h2 className="portal-surface__title">Project aging</h2>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Pending</th>
                        <th>Overdue</th>
                        <th>Avg age</th>
                        <th>Oldest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sla.by_project.map((item) => (
                        <tr key={`project-${item.key}`}>
                          <td>{item.label}</td>
                          <td>{item.pending_count}</td>
                          <td>{item.overdue_count}</td>
                          <td>{item.avg_age_hours.toFixed(1)}h</td>
                          <td>{item.oldest_age_hours.toFixed(1)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Approvers</span>
                    <h2 className="portal-surface__title">Approval owners</h2>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Owner</th>
                        <th>Pending</th>
                        <th>Overdue</th>
                        <th>Avg age</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sla.by_approver.map((item) => (
                        <tr key={`owner-${item.key}`}>
                          <td>{item.label}</td>
                          <td>{item.pending_count}</td>
                          <td>{item.overdue_count}</td>
                          <td>{item.avg_age_hours.toFixed(1)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="portal-grid" style={{ alignItems: 'start', marginTop: 24 }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Environment</span>
                    <h2 className="portal-surface__title">Environment pressure</h2>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {sla.by_environment.map((item) => (
                    <span key={`env-${item.key}`} className="portal-pill">
                      {item.label}: {item.pending_count} pending
                    </span>
                  ))}
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Teams</span>
                    <h2 className="portal-surface__title">Team approval load</h2>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {sla.by_team.map((item) => (
                    <span key={`team-${item.key}`} className="portal-pill">
                      {item.label}: {item.pending_count} pending
                    </span>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
