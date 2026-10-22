import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import ReportDesk from '../components/ReportDesk';

export default function ReportsAutomationPage() {
  return (
    <>
      <Head>
        <title>Reports and automation · OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <ReportDesk />
      </DevOpsLayout>
    </>
  );
}
