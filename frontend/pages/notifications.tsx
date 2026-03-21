import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function NotificationsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/history');
  }, [router]);

  return null;
}
