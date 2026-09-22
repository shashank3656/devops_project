import { useEffect, useState } from 'react';
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
  pipeline: { stages: [] },
};

export default function Home() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspacePayload>(emptyWorkspace);

  useEffect(() => {
    if (!localStorage.getItem('isAuthenticated')) {
      router.push('/login');
      return;
    }
    const token = localStorage.getItem('token');
    fetch(`${apiUrl}/api/me/workspace`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.workspace) setWorkspace(data.workspace);
      })
      .catch(() => {});
  }, [router]);

  return (
    <>
      <Head>
        <title>Home - {SITE_NAME}</title>
      </Head>
      <WorkspaceHome
        payload={workspace}
        actions={
          <>
            <Link href="/create-infrastructure" className="btn btn-primary">New request</Link>
            <Link href="/history" className="btn btn-secondary">My requests</Link>
          </>
        }
      />
    </>
  );
}
