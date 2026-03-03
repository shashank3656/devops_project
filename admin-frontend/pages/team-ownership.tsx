import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../components/AdminLayout';

interface TeamOwnershipMember {
  user_id: number;
  username: string;
  email: string;
  user_type: string;
  role: string;
}

interface TeamOwnershipTeam {
  id: number;
  name: string;
  slug: string;
  application_id: string;
  team_type: string;
  default_env: string;
  default_cloud: string;
  member_count: number;
  owner_count: number;
  portal_user_count: number;
  devops_user_count: number;
  assigned_template_count: number;
  global_template_count: number;
  visible_template_count: number;
  request_count: number;
  pending_count: number;
  completed_count: number;
  rejected_count: number;
  in_progress_count: number;
  draft_count: number;
  needs_attention: boolean;
  last_request_at?: string;
  environments: string[];
  clouds: string[];
  owner_names: string[];
  template_names: string[];
  members: TeamOwnershipMember[];
}

interface TeamOwnershipData {
  status: string;
  summary: {
    total_teams: number;
    portal_teams: number;
    devops_teams: number;
    total_members: number;
    assigned_templates: number;
    global_templates: number;
    teams_without_owner: number;
    teams_needing_action: number;
  };
  teams: TeamOwnershipTeam[];
}

function formatTimestamp(value?: string): string {
  if (!value) return 'No request activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No request activity';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default function TeamOwnershipPage() {
  const router = useRouter();
  const [data, setData] = useState<TeamOwnershipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'portal' | 'devops'>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | 'attention' | 'healthy'>('all');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`${apiUrl}/api/admin/team-ownership`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 401 || response.status === 403) {
          router.replace('/login');
          return;
        }
        const payload = (await response.json().catch(() => ({}))) as Partial<TeamOwnershipData> & { error?: string };
        if (!response.ok || payload.status !== 'ok') {
          throw new Error(payload.error || 'Failed to load team ownership');
        }
        const nextData = payload as TeamOwnershipData;
        setData(nextData);
        setSelectedTeamId((current) => current ?? nextData.teams[0]?.id ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load team ownership');
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [apiUrl, router]);

  const filteredTeams = useMemo(() => {
    const teams = data?.teams || [];
    return teams.filter((team) => {
      const matchesSearch =
        search.trim() === '' ||
        team.name.toLowerCase().includes(search.toLowerCase()) ||
        team.slug.toLowerCase().includes(search.toLowerCase()) ||
        team.application_id.toLowerCase().includes(search.toLowerCase());
      const matchesType = typeFilter === 'all' || team.team_type === typeFilter;
      const matchesHealth =
        healthFilter === 'all' ||
        (healthFilter === 'attention' ? team.needs_attention : !team.needs_attention);
      return matchesSearch && matchesType && matchesHealth;
    });
  }, [data?.teams, healthFilter, search, typeFilter]);

  const selectedTeam = useMemo(() => {
    if (!filteredTeams.length) return null;
    return filteredTeams.find((team) => team.id === selectedTeamId) || filteredTeams[0];
  }, [filteredTeams, selectedTeamId]);

  const handleExport = async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    setExporting(true);
    try {
      const response = await fetch(`${apiUrl}/api/admin/team-ownership?format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('Failed to export team ownership');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'team-ownership.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export team ownership');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Team Ownership - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Ownership</span>
              <h1 className="portal-page__title">Team Ownership Dashboard</h1>
              <p className="portal-page__subtitle">
                Review which teams own members, templates, and request load so gaps in stewardship are visible before they become operational issues.
              </p>
            </div>
            <div className="portal-page__actions">
              <button type="button" className="btn btn-secondary" onClick={() => void handleExport()} disabled={exporting || loading}>
                {exporting ? 'Exporting...' : 'Export CSV'}
              </button>
              <Link href="/teams" className="btn btn-primary">
                Open teams
              </Link>
            </div>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="portal-surface">
              <div className="empty-state">Loading team ownership...</div>
            </div>
          ) : !data ? (
            <div className="portal-surface">
              <div className="empty-state">Team ownership could not be loaded.</div>
            </div>
          ) : (
            <>
              <section className="portal-stat-grid">
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Teams</span>
                  <span className="portal-stat-card__value">{data.summary.total_teams}</span>
                  <p className="portal-stat-card__copy">
                    {data.summary.portal_teams} portal and {data.summary.devops_teams} DevOps teams are currently tracked.
                  </p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Members</span>
                  <span className="portal-stat-card__value">{data.summary.total_members}</span>
                  <p className="portal-stat-card__copy">All team memberships currently assigned across the platform.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Templates</span>
                  <span className="portal-stat-card__value">{data.summary.assigned_templates}</span>
                  <p className="portal-stat-card__copy">
                    {data.summary.global_templates} global templates are available in addition to team-scoped assignments.
                  </p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Needs attention</span>
                  <span className="portal-stat-card__value">{data.summary.teams_needing_action}</span>
                  <p className="portal-stat-card__copy">
                    {data.summary.teams_without_owner} teams are missing a lead or manager owner.
                  </p>
                </article>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Filters</span>
                    <h2 className="portal-surface__title">Ownership Filters</h2>
                  </div>
                </div>
                <div className="portal-field-grid">
                  <div>
                    <label className="label" htmlFor="ownership-search">Search teams</label>
                    <input
                      id="ownership-search"
                      className="input"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search by team name, slug, or Group ID"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="ownership-type">Team type</label>
                    <select id="ownership-type" className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
                      <option value="all">All teams</option>
                      <option value="portal">Portal teams</option>
                      <option value="devops">DevOps teams</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="ownership-health">Ownership health</label>
                    <select id="ownership-health" className="input" value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as typeof healthFilter)}>
                      <option value="all">All teams</option>
                      <option value="attention">Needs attention</option>
                      <option value="healthy">Healthy</option>
                    </select>
                  </div>
                </div>
              </section>

              <section className="team-ownership-layout">
                <article className="portal-surface portal-surface--table">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Inventory</span>
                      <h2 className="portal-surface__title">Ownership Table</h2>
                      <p className="portal-surface__subtitle">{filteredTeams.length} teams match the current filters.</p>
                    </div>
                  </div>
                  {filteredTeams.length === 0 ? (
                    <div className="empty-state">No teams match the current filters.</div>
                  ) : (
                    <div className="table-wrap team-ownership-table-wrap">
                      <table className="team-ownership-table">
                        <thead>
                          <tr>
                            <th>Team</th>
                            <th>Type</th>
                            <th>Members</th>
                            <th>Owners</th>
                            <th>Templates</th>
                            <th>Requests</th>
                            <th>Pending</th>
                            <th>Last activity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTeams.map((team) => (
                            <tr
                              key={team.id}
                              className={selectedTeam?.id === team.id ? 'team-ownership-table__row--active' : ''}
                              onClick={() => setSelectedTeamId(team.id)}
                            >
                              <td>
                                <div className="team-ownership-cell">
                                  <strong>{team.name}</strong>
                                  <span>{team.application_id || team.slug}</span>
                                </div>
                              </td>
                              <td>
                                <span className={`portal-badge ${team.team_type === 'devops' ? 'portal-badge--warning' : 'portal-badge--neutral'}`}>
                                  {team.team_type}
                                </span>
                              </td>
                              <td>{team.member_count}</td>
                              <td>{team.owner_count}</td>
                              <td>{team.visible_template_count}</td>
                              <td>{team.request_count}</td>
                              <td>{team.pending_count}</td>
                              <td>{formatTimestamp(team.last_request_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </article>

                <aside className="portal-surface team-ownership-detail">
                  {selectedTeam ? (
                    <>
                      <div className="portal-surface__header">
                        <div>
                          <span className="portal-surface__eyebrow">Selected Team</span>
                          <h2 className="portal-surface__title">{selectedTeam.name}</h2>
                          <p className="portal-surface__subtitle">
                            {selectedTeam.team_type} team · {selectedTeam.application_id || selectedTeam.slug}
                          </p>
                        </div>
                        <div className="portal-pill-row">
                          <span className={`portal-pill ${selectedTeam.needs_attention ? 'portal-pill--warning' : ''}`}>
                            {selectedTeam.needs_attention ? 'Needs attention' : 'Healthy'}
                          </span>
                          {selectedTeam.default_cloud && <span className="portal-pill">{selectedTeam.default_cloud}</span>}
                          {selectedTeam.default_env && <span className="portal-pill">{selectedTeam.default_env}</span>}
                        </div>
                      </div>

                      <div className="team-ownership-detail__stats">
                        <div className="team-ownership-detail__stat">
                          <span>Members</span>
                          <strong>{selectedTeam.member_count}</strong>
                        </div>
                        <div className="team-ownership-detail__stat">
                          <span>Owners</span>
                          <strong>{selectedTeam.owner_count}</strong>
                        </div>
                        <div className="team-ownership-detail__stat">
                          <span>Visible templates</span>
                          <strong>{selectedTeam.visible_template_count}</strong>
                        </div>
                        <div className="team-ownership-detail__stat">
                          <span>Requests</span>
                          <strong>{selectedTeam.request_count}</strong>
                        </div>
                      </div>

                      <div className="team-ownership-detail__section">
                        <h3>Request posture</h3>
                        <div className="portal-pill-row">
                          <span className="portal-pill">Pending {selectedTeam.pending_count}</span>
                          <span className="portal-pill">Completed {selectedTeam.completed_count}</span>
                          <span className="portal-pill">Rejected {selectedTeam.rejected_count}</span>
                          <span className="portal-pill">In progress {selectedTeam.in_progress_count}</span>
                          <span className="portal-pill">Draft {selectedTeam.draft_count}</span>
                        </div>
                      </div>

                      <div className="team-ownership-detail__section">
                        <h3>Owners</h3>
                        {selectedTeam.owner_names.length > 0 ? (
                          <div className="portal-pill-row">
                            {selectedTeam.owner_names.map((owner) => (
                              <span key={owner} className="portal-pill">{owner}</span>
                            ))}
                          </div>
                        ) : (
                          <p className="team-ownership-empty-copy">No lead or manager owner is assigned.</p>
                        )}
                      </div>

                      <div className="team-ownership-detail__section">
                        <h3>Template coverage</h3>
                        {selectedTeam.template_names.length > 0 ? (
                          <div className="portal-pill-row">
                            {selectedTeam.template_names.map((template) => (
                              <span key={template} className="portal-pill">{template}</span>
                            ))}
                          </div>
                        ) : (
                          <p className="team-ownership-empty-copy">
                            {selectedTeam.team_type === 'portal'
                              ? 'No team-scoped templates are assigned.'
                              : 'DevOps teams do not currently use portal template assignments.'}
                          </p>
                        )}
                      </div>

                      <div className="team-ownership-detail__section">
                        <h3>Request footprint</h3>
                        <div className="portal-detail-grid">
                          <div className="portal-detail-card">
                            <span className="portal-surface__eyebrow">Environments</span>
                            <strong className="portal-detail-card__value">
                              {selectedTeam.environments.length > 0 ? selectedTeam.environments.join(', ') : 'No request activity'}
                            </strong>
                          </div>
                          <div className="portal-detail-card">
                            <span className="portal-surface__eyebrow">Clouds</span>
                            <strong className="portal-detail-card__value">
                              {selectedTeam.clouds.length > 0 ? selectedTeam.clouds.join(', ') : 'No request activity'}
                            </strong>
                          </div>
                        </div>
                      </div>

                      <div className="team-ownership-detail__section">
                        <div className="team-ownership-detail__section-header">
                          <h3>Member roster</h3>
                          <Link href={`/teams/${selectedTeam.id}`} className="btn btn-secondary btn-sm">
                            Manage team
                          </Link>
                        </div>
                        {selectedTeam.members.length > 0 ? (
                          <div className="team-ownership-member-list">
                            {selectedTeam.members.map((member) => (
                              <div key={`${selectedTeam.id}-${member.user_id}`} className="team-ownership-member-list__item">
                                <div>
                                  <strong>{member.username}</strong>
                                  <span>{member.email || 'No email'} · {member.user_type.replace(/_/g, ' ')}</span>
                                </div>
                                <span className="portal-pill">{member.role}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="team-ownership-empty-copy">No members are assigned to this team.</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">Select a team to inspect ownership details.</div>
                  )}
                </aside>
              </section>
            </>
          )}
        </div>
      </AdminLayout>
    </>
  );
}
