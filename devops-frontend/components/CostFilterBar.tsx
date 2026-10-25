import { useRouter } from 'next/router';
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
};

export default function CostFilterBar({ showBasis = false, options }: CostFilterBarProps) {
  const router = useRouter();
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const project = typeof router.query.project === 'string' ? router.query.project : '';
  const cloud = typeof router.query.cloud === 'string' ? router.query.cloud : '';
  const environment = typeof router.query.environment === 'string' ? router.query.environment : '';
  const freshness = typeof router.query.freshness === 'string' ? router.query.freshness : '';
  const importStatus = typeof router.query.import === 'string' ? router.query.import : '';
  const preset = costWindowPreset(from, to);
  const thisMonth = costThisMonth();
  const lastMonth = costLastMonth();
  const analysisOn = Boolean(project || cloud || environment || freshness || importStatus);

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

  const clearAnalysis = () => {
    patch({ project: undefined, cloud: undefined, environment: undefined, freshness: undefined, import: undefined });
  };

  return (
    <section className="cost-filters" aria-label="Cost filters">
      <div className="cost-filters__group" role="group" aria-label="Window">
        <span className="cost-filters__label">Window</span>
        <button type="button" className={`btn btn-sm ${preset === 'this' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => applyWindow(thisMonth.from, thisMonth.to)}>This month</button>
        <button type="button" className={`btn btn-sm ${preset === 'last' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => applyWindow(lastMonth.from, lastMonth.to)}>Last month</button>
        <button type="button" className={`btn btn-sm ${preset === 'custom' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => applyWindow(from || thisMonth.from, to || thisMonth.to)}>Custom</button>
        {preset === 'custom' || from || to ? (
          <>
            <label className="cost-window__date">From
              <input className="input" type="date" value={from} onChange={(event) => applyWindow(event.target.value, to)} />
            </label>
            <label className="cost-window__date">To
              <input className="input" type="date" value={to} onChange={(event) => applyWindow(from, event.target.value)} />
            </label>
          </>
        ) : null}
      </div>
      {showBasis ? (
        <div className="cost-filters__group" role="group" aria-label="Basis">
          <span className="cost-filters__label">Basis</span>
          <button type="button" className={`btn btn-sm ${basis === 'actual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => patch({ basis: 'actual' })}>Actual</button>
          <button type="button" className={`btn btn-sm ${basis === 'amortized' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => patch({ basis: 'amortized' })}>Amortized</button>
        </div>
      ) : null}
      {options ? (
        <div className="cost-filters__group cost-filters__group--selects" role="group" aria-label="Scope">
          <label className="cost-filters__select">Project
            <select className="input" value={project} onChange={(event) => patch({ project: event.target.value || undefined })}>
              <option value="">All projects</option>
              {options.projects.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="cost-filters__select">Cloud
            <select className="input" value={cloud} onChange={(event) => patch({ cloud: event.target.value || undefined })}>
              <option value="">All clouds</option>
              {options.clouds.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="cost-filters__select">Environment
            <select className="input" value={environment} onChange={(event) => patch({ environment: event.target.value || undefined })}>
              <option value="">All environments</option>
              {options.environments.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="cost-filters__select">Freshness
            <select className="input" value={freshness} onChange={(event) => patch({ freshness: event.target.value || undefined })}>
              <option value="">Any freshness</option>
              {options.freshness.map((item) => (
                <option key={item} value={item}>{freshnessLabel(item)}</option>
              ))}
            </select>
          </label>
          <label className="cost-filters__select">Import
            <select className="input" value={importStatus} onChange={(event) => patch({ import: event.target.value || undefined })}>
              <option value="">Any import</option>
              {options.imports.map((item) => (
                <option key={item} value={item}>{importableLabel(item)}</option>
              ))}
            </select>
          </label>
          {analysisOn ? (
            <button type="button" className="btn btn-sm btn-secondary" onClick={clearAnalysis}>Clear filters</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
