import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Stepper, type GoldenPath } from '@infragate/ui';

interface SavedConfig {
  id: number;
  name: string;
  cloud: string;
  env: string;
  service: string;
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const STEPS = [
  { id: 'choose', label: 'Choose' },
  { id: 'configure', label: 'Configure' },
  { id: 'review', label: 'Review' },
];

const ICON_PATHS: Record<string, ReactNode> = {
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  cache: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />,
  kubernetes: (
    <>
      <path d="m12 3 7.5 4.3v8.4L12 20l-7.5-4.3V7.3L12 3Z" />
      <circle cx="12" cy="11.5" r="2.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5Z" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="14" r="4" />
      <path d="m11 11 8.5-8.5M16 6l2.5 2.5M14 8l2 2" />
    </>
  ),
  code: <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />,
};

function PathIcon({ name }: { name?: string }) {
  return (
    <span className="ig-path-card__icon" aria-hidden>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {ICON_PATHS[name || ''] || ICON_PATHS.code}
      </svg>
    </span>
  );
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  return token && token !== 'undefined' ? { Authorization: `Bearer ${token}` } : {};
}

export default function NewRequestLanding() {
  const router = useRouter();
  const [paths, setPaths] = useState<GoldenPath[] | null>(null);
  const [fromPrices, setFromPrices] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<SavedConfig[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  useEffect(() => {
    if (!localStorage.getItem('isAuthenticated')) {
      router.push('/login');
      return;
    }
    const headers = authHeaders();
    fetch(`${apiUrl}/api/golden-paths`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPaths(Array.isArray(data?.paths) ? data.paths : []))
      .catch(() => setPaths([]));
    fetch(`${apiUrl}/api/me/saved-configs`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSaved(Array.isArray(data?.saved_configs) ? data.saved_configs.slice(0, 4) : []))
      .catch(() => {});
    fetch(`${apiUrl}/api/me/projects`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProjects(Array.isArray(data?.projects) ? data.projects : []))
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    if (!paths) return;
    const headers = authHeaders();
    paths
      .filter((path) => !path.advanced && path.cloud && path.service)
      .forEach((path) => {
        const params = new URLSearchParams({ cloud: path.cloud as string, service: path.service as string, env: 'dev' });
        fetch(`${apiUrl}/api/cost-guardrail?${params}`, { headers })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            const from = typeof data?.estimate_low === 'number' ? data.estimate_low : data?.estimated_monthly;
            if (typeof from === 'number' && from > 0) {
              setFromPrices((current) => ({ ...current, [path.id]: from }));
            }
          })
          .catch(() => {});
      });
  }, [paths]);

  const golden = (paths || []).filter((path) => !path.advanced);
  const advanced = (paths || []).filter((path) => path.advanced);

  return (
    <>
      <Head>
        <title>New Request - SetuOps</title>
      </Head>
      <div className="portal-page ig-choose">
        <header className="ig-choose__header">
          <Stepper steps={STEPS} current="choose" />
          <h1>What do you need?</h1>
          <p className="ig-muted">Start from an outcome. We pick safe defaults, show the cost, and route it to the right reviewers.</p>
        </header>

        <div className="ig-path-grid" aria-busy={paths === null}>
          {paths === null
            ? [0, 1, 2, 3].map((key) => (
                <div key={key} className="ig-path-card ig-path-card--skeleton">
                  <span className="ig-skeleton" style={{ width: 36, height: 36, borderRadius: 10 }} />
                  <span className="ig-skeleton ig-skeleton--line" style={{ width: '60%' }} />
                  <span className="ig-skeleton ig-skeleton--line" />
                </div>
              ))
            : golden.map((path) => (
                <Link key={path.id} href={path.href} className="ig-path-card">
                  <PathIcon name={path.icon} />
                  <span className="ig-path-card__title">{path.title}</span>
                  <span className="ig-path-card__summary">{path.summary}</span>
                  <span className="ig-path-card__meta">
                    {fromPrices[path.id] ? <span>from ${fromPrices[path.id]}/mo</span> : <span>Cost shown next</span>}
                    {path.review ? <span>{path.review}</span> : null}
                  </span>
                </Link>
              ))}
        </div>

        {paths !== null && golden.length === 0 ? (
          <div className="ig-home-panel ig-home-empty">
            <div>
              <strong>No request types available</strong>
              <p>Start from a project below, or use the advanced paths.</p>
            </div>
          </div>
        ) : null}

        <div className="ig-choose__more">
          {saved.length > 0 ? (
            <section className="ig-choose__panel">
              <h2>Continue a saved setup</h2>
              <ul className="ig-choose__list">
                {saved.map((config) => (
                  <li key={config.id}>
                    <Link
                      href={`/select-service?cloud=${encodeURIComponent(config.cloud)}&env=${encodeURIComponent(config.env)}&service=${encodeURIComponent(config.service)}&saved_id=${config.id}`}
                    >
                      <span>{config.name}</span>
                      <span className="ig-muted">
                        {config.cloud.toUpperCase()} · {config.service} · {config.env}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {projects.length > 0 ? (
            <section className="ig-choose__panel">
              <h2>Start from a project</h2>
              <ul className="ig-choose__list">
                {projects.slice(0, 5).map((project) => (
                  <li key={project.id}>
                    <Link href={`/select-service?project_id=${project.id}`}>
                      <span>{project.name}</span>
                      <span className="ig-muted">{project.code}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {projects.length > 5 ? (
                <Link href="/create-infrastructure/new" className="ig-choose__all">
                  All projects and saved setups
                </Link>
              ) : null}
            </section>
          ) : null}

          <section className="ig-choose__panel">
            <h2>Advanced</h2>
            <ul className="ig-choose__list">
              {advanced.map((path) => (
                <li key={path.id}>
                  <Link href={path.href}>
                    <span>{path.title}</span>
                    <span className="ig-muted">{path.summary}</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/select-service">
                  <span>Pick cloud and service manually</span>
                  <span className="ig-muted">Full form with every option.</span>
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
