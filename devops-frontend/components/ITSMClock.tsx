import { IncidentSLA, slaClockLabel } from '../lib/itsm';

export default function ITSMClock({ sla }: { sla?: IncidentSLA | null }) {
  if (!sla) return null;
  return (
    <>
      <div>
        <span>Response SLA</span>
        <strong style={{ color: sla.response_breached ? 'var(--color-danger, #b42318)' : undefined }}>
          {slaClockLabel(sla, 'response')}
        </strong>
      </div>
      <div>
        <span>Resolve SLA</span>
        <strong style={{ color: sla.resolve_breached ? 'var(--color-danger, #b42318)' : undefined }}>
          {slaClockLabel(sla, 'resolve')}
        </strong>
      </div>
    </>
  );
}
