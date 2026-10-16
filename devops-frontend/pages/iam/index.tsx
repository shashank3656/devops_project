import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type Summary = { active?: number; pending?: number; expiring?: number; approvals?: number; note?: string };

export default function IamHomePage() {
  const apiUrl = useApiUrl();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/devops/iam/summary`, { headers: sessionAuthHeaders() })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Cloud access could not be loaded.');
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
      <Head><title>Cloud access - IAM</title></Head>
      <IamFrame title="Cloud access" lede="Ask for a short, scoped permission. Approval does not turn access on. Active means the cloud provider confirmed it.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <section className="changes-facts" aria-label="Access summary">
          <div><span>Active</span><strong>{summary ? summary.active : '…'}</strong></div>
          <div><span>Pending</span><strong>{summary ? summary.pending : '…'}</strong></div>
          <div><span>Expiring</span><strong>{summary ? summary.expiring : '…'}</strong></div>
          <div><span>Approvals</span><strong>{summary ? summary.approvals : '…'}</strong></div>
        </section>
        <section className="portal-surface access-form">
          <h2 className="access-form__title">Start from the task</h2>
          <p className="access-hint">{summary?.note || 'A request opens an incident. The DevOps team approves it. The backend then records the grant and closes the incident.'}</p>
          <p className="access-hint">Secret values are never collected or shown here.</p>
          <Link href="/iam/request" className="btn btn-primary">Request access</Link>
        </section>
      </IamFrame>
    </DevOpsLayout>
  );
}
