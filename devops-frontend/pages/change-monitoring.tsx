import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import ChangeDesk from '../components/ChangeDesk';

export default function ChangeMonitoringPage() {
  return (
    <>
      <Head>
        <title>Change monitoring · SetuOps</title>
      </Head>
      <DevOpsLayout>
        <ChangeDesk />
      </DevOpsLayout>
    </>
  );
}
