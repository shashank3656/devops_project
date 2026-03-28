import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../../../components/DevOpsLayout';

export default function EditGitOpsProjectRedirect() {
  const router = useRouter();
  const projectId = typeof router.query.id === 'string' ? router.query.id : '';

  useEffect(() => {
    if (!projectId) return;
    void router.replace({ pathname: '/gitops-control', query: { view: 'builder', project: projectId } });
  }, [projectId, router]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Edit GitOps Project - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <section className="portal-surface">
          <div className="empty-state">Opening the GitOps structure editor...</div>
        </section>
      </div>
    </DevOpsLayout>
  );
}
