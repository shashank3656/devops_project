import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatOperationalTime } from '@infragate/ui';
import { recordReference } from '../lib/recordRef';
import ServiceActivityTimeline from './ServiceActivityTimeline';
import ServiceEnvironmentMatrix from './ServiceEnvironmentMatrix';

type TabId = 'overview' | 'resources' | 'changes' | 'incidents' | 'access' | 'environments' | 'activity';

type ChangeRow = {
  id: number;
  change_number?: string;
  service?: string;
  environment?: string;
  status?: string;
  sha?: string;
  image_digest?: string;
  updated_at?: string;
  project_id?: number;
};

type IncidentRow = {
  id: number;
  incident_number?: string;
  service?: string;
  environment?: string;
  status?: string;
  summary?: string;
  owner_username?: string;
  suspected_change_number?: string;
  updated_at?: string;
  project_id?: number;
};

type ResourceRow = {
  id: number;
  display_name?: string;
  resource_id?: string;
  environment?: string;
  service_type?: string;
  status?: string;
  updated_at?: string;
  purpose?: string;
  owner_name?: string;
  expires_at?: string;
  lifecycle_state?: string;
};

type AccessRow = {
  id?: string;
  accessNumber?: string;
  status?: string;
  evaluation?: {
    normalizedScope?: string;
    roleId?: string;
    input?: { service?: string; projectId?: number; project_id?: number };
  };
};

type ServiceSibling = {
  id: number;
  service?: string;
  environment?: string;
  repo?: string;
  team?: string;
  project_id?: number;
};

type ServiceSLO = {
  id: number;
  service?: string;
  environment?: string;
  samples?: number;
  burned?: boolean;
  budget_remaining?: number;
  freeze_reason?: string;
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'resources', label: 'Resources' },
  { id: 'changes', label: 'Changes' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'access', label: 'Access' },
  { id: 'environments', label: 'Environments' },
  { id: 'activity', label: 'Activity' },
];

function sameService(left?: string, right?: string) {
  return (left || '').trim().toLowerCase() === (right || '').trim().toLowerCase();
}

function mask(value?: string) {
  const text = (value || '').trim();
  if (!text) return 'Unknown';
  if (/password|secret|token|bearer/i.test(text)) return 'Hidden';
  return text;
}

function repoDisplay(value?: string) {
  const text = (value || '').trim();
  if (!text) return 'Not connected';
  if (/password|secret|token|bearer/i.test(text)) return 'Hidden';
  const github = text.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (github) return `${github[1]}/${github[2].replace(/\.git$/i, '')}`;
  return text;
}

