import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';

export default function ChangeCalendarPage() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    void router.replace('/ops-command-center');
  }, [router]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Change Scheduling - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Portal cleanup</span>
              <h1 className="portal-surface__title">This view has been retired</h1>
              <p className="portal-surface__subtitle">
                Change Calendar has been removed from the DevOps portal to keep the experience simpler.
                Redirecting you to Ops Command Center.
              </p>
            </div>
          </div>
          <div className="portal-page__actions">
            <Link href="/ops-command-center" className="btn btn-primary">
              Open operations
            </Link>
            <Link href="/promotions" className="btn btn-secondary">
              Open promotions
            </Link>
          </div>
        </section>
      </div>
    </DevOpsLayout>
  );
}
