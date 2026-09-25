import { IncidentSLA, slaClockLabel } from '../lib/itsm';

export default function ITSMClock({ sla }: { sla?: IncidentSLA | null }) {
  if (!sla) return null;
  const responseColor = sla.response_breached ? 'var(--color-danger, #b42318)' : undefined;
  const resolveColor = sla.resolve_breached ? 'var(--color-danger, #b42318)' : undefined;
  return (
    <div className="portal-form-grid">
      <label className="label">
        Response SLA
        <input className="input" readOnly value={slaClockLabel(sla, 'response')} style={{ color: responseColor, fontWeight: 600 }} />
      </label>
      <label className="label">
        Resolve SLA
        <input className="input" readOnly value={slaClockLabel(sla, 'resolve')} style={{ color: resolveColor, fontWeight: 600 }} />
      </label>
    </div>
  );
}
