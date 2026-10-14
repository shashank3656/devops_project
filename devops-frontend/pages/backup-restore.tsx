import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import BackupDesk from '../components/BackupDesk';

export default function BackupRestorePage() {
  return (
    <>
      <Head>
        <title>Backup and restore · SetuOps</title>
      </Head>
      <DevOpsLayout>
        <BackupDesk />
      </DevOpsLayout>
    </>
  );
}
