import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface Team {
  id: number;
  name: string;
  slug: string;
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
      .then((r) => {
        if (r.status === 401) {
          router.replace('/login');
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data?.teams) return;
        const list = data.teams as Team[];
        setTeams(list);
        list.forEach((t) => {
          fetch(`${apiUrl}/api/devops/teams/${t.id}/members`, { headers: { Authorization: `Bearer ${token}` } })
            .then((res) => res.ok ? res.json() : null)
            .then((d) => {
              if (d?.members) setMembersByTeam((prev) => ({ ...prev, [t.id]: d.members }));
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
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.members) setMembersByTeam((prev) => ({ ...prev, [teamId]: d.members }));
      })
      .catch(() => {});
  };

  const handleAddMember = async (e: React.FormEvent, teamId: number) => {
    e.preventDefault();
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
      const data = await res.json().catch(() => ({}));
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
      <Head><title>Team — {DEVOPS_SITE_NAME}</title></Head>
      <div className="container">
        <h1 className="page-title">Team</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-6)' }}>
          Manage members of your DevOps teams. Add users by email.
        </p>
        {loading ? (
          <p className="loading-text">Loading teams…</p>
        ) : teams.length === 0 ? (
          <div className="card">
            <p className="empty-state">You are not in any DevOps teams, or you cannot manage any.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {teams.map((team) => (
              <div key={team.id} className="card">
                <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>{team.name}</h2>
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Members</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                    {(membersByTeam[team.id] || []).map((m) => (
                      <li key={m.id} style={{ marginBottom: 4 }}>
                        {m.username || m.email} — <span style={{ color: 'var(--color-text-muted)' }}>{m.role}</span>
                      </li>
                    ))}
                    {(membersByTeam[team.id] || []).length === 0 && (
                      <li style={{ color: 'var(--color-text-muted)' }}>No members yet.</li>
                    )}
                  </ul>
                </div>
                {addingTeamId === team.id ? (
                  <form onSubmit={(e) => handleAddMember(e, team.id)} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
                    <div>
                      <label htmlFor={`add-email-${team.id}`} className="label">Email</label>
                      <input
                        id={`add-email-${team.id}`}
                        type="text"
                        className="input"
                        value={addEmail}
                        onChange={(e) => setAddEmail(e.target.value)}
                        placeholder="user@example.com"
                        style={{ minWidth: 200 }}
                      />
                    </div>
                    <div>
                      <label htmlFor={`add-role-${team.id}`} className="label">Role</label>
                      <select
                        id={`add-role-${team.id}`}
                        className="input"
                        value={addRole}
                        onChange={(e) => setAddRole(e.target.value)}
                        style={{ minWidth: 120 }}
                      >
                        {DEVOPS_ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
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
    </DevOpsLayout>
  );
}
