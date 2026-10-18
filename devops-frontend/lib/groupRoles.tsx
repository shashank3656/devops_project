export const JOB_TITLES = [
  { value: 'developer', label: 'Developer' },
  { value: 'senior_developer', label: 'Senior developer' },
  { value: 'lead', label: 'Lead' },
  { value: 'manager', label: 'Manager' },
];

export const MEMBERSHIP_ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'lead', label: 'Lead' },
];

export function isDevopsGroup(kind: string): boolean {
  return kind === 'devops' || kind === 'devops_user';
}

export function groupRoleLabel(kind: string): string {
  return isDevopsGroup(kind) ? 'Membership role' : 'Job title';
}

export function groupRoleHint(kind: string): string {
  return isDevopsGroup(kind)
    ? 'This DevOps group uses Member or Lead. Developer, Senior developer, and Manager are job titles on requester groups.'
    : 'This requester group uses Developer, Senior developer, Lead, or Manager. Member and Lead are used on DevOps groups.';
}

function withCurrent(options: { value: string; label: string }[], current: string) {
  if (!current || options.some((option) => option.value === current)) return options;
  return [...options, { value: current, label: current }];
}

export function GroupRoleFields({
  kind,
  role,
  onChange,
  idPrefix,
  compact = false,
}: {
  kind: string;
  role: string;
  onChange: (role: string) => void;
  idPrefix: string;
  compact?: boolean;
}) {
  const current = typeof role === 'string' ? role : '';
  const options = withCurrent(isDevopsGroup(kind) ? MEMBERSHIP_ROLES : JOB_TITLES, current);
  const label = groupRoleLabel(kind);
  return (
    <label className="label" htmlFor={`${idPrefix}-role`}>
      {compact ? <span className="ig-sr-only">{label}</span> : label}
      <select
        id={`${idPrefix}-role`}
        className="input"
        aria-label={compact ? label : undefined}
        value={current}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
