import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../components/AdminLayout';
import { WorkspaceHome, type WorkspacePayload } from '@infragate/ui';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const emptyWorkspace: WorkspacePayload = {
  title: 'Governance queue',
  subtitle: 'Pending requests and the current release path.',
  needs_you: [],
  failed: [],
  pipeline: { stages: [] },
  activity: [],
};

export default function AdminDashboard() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspacePayload>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`${apiUrl}/api/admin/workspace`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace('/login');
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
        <title>Home - Admin</title>
      </Head>
      <AdminLayout>
        <WorkspaceHome
          payload={workspace}
          loading={loading}
          error={error}
          onRetry={loadWorkspace}
          activityHref="/activity"
          actions={
            <>
              <Link href="/approval-center" className="btn btn-primary">Pending approvals</Link>
              <Link href="/users/new" className="btn btn-secondary">Invite</Link>
            </>
          }
          aside={
            <section className="ig-home__section" aria-label="Setup">
              <h2>Setup</h2>
              <p>Sign-in and connections stay here, separate from the daily approval queue.</p>
              <Link href="/sso">Sign-in setup</Link>
              {' · '}
              <Link href="/cloud-accounts">Connections</Link>
            </section>
          }
        />
      </AdminLayout>
    </>
  );
}
