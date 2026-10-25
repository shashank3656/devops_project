import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/security/vulnerabilities', permanent: false },
});

export default function CodeScanRedirect() {
  return null;
}
