import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Sign-up disabled; redirect to login. Use /login for signing in.
export default function Auth() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login');
  }, [router]);
  return null;
}
