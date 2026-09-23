import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { WorkspaceHome, type WorkspacePayload } from '@infragate/ui';

const DEVOPS_TOKEN_KEY = 'devops_token';
const emptyWorkspace: WorkspacePayload = {
  title: 'Operations queue',
  subtitle: 'Promotions, incidents, and production-impacting PRs.',
  needs_you: [],
  pipeline: { stages: [] },
  activity: [],
};

interface OncallRotation {
  id: number;
  username?: string;
  team_name?: string;
  active?: boolean;
  starts_at?: string;
  ends_at?: string;
}

export default function DevOpsDashboard() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [workspace, setWorkspace] = useState<WorkspacePayload>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [freezeReason, setFreezeReason] = useState('');
  const [activeFreeze, setActiveFreeze] = useState('');
  const [rotations, setRotations] = useState<OncallRotation[]>([]);

  const tokenHeaders = (): Record<string, string> => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadOpsControls = () => {
    fetch(`${apiUrl}/api/devops/freezes`, { headers: tokenHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setActiveFreeze(data?.active_reason || ''))
      .catch(() => {});
    fetch(`${apiUrl}/api/devops/oncall`, { headers: tokenHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRotations(Array.isArray(data?.rotations) ? data.rotations : []))
      .catch(() => {});
  };

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/workspace`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.workspace) setWorkspace(data.workspace);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    loadOpsControls();
  }, [apiUrl, router]);

  const startFreeze = () => {
    fetch(`${apiUrl}/api/devops/freezes`, {
      method: 'POST',
      headers: { ...tokenHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: 'prod', reason: freezeReason || 'Production freeze' }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(() => {
        setActiveFreeze(freezeReason || 'Production freeze');
        loadOpsControls();
      })
      .catch(() => {});
  };

  const endFreeze = () => {
    fetch(`${apiUrl}/api/devops/freezes`, {
      method: 'POST',
      headers: { ...tokenHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(() => {
        setActiveFreeze('');
        loadOpsControls();
      })
      .catch(() => {});
  };

  const takeOncall = () => {
    fetch(`${apiUrl}/api/devops/oncall`, {
      method: 'POST',
      headers: { ...tokenHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(() => loadOpsControls())
      .catch(() => {});
  };

  const pagingNow = rotations.find((item) => item.active);

  return (
    <>
      <Head>
        <title>Overview - SetuOps DevOps</title>
      </Head>
      <DevOpsLayout>
        <WorkspaceHome
          payload={workspace}
          loading={loading}
          activityHref="/tickets"
          actions={
            <>
              <Link href="/promotions" className="btn btn-secondary">Promotions</Link>
              <Link href="/tickets" className="btn btn-primary">Requests</Link>
            </>
          }
          aside={
            <>
              <section className="ig-home-panel ig-home-ops" aria-label="On-call">
                <span className="ig-home-ops__label">On-call</span>
                <h3 className="ig-home-ops__title">
                  <span className={`ig-dot ${pagingNow ? 'ig-dot--ok' : ''}`} aria-hidden />
                  {pagingNow ? `${pagingNow.username || 'Someone'} is on call` : 'No one is on call'}
                </h3>
                <p className="ig-home-ops__copy">
                  {pagingNow?.team_name ? `${pagingNow.team_name} rotation` : 'Take the next eight-hour shift.'}
                </p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={takeOncall}>Take on-call</button>
              </section>
              <section className="ig-home-panel ig-home-ops" aria-label="Change freeze">
                <span className="ig-home-ops__label">Change freeze</span>
                <h3 className="ig-home-ops__title">
                  <span className={`ig-dot ${activeFreeze ? 'ig-dot--danger' : ''}`} aria-hidden />
                  {activeFreeze ? 'Production freeze is active' : 'No freeze window'}
                </h3>
                <p className="ig-home-ops__copy">
                  {activeFreeze || 'Pause promotions to production while you investigate.'}
                </p>
                {activeFreeze ? (
                  <button type="button" className="btn btn-danger btn-sm" onClick={endFreeze}>End freeze</button>
                ) : (
                  <div className="ig-home-ops__row">
                    <input
                      className="input"
                      placeholder="Reason (optional)"
                      aria-label="Freeze reason"
                      value={freezeReason}
                      onChange={(e) => setFreezeReason(e.target.value)}
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={startFreeze}>Start</button>
                  </div>
                )}
              </section>
            </>
          }
        />
      </DevOpsLayout>
    </>
  );
}
