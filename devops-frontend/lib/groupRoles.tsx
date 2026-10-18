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
  const devops = isDevopsGroup(kind);
  const jobValue = devops ? '' : role;
  const membershipValue = devops ? role : '';
  return (
    <>
      <label className="label" htmlFor={`${idPrefix}-job`}>Job title
        <select
          id={`${idPrefix}-job`}
          className="input"
          value={jobValue}
          disabled={devops}
          onChange={(event) => onChange(event.target.value)}
        >
          {devops ? <option value="">Not stored for a DevOps group</option> : null}
          {withCurrent(JOB_TITLES, jobValue).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="label" htmlFor={`${idPrefix}-membership`}>Membership role
        <select
          id={`${idPrefix}-membership`}
          className="input"
          value={membershipValue}
          disabled={!devops}
          onChange={(event) => onChange(event.target.value)}
        >
          {!devops ? <option value="">Not stored for a requester group</option> : null}
          {withCurrent(MEMBERSHIP_ROLES, membershipValue).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {compact ? null : (
        <p className="access-hint">
          {devops
            ? 'A DevOps group stores Membership role: Member or Lead. Job title is not stored on this group.'
            : 'A requester group stores Job title: Developer, Senior developer, Lead, or Manager. Membership role is not stored on this group.'}
        </p>
      )}
    </>
  );
}
