import { useEffect, useState } from 'react';
import { formatOperationalTime } from '@infragate/ui';

type MatrixRow = {
  environment?: string;
  commit_sha?: string;
  image_digest?: string;
  observed_at?: string;
  source?: string;
  source_label?: string;
  change_number?: string;
  owner_team?: string;
  repository?: string;
  differences?: string[];
  comparable?: boolean;
};

type MatrixPayload = {
  note?: string;
  evaluated_at?: string;
  rows?: MatrixRow[];
};

function known(value?: string) {
  const text = (value || '').trim();
  return text || 'Unknown';
}

export default function ServiceEnvironmentMatrix({
  apiUrl,
  token,
  serviceId,
}: {
  apiUrl: string;
  token: string;
  serviceId: number;
}) {
  const [matrix, setMatrix] = useState<MatrixPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !serviceId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/devops/services/${serviceId}/environments`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Environment versions could not be loaded.');
        return data;
      })
      .then((data) => {
        if (!cancelled) setMatrix((data?.matrix || null) as MatrixPayload | null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Environment versions could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, serviceId, token]);

  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];

  return (
    <div className="table-wrap">
      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <p className="work-empty">Loading environment versions…</p> : null}
      {!loading && !rows.length ? <p className="work-empty">No environment versions are recorded. Missing stays Unknown.</p> : null}
      {!loading && rows.length ? (
        <table>
          <thead>
            <tr>
              <th>Environment</th>
              <th>Commit</th>
              <th>Image digest</th>
              <th>Observed at</th>
              <th>Source</th>
              <th>Differences</th>
              <th>Owner team</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.environment}>
                <td>{known(row.environment)}</td>
                <td className="ig-mono">{known(row.commit_sha)}</td>
                <td className="ig-mono">{known(row.image_digest)}</td>
                <td>{row.observed_at ? formatOperationalTime(row.observed_at) : 'Unknown'}</td>
                <td>{known(row.source_label)}</td>
                <td>
                  {row.differences?.length
                    ? row.differences.join(' · ')
                    : row.comparable
                      ? 'Matches comparable environments'
                      : 'Unknown'}
                </td>
                <td>{known(row.owner_team)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="access-hint">
        {matrix?.note || 'Environment is taken from the stored field, not the title. A recorded change is not a runtime observation. Missing stays Unknown.'}
        {matrix?.evaluated_at ? ` Loaded ${formatOperationalTime(matrix.evaluated_at)}.` : ''}
      </p>
    </div>
  );
}
