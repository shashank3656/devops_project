import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AccessNav from '../../../components/AccessNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { ACCESS_SECTIONS, grantsForTeam, pagesFor, sameGrants, type SectionGrants, type SectionKey } from '../../../lib/accessSections';
import { sessionAuthHeaders } from '../../../lib/portalAccess';
import { GroupRoleFields, groupRoleHint } from '../../../lib/groupRoles';

type Team = {
  id: number;
  name: string;
  team_type?: string;
  grants?: Partial<SectionGrants>;
  grants_saved?: boolean;
};

type Person = { id: number; username: string };
type Member = { user_id: number; username: string; role: string };
type K8sLevel = 'none' | 'read' | 'write';
type K8sLink = { project_id: number; name: string; k8s_access: K8sLevel };
type K8sProject = { id: number; name: string };
type CostLevel = 'view' | 'operate';
type CostLink = { project_id: number; name: string; cost_access: CostLevel };

function asCostLevel(value: unknown): CostLevel {
  return value === 'view' ? 'view' : 'operate';
}

function costLinkKey(links: CostLink[]): string {
  return links.map((link) => `${link.project_id}:${link.cost_access}`).sort().join('|');
}

function asK8sLevel(value: unknown): K8sLevel {
  return value === 'none' || value === 'write' || value === 'read' ? value : 'read';
}

function linkKey(links: K8sLink[]): string {
  return links.map((link) => `${link.project_id}:${link.k8s_access}`).sort().join('|');
}

