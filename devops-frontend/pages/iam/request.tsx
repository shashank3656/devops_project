import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function IamRequestRedirect() {
  const router = useRouter();
  useEffect(() => {
    void router.replace('/iam');
  }, [router]);
  return null;
}
