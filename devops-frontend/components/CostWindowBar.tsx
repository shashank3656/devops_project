import { useRouter } from 'next/router';
import { costLastMonth, costThisMonth, costWindowPreset } from '../lib/cost';

export default function CostWindowBar() {
  const router = useRouter();
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const preset = costWindowPreset(from, to);
  const thisMonth = costThisMonth();
  const lastMonth = costLastMonth();

  const apply = (nextFrom: string, nextTo: string) => {
    const query = { ...router.query };
    if (nextFrom) query.from = nextFrom;
    else delete query.from;
    if (nextTo) query.to = nextTo;
    else delete query.to;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  return (
    <div className="cost-window" role="group" aria-label="Cost window">
      <button type="button" className={`btn btn-sm ${preset === 'this' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => apply(thisMonth.from, thisMonth.to)}>This month</button>
      <button type="button" className={`btn btn-sm ${preset === 'last' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => apply(lastMonth.from, lastMonth.to)}>Last month</button>
      <button type="button" className={`btn btn-sm ${preset === 'custom' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => apply(from || thisMonth.from, to || thisMonth.to)}>Custom</button>
      {preset === 'custom' || from || to ? (
        <>
          <label className="cost-window__date">From
            <input className="input" type="date" value={from} onChange={(event) => apply(event.target.value, to)} />
          </label>
          <label className="cost-window__date">To
            <input className="input" type="date" value={to} onChange={(event) => apply(from, event.target.value)} />
          </label>
        </>
      ) : null}
    </div>
  );
}
