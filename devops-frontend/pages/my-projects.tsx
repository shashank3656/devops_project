import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { sessionAuthHeaders } from '../lib/portalAccess';

type ProjectRow = {
  id: number;
  name: string;
  code?: string;
  ready_for_requests?: boolean;
  environments?: string[];
  owner_team?: string;
};

export default function MyProjectsPage() {
  const apiUrl = useApiUrl();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/me/projects`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Projects could not be loaded.');
        return body;
      })
      .then((body) => {
        if (!cancel) setProjects(Array.isArray(body?.projects) ? body.projects : []);
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl]);

  return (
    <>
      <Head>
        <title>My projects - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Requests</p>
              <h1>My projects</h1>
              <p>Projects your teams can raise requests against.</p>
            </div>
            <Link href="/requests/new" className="btn btn-primary">New request</Link>
          </header>
          {loading ? <p className="work-empty">Loading projects…</p> : null}
          {error ? <p className="work-empty">{error}</p> : null}
          {!loading && !error && projects.length === 0 ? (
            <section className="ops-caught">
              <h2>No projects yet.</h2>
              <p>When a team is allowed to request against a project, it shows up here.</p>
            </section>
          ) : null}
          {!loading && projects.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Environments</th>
                    <th>Owner team</th>
                    <th>Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td>{project.code ? `${project.name} (${project.code})` : project.name}</td>
                      <td>{(project.environments || []).join(', ') || '—'}</td>
                      <td>{project.owner_team || '—'}</td>
                      <td>{project.ready_for_requests ? 'Ready' : 'Not ready'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
