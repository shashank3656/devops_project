import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Sign-up is disabled; redirect to login. Users are created by admins or via backend API.
export default function Signup() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login');
  }, [router]);
  return null;
}
