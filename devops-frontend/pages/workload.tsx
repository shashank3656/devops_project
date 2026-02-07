import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface Request {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  pr_url: string;
  application_id: string;
  updated_at: string;
}

interface WorkloadItem {
  request: Request;
  assignee_id: number;
  assignee_username: string;
}

export default function DevOpsWorkload() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [workload, setWorkload] = useState<WorkloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/workload`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.workload) setWorkload(data.workload);
        else if (data?.error) setError(data.error);
      })
      .catch(() => setError('Failed to load workload'))
      .finally(() => setLoading(false));
  }, [router, apiUrl]);

  return (
    <>
      <Head>
        <title>Workload - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="container">
          <h1 className="page-title">Workload (what is working)</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Requests that have been assigned to DevOps team members. Only visible to DevOps managers.
          </p>
          {error && <div className="alert alert-error">{error}</div>}
          {loading ? (
            <p className="loading-text">Loading…</p>
          ) : workload.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <p>No assigned tickets yet.</p>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Assignee</th>
                      <th>ID</th>
                      <th>Team</th>
                      <th>Env</th>
                      <th>Cloud</th>
                      <th>Service</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>PR</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workload.map((item) => (
                      <tr key={item.request.id}>
                        <td style={{ fontWeight: 500 }}>{item.assignee_username}</td>
                        <td><code>{item.request.application_id || item.request.id}</code></td>
                        <td>{item.request.team}</td>
                        <td>{item.request.env}</td>
                        <td>{item.request.cloud}</td>
                        <td>{item.request.service}</td>
                        <td>{item.request.priority}</td>
                        <td>{item.request.status}</td>
                        <td>{item.request.pr_url ? <a href={item.request.pr_url} target="_blank" rel="noopener noreferrer">Open PR</a> : '-'}</td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{new Date(item.request.updated_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
