import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface KnowledgeArticle {
  id: number;
  article_number: string;
  title: string;
  body: string;
  problem_id?: number;
  problem_number?: string;
}

export default function KnowledgeDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [item, setItem] = useState<KnowledgeArticle | null>(null);
  const [error, setError] = useState('');
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;

  useEffect(() => {
    if (!id) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/knowledge/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load article');
          return;
        }
        setItem(data.article || null);
      })
      .catch(() => setError('Failed to load article'));
  }, [apiUrl, id]);

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.article_number || 'Knowledge'} - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Knowledge</span>
            <h1 className="portal-page__title">{item?.article_number || 'Article'}</h1>
            <p className="portal-page__subtitle">{item?.title || 'Known-error article'}</p>
          </div>
          <div className="portal-page__actions">
            {item?.problem_id ? <Link href={`/problems/${item.problem_id}`} className="btn btn-secondary">Open problem</Link> : null}
            <Link href="/knowledge" className="btn btn-secondary">Back to knowledge</Link>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {item ? (
          <section className="portal-surface">
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{item.body}</pre>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
