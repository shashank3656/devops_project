import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function OnCallSchedulePage() {
  const router = useRouter();
  useEffect(() => {
    if (!router.isReady) return;
    void router.replace('/on-call');
  }, [router, router.isReady]);
  return null;
}
