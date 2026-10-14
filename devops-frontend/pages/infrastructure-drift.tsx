import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import DriftDesk from '../components/DriftDesk';

export default function InfrastructureDriftPage() {
  return (
    <>
      <Head>
        <title>Infrastructure drift · SetuOps</title>
      </Head>
      <DevOpsLayout>
        <DriftDesk />
      </DevOpsLayout>
    </>
  );
}
