import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';
import { asRecord } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface Team {
  id: number;
  name: string;
  slug: string;
  application_id: string;
  team_type: string;
  created_at: string;
}

interface Member {
  id: number;
  user_id: number;
  role: string;
  username: string;
  email: string;
}

const DEVOPS_ROLES = ['member', 'lead'];

export default function DevOpsTeamPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [membersByTeam, setMembersByTeam] = useState<Record<number, Member[]>>({});
  const [addingTeamId, setAddingTeamId] = useState<number | null>(null);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('member');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/my-teams`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (response.status === 401) {
          router.replace('/login');
          return null;
        }
        return response.json().catch(() => ({}));
      })
      .then((rawData) => {
        const data = asRecord(rawData);
        if (!Array.isArray(data.teams)) return;
        const nextTeams = data.teams as Team[];
        setTeams(nextTeams);
        nextTeams.forEach((team) => {
          fetch(`${apiUrl}/api/devops/teams/${team.id}/members`, { headers: { Authorization: `Bearer ${token}` } })
            .then((response) => (response.ok ? response.json() : null))
            .then((rawMembersData) => {
              const membersData = asRecord(rawMembersData);
              if (Array.isArray(membersData.members)) {
                setMembersByTeam((previous) => ({ ...previous, [team.id]: membersData.members as Member[] }));
              }
            })
            .catch(() => {});
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const loadMembers = (teamId: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/teams/${teamId}/members`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((rawData) => {
        const data = asRecord(rawData);
        if (Array.isArray(data.members)) {
          setMembersByTeam((previous) => ({ ...previous, [teamId]: data.members as Member[] }));
        }
      })
      .catch(() => {});
  };

  const handleAddMember = async (event: FormEvent, teamId: number) => {
    event.preventDefault();
    const email = addEmail.trim();
    if (!email) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/devops/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, role: addRole }),
      });
      if (res.ok) {
        setAddEmail('');
        setAddRole('member');
        setAddingTeamId(null);
        loadMembers(teamId);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Team - {DEVOPS_SITE_NAME}</title>
      </Head>
      <div className="portal-page">
        <header className="portal-page__header">
          <div className="portal-page__header-main">
            <span className="portal-page__eyebrow">Teams</span>
            <h1 className="portal-page__title">Team Management</h1>
            <p className="portal-page__subtitle">
              All current team-management features remain in place, now organized as clearer team surfaces with explicit member actions.
            </p>
          </div>
        </header>

        <section className="portal-stat-grid">
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Teams</span>
            <strong className="portal-stat-card__value">{teams.length}</strong>
            <p className="portal-stat-card__copy">DevOps teams available to the current manager.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Members</span>
            <strong className="portal-stat-card__value">
              {Object.values(membersByTeam).reduce((total, members) => total + members.length, 0)}
            </strong>
            <p className="portal-stat-card__copy">Total visible team members across the current workspace.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Open forms</span>
            <strong className="portal-stat-card__value">{addingTeamId ? 1 : 0}</strong>
            <p className="portal-stat-card__copy">Member onboarding form state inside the redesigned team view.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">State</span>
            <strong className="portal-stat-card__value">{loading ? 'Syncing' : 'Ready'}</strong>
            <p className="portal-stat-card__copy">Team membership actions still use the existing API workflow.</p>
          </article>
        </section>

        {loading ? (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>Loading teams...</p>
            </div>
          </section>
        ) : teams.length === 0 ? (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>You are not in any DevOps teams, or you cannot manage any.</p>
            </div>
          </section>
        ) : (
          <div className="portal-team-layout">
            {teams.map((team) => {
              const members = membersByTeam[team.id] || [];
              return (
                <section key={team.id} className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Squad</span>
                      <h2 className="portal-surface__title">{team.name}</h2>
                      <p className="portal-surface__subtitle">
                        {team.team_type || 'DevOps team'} | {members.length} members
                      </p>
                    </div>
                    <div className="portal-page__actions">
                      {addingTeamId === team.id ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setAddingTeamId(null);
                            setAddEmail('');
                            setAddRole('member');
                          }}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button type="button" className="btn btn-primary" onClick={() => setAddingTeamId(team.id)}>
                          Add member
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="portal-stack">
                    <div>
                      <div className="portal-pill-row" style={{ marginBottom: 14 }}>
                        <span className="portal-pill">{team.application_id || 'Pending group ID'}</span>
                        <span className="portal-pill">{team.slug}</span>
                        <span className="portal-pill">{team.team_type || 'platform'}</span>
                      </div>
                      {members.length === 0 ? (
                        <div className="portal-empty" style={{ padding: '18px 0 0', textAlign: 'left' }}>
                          <p>No members yet.</p>
                        </div>
                      ) : (
                        <ul className="portal-member-list">
                          {members.map((member) => (
                            <li key={member.id} className="portal-member-list__item">
                              <div>
                                <span className="portal-member-list__name">{member.username || member.email}</span>
                                <span className="portal-member-list__meta">{member.email}</span>
                              </div>
                              <span className="portal-badge portal-badge--neutral">{member.role}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {addingTeamId === team.id && (
                      <form onSubmit={(event) => handleAddMember(event, team.id)} className="portal-stack">
                        <div className="portal-field-grid portal-field-grid--two">
                          <div className="form-group">
                            <label htmlFor={`add-email-${team.id}`} className="label">
                              Email
                            </label>
                            <input
                              id={`add-email-${team.id}`}
                              type="text"
                              className="input"
                              value={addEmail}
                              onChange={(event) => setAddEmail(event.target.value)}
                              placeholder="user@example.com"
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor={`add-role-${team.id}`} className="label">
                              Role
                            </label>
                            <select
                              id={`add-role-${team.id}`}
                              className="input"
                              value={addRole}
                              onChange={(event) => setAddRole(event.target.value)}
                            >
                              {DEVOPS_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="portal-form-actions">
                          <button type="submit" className="btn btn-primary" disabled={submitting}>
                            {submitting ? 'Adding...' : 'Invite member'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </DevOpsLayout>
  );
}
