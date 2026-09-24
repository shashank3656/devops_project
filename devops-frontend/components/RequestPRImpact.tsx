import { useEffect, useState } from 'react';
import { PRImpactBrief, type PRImpactBriefData } from '@infragate/ui';

export default function RequestPRImpact({ apiUrl, token, requestId }: { apiUrl: string; token: string | null; requestId: number }) {
  const [brief, setBrief] = useState<PRImpactBriefData | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!requestId || !token) return;
    fetch(`${apiUrl.replace(/\/+$/, '')}/api/devops/pr-impact?request_id=${requestId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.impact) setBrief(data.impact);
      })
      .catch(() => {});
  }, [apiUrl, requestId, token]);

  const acknowledge = () => {
    if (!token || !requestId) return;
    setSaving(true);
    fetch(`${apiUrl.replace(/\/+$/, '')}/api/devops/pr-impact?request_id=${requestId}&acknowledge=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.impact) setBrief(data.impact);
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  if (!brief) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <PRImpactBrief brief={brief} />
      {brief.risk_level === 'high' && !brief.acknowledged ? (
        <div className="portal-page__actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={acknowledge} disabled={saving}>
            {saving ? 'Saving…' : 'Acknowledge high-risk brief'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
