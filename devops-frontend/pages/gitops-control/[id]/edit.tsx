import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
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
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">GitOps Control</span>
            <h1 className="portal-page__title">Edit GitOps structure</h1>
            <p className="portal-page__subtitle">
              We are opening the full GitOps builder so the project structure can be updated in its dedicated workspace.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/gitops-control" className="btn btn-secondary">
              Back to GitOps
            </Link>
          </div>
        </div>

        <section className="portal-surface route-launch">
          <div className="route-launch__stack">
            <span className="portal-surface__eyebrow">Redirecting</span>
            <h2 className="portal-surface__title">Opening the GitOps structure editor</h2>
            <p className="portal-surface__subtitle">
              If the editor does not load automatically, use the button below to open the selected project directly.
            </p>
            <div className="route-launch__actions">
              <Link href={{ pathname: '/gitops-control', query: { view: 'builder', project: projectId } }} className="btn btn-primary">
                Open editor now
              </Link>
            </div>
          </div>
        </section>
      </div>
    </DevOpsLayout>
  );
}
