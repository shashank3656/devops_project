import { useRouter } from 'next/router';
import OnCallScheduleForm from '../../components/OnCallScheduleForm';

export default function OnCallSchedulePage() {
  const router = useRouter();
  const raw = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const scheduleId = Number.parseInt(raw || '', 10);
  if (!router.isReady) return null;
  return <OnCallScheduleForm scheduleId={Number.isFinite(scheduleId) ? scheduleId : 0} />;
}
