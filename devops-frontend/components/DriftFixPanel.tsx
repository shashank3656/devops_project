import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface DriftFinding {
  key: string;
  label: string;
  status: string;
  detail: string;
  environments?: string[];
}

interface DriftPair {
  baseline: string;
  target: string;
  details: string[];
}

interface PreparedFix {
  requestId: number;
  changes: Array<{ key: string; from: string; to: string }>;
}

export default function DriftFixPanel({ projectId }: { projectId: number }) {
  const apiUrl = useApiUrl();
  const [findings, setFindings] = useState<DriftFinding[] | null>(null);
  const [state, setState] = useState('');
  const [preparing, setPreparing] = useState('');
  const [prepared, setPrepared] = useState<Record<string, PreparedFix>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/devops/environment-drift?project_id=${projectId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) return null;
        return asRecord(await res.json().catch(() => ({})));
      })
      .then((data) => {
        if (cancelled || !data) return;
        const items = Array.isArray(asRecord(data.drift).items) ? (asRecord(data.drift).items as unknown[]) : [];
        const item = asRecord(items[0]);
        setState(getString(item.state));
        setFindings(Array.isArray(item.findings) ? (item.findings as DriftFinding[]) : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiUrl, projectId]);

  const pairs = useMemo(() => {
    const byPair = new Map<string, DriftPair>();
    (findings || []).forEach((finding) => {
      if (finding.key !== 'version' || !finding.environments || finding.environments.length < 2) return;
      const [baseline, target] = finding.environments;
      const key = `${baseline}->${target}`;
      const pair: DriftPair = byPair.get(key) || { baseline, target, details: [] };
      pair.details.push(finding.detail);
      byPair.set(key, pair);
    });
    return Array.from(byPair.values());
  }, [findings]);

  const otherFindings = (findings || []).filter((finding) => finding.key !== 'version' && finding.status !== 'aligned');

  const prepareFix = async (pair: DriftPair) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const key = `${pair.baseline}->${pair.target}`;
    setPreparing(key);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/environment-drift/fix`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, baseline_env: pair.baseline, target_env: pair.target }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) throw new Error(getString(data.error, 'Could not prepare the drift fix'));
      const request = asRecord(data.request);
      setPrepared((current) => ({
        ...current,
        [key]: {
          requestId: Number(request.id) || 0,
          changes: Array.isArray(data.changes) ? (data.changes as PreparedFix['changes']) : [],
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the drift fix');
    } finally {
      setPreparing('');
    }
  };

  if (findings === null) return null;

  return (
    <section id="drift" className="portal-surface">
      <div className="portal-surface__header">
        <div>
          <span className="portal-surface__eyebrow">Environment drift</span>
          <h2 className="portal-surface__title">
            {pairs.length > 0 ? 'Versions differ between environments' : state === 'aligned' ? 'Environments are aligned' : 'No version drift'}
          </h2>
          <p className="portal-surface__subtitle">
            A fix creates a draft request that copies the baseline&apos;s image, chart and engine versions into the drifted
            environment. It still goes through approval, the pull request and plan review.
          </p>
        </div>
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      {pairs.length > 0 ? (
        <ul className="ig-drift">
          {pairs.map((pair) => {
            const key = `${pair.baseline}->${pair.target}`;
            const done = prepared[key];
            return (
              <li key={key} className="ig-drift__pair">
                <div className="ig-drift__body">
                  <strong>
                    Align <span className="ig-mono">{pair.target}</span> to <span className="ig-mono">{pair.baseline}</span>
                  </strong>
                  <ul className="ig-drift__details">
                    {pair.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                  {done ? (
                    <p className="ig-drift__done" role="status">
                      Draft #{done.requestId} created with {done.changes.length} version{' '}
                      {done.changes.length === 1 ? 'change' : 'changes'}.{' '}
                      <Link href={`/tickets?id=${done.requestId}`}>Open the draft</Link>
                    </p>
                  ) : null}
                </div>
                {!done ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={Boolean(preparing)}
                    onClick={() => void prepareFix(pair)}
                  >
                    {preparing === key ? 'Preparing…' : 'Prepare fix'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {otherFindings.length > 0 ? (
        <ul className="ig-drift__other">
          {otherFindings.map((finding) => (
            <li key={`${finding.key}:${finding.detail}`}>
              <span className={`ig-chip ig-chip--${finding.status === 'drift' ? 'high' : 'medium'}`}>{finding.label}</span>
              <span>{finding.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
