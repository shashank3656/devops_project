import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AccessNav from '../../../components/AccessNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../../lib/portalAccess';

export default function NewPersonPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userType, setUserType] = useState('portal_user');
  const [role, setRole] = useState('viewer');
  const [isManager, setIsManager] = useState(false);
  const [position, setPosition] = useState('');
  const [onboardDate, setOnboardDate] = useState('');
  const [level, setLevel] = useState('L1');
  const [memberRole, setMemberRole] = useState('developer');
  const [teamId, setTeamId] = useState('');
  const [teams, setTeams] = useState<{ id: number; name: string; team_type?: string }[]>([]);
  const [teamsReady, setTeamsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/admin/teams`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Groups could not be loaded.');
        return body;
      })
      .then((body) => {
        if (cancel) return;
        const rows = Array.isArray(body?.teams) ? body.teams : [];
        setTeams(rows.map((team: { id: number; name: string; team_type?: string }) => ({
          id: team.id,
          name: team.name,
          team_type: team.team_type,
        })));
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      })
      .finally(() => {
        if (!cancel) setTeamsReady(true);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl]);

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
          role,
          user_type: userType,
          is_manager: isManager,
          position: userType === 'devops_user' ? position.trim() : undefined,
          onboard_date: userType === 'devops_user' && onboardDate ? onboardDate : undefined,
          level: userType === 'devops_user' ? level : undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'The account was not created.');
        return;
      }
      const createdId = Number(body?.user?.id);
      const chosen = teams.find((team) => String(team.id) === teamId);
      if (chosen && Number.isFinite(createdId) && createdId > 0) {
        const memberResponse = await fetch(`${apiUrl}/api/admin/teams/${chosen.id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
          body: JSON.stringify({ user_id: createdId, role: memberRole }),
        });
        const memberBody = await memberResponse.json().catch(() => ({}));
        if (!memberResponse.ok) {
          setError(typeof memberBody?.error === 'string' ? memberBody.error : 'The account was created, but they were not added to the group.');
          return;
        }
      }
      await router.push('/portal-access/users?added=1');
    } catch {
      setError('The account could not be created.');
    } finally {
      setSaving(false);
    }
  }

  const matchingTeams = teams.filter((team) => (userType === 'devops_user' ? team.team_type === 'devops' : team.team_type !== 'devops'));
  const roleOptions = userType === 'devops_user'
    ? [{ value: 'member', label: 'Member' }, { value: 'lead', label: 'Lead' }]
    : [
      { value: 'developer', label: 'Developer' },
      { value: 'senior_developer', label: 'Senior developer' },
      { value: 'lead', label: 'Lead' },
      { value: 'manager', label: 'Manager' },
    ];

  return (
    <>
      <Head>
        <title>Add person - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Portal Access</p>
              <h1>Add person</h1>
              <p>Create the account and put them in a group. The password is stored and is not shown again.</p>
            </div>
            <Link href="/portal-access/users" className="btn btn-secondary">Back to people</Link>
          </header>
          <AccessNav />
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          <form className="portal-surface access-form" onSubmit={createUser}>
            <label className="label" htmlFor="new-username">Username</label>
            <input id="new-username" className="input" value={username} onChange={(event) => setUsername(event.target.value)} required />
            <label className="label" htmlFor="new-email">Sign-in email</label>
            <input id="new-email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="off" />
            <label className="label" htmlFor="new-password">First password</label>
            <input id="new-password" className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete="new-password" />
            <label className="label" htmlFor="new-type">Kind</label>
            <select
              id="new-type"
              className="input"
              value={userType}
              onChange={(event) => {
                const next = event.target.value;
                setUserType(next);
                setTeamId('');
                setMemberRole(next === 'devops_user' ? 'member' : 'developer');
              }}
            >
              <option value="portal_user">Requester</option>
              <option value="devops_user">DevOps</option>
            </select>
            <label className="label" htmlFor="new-role">Can change work</label>
            <select id="new-role" className="input" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="viewer">View only</option>
              <option value="contributor">Can raise and update</option>
            </select>
            {userType === 'devops_user' ? (
              <>
                <label className="label" htmlFor="new-position">Position</label>
                <input id="new-position" className="input" value={position} onChange={(event) => setPosition(event.target.value)} placeholder="DevOps Engineer" />
                <label className="label" htmlFor="new-onboard">Onboard date</label>
                <input id="new-onboard" className="input" type="date" value={onboardDate} onChange={(event) => setOnboardDate(event.target.value)} />
                <label className="label" htmlFor="new-level">Approval level</label>
                <select id="new-level" className="input" value={level} onChange={(event) => setLevel(event.target.value)}>
                  <option value="L1">L1 — low</option>
                  <option value="L2">L2 — medium</option>
                  <option value="L3">L3 — high</option>
                  <option value="L4">L4 — critical</option>
                </select>
                <p className="access-hint">A request is assigned by priority. Low goes to L1, medium to L2, high to L3, and critical to L4.</p>
              </>
            ) : null}
            <label className="label" htmlFor="new-team">Group</label>
            <select id="new-team" className="input" value={teamId} onChange={(event) => setTeamId(event.target.value)} required={matchingTeams.length > 0}>
              <option value="">{matchingTeams.length ? 'Choose a group' : 'No matching groups yet'}</option>
              {matchingTeams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
            <label className="label" htmlFor="new-member-role">Role in the group</label>
            <select id="new-member-role" className="input" value={memberRole} onChange={(event) => setMemberRole(event.target.value)}>
              {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label className="access-chip">
              <input type="checkbox" checked={isManager} onChange={(event) => setIsManager(event.target.checked)} />
              Manager
            </label>
            <button type="submit" className="btn btn-primary" disabled={saving || !teamsReady}>{saving ? 'Adding…' : 'Add person'}</button>
          </form>
        </div>
      </DevOpsLayout>
    </>
  );
}
