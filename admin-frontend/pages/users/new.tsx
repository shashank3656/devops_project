import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

interface Team {
  id: number;
  name: string;
  team_type?: string;
}

export default function NewUser() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'viewer' | 'contributor'>('viewer');
  const [isManager, setIsManager] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamRole, setTeamRole] = useState<'developer' | 'senior_developer' | 'lead' | 'manager'>('developer');
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const portalTeams = teams.filter((team) => (team.team_type || 'portal') === 'portal');

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/admin/teams`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (Array.isArray(data.teams)) {
          setTeams(data.teams);
        }
      })
      .catch(() => {});
  }, [apiUrl, router]);

  const toggleTeam = (teamId: number) => {
    setSelectedTeamIds((current) =>
      current.includes(teamId) ? current.filter((value) => value !== teamId) : [...current, teamId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
        },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
          role,
          user_type: 'portal_user',
          is_manager: isManager,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        const createdUserId = Number(data.user.id || 0);
        if (createdUserId > 0 && selectedTeamIds.length > 0) {
          const token = localStorage.getItem('admin_token');
          const failedTeams: string[] = [];
          for (const teamId of selectedTeamIds) {
            const team = portalTeams.find((entry) => entry.id === teamId);
            const membershipRes = await fetch(`${apiUrl}/api/admin/teams/${teamId}/members`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                user_id: createdUserId,
                role: teamRole,
              }),
            });
            if (!membershipRes.ok && team) {
              failedTeams.push(team.name);
            }
          }
          if (failedTeams.length > 0) {
            router.push(`/users/${createdUserId}/edit?created=1&team_assign_failed=${failedTeams.length}`);
            return;
          }
        }
        router.push('/users');
        return;
      }
      setError(data.error || 'Failed to create user');
    } catch (_) {
      setError('Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Add user - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <Link href="/users" className="back-link">
            ← Back to Users
          </Link>
          <div className="card" style={{ maxWidth: 480 }}>
            <h2 className="card-title">Add new user</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 24 }}>
              Create a user account. They can log in to the main portal and be added to teams.
            </p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="label" htmlFor="user-username">
                  Username <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="user-username"
                  className="input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="e.g. jane"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="user-email">
                  Email <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="user-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="e.g. jane@example.com"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="user-password">
                  Password <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="user-password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Min 6 characters"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="user-role">
                  Role
                </label>
                <select
                  id="user-role"
                  className="input"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'viewer' | 'contributor')}
                  style={{ maxWidth: 200 }}
                >
                  <option value="viewer">Viewer</option>
                  <option value="contributor">Contributor</option>
                </select>
                <span className="label-optional" style={{ display: 'block', marginTop: 4 }}>
                  Contributors can create PRs; viewers have read-only access.
                </span>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isManager}
                    onChange={(e) => setIsManager(e.target.checked)}
                  />
                  <span className="label">Portal manager</span>
                </label>
                <span className="label-optional" style={{ display: 'block', marginTop: 4 }}>
                  Designate this user as a group manager (same as DevOps manager). They can approve team tickets and see Group tickets in the portal.
                </span>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="user-team-role">
                  Team onboarding
                </label>
                <span className="label-optional" style={{ display: 'block', marginBottom: 10 }}>
                  Optionally place the user into portal teams during creation so they can start using the product immediately.
                </span>
                {portalTeams.length === 0 ? (
                  <div className="empty-state" style={{ padding: 16, textAlign: 'left' }}>
                    No portal teams exist yet. <Link href="/teams/new">Create a team first</Link>.
                  </div>
                ) : (
                  <>
                    <select
                      id="user-team-role"
                      className="input"
                      value={teamRole}
                      onChange={(e) => setTeamRole(e.target.value as 'developer' | 'senior_developer' | 'lead' | 'manager')}
                      style={{ maxWidth: 220, marginBottom: 12 }}
                    >
                      <option value="developer">developer</option>
                      <option value="senior_developer">senior developer</option>
                      <option value="lead">lead</option>
                      <option value="manager">manager</option>
                    </select>
                    <div className="admin-team-check-row">
                      {portalTeams.map((team) => (
                        <label key={team.id} className="admin-team-check">
                          <input
                            type="checkbox"
                            checked={selectedTeamIds.includes(team.id)}
                            onChange={() => toggleTeam(team.id)}
                          />
                          <span>{team.name}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ padding: '10px 24px' }}
              >
                {loading ? 'Creating…' : 'Create user'}
              </button>
            </form>
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
