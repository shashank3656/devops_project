import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { sessionAuthHeaders } from '../lib/portalAccess';

type Team = { id: number; name: string; slug: string; application_id?: string };
type Member = { id: number; user_id: number; username: string; role: string };

const ROLES = ['developer', 'senior_developer', 'lead', 'manager'];

export default function MyTeamsPage() {
  const apiUrl = useApiUrl();
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Record<number, Member[]>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState<number | null>(null);
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('developer');

  function loadMembers(teamId: number) {
    fetch(`${apiUrl}/api/me/teams/${teamId}/members`, { headers: sessionAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const rows = Array.isArray(body?.members) ? body.members : [];
        setMembers((current) => ({
          ...current,
          [teamId]: rows.map((member: Member) => ({
            id: member.id,
            user_id: member.user_id,
            username: member.username,
            role: member.role,
          })),
        }));
      })
      .catch(() => setMembers((current) => ({ ...current, [teamId]: [] })));
  }

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/me/managed-teams`, { headers: sessionAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancel) return;
        const list = Array.isArray(body?.teams) ? body.teams : [];
        setTeams(list);
        list.forEach((team: Team) => loadMembers(team.id));
      })
      .catch(() => {
        if (!cancel) setNotice('Teams could not be loaded.');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl]);

  async function addMember(event: React.FormEvent, teamId: number) {
    event.preventDefault();
    const response = await fetch(`${apiUrl}/api/me/teams/${teamId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
      body: JSON.stringify({ email: person.trim(), username: person.trim(), role }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(typeof body?.error === 'string' ? body.error : 'Could not add that person.');
      return;
    }
    setPerson('');
    setAdding(null);
    setNotice('Person added.');
    loadMembers(teamId);
  }

  async function removeMember(team: Team, member: Member) {
    const response = await fetch(`${apiUrl}/api/me/teams/${team.id}/members/${member.user_id}`, {
      method: 'DELETE',
      headers: sessionAuthHeaders(),
    });
    if (!response.ok) {
      setNotice('Could not remove that person.');
      return;
    }
    setNotice('Person removed.');
    loadMembers(team.id);
  }

  return (
    <>
      <Head>
        <title>My teams - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Requests</p>
              <h1>My teams</h1>
              <p>Groups you lead. Add or remove people so requests go to the right reviewers.</p>
            </div>
          </header>
          {notice ? <p className="work-empty">{notice}</p> : null}
          {loading ? <p className="work-empty">Loading teams…</p> : null}
          {!loading && teams.length === 0 ? (
            <section className="ops-caught">
              <h2>You do not lead a team.</h2>
              <p>When you are a manager of a group, its members show up here.</p>
            </section>
          ) : null}
          {teams.map((team) => (
            <section key={team.id} className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">{team.slug}</span>
                  <h2 className="portal-surface__title">{team.name}</h2>
                </div>
              </div>
              {(members[team.id] || []).length === 0 ? <p className="work-empty">No members yet.</p> : (
                <ul className="work-list">
                  {(members[team.id] || []).map((member) => (
                    <li key={member.id}>
                      <div className="work-list-row">
                        <strong>{member.username || 'Member'}</strong>
                        <small>{member.role.replaceAll('_', ' ')}</small>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeMember(team, member)}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {adding === team.id ? (
                <form className="portal-field-grid portal-field-grid--two" onSubmit={(event) => addMember(event, team.id)}>
                  <input className="input" value={person} onChange={(event) => setPerson(event.target.value)} placeholder="Username" aria-label="Username" required />
                  <select className="input" value={role} onChange={(event) => setRole(event.target.value)} aria-label="Role">
                    {ROLES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}
                  </select>
                  <button type="submit" className="btn btn-primary">Add</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
                </form>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setAdding(team.id)}>Add a person</button>
              )}
            </section>
          ))}
        </div>
      </DevOpsLayout>
    </>
  );
}
