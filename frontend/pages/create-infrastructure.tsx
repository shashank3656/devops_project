import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { PageHeader } from '@infragate/ui';

interface GoldenPath {
  id: string;
  title: string;
  summary: string;
  href: string;
  advanced?: boolean;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function NewRequestLanding() {
  const router = useRouter();
  const [paths, setPaths] = useState<GoldenPath[]>([]);
  const [estimates, setEstimates] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!localStorage.getItem('isAuthenticated')) {
      router.push('/login');
      return;
    }
    const token = localStorage.getItem('token');
    fetch(`${apiUrl}/api/golden-paths`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPaths(Array.isArray(data?.paths) ? data.paths : []))
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    paths.filter((path) => !path.advanced).forEach((path) => {
      const href = new URL(path.href, 'http://local');
      const cloud = href.searchParams.get('cloud') || '';
      const service = href.searchParams.get('service') || '';
      if (!cloud || !service) return;
      fetch(`${apiUrl}/api/cost-guardrail?cloud=${encodeURIComponent(cloud)}&service=${encodeURIComponent(service)}&env=dev`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (typeof data?.estimated_monthly === 'number') {
            setEstimates((current) => ({ ...current, [path.id]: data.estimated_monthly }));
          }
        })
        .catch(() => {});
    });
  }, [paths]);

  return (
    <>
      <Head>
        <title>New Request - SetuOps</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="New request"
          title="What do you need?"
          subtitle="Start from an outcome. Cloud pickers and JSON remain available as advanced paths."
        />
        <div className="ig-catalog">
          {paths.map((path) => (
            <Link key={path.id} href={path.href}>
              <span className="ig-eyebrow">{path.advanced ? 'Advanced' : 'Golden path'}</span>
              <h2>{path.title}</h2>
              <p className="ig-muted">{path.summary}</p>
              {estimates[path.id] ? <p className="ig-muted">From ${estimates[path.id]}/mo</p> : null}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