export default function Service360({
  apiUrl,
  token,
  serviceId,
  serviceName,
  projectId,
  environment,
  ownerTeam,
  repo,
  overview,
}: {
  apiUrl: string;
  token: string;
  serviceId?: number;
  serviceName: string;
  projectId?: number;
  environment?: string;
  ownerTeam?: string;
  repo?: string;
  overview: ReactNode;
}) {
  const [tab, setTab] = useState<TabId>('overview');
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [grants, setGrants] = useState<AccessRow[]>([]);
  const [siblings, setSiblings] = useState<ServiceSibling[]>([]);
  const [consumers, setConsumers] = useState<ServiceSibling[]>([]);
  const [slo, setSlo] = useState<ServiceSLO | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!token || !serviceName) return;
    const headers = { Authorization: `Bearer ${token}` };
    setLoading(true);
    setError('');
    const projectQuery = projectId ? `project_id=${projectId}&` : '';
    Promise.all([
      fetch(`${apiUrl}/api/devops/changes?${projectQuery}q=${encodeURIComponent(serviceName)}`, { headers }).then((res) => (res.ok ? res.json() : Promise.reject(new Error('Changes could not be loaded.')))),
      fetch(`${apiUrl}/api/devops/incidents`, { headers }).then((res) => (res.ok ? res.json() : Promise.reject(new Error('Incidents could not be loaded.')))),
      fetch(`${apiUrl}/api/devops/cloud/resources?${projectQuery}q=${encodeURIComponent(serviceName)}&limit=50`, { headers }).then((res) => (res.ok ? res.json() : Promise.reject(new Error('Resources could not be loaded.')))),
      fetch(`${apiUrl}/api/devops/iam/access-requests?scope=desk`, { headers }).then((res) => (res.ok ? res.json() : { requests: [] })),
      fetch(`${apiUrl}/api/devops/services?${projectQuery}q=${encodeURIComponent(serviceName)}`, { headers }).then((res) => (res.ok ? res.json() : { services: [] })),
      fetch(`${apiUrl}/api/devops/services?${projectQuery}`, { headers }).then((res) => (res.ok ? res.json() : { services: [] })),
      fetch(`${apiUrl}/api/devops/slos?${projectQuery}`, { headers }).then((res) => (res.ok ? res.json() : { slos: [] })),
    ]).then(([changeBody, incidentBody, resourceBody, accessBody, serviceBody, catalogBody, sloBody]) => {
      const changeRows = Array.isArray(changeBody?.changes) ? changeBody.changes : Array.isArray(changeBody?.items) ? changeBody.items : [];
      setChanges(changeRows.filter((item: ChangeRow) => sameService(item.service, serviceName) && (!projectId || !item.project_id || item.project_id === projectId)));
      const incidentRows = Array.isArray(incidentBody?.incidents) ? incidentBody.incidents : [];
      setIncidents(incidentRows.filter((item: IncidentRow) => sameService(item.service, serviceName) && (!projectId || !item.project_id || item.project_id === projectId)));
      const resourceRows = Array.isArray(resourceBody?.resources) ? resourceBody.resources : [];
      const demoIds = new Set([
        'i-0a1b2c3d4e5f67890',
        'db-platform-prod',
        'setuops-artifacts-uat',
        'arn:aws:eks:us-west-2:444455556666:cluster/dev',
        'arn:aws:lambda:us-west-2:444455556666:function:webhook-relay',
      ]);
      setResources(resourceRows.filter((item: ResourceRow) => !demoIds.has(String(item.resource_id || ''))));
      const accessRows = Array.isArray(accessBody?.requests) ? accessBody.requests : [];
      const needle = serviceName.trim().toLowerCase();
      setGrants(accessRows.filter((item: AccessRow) => {
        const named = (item.evaluation?.input?.service || '').trim().toLowerCase();
        if (named) {
          const names = named.split(',').map((value) => value.trim()).filter(Boolean);
          if (!names.includes(needle)) return false;
        } else {
          const scope = (item.evaluation?.normalizedScope || '').toLowerCase();
          const tokens = scope.split(/[^a-z0-9_-]+/).filter(Boolean);
          if (!tokens.includes(needle)) return false;
        }
        const grantProject = item.evaluation?.input?.projectId || item.evaluation?.input?.project_id;
        return !projectId || !grantProject || grantProject === projectId;
      }));
      const serviceRows = Array.isArray(serviceBody?.services) ? serviceBody.services : [];
      setSiblings(serviceRows.filter((item: ServiceSibling) => sameService(item.service, serviceName) && (!projectId || !item.project_id || item.project_id === projectId)));
      const catalog = Array.isArray(catalogBody?.services) ? catalogBody.services as ServiceSibling[] : [];
      const repoKey = (repo || '').trim().toLowerCase();
      const teamKey = (ownerTeam || '').trim().toLowerCase();
      setConsumers(catalog.filter((item) => {
        if (sameService(item.service, serviceName)) return false;
        if (projectId && item.project_id && item.project_id !== projectId) return false;
        const sameRepo = repoKey && (item.repo || '').trim().toLowerCase() === repoKey;
        const sameTeam = teamKey && (item.team || '').trim().toLowerCase() === teamKey;
        return Boolean(sameRepo || sameTeam);
      }).slice(0, 8));
      const sloRows = Array.isArray(sloBody?.slos) ? sloBody.slos as ServiceSLO[] : [];
      setSlo(sloRows.find((item) => sameService(item.service, serviceName) && (!environment || !item.environment || item.environment.toLowerCase() === environment.toLowerCase())) || sloRows.find((item) => sameService(item.service, serviceName)) || null);
      setLoadedAt(new Date().toISOString());
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Service context could not be loaded.');
    }).finally(() => setLoading(false));
  }, [apiUrl, environment, ownerTeam, projectId, reload, repo, serviceName, token]);

  const comparison = useMemo(() => {
    const names = ['dev', 'uat', 'prod'];
    const extras = siblings.map((item) => (item.environment || '').toLowerCase()).filter((name) => name && !names.includes(name));
    return [...names, ...Array.from(new Set(extras))].map((name) => {
      const sibling = siblings.find((item) => (item.environment || '').toLowerCase() === name);
      const change = changes
        .filter((item) => (item.environment || '').toLowerCase() === name)
        .sort((left, right) => (right.updated_at || '').localeCompare(left.updated_at || ''))[0];
      const commit = (change?.sha || '').trim();
      const digest = (change?.image_digest || '').trim();
      const revision = commit.startsWith('manual-') || commit.startsWith('manual_')
        ? `Manual reference ${commit}`
        : commit || digest || 'Unknown';
      return {
        environment: name,
        latestChange: change?.status ? change.status.replaceAll('_', ' ') : 'No change recorded',
        approval: 'Unknown',
        revision,
        digest: mask(digest),
        owner: (sibling?.team || '').trim() || (name === (environment || '').toLowerCase() ? (ownerTeam || '').trim() : '') || 'Not assigned',
        repo: sibling?.repo || 'Unknown',
      };
    });
  }, [changes, environment, ownerTeam, siblings]);

  const activeIncidents = incidents.filter((item) => !['resolved', 'closed', 'cancelled'].includes((item.status || '').toLowerCase()));
  const latestChange = [...changes].sort((left, right) => (right.updated_at || '').localeCompare(left.updated_at || ''))[0];
  const accessAttention = grants.filter((item) => !['approved', 'completed', 'rejected', 'revoked', 'expired'].includes((item.status || '').toLowerCase()));
  const ownerLabel = (ownerTeam || '').trim() || 'Not assigned';
  const repoLabel = repoDisplay(repo);

  const source = loadedAt
    ? `Source: service catalogue, changes, incidents, cloud resources, and access requests. Loaded ${formatOperationalTime(loadedAt)}. Missing telemetry stays Unknown.`
    : 'Source is still loading.';

  return (
    <section className="service-360">
      <div className="service-360__tabs" role="tablist" aria-label="Service 360">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-selected' : ''} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <p className="access-hint">{source} This service environment is {environment || 'Unknown'}.</p>
      {error ? (
        <div className="alert alert-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReload((current) => current + 1)}>Retry</button>
        </div>
      ) : null}
      {loading ? <p className="work-empty">Loading service context…</p> : null}
      {tab === 'overview' ? (
        <>
          <div className="service-360__facts">
            <div className="service-360__fact">
              <span>Service owner team</span>
              <strong>{loading ? 'Unknown' : ownerLabel}</strong>
            </div>
            <div className="service-360__fact">
              <span>Repository</span>
              <strong>{loading ? 'Unknown' : repoLabel}</strong>
            </div>
            <button type="button" onClick={() => setTab('resources')}>
              <span>Linked resources</span>
              <strong>{loading || error ? 'Unknown' : String(resources.length)}</strong>
            </button>
            <button type="button" onClick={() => setTab('incidents')}>
              <span>Active incidents</span>
              <strong>{loading || error ? 'Unknown' : String(activeIncidents.length)}</strong>
            </button>
            <button type="button" onClick={() => setTab('changes')}>
              <span>Latest change</span>
              <strong>{loading || error ? 'Unknown' : latestChange ? (latestChange.change_number || recordReference('CHG', latestChange.id)) : 'Unknown'}</strong>
              <small>{loading || error ? 'Unknown' : latestChange?.status ? latestChange.status.replaceAll('_', ' ') : 'Unknown'}</small>
            </button>
            <button type="button" onClick={() => setTab('access')}>
              <span>Access needing attention</span>
              <strong>{loading || error ? 'Unknown' : String(accessAttention.length)}</strong>
            </button>
            <div className="service-360__fact">
              <span>SLO</span>
              <strong>
                {loading || error
                  ? 'Unknown'
                  : !slo
                    ? 'Unknown'
                    : (slo.samples || 0) <= 0
                      ? 'Unknown'
                      : slo.burned
                        ? (slo.freeze_reason || 'Burning')
                        : 'Inside budget'}
              </strong>
              <small><Link href="/slos">Open SLO objects</Link></small>
            </div>
            <div className="service-360__fact">
              <span>One-hop consumers</span>
              <strong>{loading || error ? 'Unknown' : consumers.length ? String(consumers.length) : 'None recorded'}</strong>
              <small>Same team or repository. Not a proven call graph.</small>
            </div>
          </div>
          {!loading && consumers.length ? (
            <p className="access-hint">
              Nearby services:{' '}
              {consumers.map((item, index) => (
                <span key={item.id}>
                  {index > 0 ? ' · ' : ''}
                  {item.id ? <Link href={`/services/${item.id}`}>{item.service || 'Service'}</Link> : (item.service || 'Service')}
                  {item.environment ? ` (${item.environment})` : ''}
                </span>
              ))}
            </p>
          ) : null}
          {overview}
        </>
      ) : null}
      {tab === 'resources' && !loading ? (
        resources.length === 0 ? <p className="work-empty">No cloud resources matched this service. An empty list is not a healthy inventory.</p> : (
          <ul className="request-timeline">
            {resources.map((item) => (
              <li key={item.id}>
                <strong>{item.display_name || item.service_type || 'Resource'}</strong>
                <span>{mask(item.resource_id)} · {item.environment || 'Unknown'} · {item.status || 'Unknown'}</span>
                <small>Owner {item.owner_name || 'Unassigned'} · Purpose {item.purpose || 'Not recorded'} · Expiry {item.expires_at || 'Not recorded'} · {item.lifecycle_state || 'No retirement request'}</small>
                {item.updated_at ? <small>{formatOperationalTime(item.updated_at)}</small> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {tab === 'changes' && !loading ? (
        changes.length === 0 ? <p className="work-empty">No changes for this service.</p> : (
          <ul className="request-timeline">
            {changes.map((item) => (
              <li key={item.id}>
                <strong><Link href={`/changes/${item.id}`}>{item.change_number || recordReference('CHG', item.id)}</Link></strong>
                <span>{item.environment || 'Unknown'} · {(item.status || 'unknown').replaceAll('_', ' ')} · {mask(item.sha)}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {tab === 'incidents' && !loading ? (
        incidents.length === 0 ? <p className="work-empty">No incidents for this service.</p> : (
          <ul className="request-timeline">
            {incidents.map((item) => (
              <li key={item.id}>
                <strong><Link href={`/incidents/${item.id}/edit`}>{item.incident_number || recordReference('INC', item.id)}</Link></strong>
                <span>{item.summary || 'Incident'} · {item.environment || 'Unknown'} · {(item.status || 'unknown').replaceAll('_', ' ')}</span>
                <small>{item.suspected_change_number ? `Suspected change ${item.suspected_change_number}. This is not a confirmed cause.` : 'No suspected change is linked.'}</small>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {tab === 'access' && !loading ? (
        grants.length === 0 ? (
          <p className="work-empty">No access grants are linked to this service. Provider revocation is not shown here. <Link href="/iam">Open access</Link>.</p>
        ) : (
          <ul className="request-timeline">
            {grants.map((item, index) => (
              <li key={item.id || item.accessNumber || index}>
                <strong>{item.accessNumber || 'Access request'}</strong>
                <span>{item.evaluation?.roleId || 'Role unknown'} · {(item.status || 'unknown').replaceAll('_', ' ')}</span>
                <small>This is the request status. Provider revocation is recorded separately and is not confirmed here.</small>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {tab === 'environments' && !loading ? (
        serviceId ? (
          <ServiceEnvironmentMatrix apiUrl={apiUrl} token={token} serviceId={serviceId} />
        ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Environment</th>
                <th>Latest change status</th>
                <th>Approval readiness</th>
                <th>Deployed revision</th>
                <th>Image digest</th>
                <th>Service owner team</th>
                <th>Repository</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.environment}>
                  <td>{row.environment}</td>
                  <td>{row.latestChange}</td>
                  <td>{row.approval}</td>
                  <td>{row.revision}</td>
                  <td>{row.digest}</td>
                  <td>{row.owner}</td>
                  <td>{row.repo}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="access-hint">Latest change status is the change record. Approval readiness stays Unknown until an approval decision is stored. A value that starts with a manual reference is not a commit SHA. Configuration values are not compared here.</p>
        </div>
        )
      ) : null}
      {tab === 'activity' && !loading ? (
        serviceId ? (
          <ServiceActivityTimeline apiUrl={apiUrl} token={token} serviceId={serviceId} />
        ) : (
          <p className="work-empty">Activity needs a saved service record.</p>
        )
      ) : null}
    </section>
  );
}
