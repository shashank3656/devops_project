import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import PilotDesk from '../components/PilotDesk';

export default function PilotAcceptancePage() {
  return (
    <>
      <Head>
        <title>Pilot and acceptance · SetuOps</title>
      </Head>
      <DevOpsLayout>
        <PilotDesk />
      </DevOpsLayout>
    </>
  );
}
