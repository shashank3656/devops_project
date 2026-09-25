import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../../components/AdminLayout';
import CalendarDateInput from '../../../components/CalendarDateInput';

interface DevopsProfile {
  is_manager: boolean;
  position: string;
  onboard_date: string | null;
  level: string;
}

interface Team {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  verified: boolean;
  created_at?: string;
  user_type?: 'portal_user' | 'devops_user';
  manager_id?: number | null;
  devops_profile?: DevopsProfile;
  teams?: Team[];
}

interface OnboardingMilestone {
  key: string;
  title: string;
  detail: string;
  state: 'completed' | 'current' | 'upcoming' | 'attention';
  timestamp?: string;
}

interface OnboardingRequestSummary {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  pr_url: string;
  created_at: string;
  updated_at: string;
}

interface OnboardingProgress {
  user_id: number;
  username: string;
  email: string;
  user_type: string;
  role: string;
  verified: boolean;
  created_at: string;
  manager_username?: string;
  teams: Team[];
  requests_by_status: Record<string, number>;
  requests_total: number;
  submitted_requests: number;
  latest_request?: OnboardingRequestSummary | null;
  milestones: OnboardingMilestone[];
  next_action: string;
  completion_percent: number;
}

function normalizeOnboardingProgress(raw: any): OnboardingProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const latestRequest =
    raw.latest_request && typeof raw.latest_request === 'object'
      ? {
          id: typeof raw.latest_request.id === 'number' ? raw.latest_request.id : 0,
          team: typeof raw.latest_request.team === 'string' ? raw.latest_request.team : '',
          env: typeof raw.latest_request.env === 'string' ? raw.latest_request.env : '',
          cloud: typeof raw.latest_request.cloud === 'string' ? raw.latest_request.cloud : '',
          service: typeof raw.latest_request.service === 'string' ? raw.latest_request.service : '',
          status: typeof raw.latest_request.status === 'string' ? raw.latest_request.status : 'unknown',
          pr_url: typeof raw.latest_request.pr_url === 'string' ? raw.latest_request.pr_url : '',
          created_at: typeof raw.latest_request.created_at === 'string' ? raw.latest_request.created_at : '',
          updated_at: typeof raw.latest_request.updated_at === 'string' ? raw.latest_request.updated_at : '',
        }
      : null;
  const milestones = Array.isArray(raw.milestones)
    ? raw.milestones
        .filter((item: any) => item && typeof item === 'object')
        .map(
          (item: any, index: number): OnboardingMilestone => ({
            key: typeof item.key === 'string' ? item.key : `step-${index + 1}`,
            title: typeof item.title === 'string' ? item.title : 'Onboarding step',
            detail: typeof item.detail === 'string' ? item.detail : '',
            state:
              item.state === 'completed' || item.state === 'current' || item.state === 'upcoming' || item.state === 'attention'
                ? item.state
                : 'upcoming',
            timestamp: typeof item.timestamp === 'string' ? item.timestamp : undefined,
          }),
        )
    : [];
  return {
    user_id: typeof raw.user_id === 'number' ? raw.user_id : 0,
    username: typeof raw.username === 'string' ? raw.username : '',
    email: typeof raw.email === 'string' ? raw.email : '',
    user_type: typeof raw.user_type === 'string' ? raw.user_type : '',
    role: typeof raw.role === 'string' ? raw.role : '',
    verified: Boolean(raw.verified),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    manager_username: typeof raw.manager_username === 'string' ? raw.manager_username : undefined,
    teams: Array.isArray(raw.teams) ? raw.teams : [],
    requests_by_status:
      raw.requests_by_status && typeof raw.requests_by_status === 'object' ? raw.requests_by_status : {},
    requests_total: typeof raw.requests_total === 'number' ? raw.requests_total : 0,
    submitted_requests: typeof raw.submitted_requests === 'number' ? raw.submitted_requests : 0,
    latest_request: latestRequest,
    milestones,
    next_action: typeof raw.next_action === 'string' ? raw.next_action : 'Review user onboarding',
    completion_percent: typeof raw.completion_percent === 'number' ? raw.completion_percent : 0,
  };
}

function parsePositiveIntParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export default function EditUser() {
  const router = useRouter();
  const { id, created, team_assign_failed } = router.query;
  const routeUserId = useMemo(() => parsePositiveIntParam(id), [id]);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'contributor' | 'admin'>('viewer');
  const [verified, setVerified] = useState(false);
  const [userType, setUserType] = useState<'portal_user' | 'devops_user'>('portal_user');
  const [isManager, setIsManager] = useState(false);
  const [position, setPosition] = useState('');
  const [onboardDate, setOnboardDate] = useState('');
  const [level, setLevel] = useState<'L1' | 'L2' | 'L3' | 'L4'>('L1');
  const [managerId, setManagerId] = useState<string>('');
  const [isPortalManager, setIsPortalManager] = useState(false);
  const [usersList, setUsersList] = useState<{ id: number; username: string }[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [teamRole, setTeamRole] = useState('developer');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [membershipSaving, setMembershipSaving] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState<OnboardingProgress | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [error, setError] = useState('');
  const [membershipNotice, setMembershipNotice] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    if (routeUserId) {
      fetchUser(routeUserId);
      fetchOnboardingProgress(routeUserId);
    } else {
      setLoading(false);
      setUser(null);
      setError('User not found');
    }
    fetchUsersList();
    fetchTeamsList();
  }, [token, routeUserId, router]);

  const fetchOnboardingProgress = async (userId: number) => {
    setOnboardingLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${userId}/onboarding-progress`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOnboardingProgress(normalizeOnboardingProgress(data.progress));
      } else {
        setOnboardingProgress(null);
      }
    } catch (_) {
      setOnboardingProgress(null);
    } finally {
      setOnboardingLoading(false);
    }
  };

  const fetchUsersList = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.users)) {
        setUsersList(
          data.users.map((u: { id: number; username: string }) => ({ id: u.id, username: u.username })),
        );
      } else {
        setUsersList([]);
      }
    } catch (_) {}
  };

  const fetchTeamsList = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.teams)) {
        setAllTeams(data.teams);
      } else {
        setAllTeams([]);
      }
    } catch (_) {
      setAllTeams([]);
    }
  };

  const fetchUser = async (userId: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.user) {
        const nextUser = {
          ...data.user,
          teams: Array.isArray(data.user.teams) ? data.user.teams : [],
        } as User;
        setUser(nextUser);
        setUsername(nextUser.username || '');
        setEmail(nextUser.email || '');
        setRole((nextUser.role || 'viewer') as 'viewer' | 'contributor' | 'admin');
        setVerified(Boolean(nextUser.verified));
        setUserType(nextUser.user_type === 'devops_user' ? 'devops_user' : 'portal_user');
        setManagerId(nextUser.manager_id != null ? String(nextUser.manager_id) : '');
        setIsPortalManager(Boolean((nextUser as any).is_portal_manager));
        const dp = nextUser.devops_profile;
        if (dp) {
          setIsManager(Boolean(dp.is_manager));
          setPosition(dp.position || '');
          setOnboardDate(dp.onboard_date || '');
          setLevel((dp.level || 'L1') as 'L1' | 'L2' | 'L3' | 'L4');
        } else {
          setIsManager(false);
          setPosition('');
          setOnboardDate('');
          setLevel('L1');
        }
      } else {
        setError(data.error || 'User not found');
      }
    } catch (_) {
      setError('Failed to load user');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          role,
          verified,
          user_type: userType,
          manager_id: userType === 'portal_user' ? (managerId ? parseInt(managerId, 10) : null) : undefined,
          is_portal_manager: userType === 'portal_user' ? isPortalManager : undefined,
          ...(userType === 'devops_user' && {
            is_manager: isManager,
            position: position.trim(),
            onboard_date: onboardDate.trim() || undefined,
            level,
          }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push('/users');
        return;
      }
      setError(data.error || 'Failed to update user');
    } catch (_) {
      setError('Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const availableTeams = allTeams.filter((team) => {
    if ((team.team_type || 'portal') !== userType.replace('_user', '')) {
      return false;
    }
    return !user?.teams?.some((entry) => entry.id === team.id);
  });

  useEffect(() => {
    if (userType === 'devops_user') {
      if (!['member', 'lead'].includes(teamRole)) {
        setTeamRole('member');
      }
    } else if (!['developer', 'senior_developer', 'lead', 'manager'].includes(teamRole)) {
      setTeamRole('developer');
    }
  }, [teamRole, userType]);

  useEffect(() => {
    if (!selectedTeamId && availableTeams.length > 0) {
      setSelectedTeamId(String(availableTeams[0].id));
    }
    if (selectedTeamId && !availableTeams.some((team) => team.id === Number(selectedTeamId))) {
      setSelectedTeamId(availableTeams[0] ? String(availableTeams[0].id) : '');
    }
  }, [availableTeams, selectedTeamId]);

  const handleAddTeamMembership = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedTeamId) return;
    setMembershipSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${selectedTeamId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: user.id,
          role: teamRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to add team membership');
        return;
      }
      setMembershipNotice('Added to team.');
      window.setTimeout(() => setMembershipNotice(''), 4000);
      await fetchUser(user.id);
      await fetchOnboardingProgress(user.id);
    } catch (_) {
      setError('Failed to add team membership');
    } finally {
      setMembershipSaving(false);
    }
  };

  const handleRemoveTeamMembership = async (teamId: number) => {
    if (!user || !confirm('Remove this user from the selected team?')) return;
    setMembershipSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${teamId}/members/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to remove team membership');
        return;
      }
      await fetchUser(user.id);
      await fetchOnboardingProgress(user.id);
    } catch (_) {
      setError('Failed to remove team membership');
    } finally {
      setMembershipSaving(false);
    }
  };

  if (!routeUserId) return null;

  return (
    <>
      <Head>
        <title>Edit user - SetuOps Governance</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          {loading ? (
            <div className="admin-queue-state">
              <div className="admin-queue-state__spinner" aria-hidden="true" />
              <p className="admin-queue-state__title">Loading user</p>
            </div>
          ) : error && !user ? (
            <div className="portal-surface">
              <div className="alert alert-error">{error}</div>
              <Link href="/users" className="btn btn-secondary" style={{ marginTop: 16 }}>
                Back to users
              </Link>
            </div>
          ) : user ? (
            <>
              <div className="portal-page__header">
                <div>
                  <span className="portal-page__eyebrow">People</span>
                  <h1 className="portal-page__title">{user.username}</h1>
                  <p className="portal-page__subtitle">
                    {user.email} · {userType === 'devops_user' ? 'DevOps user' : 'Portal user'}
                  </p>
                </div>
                <Link href="/users" className="btn btn-secondary">
                  All users
                </Link>
              </div>
              {created === '1' ? (
                <div className="alert admin-user-edit__success-alert" role="alert">
                  User created successfully.
                  {team_assign_failed ? ' Some team assignments still need review.' : ''}
                </div>
              ) : null}
              {membershipNotice ? (
                <div className="alert alert-success" role="status">
                  {membershipNotice}
                </div>
              ) : null}
              <div className="card onboarding-admin-card admin-user-edit__card admin-user-edit__card--wide">
                <h3 className="card-title admin-user-edit__section-title">Onboarding Progress Tracker</h3>
                <p className="admin-user-edit__section-copy">
                  Review where this user is blocked and what needs to happen next.
                </p>
                {onboardingLoading ? (
                  <div className="empty-state admin-user-edit__empty-inline">Loading onboarding progress…</div>
                ) : onboardingProgress ? (
                  <>
                    <div className="admin-onboarding-summary-grid">
                      <article className="admin-onboarding-summary-card">
                        <span>Completion</span>
                        <strong>{onboardingProgress.completion_percent}%</strong>
                        <p>{onboardingProgress.next_action}</p>
                      </article>
                      <article className="admin-onboarding-summary-card">
                        <span>Teams</span>
                        <strong>{onboardingProgress.teams.length}</strong>
                        <p>{onboardingProgress.teams.length > 0 ? onboardingProgress.teams.map((team) => team.name).slice(0, 3).join(', ') : 'No team assignment yet'}</p>
                      </article>
                      <article className="admin-onboarding-summary-card">
                        <span>Submitted requests</span>
                        <strong>{onboardingProgress.submitted_requests}</strong>
                        <p>{onboardingProgress.latest_request ? `Latest status: ${onboardingProgress.latest_request.status.replace(/_/g, ' ')}` : 'No request submitted yet'}</p>
                      </article>
                    </div>
                    <div className="admin-onboarding-timeline">
                      {onboardingProgress.milestones.map((milestone) => (
                        <article
                          key={milestone.key}
                          className={`admin-onboarding-timeline__step admin-onboarding-timeline__step--${milestone.state}`}
                        >
                          <div className="admin-onboarding-timeline__dot" />
                          <div>
                            <div className="admin-onboarding-timeline__header">
                              <strong>{milestone.title}</strong>
                              <span className={`admin-onboarding-state admin-onboarding-state--${milestone.state}`}>
                                {milestone.state}
                              </span>
                            </div>
                            <p>{milestone.detail}</p>
                            {milestone.timestamp && (
                              <span className="admin-onboarding-timeline__time">
                                {new Date(milestone.timestamp).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-state admin-user-edit__empty-inline">
                    Onboarding progress is not available for this user right now.
                  </div>
                )}
              </div>
              <section className="portal-surface admin-user-edit__card admin-user-edit__card--wide">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Teams</span>
                    <h2 className="portal-surface__title">Team membership</h2>
                    <p className="portal-surface__subtitle admin-user-edit__section-copy admin-user-edit__section-copy--compact">
                      Add or remove {userType === 'devops_user' ? 'DevOps' : 'portal'} teams for this person. You can also manage members from{' '}
                      <Link href="/teams">Teams</Link>.
                    </p>
                  </div>
                </div>
                {user.teams && user.teams.length > 0 ? (
                  <ul className="admin-user-edit__team-list">
                    {user.teams.map((t) => (
                      <li key={t.id} className="admin-user-edit__team-item">
                        <Link href={`/teams/${t.id}`}>{t.name}</Link>
                        {t.team_type ? (
                          <span className="admin-user-edit__team-meta">({t.team_type})</span>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-secondary admin-user-edit__team-remove"
                          disabled={membershipSaving}
                          onClick={() => void handleRemoveTeamMembership(t.id)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-state admin-user-edit__empty-inline">
                    Not on any teams yet. Add one below or open a team and use <strong>Add member</strong>.
                  </div>
                )}
                <div className="admin-team-detail__section" style={{ marginTop: 20 }}>
                  <h3 className="admin-team-detail__subheading">Add to team</h3>
                  {availableTeams.length === 0 ? (
                    <div className="empty-state admin-user-edit__empty-inline">
                      No more {userType === 'devops_user' ? 'DevOps' : 'portal'} teams to join.{' '}
                      <Link href="/teams/new">Create a team</Link>
                    </div>
                  ) : (
                    <form onSubmit={handleAddTeamMembership} className="admin-team-detail__inline-form">
                      <div className="form-group admin-team-detail__field admin-team-detail__field--user">
                        <label className="label" htmlFor="user-team-add">
                          Team
                        </label>
                        <select
                          id="user-team-add"
                          className="input"
                          value={selectedTeamId}
                          onChange={(e) => setSelectedTeamId(e.target.value)}
                        >
                          {availableTeams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group admin-team-detail__field admin-team-detail__field--role">
                        <label className="label" htmlFor="user-team-role">
                          Role
                        </label>
                        <select
                          id="user-team-role"
                          className="input admin-user-edit__select--sm"
                          value={teamRole}
                          onChange={(e) => setTeamRole(e.target.value)}
                        >
                          {userType === 'devops_user' ? (
                            <>
                              <option value="member">member</option>
                              <option value="lead">lead</option>
                            </>
                          ) : (
                            <>
                              <option value="developer">developer</option>
                              <option value="senior_developer">senior developer</option>
                              <option value="lead">lead</option>
                              <option value="manager">manager</option>
                            </>
                          )}
                        </select>
                      </div>
                      <button type="submit" className="btn btn-primary" disabled={membershipSaving || !selectedTeamId}>
                        {membershipSaving ? 'Saving…' : 'Add to team'}
                      </button>
                    </form>
                  )}
                </div>
              </section>
            <div className="card admin-user-edit__card admin-user-edit__card--narrow">
              <h2 className="card-title">Edit user profile</h2>
              <p className="admin-user-edit__section-copy admin-user-edit__section-copy--form">
                Update username, email, role, or verified status. Changes apply immediately.
              </p>
              {error && (
                <div className="alert alert-error" role="alert">
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="label" htmlFor="edit-username">
                    Username <span style={{ color: 'var(--color-danger)' }}>*</span>
                  </label>
                  <input
                    id="edit-username"
                    className="input"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="Username"
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="edit-email">
                    Email <span style={{ color: 'var(--color-danger)' }}>*</span>
                  </label>
                  <input
                    id="edit-email"
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="user@example.com"
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="edit-role">
                    Role
                  </label>
                  <select
                    id="edit-role"
                    className="input admin-user-edit__select--xs"
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'viewer' | 'contributor' | 'admin')}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="contributor">Contributor</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="admin-user-edit__check">
                    <input
                      type="checkbox"
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    <span className="label">Verified (can log in without OTP)</span>
                  </label>
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="edit-user-type">
                    User type
                  </label>
                  <select
                    id="edit-user-type"
                    className="input admin-user-edit__select--xs"
                    value={userType}
                    onChange={(e) => setUserType(e.target.value as 'portal_user' | 'devops_user')}
                  >
                    <option value="portal_user">Portal user</option>
                    <option value="devops_user">DevOps user</option>
                  </select>
                </div>
                {userType === 'portal_user' && (
                  <div className="form-group">
                    <label className="label" htmlFor="edit-manager">Manager (for two-step approval)</label>
                    <select
                      id="edit-manager"
                      className="input admin-user-edit__select--md"
                      value={managerId}
                      onChange={(e) => setManagerId(e.target.value)}
                    >
                      <option value="">None</option>
                      {usersList.filter((u) => u.id !== (id && typeof id === 'string' ? parseInt(id, 10) : 0)).map((u) => (
                        <option key={u.id} value={u.id}>{u.username}</option>
                      ))}
                    </select>
                    <span className="label-optional admin-user-edit__hint">
                      When this user submits a request, their manager approves first, then DevOps.
                    </span>
                  </div>
                )}
                {userType === 'portal_user' && (
                  <div className="form-group">
                    <label className="admin-user-edit__check">
                      <input
                        type="checkbox"
                        checked={isPortalManager}
                        onChange={(e) => setIsPortalManager(e.target.checked)}
                      />
                      <span className="label">Portal manager</span>
                    </label>
                    <span className="label-optional admin-user-edit__hint">
                      Designate as group manager (same as DevOps manager). They can approve team tickets and see Group tickets.
                    </span>
                  </div>
                )}
                {userType === 'devops_user' && (
                  <>
                    <div className="form-group">
                      <label className="admin-user-edit__check">
                        <input
                          type="checkbox"
                          checked={isManager}
                          onChange={(e) => setIsManager(e.target.checked)}
                        />
                        <span className="label">DevOps manager</span>
                      </label>
                    </div>
                    <div className="form-group">
                      <label className="label" htmlFor="edit-position">Position</label>
                      <input
                        id="edit-position"
                        className="input"
                        type="text"
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                        placeholder="e.g. DevOps Engineer"
                      />
                    </div>
                    <div className="form-group">
                      <label className="label" htmlFor="edit-onboard">Onboard date</label>
                      <div className="admin-user-edit__date-wrap">
                        <CalendarDateInput id="edit-onboard" value={onboardDate} onChange={setOnboardDate} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="label" htmlFor="edit-level">Level</label>
                      <select
                        id="edit-level"
                        className="input admin-user-edit__select--level"
                        value={level}
                        onChange={(e) => setLevel(e.target.value as 'L1' | 'L2' | 'L3' | 'L4')}
                      >
                        <option value="L1">L1</option>
                        <option value="L2">L2</option>
                        <option value="L3">L3</option>
                        <option value="L4">L4</option>
                      </select>
                    </div>
                  </>
                )}
                <button
                  type="submit"
                  className="btn btn-primary admin-user-edit__submit"
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </form>
            </div>
            </>
          ) : null}
        </div>
      </AdminLayout>
    </>
  );
}
