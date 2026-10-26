import { useEffect } from 'react';
import { useRouter } from 'next/router';
import DevOpsLayout from '../../components/DevOpsLayout';

export default function CostAnomaliesRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    void router.replace({ pathname: '/cost/budgets', query: { ...router.query, tab: 'alerts' } });
  }, [router.isReady, router]);

  return (
    <DevOpsLayout>
      <div className="portal-page cost-analysis">
        <div className="empty-state">Opening Budgets & alerts…</div>
      </div>
    </DevOpsLayout>
  );
}
