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
      .catch(() => {});
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
          actions={
            <>
              <Link href="/tickets" className="btn btn-primary">Requests</Link>
              <Link href="/promotions" className="btn btn-secondary">Promotions</Link>
            </>
          }
        />
        <section className="ig-queue" style={{ marginTop: 32 }}>
          <span className="ig-eyebrow">On-call</span>
          <h2>{pagingNow ? `${pagingNow.username || 'Someone'} is paging now` : 'No one is on call'}</h2>
          <p className="ig-muted">
            {pagingNow?.team_name ? `${pagingNow.team_name} rotation` : 'Take the next eight-hour shift from this queue.'}
          </p>
          <div className="portal-page__actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-secondary" onClick={takeOncall}>Take on-call</button>
          </div>
        </section>
        <section className="ig-queue" style={{ marginTop: 32 }}>
          <span className="ig-eyebrow">Change freeze</span>
          <h2>{activeFreeze ? 'Production freeze is active' : 'No freeze window'}</h2>
          <p className="ig-muted">{activeFreeze || 'Start a freeze when production should not receive promotions.'}</p>
          <div className="portal-page__actions" style={{ marginTop: 16 }}>
            <input className="input" placeholder="Freeze reason" value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} />
            <button type="button" className="btn btn-secondary" onClick={startFreeze}>Start freeze</button>
            {activeFreeze ? (
              <button type="button" className="btn btn-secondary" onClick={endFreeze}>End freeze</button>
            ) : null}
          </div>
        </section>
      </DevOpsLayout>
    </>
  );
}
