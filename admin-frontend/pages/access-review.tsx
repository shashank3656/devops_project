import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import AdminLayout from '../components/AdminLayout';

interface DevopsProfile {
  is_manager: boolean;
  position: string;
  onboard_date: string | null;
  level: string;
}

interface AccessMembership {
  team_id: number;
  team_name: string;
  team_slug: string;
  application_id: string;
  team_type: string;
  role: string;
  project_scopes: ProjectScope[];
}

interface ProjectScope {
  project_id: number;
  project_name: string;
  project_code: string;
  project_status: string;
  environments: string[];
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  status?: string;
}

interface AccessReviewUser {
  id: number;
  username: string;
  email: string;
  role: string;
  verified: boolean;
  user_type: 'portal_user' | 'devops_user';
  is_portal_manager: boolean;
  devops_profile?: DevopsProfile;
  memberships: AccessMembership[];
}

interface Summary {
  total_users: number;
  total_memberships: number;
  total_project_scopes: number;
  users_without_teams: number;
  portal_managers: number;
  devops_managers: number;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function AccessReviewPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AccessReviewUser[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [userTypeFilter, setUserTypeFilter] = useState<'all' | 'portal_user' | 'devops_user'>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'with_teams' | 'without_teams'>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [removingKey, setRemovingKey] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    const rawProjectID = router.query.project_id;
    const projectID = Array.isArray(rawProjectID) ? rawProjectID[0] : rawProjectID;
    if (projectID) {
      setProjectFilter(projectID);
    }
  }, [router.isReady, router.query.project_id]);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      window.location.href = '/login';
      return;
    }
    void fetchAccessReview();
  }, []);

  const fetchAccessReview = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/access-review`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
      });
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/login';
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers(Array.isArray(data.users) ? data.users : []);
        setProjects(Array.isArray(data.projects) ? data.projects : []);
        setSummary(data.summary || null);
      } else {
        setError(data.error || 'Failed to load access review');
      }
    } catch {
      setError('Failed to load access review');
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => {
      if (userTypeFilter !== 'all' && user.user_type !== userTypeFilter) return false;
      if (scopeFilter === 'with_teams' && user.memberships.length === 0) return false;
      if (scopeFilter === 'without_teams' && user.memberships.length > 0) return false;
      if (projectFilter !== 'all') {
        const hasProjectAccess = user.memberships.some((membership) =>
          membership.project_scopes.some((scope) => String(scope.project_id) === projectFilter),
        );
        if (!hasProjectAccess) return false;
      }
      if (!q) return true;
      const membershipText = user.memberships.map((membership) => {
        const projectText = membership.project_scopes
          .map((scope) => `${scope.project_name} ${scope.project_code} ${scope.project_status} ${scope.environments.join(' ')}`)
          .join(' ');
        return `${membership.team_name} ${membership.role} ${membership.team_type} ${projectText}`;
      }).join(' ').toLowerCase();
      return (
        user.username.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        user.role.toLowerCase().includes(q) ||
        membershipText.includes(q)
      );
    });
  }, [users, search, scopeFilter, projectFilter, userTypeFilter]);

  const handleRevoke = async (userId: number, membership: AccessMembership) => {
    const confirmed = window.confirm(`Remove ${membership.team_name} access from this user?`);
    if (!confirmed) return;
    const requestKey = `${membership.team_id}:${userId}`;
    const existingUser = users.find((user) => user.id === userId);
    const hadSingleMembership = (existingUser?.memberships.length || 0) === 1;
    const removedProjectScopes = membership.project_scopes.length;
    setRemovingKey(requestKey);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${membership.team_id}/members/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to revoke access');
        return;
      }
      setUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? { ...user, memberships: user.memberships.filter((item) => item.team_id !== membership.team_id) }
            : user,
        ),
      );
      setSummary((current) =>
        current
          ? {
              ...current,
              total_memberships: Math.max(0, current.total_memberships - 1),
              total_project_scopes: Math.max(0, current.total_project_scopes - removedProjectScopes),
              users_without_teams: current.users_without_teams + (hadSingleMembership ? 1 : 0),
            }
          : current,
      );
    } catch {
      setError('Failed to revoke access');
    } finally {
      setRemovingKey('');
    }
  };

  return (
    <>
      <Head>
        <title>Access Review - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Access Review</span>
              <h1 className="portal-page__title">Access Review</h1>
              <p className="portal-page__subtitle">
                Review portal and DevOps memberships in one place, then revoke stale team access without leaving the admin console.
              </p>
            </div>
          </div>

          <section className="portal-stat-grid">
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Users</span>
              <strong className="portal-stat-card__value">{summary?.total_users ?? users.length}</strong>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Memberships</span>
              <strong className="portal-stat-card__value">{summary?.total_memberships ?? 0}</strong>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">No Team</span>
              <strong className="portal-stat-card__value">{summary?.users_without_teams ?? 0}</strong>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Project scopes</span>
              <strong className="portal-stat-card__value">{summary?.total_project_scopes ?? 0}</strong>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Managers</span>
              <strong className="portal-stat-card__value">{(summary?.portal_managers ?? 0) + (summary?.devops_managers ?? 0)}</strong>
            </article>
          </section>

          <section className="portal-surface">
            <div className="access-review-toolbar">
              <input
                className="input access-review-toolbar__search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by user, email, team, or role"
              />
              <select className="input access-review-toolbar__select" value={userTypeFilter} onChange={(event) => setUserTypeFilter(event.target.value as 'all' | 'portal_user' | 'devops_user')}>
                <option value="all">All user types</option>
                <option value="portal_user">Portal users</option>
                <option value="devops_user">DevOps users</option>
              </select>
              <select className="input access-review-toolbar__select" value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as 'all' | 'with_teams' | 'without_teams')}>
                <option value="all">All access states</option>
                <option value="with_teams">With team access</option>
                <option value="without_teams">Without team access</option>
              </select>
              <select className="input access-review-toolbar__select" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="all">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={String(project.id)}>
                    {project.name} ({project.code})
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="portal-surface portal-surface--table">
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            {loading ? (
              <div className="empty-state" style={{ padding: 24 }}>Loading access review...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="empty-state">
                <p>No users match the current access review filters.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="users-table access-review-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Type</th>
                      <th>Directory Role</th>
                      <th>Verification</th>
                      <th>Team Access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div className="access-review-user">
                            <strong>{user.username}</strong>
                            <span>{user.email}</span>
                          </div>
                        </td>
                        <td>
                          <div className="access-review-type">
                            <span>{user.user_type === 'devops_user' ? 'DevOps user' : 'Portal user'}</span>
                            {user.is_portal_manager && <span className="portal-pill">Portal manager</span>}
                            {user.devops_profile?.is_manager && <span className="portal-pill">DevOps manager</span>}
                          </div>
                        </td>
                        <td>
                          <span className={`role-badge role-badge--${user.role || 'viewer'}`}>{user.role || 'viewer'}</span>
                        </td>
                        <td>{user.verified ? 'Verified' : 'Pending'}</td>
                        <td>
                          {user.memberships.length === 0 ? (
                            <span className="portal-pill">No team access</span>
                          ) : (
                            <div className="access-review-memberships">
                              {user.memberships.map((membership) => {
                                const key = `${membership.team_id}:${user.id}`;
                                return (
                                  <div key={key} className="access-review-membership">
                                    <div className="access-review-membership__meta">
                                      <strong>{membership.team_name}</strong>
                                      <span>
                                        {membership.team_type} / {membership.role}
                                        {membership.application_id ? ` / ${membership.application_id}` : ''}
                                      </span>
                                      {membership.project_scopes.length > 0 ? (
                                        <div className="access-review-project-scopes">
                                          {membership.project_scopes.map((scope) => (
                                            <span key={`${membership.team_id}-${scope.project_id}`} className="portal-pill">
                                              {scope.project_name} ({scope.project_code}) / {scope.environments.join(', ')}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="access-review-project-scopes">
                                          <span className="portal-pill">No project scope</span>
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      disabled={removingKey === key}
                                      onClick={() => void handleRevoke(user.id, membership)}
                                    >
                                      {removingKey === key ? 'Removing...' : 'Revoke'}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </AdminLayout>
    </>
  );
}
