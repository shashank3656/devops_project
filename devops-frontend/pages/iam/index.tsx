import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type Summary = { active?: number; pending?: number; expiring?: number; approvals?: number };

export default function IamHomePage() {
  const apiUrl = useApiUrl();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/devops/iam/summary`, { headers: sessionAuthHeaders() })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Access could not be loaded.');
        if (!cancel) setSummary(body);
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head><title>IAM</title></Head>
      <IamFrame title="IAM" lede="See what is active, what is waiting, and open a request when someone needs a cloud role.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <section className="changes-facts" aria-label="Access summary">
          <div><span>Active</span><strong>{summary ? summary.active ?? 0 : '…'}</strong></div>
          <div><span>Pending</span><strong>{summary ? summary.pending ?? 0 : '…'}</strong></div>
          <div><span>Expiring</span><strong>{summary ? summary.expiring ?? 0 : '…'}</strong></div>
          <div><span>Approvals</span><strong>{summary ? summary.approvals ?? 0 : '…'}</strong></div>
        </section>
        <section className="portal-surface iam-sheet">
          <h2>Request access</h2>
          <p className="access-hint">Choose the services and permissions, then a start time and an end time. Access cannot run longer than 90 days. Submitting raises an access request on the Service Desk.</p>
          <Link href="/iam/request" className="btn btn-primary">Open the request form</Link>
        </section>
      </IamFrame>
    </DevOpsLayout>
  );
}
