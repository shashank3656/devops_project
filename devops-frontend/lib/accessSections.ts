export type SectionKey = 'requests' | 'daily' | 'operations' | 'infrastructure' | 'security' | 'records';
export type SectionGrants = Record<SectionKey, boolean>;

export const ACCESS_SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'requests', label: 'Requests' },
  { key: 'daily', label: 'Daily' },
  { key: 'operations', label: 'Operations' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'security', label: 'Security' },
  { key: 'records', label: 'Records' },
];

export function emptyGrants(): SectionGrants {
  return {
    requests: false,
    daily: false,
    operations: false,
    infrastructure: false,
    security: false,
    records: false,
  };
}

export function grantsForTeam(team: { team_type?: string; grants?: Partial<SectionGrants> | null }): SectionGrants {
  if (team.grants) return grantsFrom(team.grants);
  if (team.team_type === 'devops') {
    return {
      requests: false,
      daily: true,
      operations: true,
      infrastructure: true,
      security: true,
      records: false,
    };
  }
  return {
    requests: true,
    daily: false,
    operations: false,
    infrastructure: false,
    security: false,
    records: false,
  };
}

export function grantsFrom(saved: Partial<SectionGrants> | undefined): SectionGrants {
  const grants = emptyGrants();
  for (const section of ACCESS_SECTIONS) grants[section.key] = Boolean(saved?.[section.key]);
  return grants;
}

export function sameGrants(left: SectionGrants, right: SectionGrants) {
  return ACCESS_SECTIONS.every((section) => left[section.key] === right[section.key]);
}

export function grantSummary(grants: SectionGrants) {
  const names = ACCESS_SECTIONS.filter((section) => grants[section.key]).map((section) => section.label);
  return names.length ? names.join(', ') : 'No sections';
}
