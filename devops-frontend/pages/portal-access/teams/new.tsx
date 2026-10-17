import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AccessNav from '../../../components/AccessNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../../lib/portalAccess';

type Person = { id: number; username: string };

export default function NewGroupPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [teamType, setTeamType] = useState('portal');
  const [defaultEnv, setDefaultEnv] = useState('');
  const [defaultCloud, setDefaultCloud] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/admin/users`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'People could not be loaded.');
        return body;
      })
      .then((body) => {
        if (cancel) return;
        const rows = Array.isArray(body?.users) ? body.users : [];
        setPeople(rows.map((account: Person) => ({ id: account.id, username: account.username })));
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl]);

  function togglePerson(id: number) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          team_type: teamType,
          default_env: defaultEnv || undefined,
          default_cloud: defaultCloud || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'The group was not created.');
        return;
      }
      const teamId = Number(body?.team?.id);
      if (picked.length > 0 && Number.isFinite(teamId) && teamId > 0) {
        const memberResponse = await fetch(`${apiUrl}/api/admin/teams/${teamId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
          body: JSON.stringify({
            user_ids: picked,
            role: teamType === 'devops' ? 'member' : 'developer',
          }),
        });
        if (!memberResponse.ok) {
          await router.push(`/portal-access/teams/${teamId}?people=0`);
          return;
        }
      }
      if (Number.isFinite(teamId) && teamId > 0) {
        await router.push(`/portal-access/teams/${teamId}`);
        return;
      }
      await router.push('/portal-access/teams?created=1');
    } catch {
      setError('The group could not be created.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Head>
        <title>Create group - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Portal Access</p>
              <h1>Create group</h1>
              <p>Name the group and choose who belongs in it.</p>
            </div>
            <Link href="/portal-access/teams" className="btn btn-secondary">Back to groups</Link>
          </header>
          <AccessNav />
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          <form className="portal-surface access-form" onSubmit={createTeam}>
            <label className="label" htmlFor="team-name">Group name</label>
            <input id="team-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Platform" required />
            <label className="label" htmlFor="team-slug">Short name</label>
            <input id="team-slug" className="input" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="platform-team" />
            <label className="label" htmlFor="team-type">Kind</label>
            <select id="team-type" className="input" value={teamType} onChange={(event) => setTeamType(event.target.value)}>
              <option value="portal">Requester</option>
              <option value="devops">DevOps</option>
            </select>
            <label className="label" htmlFor="team-env">Default environment</label>
            <select id="team-env" className="input" value={defaultEnv} onChange={(event) => setDefaultEnv(event.target.value)}>
              <option value="">None</option>
              <option value="dev">dev</option>
              <option value="uat">uat</option>
              <option value="prod">prod</option>
              {defaultEnv && !['dev', 'uat', 'prod'].includes(defaultEnv) ? <option value={defaultEnv}>{defaultEnv}</option> : null}
            </select>
            <label className="label" htmlFor="team-cloud">Default cloud</label>
            <select id="team-cloud" className="input" value={defaultCloud} onChange={(event) => setDefaultCloud(event.target.value)}>
              <option value="">None</option>
              <option value="aws">AWS</option>
              <option value="gcp">GCP</option>
              <option value="azure">Azure</option>
            </select>
            <p className="access-hint">These prefill the next request someone in this group opens.</p>
            <p className="label" id="team-people-label">People</p>
            {people.length === 0 ? <p className="work-empty">No people yet. You can add them after the group exists.</p> : (
              <ul className="access-people" aria-labelledby="team-people-label">
                {people.map((person) => (
                  <li key={person.id}>
                    <label className={picked.includes(person.id) ? 'access-chip is-on' : 'access-chip'}>
                      <input type="checkbox" checked={picked.includes(person.id)} onChange={() => togglePerson(person.id)} />
                      {person.username}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create group'}</button>
          </form>
        </div>
      </DevOpsLayout>
    </>
  );
}
