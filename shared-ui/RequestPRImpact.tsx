import { useEffect, useState } from 'react';
import PRImpactBrief from './PRImpactBrief';
import type { PRImpactBriefData } from './types';
import { portalFetch } from './apiRuntime';

export default function RequestPRImpact({
  apiUrl,
  token,
  requestId,
  compact = false,
}: {
  apiUrl: string;
  token: string | null;
  requestId: number;
  compact?: boolean;
}) {
  const [brief, setBrief] = useState<PRImpactBriefData | null>(null);

  useEffect(() => {
    if (!requestId || !token) return;
    const base = apiUrl.replace(/\/+$/, '');
    portalFetch(`${base}/api/request/${requestId}/pr-impact`, { token })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.impact) setBrief(data.impact);
      })
      .catch(() => {});
  }, [apiUrl, requestId, token]);

  if (!brief) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <PRImpactBrief brief={brief} compact={compact} />
    </div>
  );
}
