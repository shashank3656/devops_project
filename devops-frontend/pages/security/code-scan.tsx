import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { deskCall } from '../../components/deskClient';
import { useApiUrl } from '../../context/ApiUrlContext';
import { reportResultLabel, textField } from '../../lib/securityDesk';
import { asRecord } from '../../lib/payload';
import { useWorkspaceScope } from '../../shared-ui/useWorkspaceScope';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProjectOption {
  id: number;
  name: string;
}

interface BranchFinding {
  rule_id: string;
  path: string;
  message: string;
}

export default function CodeScanPage() {
  const apiUrl = useApiUrl();
  const { scope } = useWorkspaceScope();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [repository, setRepository] = useState('');
  const [revision, setRevision] = useState('');
  const [cloud, setCloud] = useState('');
  const [environment, setEnvironment] = useState('');
  const [reportId, setReportId] = useState('');
  const [digest, setDigest] = useState('');
  const [branchLabel, setBranchLabel] = useState(reportResultLabel(0, 0));
  const [branchFindings, setBranchFindings] = useState<BranchFinding[]>([]);
  const [artifactLabel, setArtifactLabel] = useState('No deployed artifact is selected. Branch findings stay separate from deployed exposure.');
  const [error, setError] = useState('');
  const projectRef = useRef<HTMLSelectElement>(null);
  const repositoryRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    void deskCall(apiUrl, '/api/devops/projects', 'GET').then((result) => {
      if (result.status !== 200) {
        setError('Project scope could not be loaded.');
        return;
      }
      const body = asRecord(result.body);
      const rows = Array.isArray(body.projects) ? body.projects : Array.isArray(result.body) ? result.body : [];
      setProjects(rows.map((row) => {
        const item = asRecord(row);
        return { id: Number(item.id) || 0, name: textField(item, 'name') || 'Unknown' };
      }).filter((item) => item.id > 0));
    }).catch(() => setError('Project scope could not be loaded.'));
  }, [apiUrl]);

  useEffect(() => {
    if (!projectId && scope.projectId) setProjectId(scope.projectId);
  }, [projectId, scope.projectId]);

  const revisionReady = /^[0-9a-f]{40}$/.test(revision.trim().toLowerCase());
  const scopeReady = Boolean(projectId && repository.trim() && revisionReady);

  async function loadReport() {
    setError('');
    if (!scopeReady) {
      setBranchLabel('Project, an authorized repository, and an exact revision are required.');
      setBranchFindings([]);
      if (!projectId) projectRef.current?.focus();
      else if (!repository.trim()) repositoryRef.current?.focus();
      else revisionRef.current?.focus();
      return;
    }
    if (!reportId) {
      setBranchFindings([]);
      setBranchLabel(reportResultLabel(0, 0));
      return;
    }
    const result = await deskCall(apiUrl, `/api/security/reports?report_id=${encodeURIComponent(reportId)}`, 'GET');
    if (result.status !== 200) {
      setBranchFindings([]);
      setBranchLabel(reportResultLabel(result.status, 0));
      return;
    }
    const body = asRecord(result.body);
    const findings = Array.isArray(body.findings) ? body.findings.map((row) => {
      const item = asRecord(row);
      return { rule_id: textField(item, 'rule_id') || 'Unknown', path: textField(item, 'path') || 'Unknown', message: textField(item, 'message') || 'Unknown' };
    }) : [];
    setBranchFindings(findings);
    setBranchLabel(reportResultLabel(200, findings.length));
  }

  async function loadArtifact() {
    setError('');
    if (!digest.trim()) {
      setArtifactLabel('No deployed artifact is selected. Branch findings stay separate from deployed exposure.');
      return;
    }
    if (!projectId) {
      setArtifactLabel('Deployed artifact context needs a project. This is not a branch report.');
      return;
    }
    const result = await deskCall(apiUrl, `/api/artifacts/context?project_id=${encodeURIComponent(projectId)}&digest=${encodeURIComponent(digest.trim())}`, 'GET');
    if (result.status !== 200) {
      setArtifactLabel('Deployed artifact context failed. This is not an empty branch report.');
      return;
    }
    const body = asRecord(result.body);
    const exposure = textField(body, 'exposure') || 'unknown';
    const state = textField(body, 'state') || 'unknown';
    setArtifactLabel(`Deployed artifact ${state}. Exposure ${exposure}. This is separate from branch findings.`);
  }

  return (
    <DevOpsLayout>
      <Head><title>Code scan</title></Head>
      <div className="portal-page desk-landing">
        <header className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Security / code posture</span>
            <h1 className="portal-page__title">Scan a known revision.</h1>
            <p className="portal-page__subtitle">Project, repository, and exact revision are required. Missing coverage stays unknown.</p>
          </div>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <form className="portal-surface" onSubmit={(event) => { event.preventDefault(); void loadReport(); }}>
          <div className="portal-field-grid portal-field-grid--two">
            <label className="label">Project
              <select ref={projectRef} className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
                <option value="">Select one project</option>
                {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="label">Repository
              <input ref={repositoryRef} className="input" value={repository} onChange={(event) => setRepository(event.target.value)} required />
            </label>
            <label className="label">Exact revision
              <input ref={revisionRef} className="input" value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="40-character commit SHA" required />
            </label>
            <label className="label">Report id
              <input className="input" value={reportId} onChange={(event) => setReportId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            </label>
            <label className="label">Cloud, optional
              <input className="input" value={cloud} onChange={(event) => setCloud(event.target.value)} />
            </label>
            <label className="label">Environment, optional
              <input className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} />
            </label>
          </div>
          <div className="portal-page__actions">
            <button className="btn btn-primary" type="submit">Load branch report</button>
          </div>
        </form>
        <section className="portal-surface">
          <h2 className="portal-surface__title">Branch findings</h2>
          <p>{branchLabel}</p>
          <p className="portal-page__subtitle">Repository {repository || 'Unknown'} · Revision {revisionReady ? revision : 'Unknown'} · Cloud {cloud || 'Not selected'} · Environment {environment || 'Not selected'}</p>
          {branchFindings.length > 0 ? (
            <ul>
              {branchFindings.map((item) => <li key={`${item.rule_id}-${item.path}`}>{item.rule_id} · {item.path} · {item.message}</li>)}
            </ul>
          ) : null}
        </section>
        <section className="portal-surface">
          <h2 className="portal-surface__title">Deployed artifact</h2>
          <label className="label">Image digest, optional
            <input className="input" value={digest} onChange={(event) => setDigest(event.target.value)} />
          </label>
          <div className="portal-page__actions">
            <button className="btn btn-secondary" type="button" onClick={() => void loadArtifact()}>Load deployed context</button>
          </div>
          <p>{artifactLabel}</p>
        </section>
      </div>
    </DevOpsLayout>
  );
}
