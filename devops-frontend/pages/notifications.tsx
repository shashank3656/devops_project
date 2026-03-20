import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function DevOpsNotificationsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/tickets');
  }, [router]);

  return null;
}
