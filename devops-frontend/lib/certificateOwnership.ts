export type CertificateTeamOption = { id: number; name: string };
export type CertificateMemberOption = { user_id: number; name: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function jsonIfOk(res: Response): Promise<Record<string, unknown>> {
  const data = await res.json().catch(() => ({}));
  return res.ok ? asRecord(data) : {};
}

function addTeam(byId: Map<number, CertificateTeamOption>, item: unknown) {
  const row = asRecord(item);
  const id = asNumber(row.id) || asNumber(row.team_id);
  const name = String(row.name || row.team_name || '').trim();
  if (id > 0 && name) byId.set(id, { id, name });
}

function collectTeamLists(data: Record<string, unknown>, byId: Map<number, CertificateTeamOption>) {
  [data.teams, data.owner_teams, data.portal_teams, data.choices].forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((item) => addTeam(byId, item));
  });
}

function memberDisplayName(row: Record<string, unknown>): string {
  const name = String(row.name || row.username || '').trim();
  return name || 'Unknown';
}

function readMembers(data: Record<string, unknown>): CertificateMemberOption[] {
  const rows = Array.isArray(data.members) ? data.members : [];
  const byId = new Map<number, CertificateMemberOption>();
  rows.forEach((item) => {
    const row = asRecord(item);
    const userId = asNumber(row.user_id);
    if (userId <= 0) return;
    byId.set(userId, { user_id: userId, name: memberDisplayName(row) });
  });
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadCertificateTeams(
  apiUrl: string,
  token: string,
  projectId?: string,
): Promise<CertificateTeamOption[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const ownershipQuery = new URLSearchParams();
  if (projectId) ownershipQuery.set('project_id', projectId);
  const ownershipPath = ownershipQuery.toString()
    ? `${apiUrl}/api/expiry/assets/ownership?${ownershipQuery}`
    : `${apiUrl}/api/expiry/assets/ownership`;
  const [ownership, mine, options, meTeams, projectTeams] = await Promise.all([
    fetch(ownershipPath, { headers }).then(jsonIfOk).catch(() => ({})),
    fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then(jsonIfOk).catch(() => ({})),
    fetch(`${apiUrl}/api/devops/project-options`, { headers }).then(jsonIfOk).catch(() => ({})),
    fetch(`${apiUrl}/api/me/teams`, { headers }).then(jsonIfOk).catch(() => ({})),
    projectId
      ? fetch(`${apiUrl}/api/oncall/project-teams?project_id=${encodeURIComponent(projectId)}`, { headers })
          .then(jsonIfOk)
          .catch(() => ({}))
      : Promise.resolve({}),
  ]);
  const byId = new Map<number, CertificateTeamOption>();
  [ownership, mine, options, meTeams, projectTeams].forEach((data) => collectTeamLists(data, byId));
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadCertificateMembers(
  apiUrl: string,
  token: string,
  teamId: string,
): Promise<CertificateMemberOption[]> {
  if (!teamId) return [];
  const headers = { Authorization: `Bearer ${token}` };
  const fromOwnership = await fetch(`${apiUrl}/api/expiry/assets/ownership?team_id=${encodeURIComponent(teamId)}`, { headers })
    .then(jsonIfOk)
    .catch(() => ({}));
  const owned = readMembers(fromOwnership);
  if (owned.length) return owned;
  const oncall = await fetch(`${apiUrl}/api/oncall/team-members?team_id=${encodeURIComponent(teamId)}`, { headers })
    .then(jsonIfOk)
    .catch(() => ({}));
  const oncallMembers = readMembers(oncall);
  if (oncallMembers.length) return oncallMembers;
  const devops = await fetch(`${apiUrl}/api/devops/teams/${encodeURIComponent(teamId)}/members`, { headers })
    .then(jsonIfOk)
    .catch(() => ({}));
  return readMembers(devops);
}
