import { useEffect, useState } from 'react';
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
  pipeline: { stages: [] },
  activity: [],
};

export default function AdminDashboard() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspacePayload>(emptyWorkspace);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/admin/workspace`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.workspace) setWorkspace(data.workspace);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <>
      <Head>
        <title>Home - Admin</title>
      </Head>
      <AdminLayout>
        <WorkspaceHome
          payload={workspace}
          loading={loading}
          activityHref="/activity"
          actions={
            <>
              <Link href="/changes" className="btn btn-secondary">Changes</Link>
              <Link href="/incidents" className="btn btn-secondary">Incidents</Link>
              <Link href="/approval-center" className="btn btn-primary">Approvals</Link>
            </>
          }
        />
      </AdminLayout>
    </>
  );
}
