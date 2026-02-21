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
        list.forEach((t: Team) => {
          fetch(`${apiUrl}/api/me/teams/${t.id}/members`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.ok ? r.json() : null)
            .then((d) => {
              if (d && Array.isArray(d.members)) {
                setMembersByTeam((prev) => ({ ...prev, [t.id]: d.members }));
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
      .then((r) => r.ok ? r.json() : null)
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

  if (loading) {
    return (
      <>
        <Head><title>My teams — {SITE_NAME}</title></Head>
        <div className="card" style={{ padding: 24 }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading teams...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Head><title>My teams — {SITE_NAME}</title></Head>
      <div style={{ maxWidth: 900 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>My teams</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          Manage members for teams you lead. Add users by email or username.
        </p>
        {teams.length === 0 ? (
          <div className="card" style={{ padding: 24 }}>
            <p style={{ color: 'var(--text-secondary)' }}>You don&apos;t manage any teams.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {teams.map((team) => (
              <div key={team.id} className="card" style={{ padding: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>{team.name}</h2>
                <div style={{ marginBottom: 16 }}>
                  <strong style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Members</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                    {(membersByTeam[team.id] || []).map((m) => (
                      <li key={m.id} style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{m.username || m.email} — <span style={{ color: 'var(--text-secondary)' }}>{m.role}</span></span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                          onClick={async () => {
                            if (!confirm(`Remove ${m.username || m.email} from ${team.name}?`)) return;
                            const token = localStorage.getItem('token');
                            if (!token) return;
                            const res = await fetch(`${apiUrl}/api/me/teams/${team.id}/members/${m.user_id}`, {
                              method: 'DELETE',
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            if (res.ok) {
                              toast('Member removed', 'success');
                              loadMembers(team.id);
                            } else {
                              const d = await res.json().catch(() => ({}));
                              toast(d.error || 'Failed to remove', 'error');
                            }
                          }}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                    {(membersByTeam[team.id] || []).length === 0 && (
                      <li style={{ color: 'var(--text-secondary)' }}>No members yet.</li>
                    )}
                  </ul>
                </div>
                {addingTeamId === team.id ? (
                  <form onSubmit={(e) => handleAddMember(e, team.id)} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                    <div>
                      <label htmlFor={`add-email-${team.id}`} style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>
                        Email or username
                      </label>
                      <input
                        id={`add-email-${team.id}`}
                        type="text"
                        value={addEmail}
                        onChange={(e) => setAddEmail(e.target.value)}
                        placeholder="user@example.com or username"
                        style={{ padding: '8px 12px', minWidth: 200, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                      />
                    </div>
                    <div>
                      <label htmlFor={`add-role-${team.id}`} style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>
                        Role
                      </label>
                      <select
                        id={`add-role-${team.id}`}
                        value={addRole}
                        onChange={(e) => setAddRole(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                      >
                        {PORTAL_ROLES.map((r) => (
                          <option key={r} value={r}>{r.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                      {submitting ? 'Adding…' : 'Add'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => { setAddingTeamId(null); setAddEmail(''); }}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => setAddingTeamId(team.id)}>
                    Add member
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
