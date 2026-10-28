import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { JIRA_RELATIONSHIPS, jiraHealthLabel, jiraHealthTone, type JiraConnection, type JiraFieldOwnership, type JiraRemediationRule, type JiraSpace, type JiraSyncPolicy } from '../../../lib/jira';
import { buildPortalApiUrl, parsePortalNumericId, portalFetch } from '@infragate/ui';

const TOKEN_KEY = 'devops_token';
type Screen = 'overview' | 'mappings' | 'access' | 'sync' | 'activity';

type Check = { level: string; message: string };
type Site = { id: string; name: string; url: string };
type RemoteSpace = { id: string; key: string; name: string; style?: string };
type Mapping = { id: number; space_id: number; portal_project_id?: number; portal_project_name?: string; portal_service?: string; issue_type_id: string; issue_type_name: string; default_relationship: string };
type Grant = { team_id: number; team_name?: string; can_view: boolean; can_link: boolean; can_create: boolean; can_administer: boolean };
type Team = { id: number; name: string; slug: string };
type Project = { id: number; name: string };
type IssueType = { id: string; name: string };

export default function JiraConnectionPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = parsePortalNumericId(router.query.id);
  const screen = (['overview', 'mappings', 'access', 'sync', 'activity'] as Screen[]).includes(router.query.screen as Screen)
    ? (router.query.screen as Screen)
    : 'overview';
  const [conn, setConn] = useState<JiraConnection | null>(null);
  const [spaces, setSpaces] = useState<JiraSpace[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [discovered, setDiscovered] = useState<RemoteSpace[]>([]);
  const [selected, setSelected] = useState<Record<string, RemoteSpace>>({});
  const [query, setQuery] = useState('');
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [types, setTypes] = useState<IssueType[]>([]);
  const [spaceId, setSpaceId] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [mapProject, setMapProject] = useState(0);
  const [mapService, setMapService] = useState('');
  const [mapType, setMapType] = useState('');
  const [mapRelationship, setMapRelationship] = useState('related');
  const [policy, setPolicy] = useState<JiraSyncPolicy>({
    create_issues: true,
    link_issues: true,
    read_status: true,
    read_assignee: true,
    read_priority: true,
    publish_comments: true,
    apply_transitions: true,
    send_attachments: true,
  });
  const [ownership, setOwnership] = useState<JiraFieldOwnership[]>([]);
  const [grantTeam, setGrantTeam] = useState(0);
  const [setupStep, setSetupStep] = useState('');
  const [readyToEnable, setReadyToEnable] = useState(false);
  const [activity, setActivity] = useState<Array<{ operation_id: string; kind: string; state: string; issue_key?: string; last_error?: string; updated_at: string; retryable?: boolean }>>([]);
  const [webhook, setWebhook] = useState<{ renewal_status?: string; expiration?: string; last_error?: string } | null>(null);
  const [rules, setRules] = useState<JiraRemediationRule[]>([]);
  const [ruleSource, setRuleSource] = useState('security_finding');
  const [ruleType, setRuleType] = useState('');
  const [ruleMatch, setRuleMatch] = useState('');
  const [ruleAuto, setRuleAuto] = useState(false);
  const [ruleLimit, setRuleLimit] = useState(10);

  const token = () => localStorage.getItem(TOKEN_KEY) || '';

  const load = useCallback(() => {
    if (!id) return;
    const auth = token();
    if (!auth) {
      void router.replace('/login');
      return;
    }
    setLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}`), { token: auth })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Connection could not be loaded');
        setConn(body.connection);
        setSpaces(Array.isArray(body.spaces) ? body.spaces : []);
        setMappings(Array.isArray(body.mappings) ? body.mappings : []);
        setChecks(Array.isArray(body.checks) ? body.checks : []);
        setSetupStep(typeof body.setup_step === 'string' ? body.setup_step : '');
        setReadyToEnable(body.ready_to_enable === true);
        setWebhook(body.webhook && typeof body.webhook === 'object' ? body.webhook : null);
        if (body.sync_policy && typeof body.sync_policy === 'object') setPolicy(body.sync_policy);
        setOwnership(Array.isArray(body.ownership) ? body.ownership : []);
        if ((body.spaces || [])[0]?.id) setSpaceId((body.spaces[0] as JiraSpace).id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Connection could not be loaded'))
      .finally(() => setLoading(false));
  }, [apiUrl, id, router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (router.query.select_site === '1') setNotice('Authorization succeeded. Select the Jira site this connection should use.');
    if (router.query.select_spaces === '1') setNotice('Site saved. Search and select only the spaces this team should use.');
    if (typeof router.query.error === 'string') setError(router.query.error);
  }, [router.query.error, router.query.select_site, router.query.select_spaces]);

  async function authorize() {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}/authorize`), { method: 'POST', token: token() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Authorization could not start');
      return;
    }
    setNotice(body.explanation || 'Continue in Atlassian to grant access.');
    if (body.authorize_url) window.location.href = body.authorize_url;
  }

  async function loadSites() {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}/sites`), { token: token() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Sites could not be loaded');
      return;
    }
    const nextSites = Array.isArray(body.sites) ? body.sites as Site[] : [];
    setSites(nextSites);
    if (!conn?.cloud_id && nextSites.length === 1) {
      void selectSite(nextSites[0].id);
    }
  }

  async function selectSite(cloudId: string) {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}/select-site`), {
      method: 'POST', token: token(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cloud_id: cloudId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Site could not be saved');
      return;
    }
    setNotice('Site saved. Search and select only the spaces this team should use.');
    load();
    void discover();
  }

  async function discover() {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}/discover-spaces?q=${encodeURIComponent(query)}`), { token: token() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Spaces could not be searched');
      return;
    }
    setDiscovered(Array.isArray(body.spaces) ? body.spaces : []);
  }

  async function saveSpaces() {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}/spaces`), {
      method: 'POST', token: token(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spaces: Object.values(selected) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Spaces could not be saved');
      return;
    }
    setNotice('Selected spaces are connected. Entire-site import is not used. Set team access next.');
    if (Array.isArray(body.spaces) && body.spaces[0]?.id) setSpaceId(body.spaces[0].id);
    load();
    void router.replace(`/integrations/jira/${id}?screen=access`);
  }

  async function enable() {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}/enable`), { method: 'POST', token: token() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Connection could not be enabled');
      return;
    }
    setNotice('Connection enabled. Collection is limited to linked issues.');
    load();
  }

  async function pause() {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}/pause`), { method: 'POST', token: token() });
    const body = await res.json().catch(() => ({}));
    setNotice(body.note || 'Synchronization paused. Linked records and Jira issues were kept.');
    load();
  }

  async function disconnect() {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}`), { method: 'DELETE', token: token() });
    const body = await res.json().catch(() => ({}));
    setNotice(body.note || 'Synchronization stopped. Jira issues were not deleted.');
    load();
  }

  async function loadAccess() {
    const auth = token();
    const [teamRes, grantRes, projectRes] = await Promise.all([
      portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/teams'), { token: auth }),
      spaceId ? portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/spaces/${spaceId}/access`), { token: auth }) : Promise.resolve(null),
      portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/projects'), { token: auth }),
    ]);
    const teamBody = await teamRes.json().catch(() => ({}));
    setTeams(Array.isArray(teamBody.teams) ? teamBody.teams : []);
    if (grantRes) {
      const grantBody = await grantRes.json().catch(() => ({}));
      setGrants(Array.isArray(grantBody.access) ? grantBody.access : []);
    }
    const projectBody = await projectRes.json().catch(() => ({}));
    setProjects(Array.isArray(projectBody.projects) ? projectBody.projects : []);
  }

  async function loadTypes() {
    if (!spaceId) return;
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/spaces/${spaceId}/issue-types`), { token: token() });
    const body = await res.json().catch(() => ({}));
    setTypes(Array.isArray(body.issue_types) ? body.issue_types : []);
  }

  useEffect(() => {
    if (screen === 'access' || screen === 'mappings') void loadAccess();
    if (screen === 'mappings' || screen === 'sync') void loadTypes();
    if (screen === 'sync' && spaceId) {
      const auth = token();
      portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/spaces/${spaceId}/remediation-rules`), { token: auth })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          setRules(Array.isArray(body.rules) ? body.rules : []);
        })
        .catch(() => setRules([]));
    }
    if (screen === 'activity') {
      const auth = token();
      portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/activity'), { token: auth })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          setActivity(Array.isArray(body.operations) ? body.operations : []);
        })
        .catch(() => setActivity([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, spaceId]);

  useEffect(() => {
    if (!conn) return;
    if (router.query.select_site === '1' || setupStep === 'select_site') void loadSites();
    if (router.query.select_spaces === '1' || setupStep === 'select_spaces') void discover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id, conn?.cloud_id, setupStep, router.query.select_site, router.query.select_spaces]);

  async function saveGrants() {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/spaces/${spaceId}/access`), {
      method: 'PUT', token: token(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grants }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error || 'Access could not be saved');
    else {
      setNotice('Access saved. Owner Jira access is still not granted to every portal user. Map a portal project next.');
      load();
      if (setupStep === 'access') void router.replace(`/integrations/jira/${id}?screen=mappings`);
    }
  }

  async function addMapping() {
    const type = types.find((item) => item.id === mapType);
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/spaces/${spaceId}/mappings`), {
      method: 'POST', token: token(), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portal_project_id: mapProject, portal_service: mapService, issue_type_id: mapType, issue_type_name: type?.name || '', default_relationship: mapRelationship }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error || 'Mapping could not be saved');
    else {
      setNotice('Mapping saved. Review field ownership, then enable the connection.');
      load();
      void router.replace(`/integrations/jira/${id}?screen=sync`);
    }
  }

  async function removeMapping(mappingId: number) {
    const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/mappings/${mappingId}`), { method: 'DELETE', token: token() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error || 'Mapping could not be removed');
    else load();
  }

  if (!id) {
    return <DevOpsLayout><p className="work-empty">Unknown connection.</p></DevOpsLayout>;
  }

  return (
    <DevOpsLayout>
      <Head><title>{conn?.name || 'Jira connection'} - OpsTrellis</title></Head>
      <div className="work-page">
        <header className="work-page__head">
          <div>
            <p className="ops-kicker"><Link href="/integrations/jira">Jira</Link></p>
            <h1>{conn?.name || 'Jira connection'}</h1>
            <p>Owner {conn?.owner_username || 'Unknown'}. Authentication and sync are tracked separately.</p>
          </div>
          <div className="request-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-primary" onClick={() => void authorize()}>
              {conn?.auth_health === 'reauthorization_required' ? 'Reconnect' : 'Authorize with Jira'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!readyToEnable || conn?.enabled} onClick={() => void enable()}>Enable</button>
            <button type="button" className="btn btn-secondary" onClick={() => void pause()}>Pause</button>
            <button type="button" className="btn btn-secondary" onClick={() => void disconnect()}>Disconnect</button>
          </div>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {setupStep && setupStep !== 'ready' ? (
          <section className="portal-surface">
            <h2 className="portal-surface__title">Setup</h2>
            <p className="portal-surface__subtitle">
              {setupStep === 'authorize' ? 'Authorize this connection, then choose a site and only the permitted spaces.' : null}
              {setupStep === 'select_site' ? 'Choose the Jira site. Multiple sites can contain the same issue key, so the site ID is stored with every issue.' : null}
              {setupStep === 'select_spaces' ? 'Search and connect only approved spaces. The rest of the site is not imported.' : null}
              {setupStep === 'access' ? 'Choose which portal teams can view, link, create, or administer this space.' : null}
              {setupStep === 'mappings' ? 'Map an OpsTrellis project or service to a Jira issue type. Names do not have to match.' : null}
              {setupStep === 'sync' ? 'Choose what OpsTrellis may create or write, and review which system owns each field.' : null}
              {setupStep === 'validate' ? 'Review the checks below, then enable. Collection stays limited to linked issues.' : null}
              {setupStep === 'onboard_app' ? 'Store the Atlassian client ID and secret before authorizing a connection.' : null}
            </p>
            {setupStep === 'onboard_app' ? <Link href="/integrations/jira/onboard" className="btn btn-primary">Onboard Jira app</Link> : null}
            {setupStep === 'authorize' ? <button type="button" className="btn btn-primary" onClick={() => void authorize()}>{conn?.auth_health === 'reauthorization_required' ? 'Reconnect' : 'Authorize with Jira'}</button> : null}
            {setupStep === 'select_site' ? <button type="button" className="btn btn-primary" onClick={() => void loadSites()}>Load accessible sites</button> : null}
            {setupStep === 'select_spaces' ? <button type="button" className="btn btn-primary" onClick={() => void discover()}>Search spaces</button> : null}
            {setupStep === 'access' ? <Link href={`/integrations/jira/${id}?screen=access`} className="btn btn-primary">Set access</Link> : null}
            {setupStep === 'mappings' ? <Link href={`/integrations/jira/${id}?screen=mappings`} className="btn btn-primary">Configure mapping</Link> : null}
            {setupStep === 'sync' ? <Link href={`/integrations/jira/${id}?screen=sync`} className="btn btn-primary">Configure sync</Link> : null}
            {setupStep === 'validate' ? <button type="button" className="btn btn-primary" disabled={!readyToEnable} onClick={() => void enable()}>Enable connection</button> : null}
          </section>
        ) : null}
        {conn ? (
          <p>
            <span className={`jira-health jira-health--${jiraHealthTone(conn.auth_health)}`}>{jiraHealthLabel(conn.auth_health)}</span>
            {' '}
            <span className={`jira-health jira-health--${jiraHealthTone(conn.sync_health)}`}>{jiraHealthLabel(conn.sync_health)}</span>
          </p>
        ) : null}
        <div className="delivery-filters" role="tablist">
          {(['overview', 'mappings', 'access', 'sync', 'activity'] as Screen[]).map((item) => (
            <Link key={item} href={`/integrations/jira/${id}?screen=${item}`} className={`delivery-filter${screen === item ? ' is-selected' : ''}`}>
              {item === 'sync' ? 'Sync rules' : item[0].toUpperCase() + item.slice(1)}
            </Link>
          ))}
        </div>
        {loading ? <p className="work-empty">Loading connection…</p> : null}
        {screen === 'overview' && conn ? (
          <section className="portal-surface">
            <h2 className="portal-surface__title">Overview</h2>
            <p className="portal-surface__subtitle">Select a site, then only the spaces this team is allowed to use. The whole Jira site is never imported.</p>
            <dl className="sre-meta">
              <div className="sre-meta__item"><dt>Site</dt><dd>{conn.site_name || 'Not selected'}</dd></div>
              <div className="sre-meta__item"><dt>Cloud ID</dt><dd>{conn.cloud_id || 'Unknown'}</dd></div>
              <div className="sre-meta__item"><dt>Owner</dt><dd>{conn.owner_username || 'Unknown'}</dd></div>
              <div className="sre-meta__item"><dt>Requested scopes</dt><dd>{conn.scopes || 'read and write Jira work, webhook management, offline access'}</dd></div>
              <div className="sre-meta__item"><dt>Webhooks</dt><dd>{webhook?.renewal_status || 'Unknown'}{webhook?.expiration ? ` · expires ${new Date(webhook.expiration).toLocaleString()}` : ''}</dd></div>
            </dl>
            {!conn.cloud_id ? (
              <>
                <div className="portal-form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => void loadSites()}>Load accessible sites</button>
                </div>
                {sites.length ? (
                  <ul className="jira-link-list">
                    {sites.map((site) => (
                      <li key={site.id}>
                        <button type="button" className="btn btn-secondary" onClick={() => void selectSite(site.id)}>{site.name} · {site.url}</button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <>
                <label className="label">Search spaces
                  <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Platform" />
                </label>
                <button type="button" className="btn btn-secondary" onClick={() => void discover()}>Search</button>
                {discovered.length ? (
                  <ul className="jira-link-list">
                    {discovered.map((space) => (
                      <li key={space.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[space.id])}
                            onChange={(event) => {
                              setSelected((current) => {
                                const next = { ...current };
                                if (event.target.checked) next[space.id] = space;
                                else delete next[space.id];
                                return next;
                              });
                            }}
                          />
                          {' '}{space.name} ({space.key})
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="portal-form-actions">
                  <button type="button" className="btn btn-primary" disabled={!Object.keys(selected).length} onClick={() => void saveSpaces()}>Connect selected spaces</button>
                </div>
              </>
            )}
            <h3>Checks</h3>
            <ul>
              {checks.map((check) => <li key={check.message}>{check.message}</li>)}
            </ul>
            <p className="form-section__copy">Disconnect stops synchronization and keeps linked portal records. Jira issues are not deleted.</p>
          </section>
        ) : null}
        {screen === 'mappings' ? (
          <section className="portal-surface">
            <h2 className="portal-surface__title">Mappings</h2>
            <p className="portal-surface__subtitle">A Jira space does not need to share a name with an OpsTrellis project.</p>
            <label className="label">Space
              <select className="input" value={spaceId} onChange={(event) => setSpaceId(Number(event.target.value))}>
                {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
              </select>
            </label>
            <div className="portal-form-grid">
              <label className="label">Portal project
                <select className="input" value={mapProject} onChange={(event) => setMapProject(Number(event.target.value))}>
                  <option value={0}>None</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label className="label">Service
                <input className="input" value={mapService} onChange={(event) => setMapService(event.target.value)} />
              </label>
              <label className="label">Issue type
                <select className="input" value={mapType} onChange={(event) => setMapType(event.target.value)}>
                  <option value="">Select</option>
                  {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
              <label className="label">Default relationship
                <select className="input" value={mapRelationship} onChange={(event) => setMapRelationship(event.target.value)}>
                  {JIRA_RELATIONSHIPS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void addMapping()}>Add mapping</button>
            <ul className="jira-link-list">
              {mappings.map((mapping) => (
                <li key={mapping.id} className="jira-link-card">
                  <span>{mapping.portal_project_name || mapping.portal_service || 'Unscoped'} → {mapping.issue_type_name || mapping.issue_type_id}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void removeMapping(mapping.id)}>Remove</button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {screen === 'access' ? (
          <section className="portal-surface">
            <h2 className="portal-surface__title">Access</h2>
            <p className="portal-surface__subtitle">View, link, create, and administer are separate. Restricted Jira issues stay hidden from non-administrators.</p>
            <label className="label">Space
              <select className="input" value={spaceId} onChange={(event) => setSpaceId(Number(event.target.value))}>
                {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
              </select>
            </label>
            <label className="label">Add team
              <select className="input" value={grantTeam} onChange={(event) => {
                const teamId = Number(event.target.value);
                setGrantTeam(teamId);
                if (!teamId || grants.some((g) => g.team_id === teamId)) return;
                const team = teams.find((item) => item.id === teamId);
                setGrants((current) => [...current, { team_id: teamId, team_name: team?.name, can_view: true, can_link: false, can_create: false, can_administer: false }]);
              }}>
                <option value={0}>Select a team</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            {grants.map((grant) => (
              <div key={grant.team_id} className="jira-grant-row">
                <strong>{grant.team_name || `Team ${grant.team_id}`}</strong>
                {(['can_view', 'can_link', 'can_create', 'can_administer'] as const).map((key) => (
                  <label key={key}>
                    <input type="checkbox" checked={grant[key]} onChange={(event) => setGrants((current) => current.map((item) => item.team_id === grant.team_id ? { ...item, [key]: event.target.checked } : item))} />
                    {' '}{key.replace('can_', '')}
                  </label>
                ))}
              </div>
            ))}
            <div className="portal-form-actions">
              <button type="button" className="btn btn-primary" onClick={() => void saveGrants()}>Save access</button>
              {setupStep === 'access' ? <Link href={`/integrations/jira/${id}?screen=mappings`} className="btn btn-secondary">Continue with owner-only access</Link> : null}
            </div>
          </section>
        ) : null}
        {screen === 'sync' ? (
          <section className="portal-surface">
            <h2 className="portal-surface__title">Sync rules</h2>
            <p>OpsTrellis creates and links issues, then reads Jira title, status, assignee, and priority. Comments publish only after preview. Status changes use Jira transitions, not field writes.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Information</th>
                    <th>Owner</th>
                    <th>Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {(ownership.length ? ownership : [
                    { field: 'Title, status, assignee, priority', owner: 'Jira after creation', direction: 'Read from Jira' },
                    { field: 'Record relationship', owner: 'OpsTrellis', direction: 'Stored here' },
                    { field: 'Published comments', owner: 'Original system', direction: 'Publish once; do not mirror' },
                  ]).map((row) => (
                    <tr key={row.field}>
                      <td>{row.field}</td>
                      <td>{row.owner}</td>
                      <td>{row.direction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="jira-grant-row" style={{ display: 'grid', gap: 8, margin: '16px 0' }}>
              {([
                ['create_issues', 'Create issues'],
                ['link_issues', 'Link existing issues'],
                ['read_status', 'Read status'],
                ['read_assignee', 'Read assignee'],
                ['read_priority', 'Read priority'],
                ['publish_comments', 'Publish comments'],
                ['apply_transitions', 'Apply transitions'],
                ['send_attachments', 'Send attachments'],
              ] as const).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={Boolean(policy[key])}
                    onChange={(event) => setPolicy((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                  {' '}{label}
                </label>
              ))}
            </div>
            <div className="portal-form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/connections/${id}/sync-policy`), {
                    method: 'PUT', token: token(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(policy),
                  }).then(async (res) => {
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) setError(body.error || 'Sync rules could not be saved');
                    else {
                      setNotice(body.note || 'Sync rules saved.');
                      if (body.policy) setPolicy(body.policy);
                      load();
                      if (setupStep === 'sync') void router.replace(`/integrations/jira/${id}`);
                    }
                  });
                }}
              >
                Save sync rules
              </button>
            </div>
            <h3>Remediation automation</h3>
            <p className="form-section__copy">Auto-create runs only for acknowledged findings and approved cost reviews. Duplicates are skipped.</p>
            <label className="label">Space
              <select className="input" value={spaceId} onChange={(event) => setSpaceId(Number(event.target.value))}>
                {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
              </select>
            </label>
            <div className="portal-form-grid">
              <label className="label">Source
                <select className="input" value={ruleSource} onChange={(event) => setRuleSource(event.target.value)}>
                  <option value="security_finding">Security findings</option>
                  <option value="cost_recommendation">Cost recommendations</option>
                </select>
              </label>
              <label className="label">Issue type
                <select className="input" value={ruleType} onChange={(event) => setRuleType(event.target.value)}>
                  <option value="">Select</option>
                  {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
              <label className="label">Optional filter
                <input className="input" value={ruleMatch} onChange={(event) => setRuleMatch(event.target.value)} placeholder="package or calc id fragment" />
              </label>
              <label className="label">Daily limit
                <input className="input" type="number" min={1} max={50} value={ruleLimit} onChange={(event) => setRuleLimit(Number(event.target.value) || 10)} />
              </label>
            </div>
            <label>
              <input type="checkbox" checked={ruleAuto} onChange={(event) => setRuleAuto(event.target.checked)} />
              {' '}Create automatically for approved records
            </label>
            <div className="portal-form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const type = types.find((item) => item.id === ruleType);
                  void portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/spaces/${spaceId}/remediation-rules`), {
                    method: 'POST', token: token(), headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      source_type: ruleSource,
                      match_text: ruleMatch,
                      issue_type_id: ruleType,
                      issue_type_name: type?.name || '',
                      relationship: 'remediates',
                      enabled: true,
                      auto_create: ruleAuto,
                      daily_limit: ruleLimit,
                    }),
                  }).then(async (res) => {
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) setError(body.error || 'Rule could not be saved');
                    else {
                      setNotice('Remediation rule saved. Auto-create still skips duplicates and stays inside the daily limit.');
                      setRules((current) => body.rule ? [...current.filter((item) => item.id !== body.rule.id), body.rule] : current);
                    }
                  });
                }}
              >
                Save rule
              </button>
            </div>
            <ul className="jira-link-list">
              {rules.map((rule) => (
                <li key={rule.id} className="jira-link-card">
                  <span>
                    {rule.source_type.replace(/_/g, ' ')} → {rule.issue_type_name || rule.issue_type_id}
                    {rule.auto_create ? ' · auto' : ' · confirm each'}
                    {rule.match_text ? ` · filter ${rule.match_text}` : ''}
                    {` · ${rule.daily_limit}/day`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      void portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/remediation-rules/${rule.id}`), { method: 'DELETE', token: token() })
                        .then(() => setRules((current) => current.filter((item) => item.id !== rule.id)));
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {screen === 'activity' ? (
          <section className="portal-surface">
            <h2 className="portal-surface__title">Activity</h2>
            {activity.length === 0 ? <p className="form-section__copy">No operations yet.</p> : (
              <ul className="jira-link-list">
                {activity.map((op) => (
                  <li key={op.operation_id} className="jira-link-card">
                    <span>
                      {op.kind.replace(/_/g, ' ')} · {op.state}
                      {op.issue_key ? ` · ${op.issue_key}` : ''}
                      {op.last_error ? ` · ${op.last_error}` : ''}
                    </span>
                    {op.retryable ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          void portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/operations/${encodeURIComponent(op.operation_id)}/retry`), { method: 'POST', token: token() })
                            .then(() => {
                              setNotice('Retry queued.');
                              void portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/activity'), { token: token() })
                                .then(async (res) => {
                                  const next = await res.json().catch(() => ({}));
                                  setActivity(Array.isArray(next.operations) ? next.operations : []);
                                });
                            });
                        }}
                      >
                        Retry
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <p><Link href="/integrations/jira?tab=activity">Open the shared activity log</Link></p>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
