import { useRouter } from 'next/router';
import { useEffect } from 'react';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function DevOpsIndex() {
  const router = useRouter();
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;
    if (token) router.replace('/dashboard');
    else router.replace('/login');
  }, [router]);
  return <p className="loading-text" style={{ padding: 24 }}>Redirecting…</p>;
}
