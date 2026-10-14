import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import AccessDesk from '../components/AccessDesk';

export default function TemporaryAccessPage() {
  return (
    <>
      <Head>
        <title>Temporary access · SetuOps</title>
      </Head>
      <DevOpsLayout>
        <AccessDesk />
      </DevOpsLayout>
    </>
  );
}
