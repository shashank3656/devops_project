import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { SITE_NAME } from '../lib/site';
import { WorkspaceHome, type WorkspacePayload } from '@infragate/ui';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const emptyWorkspace: WorkspacePayload = {
  title: 'What needs attention',
  subtitle: 'Your requests, reviews, and environment path.',
  needs_you: [],
  failed: [],
  pipeline: { stages: [] },
  activity: [],
};

export default function Home() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspacePayload>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(() => {
    if (!localStorage.getItem('isAuthenticated')) {
      router.push('/login');
      return;
    }
    const token = localStorage.getItem('token');
    setLoading(true);
    setError(null);
    fetch(`${apiUrl}/api/me/workspace`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (res.status === 401) {
          router.push('/login');
          return null;
        }
        if (!res.ok) {
          throw new Error(`Home could not load (${res.status}).`);
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        if (!data.workspace) {
          throw new Error('Home response was empty.');
        }
        setWorkspace(data.workspace);
      })
      .catch((err: Error) => {
        setWorkspace(emptyWorkspace);
        setError(err?.message || 'Home could not load.');
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  return (
    <>
      <Head>
        <title>Home - {SITE_NAME}</title>
      </Head>
      <WorkspaceHome
        payload={workspace}
        loading={loading}
        error={error}
        onRetry={loadWorkspace}
        activityHref="/history"
        actions={
          <>
            <Link href="/changes" className="btn btn-secondary">Changes</Link>
            <Link href="/incidents" className="btn btn-secondary">Incidents</Link>
            <Link href="/create-infrastructure" className="btn btn-primary">New request</Link>
          </>
        }
      />
    </>
  );
}
