import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { MyWorkDesk, readWorkPageSize } from '../components/MyWorkPanel';
import { queryString, readWorkspaceScope, workKind, workspaceScopeBlock, writeWorkspaceScope, type WorkKind } from '@infragate/ui';

export default function MyWorkPage() {
  const router = useRouter();
  const seeded = useRef('');
  const kind = workKind(queryString(router.query, 'kind'));
  const service = queryString(router.query, 'service');
  const sourceId = queryString(router.query, 'source_id');
  const projectId = queryString(router.query, 'project_id');
  const environment = queryString(router.query, 'environment');
  const page = Math.max(1, Number(queryString(router.query, 'page')) || 1);
  const pageSize = readWorkPageSize(queryString(router.query, 'page_size'));

  useEffect(() => {
    if (!router.isReady) return;
    const key = `${projectId}\n${environment}`;
    if (seeded.current === key) return;
    seeded.current = key;
    if (workspaceScopeBlock(projectId, environment)) return;
    const current = readWorkspaceScope();
    if (current.projectId !== projectId || current.environment !== environment) {
      writeWorkspaceScope({ projectId, environment });
    }
    const query = { ...router.query };
    delete query.project_id;
    delete query.environment;
    void router.replace({ pathname: '/my-work', query }, undefined, { shallow: true });
  }, [environment, projectId, router]);

  function replace(next: Record<string, string>) {
    const query = { ...router.query, ...next };
    for (const [key, value] of Object.entries(query)) {
      if (value === '' || value === undefined) delete query[key];
    }
    void router.replace({ pathname: '/my-work', query }, undefined, { shallow: true });
  }

  return (
    <>
      <Head>
        <title>My work · SetuOps</title>
      </Head>
      <DevOpsLayout>
        <MyWorkDesk
          projectId={projectId}
          environment={environment}
          kind={kind}
          service={service}
          page={page}
          pageSize={pageSize}
          sourceId={sourceId}
          onKind={(next: WorkKind | '') => replace({ kind: next, page: '1' })}
          onService={(next) => replace({ service: next, page: '1' })}
          onPage={(next) => replace({ page: String(next) })}
          onPageSize={(next) => replace({ page_size: String(next), page: '1' })}
        />
      </DevOpsLayout>
    </>
  );
}
