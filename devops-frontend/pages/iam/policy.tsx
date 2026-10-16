import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type PolicyRow = { risk: string; condition: string; approval: string; max: string };

export default function IamPolicyPage() {
  const apiUrl = useApiUrl();
  const [version, setVersion] = useState('');
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${apiUrl}/api/devops/iam/policy`, { headers: sessionAuthHeaders() })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Policy could not be loaded.');
        setVersion(typeof body?.policyVersion === 'string' ? body.policyVersion : '');
        setRows(Array.isArray(body?.matrix) ? body.matrix : []);
      })
      .catch((err: Error) => setError(err.message));
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head><title>Access policy - IAM</title></Head>
      <IamFrame title="Policy" lede="These are the current approval rules. Changing them needs a versioned approval. This screen does not edit the catalog.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <p className="access-hint">Version {version || 'Unknown'}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Risk</th><th>When</th><th>Approval</th><th>Maximum</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.risk}>
                  <td>{row.risk}</td>
                  <td>{row.condition}</td>
                  <td>{row.approval}</td>
                  <td>{row.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </IamFrame>
    </DevOpsLayout>
  );
}
