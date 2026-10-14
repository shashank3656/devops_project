import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import ReadinessDesk from '../components/ReadinessDesk';

export default function ReadinessSignalsPage() {
  return (
    <>
      <Head>
        <title>Readiness signals · SetuOps</title>
      </Head>
      <DevOpsLayout>
        <ReadinessDesk />
      </DevOpsLayout>
    </>
  );
}
