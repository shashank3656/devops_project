import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function AdminNotificationsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/requests');
  }, [router]);

  return null;
}
