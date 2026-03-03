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

export default function NewDevopsUser() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'viewer' | 'contributor'>('viewer');
  const [isManager, setIsManager] = useState(false);
  const [position, setPosition] = useState('');
  const [onboardDate, setOnboardDate] = useState('');
  const [level, setLevel] = useState<'L1' | 'L2' | 'L3' | 'L4'>('L1');
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamRole, setTeamRole] = useState<'member' | 'lead'>('member');
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const devopsTeams = teams.filter((team) => (team.team_type || 'portal') === 'devops');

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
          user_type: 'devops_user',
          is_manager: isManager,
          position: position.trim(),
          onboard_date: onboardDate.trim() || undefined,
          level,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        const createdUserId = Number(data.user.id || 0);
        if (createdUserId > 0 && selectedTeamIds.length > 0) {
          const token = localStorage.getItem('admin_token');
          const failedTeams: string[] = [];
          for (const teamId of selectedTeamIds) {
            const team = devopsTeams.find((entry) => entry.id === teamId);
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
      setError(data.error || 'Failed to create DevOps user');
    } catch (_) {
      setError('Failed to create DevOps user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Create DevOps user - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <Link href="/users" className="back-link">
            ← Back to Users
          </Link>
          <div className="card" style={{ maxWidth: 520 }}>
            <h2 className="card-title">Create DevOps user</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 24 }}>
              Create a user who will access the DevOps portal. Set whether they are a manager, position, onboard date, and level (L1–L4) for ticket assignment.
            </p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="label" htmlFor="devops-username">
                  Username <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="devops-username"
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
                <label className="label" htmlFor="devops-email">
                  Email <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="devops-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="e.g. jane@example.com"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="devops-password">
                  Password <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="devops-password"
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
                <label className="label" htmlFor="devops-role">
                  Role
                </label>
                <select
                  id="devops-role"
                  className="input"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'viewer' | 'contributor')}
                  style={{ maxWidth: 200 }}
                >
                  <option value="viewer">Viewer</option>
                  <option value="contributor">Contributor</option>
                </select>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isManager}
                    onChange={(e) => setIsManager(e.target.checked)}
                  />
                  <span className="label">DevOps manager</span>
                </label>
                <span className="label-optional" style={{ display: 'block', marginTop: 4 }}>
                  Managers get access to the workload / &quot;what is working&quot; view in the DevOps portal.
                </span>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="devops-position">
                  Position
                </label>
                <input
                  id="devops-position"
                  className="input"
                  type="text"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="e.g. DevOps Engineer, SRE"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="devops-onboard">
                  Onboard date
                </label>
                <input
                  id="devops-onboard"
                  className="input"
                  type="date"
                  value={onboardDate}
                  onChange={(e) => setOnboardDate(e.target.value)}
                  style={{ maxWidth: 200 }}
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="devops-level">
                  Level
                </label>
                <select
                  id="devops-level"
                  className="input"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as 'L1' | 'L2' | 'L3' | 'L4')}
                  style={{ maxWidth: 120 }}
                >
                  <option value="L1">L1</option>
                  <option value="L2">L2</option>
                  <option value="L3">L3</option>
                  <option value="L4">L4</option>
                </select>
                <span className="label-optional" style={{ display: 'block', marginTop: 4 }}>
                  Used for ticket assignment: Critical→L4, High→L3, Medium→L2, Low→L1.
                </span>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="devops-team-role">
                  Team onboarding
                </label>
                <span className="label-optional" style={{ display: 'block', marginBottom: 10 }}>
                  Optionally add this operator to DevOps teams during creation so they are visible in workload and assignment flows immediately.
                </span>
                {devopsTeams.length === 0 ? (
                  <div className="empty-state" style={{ padding: 16, textAlign: 'left' }}>
                    No DevOps teams exist yet. <Link href="/teams/new">Create a DevOps team first</Link>.
                  </div>
                ) : (
                  <>
                    <select
                      id="devops-team-role"
                      className="input"
                      value={teamRole}
                      onChange={(e) => setTeamRole(e.target.value as 'member' | 'lead')}
                      style={{ maxWidth: 220, marginBottom: 12 }}
                    >
                      <option value="member">member</option>
                      <option value="lead">lead</option>
                    </select>
                    <div className="admin-team-check-row">
                      {devopsTeams.map((team) => (
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
                {loading ? 'Creating…' : 'Create DevOps user'}
              </button>
            </form>
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
