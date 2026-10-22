import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../../components/DevOpsLayout';

export default function NewGitOpsProjectRedirect() {
  const router = useRouter();

  useEffect(() => {
    void router.replace({ pathname: '/gitops-control', query: { view: 'builder' } });
  }, [router]);

  return (
    <DevOpsLayout>
      <Head>
        <title>New GitOps Project - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">GitOps Control</span>
            <h1 className="portal-page__title">New GitOps project</h1>
            <p className="portal-page__subtitle">
              We are opening the GitOps builder so you can start from the full structure workspace instead of a list page modal.
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
            <h2 className="portal-surface__title">Opening the GitOps project builder</h2>
            <p className="portal-surface__subtitle">
              If the workspace does not load automatically, use the button below to open it directly.
            </p>
            <div className="route-launch__actions">
              <Link href={{ pathname: '/gitops-control', query: { view: 'builder' } }} className="btn btn-primary">
                Open builder now
              </Link>
            </div>
          </div>
        </section>
      </div>
    </DevOpsLayout>
  );
}
