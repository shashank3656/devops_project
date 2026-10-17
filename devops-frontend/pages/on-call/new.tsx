import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function NewOnCallPage() {
  const router = useRouter();
  useEffect(() => {
    void router.replace('/on-call');
  }, [router]);
  return null;
}
