import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import BootstrapDesk from '../components/BootstrapDesk';

export default function ServiceBootstrapPage() {
  return (
    <>
      <Head>
        <title>Service bootstrap · SetuOps</title>
      </Head>
      <DevOpsLayout>
        <BootstrapDesk />
      </DevOpsLayout>
    </>
  );
}
