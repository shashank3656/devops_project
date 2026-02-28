import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useToast } from '../context/ToastContext';
import { getApiUrl } from '../components/AppLayout';
import { SITE_NAME } from '../lib/site';

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
  team_id: number;
  user_id: number;
  role: string;
  created_at: string;
  username: string;
  email: string;
}

const PORTAL_ROLES = ['developer', 'senior_developer', 'lead', 'manager'];

export default function MyTeamsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [membersByTeam, setMembersByTeam] = useState<Record<number, Member[]>>({});
  const [addingTeamId, setAddingTeamId] = useState<number | null>(null);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('developer');
  const [submitting, setSubmitting] = useState(false);

  const apiUrl = getApiUrl();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/me/managed-teams`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) {
          router.replace('/login');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        const list = data.teams || [];
        setTeams(list);
        list.forEach((team: Team) => {
          fetch(`${apiUrl}/api/me/teams/${team.id}/members`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => (r.ok ? r.json() : null))
            .then((memberData) => {
              if (memberData && Array.isArray(memberData.members)) {
                setMembersByTeam((prev) => ({ ...prev, [team.id]: memberData.members }));
              }
            })
            .catch(() => {});
        });
      })
      .catch(() => toast('Failed to load teams', 'error'))
      .finally(() => setLoading(false));
  }, [apiUrl, router, toast]);

  const loadMembers = (teamId: number) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`${apiUrl}/api/me/teams/${teamId}/members`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.members)) {
          setMembersByTeam((prev) => ({ ...prev, [teamId]: d.members }));
        }
      })
      .catch(() => {});
  };

  const handleAddMember = async (e: React.FormEvent, teamId: number) => {
    e.preventDefault();
    const emailOrUsername = addEmail.trim();
    if (!emailOrUsername) {
      toast('Enter email or username', 'error');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/me/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: emailOrUsername, username: emailOrUsername, role: addRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast('Member added', 'success');
        setAddEmail('');
        setAddRole('developer');
        setAddingTeamId(null);
        loadMembers(teamId);
      } else {
        toast(data.error || 'Failed to add member', 'error');
      }
    } catch (_) {
      toast('Request failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const removeMember = async (team: Team, member: Member) => {
    if (!confirm(`Remove ${member.username || member.email} from ${team.name}?`)) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const res = await fetch(`${apiUrl}/api/me/teams/${team.id}/members/${member.user_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      toast('Member removed', 'success');
      loadMembers(team.id);
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || 'Failed to remove', 'error');
    }
  };

  if (loading) {
    return (
      <>
        <Head>
          <title>My teams - {SITE_NAME}</title>
        </Head>
        <div className="portal-page">
          <div className="portal-surface">
            <div className="empty-state">Loading teams...</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>My teams - {SITE_NAME}</title>
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">My Teams</span>
            <h1 className="portal-page__title">Team Management</h1>
            <p className="portal-page__subtitle">
              Add or remove teammates from the groups you lead so requests route through the right people and approvals stay current.
            </p>
          </div>
        </div>

        {teams.length === 0 ? (
          <div className="portal-surface">
            <div className="empty-state">You do not manage any teams yet.</div>
          </div>
        ) : (
          <div className="team-control-grid">
            {teams.map((team) => (
              <section key={team.id} className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">{team.team_type || 'team'}</span>
                    <h2 className="portal-surface__title">{team.name}</h2>
                    <p className="portal-surface__subtitle">
                      Group ID: {team.application_id || 'Pending'} | Slug: {team.slug}
                    </p>
                  </div>
                  <span className="portal-badge portal-badge--neutral">
                    {(membersByTeam[team.id] || []).length} members
                  </span>
                </div>

                <div className="portal-member-list">
                  {(membersByTeam[team.id] || []).length === 0 ? (
                    <div className="empty-state">No members assigned yet.</div>
                  ) : (
                    (membersByTeam[team.id] || []).map((member) => (
                      <div key={member.id} className="portal-member-list__item">
                        <div>
                          <span className="portal-member-list__name">{member.username || member.email}</span>
                          <span className="portal-member-list__meta">{member.email} / {member.role}</span>
                        </div>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeMember(team, member)}>
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {addingTeamId === team.id ? (
                  <form className="team-control-form" onSubmit={(e) => handleAddMember(e, team.id)}>
                    <div className="portal-field-grid portal-field-grid--two">
                      <div>
                        <label className="label" htmlFor={`add-email-${team.id}`}>Email or username</label>
                        <input
                          id={`add-email-${team.id}`}
                          type="text"
                          className="input"
                          value={addEmail}
                          onChange={(e) => setAddEmail(e.target.value)}
                          placeholder="user@example.com"
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor={`add-role-${team.id}`}>Role</label>
                        <select
                          id={`add-role-${team.id}`}
                          className="input"
                          value={addRole}
                          onChange={(e) => setAddRole(e.target.value)}
                        >
                          {PORTAL_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? 'Adding...' : 'Add member'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setAddingTeamId(null);
                          setAddEmail('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="portal-form-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setAddingTeamId(team.id)}>
                      Add member
                    </button>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
