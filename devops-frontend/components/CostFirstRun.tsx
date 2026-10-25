import Link from 'next/link';

export default function CostFirstRun({ canOperate }: { canOperate?: boolean }) {
  return (
    <section className="cost-first-run" aria-label="Enable Cost">
      <h2>No Cost accounts in a project you can see</h2>
      <ol className="cost-first-run__steps">
        <li>
          <strong>Assign to a project</strong>
          <span>Put a cloud account in a project you can see. Demo inventory accounts stay out.</span>
          <Link href="/cloud-accounts">Cloud accounts</Link>
        </li>
        <li>
          <strong>Enable Cost</strong>
          <span>Cost visibility is project membership plus the Cost section.</span>
          {canOperate === false
            ? <span>Ask someone with Cost operate to enable.</span>
            : <Link href="/cost/configuration">Enable Cost</Link>}
        </li>
        <li>
          <strong>Import billed lines</strong>
          <span>Spend stays Unknown until a complete revision exists. Incomplete is never $0.</span>
          {canOperate === false
            ? <span>Ask someone with Cost operate to import.</span>
            : <Link href="/cost/configuration">Import</Link>}
        </li>
      </ol>
    </section>
  );
}
