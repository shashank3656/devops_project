import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import CostAskChips from './CostAskChips';
import {
  CostFilterOptions,
  costLastMonth,
  costThisMonth,
  costWindowPreset,
  freshnessLabel,
  importableLabel,
} from '../lib/cost';

type CostFilterBarProps = {
  showBasis?: boolean;
  options?: CostFilterOptions | null;
  explorer?: boolean;
  exporting?: boolean;
  onExport?: () => void;
};

function DraftField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className={`cost-toolbar__field${label === 'Product' ? ' cost-toolbar__field--grow' : ''}`}>
      <span>{label}</span>
      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

export default function CostFilterBar({
  showBasis = false,
  options,
  explorer = false,
  exporting = false,
  onExport,
}: CostFilterBarProps) {
  const router = useRouter();
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const project = typeof router.query.project === 'string' ? router.query.project : '';
  const cloud = typeof router.query.cloud === 'string' ? router.query.cloud : '';
  const environment = typeof router.query.environment === 'string' ? router.query.environment : '';
  const freshness = typeof router.query.freshness === 'string' ? router.query.freshness : '';
  const importStatus = typeof router.query.import === 'string' ? router.query.import : '';
  const service = typeof router.query.service === 'string' ? router.query.service : '';
  const region = typeof router.query.region === 'string' ? router.query.region : '';
  const team = typeof router.query.team === 'string' ? router.query.team : '';
  const account = typeof router.query.account === 'string' ? router.query.account : '';
  const preset = costWindowPreset(from, to);
  const thisMonth = costThisMonth();
  const lastMonth = costLastMonth();
  const extraOn = Boolean(project || cloud || environment || freshness || importStatus || service || region || team || account);

  const patch = (next: Record<string, string | undefined>) => {
    const query = { ...router.query };
    Object.entries(next).forEach(([key, value]) => {
      if (value) query[key] = value;
      else delete query[key];
    });
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  const applyWindow = (nextFrom: string, nextTo: string) => {
    patch({ from: nextFrom || undefined, to: nextTo || undefined });
  };

  const setPreset = (value: string) => {
    if (value === 'last') applyWindow(lastMonth.from, lastMonth.to);
    else if (value === 'custom') applyWindow(from || thisMonth.from, to || thisMonth.to);
    else applyWindow(thisMonth.from, thisMonth.to);
  };

  return (
    <section className="cost-toolbar" aria-label="Cost filters">
      <label className="cost-toolbar__field">
        <span>Window</span>
        <select className="input" value={preset === 'all' ? 'this' : preset} onChange={(event) => setPreset(event.target.value)}>
          <option value="this">This month</option>
          <option value="last">Last month</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {preset === 'custom' ? (
        <>
          <label className="cost-toolbar__field">
            <span>From</span>
            <input className="input" type="date" value={from} onChange={(event) => applyWindow(event.target.value, to)} />
          </label>
          <label className="cost-toolbar__field">
            <span>To</span>
            <input className="input" type="date" value={to} onChange={(event) => applyWindow(from, event.target.value)} />
          </label>
        </>
      ) : null}
      {showBasis ? (
        <label className="cost-toolbar__field">
          <span>Basis</span>
          <select className="input" value={basis} onChange={(event) => patch({ basis: event.target.value })}>
            <option value="actual">Actual</option>
            <option value="amortized">Amortized</option>
          </select>
        </label>
      ) : null}
      {options ? (
        <>
          <label className="cost-toolbar__field">
            <span>Project</span>
            <select className="input" value={project} onChange={(event) => patch({ project: event.target.value || undefined })}>
              <option value="">All projects</option>
              {options.projects.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="cost-toolbar__field">
            <span>Cloud</span>
            <select className="input" value={cloud} onChange={(event) => patch({ cloud: event.target.value || undefined })}>
              <option value="">All clouds</option>
              {options.clouds.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="cost-toolbar__field">
            <span>Environment</span>
            <select className="input" value={environment} onChange={(event) => patch({ environment: event.target.value || undefined })}>
              <option value="">All environments</option>
              {options.environments.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {explorer ? (
        <>
          <DraftField label="Product" value={service} placeholder="Product" onCommit={(next) => patch({ service: next || undefined })} />
          <DraftField label="Team" value={team} placeholder="Team" onCommit={(next) => patch({ team: next || undefined })} />
          <DraftField label="Region" value={region} placeholder="Region" onCommit={(next) => patch({ region: next || undefined })} />
        </>
      ) : null}
      {options || explorer ? (
        <details className="cost-toolbar__more">
          <summary>More</summary>
          <div className="cost-toolbar__more-panel">
            {options ? (
              <>
                <label className="cost-toolbar__field">
                  <span>Freshness</span>
                  <select className="input" value={freshness} onChange={(event) => patch({ freshness: event.target.value || undefined })}>
                    <option value="">Any freshness</option>
                    {options.freshness.map((item) => (
                      <option key={item} value={item}>{freshnessLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <label className="cost-toolbar__field">
                  <span>Import</span>
                  <select className="input" value={importStatus} onChange={(event) => patch({ import: event.target.value || undefined })}>
                    <option value="">Any import</option>
                    {options.imports.map((item) => (
                      <option key={item} value={item}>{importableLabel(item)}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            {explorer ? (
              <DraftField label="Account" value={account} placeholder="Account" onCommit={(next) => patch({ account: next || undefined })} />
            ) : null}
          </div>
        </details>
      ) : null}
      {extraOn ? (
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => patch({
            project: undefined,
            cloud: undefined,
            environment: undefined,
            freshness: undefined,
            import: undefined,
            service: undefined,
            region: undefined,
            team: undefined,
            account: undefined,
          })}
        >
          Clear
        </button>
      ) : null}
      {onExport ? (
        <button type="button" className="btn btn-sm btn-secondary" disabled={exporting} onClick={onExport}>
          {exporting ? 'Exporting…' : 'CSV'}
        </button>
      ) : null}
      <CostAskChips />
    </section>
  );
}
