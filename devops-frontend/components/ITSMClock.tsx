import { IncidentSLA, slaClockLabel, slaClockTone } from '../lib/itsm';

function slaColor(kind: 'response' | 'resolve', sla: IncidentSLA): string | undefined {
  const tone = slaClockTone(sla, kind);
  if (tone === 'danger') return 'var(--color-danger, #b42318)';
  if (tone === 'stale') return 'var(--ig-text-2, #58677F)';
  return undefined;
}

export default function ITSMClock({ sla }: { sla?: IncidentSLA | null }) {
  if (!sla) return null;
  return (
    <>
      <div>
        <span>Response SLA</span>
        <strong style={{ color: slaColor('response', sla) }}>
          {slaClockLabel(sla, 'response')}
        </strong>
      </div>
      <div>
        <span>Resolve SLA</span>
        <strong style={{ color: slaColor('resolve', sla) }}>
          {slaClockLabel(sla, 'resolve')}
        </strong>
      </div>
    </>
  );
}
