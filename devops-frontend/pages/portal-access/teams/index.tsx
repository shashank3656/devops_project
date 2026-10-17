import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AccessFilters from '../../../components/AccessFilters';
import AccessNav from '../../../components/AccessNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { grantSummary, grantsForTeam, type SectionKey } from '../../../lib/accessSections';
import { sessionAuthHeaders } from '../../../lib/portalAccess';

type Team = {
  id: number;
  name: string;
  team_type?: string;
  grants?: Partial<Record<SectionKey, boolean>>;
};

export default function PortalTeamsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [section, setSection] = useState('all');

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/admin/teams`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Groups could not be loaded.');
        return body;
      })
      .then((body) => {
        if (!cancel) setTeams(Array.isArray(body?.teams) ? body.teams : []);
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

  const needle = query.trim().toLowerCase();
  const visible = teams.filter((team) => {
    const grants = grantsForTeam(team);
    if (kind === 'devops' && team.team_type !== 'devops') return false;
    if (kind === 'portal' && team.team_type === 'devops') return false;
    if (section !== 'all' && !grants[section as SectionKey]) return false;
    if (!needle) return true;
    return team.name.toLowerCase().includes(needle) || grantSummary(grants).toLowerCase().includes(needle);
  });

  return (
    <>
      <Head>
        <title>Groups - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Portal Access</p>
              <h1>Groups</h1>
              <p>Open a group to choose the sections it can see, then save.</p>
            </div>
            <Link href="/portal-access/teams/new" className="btn btn-primary">Create group</Link>
          </header>
          <AccessNav />
          {router.query.created === '1' ? <div className="alert alert-success" role="status">Group created. Open it to choose sections.</div> : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          <AccessFilters
            query={query}
            onQuery={setQuery}
            placeholder="Search by group or section"
            kind={kind}
            onKind={setKind}
            kindLabel="Kind"
            kindOptions={[
              { value: 'all', label: 'All kinds' },
              { value: 'portal', label: 'Requester' },
              { value: 'devops', label: 'DevOps' },
            ]}
            extra={section}
            onExtra={setSection}
            extraLabel="Has section"
            extraOptions={[
              { value: 'all', label: 'Any section' },
              { value: 'requests', label: 'Requests' },
              { value: 'daily', label: 'Daily' },
              { value: 'operations', label: 'Operations' },
              { value: 'infrastructure', label: 'Infrastructure' },
              { value: 'security', label: 'Security' },
              { value: 'records', label: 'Records' },
            ]}
          />
          {loading ? <p className="work-empty">Loading groups…</p> : null}
          {!loading && !error && teams.length === 0 ? <p className="work-empty">No groups yet. Create a group to get started.</p> : null}
          {!loading && teams.length > 0 && visible.length === 0 ? <p className="work-empty">No groups match this search.</p> : null}
          {!loading && visible.map((team) => (
            <Link key={team.id} href={`/portal-access/teams/${team.id}`} className="access-team__link">
              <span>
                <strong>{team.name}</strong>
                <small>{team.team_type === 'devops' ? 'DevOps' : 'Requester'} · {grantSummary(grantsForTeam(team))}</small>
              </span>
              <span aria-hidden="true">Open</span>
            </Link>
          ))}
        </div>
      </DevOpsLayout>
    </>
  );
}