export default function GroupAccessPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const teamId = Number(router.query.id);
  const [team, setTeam] = useState<Team | null>(null);
  const [draft, setDraft] = useState<SectionGrants>(grantsForTeam({}));
  const [saved, setSaved] = useState<SectionGrants>(grantsForTeam({}));
  const [custom, setCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState('');
  const [memberRole, setMemberRole] = useState('developer');
  const [defaultEnv, setDefaultEnv] = useState('');
  const [defaultCloud, setDefaultCloud] = useState('');
  const [savedEnv, setSavedEnv] = useState('');
  const [savedCloud, setSavedCloud] = useState('');
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [teamK8s, setTeamK8s] = useState<K8sLevel>('none');
  const [savedK8s, setSavedK8s] = useState<K8sLevel>('none');
  const [k8sLinks, setK8sLinks] = useState<K8sLink[]>([]);
  const [savedLinkKey, setSavedLinkKey] = useState('');
  const [k8sProjects, setK8sProjects] = useState<K8sProject[]>([]);
  const [addProjectId, setAddProjectId] = useState('');
  const [addProjectLevel, setAddProjectLevel] = useState<K8sLevel>('read');
  const [savingK8s, setSavingK8s] = useState(false);
  const [costLinks, setCostLinks] = useState<CostLink[]>([]);
  const [savedCostKey, setSavedCostKey] = useState('');
  const [costProjects, setCostProjects] = useState<K8sProject[]>([]);
  const [addCostProjectId, setAddCostProjectId] = useState('');
  const [addCostLevel, setAddCostLevel] = useState<CostLevel>('view');
  const [savingCost, setSavingCost] = useState(false);

  useEffect(() => {
    if (!router.isReady || !Number.isFinite(teamId) || teamId <= 0) return;
    let cancel = false;
    fetch(`${apiUrl}/api/admin/users`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return;
        if (cancel) return;
        const rows = Array.isArray(body?.users) ? body.users : [];
        setPeople(rows.map((account: Person) => ({
          id: Number(account.id) || 0,
          username: typeof account.username === 'string' && account.username ? account.username : 'Person',
        })));
      })
      .catch(() => undefined);
    fetch(`${apiUrl}/api/admin/teams/${teamId}`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancel) return;
        const detail = body?.team && typeof body.team === 'object' ? body.team as { default_env?: string; default_cloud?: string; team_type?: string } : null;
        if (detail) {
          const env = typeof detail.default_env === 'string' ? detail.default_env : '';
          const cloud = typeof detail.default_cloud === 'string' ? detail.default_cloud : '';
          setDefaultEnv(env);
          setDefaultCloud(cloud);
          setSavedEnv(env);
          setSavedCloud(cloud);
          setMemberRole(detail.team_type === 'devops' ? 'member' : 'developer');
        }
        const rows = Array.isArray(body?.members) ? body.members : [];
        setMembers(rows.map((member: { user_id: number; username: string; role: string }) => ({
          user_id: Number(member.user_id) || 0,
          username: typeof member.username === 'string' && member.username ? member.username : 'Person',
          role: typeof member.role === 'string' ? member.role : '',
        })));
      })
      .catch(() => undefined);
    fetch(`${apiUrl}/api/admin/teams/${teamId}/k8s-access`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancel) return;
        const level = body?.k8s_access === 'write' || body?.k8s_access === 'none' ? body.k8s_access : 'read';
        setTeamK8s(level);
        setSavedK8s(level);
        const links = Array.isArray(body?.links) ? body.links : [];
        const mapped = links.map((link: { project_id: number; name: string; k8s_access: string }) => ({
          project_id: Number(link.project_id) || 0,
          name: typeof link.name === 'string' && link.name ? link.name : 'Project',
          k8s_access: asK8sLevel(link.k8s_access),
        }));
        setK8sLinks(mapped);
        setSavedLinkKey(linkKey(mapped));
        const projects = Array.isArray(body?.projects) ? body.projects : [];
        setK8sProjects(projects.map((project: { id: number; name: string }) => ({
          id: Number(project.id) || 0,
          name: typeof project.name === 'string' && project.name ? project.name : 'Project',
        })));
      })
      .catch(() => undefined);
    fetch(`${apiUrl}/api/admin/teams/${teamId}/cost-access`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancel) return;
        const links = Array.isArray(body?.links) ? body.links : [];
        const mapped = links.map((link: { project_id: number; name: string; cost_access: string }) => ({
          project_id: Number(link.project_id) || 0,
          name: typeof link.name === 'string' && link.name ? link.name : 'Project',
          cost_access: asCostLevel(link.cost_access),
        }));
        setCostLinks(mapped);
        setSavedCostKey(costLinkKey(mapped));
        const projects = Array.isArray(body?.projects) ? body.projects : [];
        setCostProjects(projects.map((project: { id: number; name: string }) => ({
          id: Number(project.id) || 0,
          name: typeof project.name === 'string' && project.name ? project.name : 'Project',
        })));
      })
      .catch(() => undefined);
    fetch(`${apiUrl}/api/admin/teams`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'This group could not be loaded.');
        return body;
      })
      .then((body) => {
        if (cancel) return;
        const list = Array.isArray(body?.teams) ? body.teams as Team[] : [];
        const found = list.find((item) => item.id === teamId) || null;
        if (!found) {
          setError('This group was not found.');
          return;
        }
        const grants = grantsForTeam(found);
        setTeam(found);
        setDraft(grants);
        setSaved(grants);
        setCustom(Boolean(found.grants_saved));
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl, router.isReady, teamId]);

  async function addPerson() {
    if (!team || !personId) return;
    setAdding(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({
          user_id: Number(personId),
          role: memberRole,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'That person was not added.');
        return;
      }
      const person = people.find((item) => String(item.id) === personId);
      setMembers((current) => [...current, {
        user_id: Number(personId),
        username: person?.username || 'Person',
        role: memberRole,
      }]);
      setPersonId('');
      setNotice('Person added to this group.');
    } catch {
      setError('That person could not be added.');
    } finally {
      setAdding(false);
    }
  }

  async function removePerson(userId: number) {
    if (!team) return;
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/members/${userId}`, {
        method: 'DELETE',
        headers: sessionAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'That person was not removed.');
        return;
      }
      setMembers((current) => current.filter((member) => member.user_id !== userId));
    } catch {
      setError('That person could not be removed.');
    }
  }

  async function changeRole(userId: number, role: string) {
    if (!team) return;
    setError('');
    const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
      body: JSON.stringify({ role }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(typeof body?.error === 'string' ? body.error : 'The role was not changed.');
      return;
    }
    setMembers((current) => current.map((member) => (member.user_id === userId ? { ...member, role } : member)));
  }

  async function saveDefaults() {
    if (!team) return;
    setSavingDefaults(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({ default_env: defaultEnv, default_cloud: defaultCloud }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Defaults were not saved.');
        return;
      }
      setNotice('Request defaults saved.');
      setSavedEnv(defaultEnv);
      setSavedCloud(defaultCloud);
    } catch {
      setError('Defaults could not be saved.');
    } finally {
      setSavingDefaults(false);
    }
  }

  function queueProject() {
    const projectId = Number(addProjectId);
    const project = k8sProjects.find((item) => item.id === projectId);
    if (!project || k8sLinks.some((link) => link.project_id === project.id)) return;
    setK8sLinks((current) => [...current, { project_id: project.id, name: project.name, k8s_access: addProjectLevel }]);
    setAddProjectId('');
    setAddProjectLevel('read');
  }

  function queueCostProject() {
    const projectId = Number(addCostProjectId);
    const project = costProjects.find((item) => item.id === projectId) || k8sProjects.find((item) => item.id === projectId);
    if (!project || costLinks.some((link) => link.project_id === project.id)) return;
    setCostLinks((current) => [...current, { project_id: project.id, name: project.name, cost_access: addCostLevel }]);
    setAddCostProjectId('');
    setAddCostLevel('view');
  }

  async function saveCostAccess() {
    if (!team) return;
    setSavingCost(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/cost-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({
          projects: costLinks.map((link) => ({ project_id: link.project_id, cost_access: link.cost_access })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Cost access was not saved.');
        return;
      }
      const links = Array.isArray(body?.links) ? body.links : [];
      const mapped = links.map((link: { project_id: number; name: string; cost_access: string }) => ({
        project_id: Number(link.project_id) || 0,
        name: typeof link.name === 'string' && link.name ? link.name : 'Project',
        cost_access: asCostLevel(link.cost_access),
      }));
      setCostLinks(mapped);
      setSavedCostKey(costLinkKey(mapped));
      setNotice('Cost access saved.');
    } catch {
      setError('Cost access was not saved.');
    } finally {
      setSavingCost(false);
    }
  }

  async function saveKubernetes() {
    if (!team) return;
    setSavingK8s(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/k8s-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({
          k8s_access: teamK8s,
          projects: k8sLinks.map((link) => ({ project_id: link.project_id, k8s_access: link.k8s_access })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Kubernetes access was not saved.');
        return;
      }
      setTeamK8s(body?.k8s_access === 'write' || body?.k8s_access === 'none' ? body.k8s_access : 'read');
      setSavedK8s(body?.k8s_access === 'write' || body?.k8s_access === 'none' ? body.k8s_access : 'read');
      const links = Array.isArray(body?.links) ? body.links : [];
      const mapped = links.map((link: { project_id: number; name: string; k8s_access: string }) => ({
        project_id: Number(link.project_id) || 0,
        name: typeof link.name === 'string' && link.name ? link.name : 'Project',
        k8s_access: asK8sLevel(link.k8s_access),
      }));
      setK8sLinks(mapped);
      setSavedLinkKey(linkKey(mapped));
      setNotice('Kubernetes access saved.');
    } catch {
      setError('Kubernetes access could not be saved.');
    } finally {
      setSavingK8s(false);
    }
  }

  async function removeGroup() {
    if (!team || !window.confirm(`Delete ${team.name}? People stay, but they leave this group.`)) return;
    setDeleting(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}`, {
        method: 'DELETE',
        headers: sessionAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'The group was not deleted.');
        return;
      }
      await router.push('/portal-access/teams');
    } catch {
      setError('The group could not be deleted.');
    } finally {
      setDeleting(false);
    }
  }

  function toggle(key: SectionKey) {
    setDraft((current) => {
      const on = !current[key];
      const pages = { ...(current.pages || {}) };
      for (const page of pagesFor(key)) pages[page.key] = on;
      return { ...current, [key]: on, pages };
    });
  }

  function togglePage(section: SectionKey, pageKey: string) {
    setDraft((current) => {
      const pages = { ...(current.pages || {}), [pageKey]: !current.pages?.[pageKey] };
      const on = pagesFor(section).some((page) => pages[page.key]);
      return { ...current, [section]: on, pages };
    });
  }

  function setSectionPages(key: SectionKey, on: boolean) {
    setDraft((current) => {
      const pages = { ...(current.pages || {}) };
      for (const page of pagesFor(key)) pages[page.key] = on;
      return { ...current, [key]: on, pages };
    });
  }

  async function save() {
    if (!team) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/grants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Sections were not saved.');
        return;
      }
      setSaved(draft);
      setCustom(true);
      setNotice('Sections saved. Members see them the next time they open the portal.');
    } catch {
      setError('Sections could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const available = people.filter((person) => !members.some((member) => member.user_id === person.id));
  const dirty = !sameGrants(draft, saved) || !custom;
  const defaultsDirty = defaultEnv !== savedEnv || defaultCloud !== savedCloud;
  const k8sDirty = teamK8s !== savedK8s || linkKey(k8sLinks) !== savedLinkKey;
  const costDirty = costLinkKey(costLinks) !== savedCostKey;

  return (
    <>
      <Head>
        <title>{team ? `${team.name} - OpsTrellis` : 'Group - OpsTrellis'}</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Portal Access</p>
              <h1>{typeof team?.name === 'string' && team.name ? team.name : 'Group'}</h1>
              <p>{team ? (team.team_type === 'devops' ? 'DevOps group' : 'Requester group') : 'Choose the sections this group can open.'}</p>
            </div>
            <div className="access-create__end">
              <Link href="/portal-access/teams" className="btn btn-secondary">Back to groups</Link>
              {team ? <button type="button" className="btn btn-secondary" disabled={deleting} onClick={removeGroup}>{deleting ? 'Deleting…' : 'Delete group'}</button> : null}
            </div>
          </header>
          <AccessNav />
          {router.query.people === '0' ? <div className="alert alert-error" role="alert">The group was created, but the people were not added. Add them below.</div> : null}
          {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          {loading ? <p className="work-empty">Loading group…</p> : null}
          {!loading && team ? (
            <div className="group-board">
              <section className="portal-surface group-card group-card--wide" aria-label="Effective access">
                <h2 className="access-form__title">What members can open</h2>
                <p className="access-hint">
                  {ACCESS_SECTIONS.filter((section) => draft[section.key]).map((section) => section.label).join(' · ') || 'No sections are on.'}
                  {dirty ? ' Section changes are not saved yet.' : ' Saved sections are what members see.'}
                </p>
                <p className="access-hint">Kubernetes group level is {teamK8s}. {k8sLinks.length ? `${k8sLinks.length} project links.` : 'No project links yet.'}</p>
              </section>
              <section className="portal-surface group-card">
                <h2 className="access-form__title">People</h2>
                <p className="access-hint">{groupRoleHint(team.team_type || '')} Adding, removing, and role changes save immediately.</p>
                {members.length === 0 ? <p className="work-empty">No one is in this group yet.</p> : (
                  <ul className="access-members">
                    {members.map((member) => (
                      <li key={member.user_id}>
                        <span className="access-members__name">{member.username}</span>
                        <GroupRoleFields
                          kind={team.team_type || ''}
                          role={member.role}
                          onChange={(role) => changeRole(member.user_id, role)}
                          idPrefix={`member-${member.user_id}`}
                          compact
                        />
                        <button type="button" className="btn btn-secondary" onClick={() => removePerson(member.user_id)}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="group-add">
                  <label className="label" htmlFor="add-person">Person
                    <select id="add-person" className="input" value={personId} onChange={(event) => setPersonId(event.target.value)}>
                      <option value="">{available.length ? 'Choose a person' : 'Everyone is already in this group'}</option>
                      {available.map((person) => (
                        <option key={person.id} value={person.id}>{person.username}</option>
                      ))}
                    </select>
                  </label>
                  <GroupRoleFields kind={team.team_type || ''} role={memberRole} onChange={setMemberRole} idPrefix="add" />
                  <button type="button" className="btn btn-primary" disabled={!personId || adding} onClick={addPerson}>
                    {adding ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </section>
              <section className="portal-surface group-card">
                <h2 className="access-form__title">Request defaults{defaultsDirty ? ' · Unsaved' : ''}</h2>
                <p className="access-hint">These prefill the next request someone in this group opens.</p>
                <div className="group-defaults">
                  <label className="label" htmlFor="group-env">Environment
                    <select id="group-env" className="input" value={defaultEnv} onChange={(event) => setDefaultEnv(event.target.value)}>
                      <option value="">None</option>
                      <option value="dev">dev</option>
                      <option value="uat">uat</option>
                      <option value="prod">prod</option>
                      {defaultEnv && !['dev', 'uat', 'prod'].includes(defaultEnv) ? <option value={defaultEnv}>{defaultEnv}</option> : null}
                    </select>
                  </label>
                  <label className="label" htmlFor="group-cloud">Cloud
                    <select id="group-cloud" className="input" value={defaultCloud} onChange={(event) => setDefaultCloud(event.target.value)}>
                      <option value="">None</option>
                      <option value="aws">AWS</option>
                      <option value="gcp">GCP</option>
                      <option value="azure">Azure</option>
                    </select>
                  </label>
                </div>
                <button type="button" className="btn btn-primary" disabled={!defaultsDirty || savingDefaults} onClick={saveDefaults}>
                  {savingDefaults ? 'Saving…' : 'Save defaults'}
                </button>
              </section>
              <section className="portal-surface group-card group-card--wide">
                <div className="group-card__head">
                  <div>
                    <h2 className="access-form__title">Kubernetes{k8sDirty ? ' · Unsaved' : ''}</h2>
                    <p className="access-hint">
                      The group level and each project level both apply. A person gets the lower of the two, and the higher result across groups they belong to. Read opens clusters, workloads, pods, and logs. Write adds restart, scale, resume, terminal, and cluster onboard. None keeps the project link and hides its clusters. The Kubernetes page under Sections still has to be on. Adding a project also links this group for on-call and other project access.
                    </p>
                  </div>
                  <button type="button" className="btn btn-primary" disabled={!k8sDirty || savingK8s} onClick={saveKubernetes}>
                    {savingK8s ? 'Saving…' : 'Save Kubernetes'}
                  </button>
                </div>
                <label className="label" htmlFor="group-k8s">Group access
                  <select id="group-k8s" className="input" value={teamK8s} onChange={(event) => setTeamK8s(asK8sLevel(event.target.value))}>
                    <option value="none">None</option>
                    <option value="read">Read</option>
                    <option value="write">Write</option>
                  </select>
                </label>
                {k8sLinks.length ? (
                  <ul className="access-menu" aria-label="Project Kubernetes access">
                    {k8sLinks.map((link) => (
                      <li key={link.project_id}>
                        <label className="label" htmlFor={`k8s-project-${link.project_id}`}>{link.name}
                          <select
                            id={`k8s-project-${link.project_id}`}
                            className="input"
                            value={link.k8s_access}
                            onChange={(event) => {
                              const next = asK8sLevel(event.target.value);
                              setK8sLinks((current) => current.map((item) => (
                                item.project_id === link.project_id ? { ...item, k8s_access: next } : item
                              )));
                            }}
                          >
                            <option value="none">None</option>
                            <option value="read">Read</option>
                            <option value="write">Write</option>
                          </select>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="access-hint">This group is not linked to a project yet.</p>
                )}
                <div className="group-add">
                  <label className="label" htmlFor="add-k8s-project">Project
                    <select id="add-k8s-project" className="input" value={addProjectId} onChange={(event) => setAddProjectId(event.target.value)}>
                      <option value="">Choose a project</option>
                      {k8sProjects.filter((project) => !k8sLinks.some((link) => link.project_id === project.id)).map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="label" htmlFor="add-k8s-level">Access
                    <select id="add-k8s-level" className="input" value={addProjectLevel} onChange={(event) => setAddProjectLevel(event.target.value === 'write' ? 'write' : 'read')}>
                      <option value="read">Read</option>
                      <option value="write">Write</option>
                    </select>
                  </label>
                  <button type="button" className="btn btn-secondary" disabled={!addProjectId} onClick={queueProject}>
                    Add project
                  </button>
                </div>
              </section>
              <section className="portal-surface group-card group-card--wide">
                <div className="group-card__head">
                  <div>
                    <h2 className="access-form__title">Cost{costDirty ? ' · Unsaved' : ''}</h2>
                    <p className="access-hint">
                      View can see project spend and graphs. Operate can enable Cost, import billed lines, and accept or dismiss suggestions. The Cost section still has to be on. This never sends account numbers, passwords, or role names to Copilot.
                    </p>
                  </div>
                  <button type="button" className="btn btn-primary" disabled={!costDirty || savingCost} onClick={() => void saveCostAccess()}>
                    {savingCost ? 'Saving…' : 'Save Cost'}
                  </button>
                </div>
                {costLinks.length ? (
                  <ul className="access-menu" aria-label="Project Cost access">
                    {costLinks.map((link) => (
                      <li key={link.project_id}>
                        <label className="label" htmlFor={`cost-project-${link.project_id}`}>{link.name}
                          <select
                            id={`cost-project-${link.project_id}`}
                            className="input"
                            value={link.cost_access}
                            onChange={(event) => {
                              const next = asCostLevel(event.target.value);
                              setCostLinks((current) => current.map((item) => (
                                item.project_id === link.project_id ? { ...item, cost_access: next } : item
                              )));
                            }}
                          >
                            <option value="view">View</option>
                            <option value="operate">Operate</option>
                          </select>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="access-hint">This group is not linked to a project yet.</p>
                )}
                <div className="group-add">
                  <label className="label" htmlFor="add-cost-project">Project
                    <select id="add-cost-project" className="input" value={addCostProjectId} onChange={(event) => setAddCostProjectId(event.target.value)}>
                      <option value="">Choose a project</option>
                      {(costProjects.length ? costProjects : k8sProjects).map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="label" htmlFor="add-cost-level">Access
                    <select id="add-cost-level" className="input" value={addCostLevel} onChange={(event) => setAddCostLevel(asCostLevel(event.target.value))}>
                      <option value="view">View</option>
                      <option value="operate">Operate</option>
                    </select>
                  </label>
                  <button type="button" className="btn btn-secondary" disabled={!addCostProjectId} onClick={queueCostProject}>
                    Add project
                  </button>
                </div>
              </section>
              <section className="portal-surface group-card group-card--wide">
                <div className="group-card__head">
                  <div>
                    <h2 className="access-form__title">Sections{dirty ? ' · Unsaved' : ''}</h2>
                    <p className="access-hint">Each row is one sidebar group. Turn the group on, then choose the pages this group can open.</p>
                  </div>
                  <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
                    {saving ? 'Saving…' : 'Save sections'}
                  </button>
                </div>
                <ul className="grant-board" aria-label="Sections">
                  {ACCESS_SECTIONS.map((section) => {
                    const pages = pagesFor(section.key);
                    const openCount = pages.filter((page) => draft.pages?.[page.key]).length;
                    const on = Boolean(draft[section.key]);
                    return (
                      <li key={section.key} className={on ? 'grant-section is-on' : 'grant-section'}>
                        <div className="grant-section__head">
                          <label className="grant-section__toggle">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggle(section.key)}
                            />
                            <span>
                              <strong>{section.label}</strong>
                              <small>{on ? `${openCount} of ${pages.length} pages` : 'Off'}</small>
                            </span>
                          </label>
                          {on ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setSectionPages(section.key, openCount < pages.length)}
                            >
                              {openCount === pages.length ? 'Clear pages' : 'All pages'}
                            </button>
                          ) : null}
                        </div>
                        {on ? (
                          <ul className="grant-section__pages" aria-label={`${section.label} pages`}>
                            {pages.map((page) => (
                              <li key={page.key}>
                                <label className={draft.pages?.[page.key] ? 'grant-section__page is-on' : 'grant-section__page'}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(draft.pages?.[page.key])}
                                    onChange={() => togglePage(section.key, page.key)}
                                  />
                                  {page.label}
                                </label>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
