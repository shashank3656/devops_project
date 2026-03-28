import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../../components/DevOpsLayout';

export default function NewGitOpsProjectRedirect() {
  const router = useRouter();

  useEffect(() => {
    void router.replace({ pathname: '/gitops-control', query: { view: 'builder' } });
  }, [router]);

  return (
    <DevOpsLayout>
      <Head>
        <title>New GitOps Project - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <section className="portal-surface">
          <div className="empty-state">Opening the GitOps project builder...</div>
        </section>
      </div>
    </DevOpsLayout>
  );
}
