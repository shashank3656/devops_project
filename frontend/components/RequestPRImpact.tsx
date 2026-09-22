import { useEffect, useState } from 'react';
import { PRImpactBrief, type PRImpactBriefData } from '@infragate/ui';

export default function RequestPRImpact({ apiUrl, token, requestId }: { apiUrl: string; token: string | null; requestId: number }) {
  const [brief, setBrief] = useState<PRImpactBriefData | null>(null);

  useEffect(() => {
    if (!requestId || !token) return;
    fetch(`${apiUrl.replace(/\/+$/, '')}/api/request/${requestId}/pr-impact`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.impact) setBrief(data.impact);
      })
      .catch(() => {});
  }, [apiUrl, requestId, token]);

  if (!brief) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <PRImpactBrief brief={brief} compact />
    </div>
  );
}
