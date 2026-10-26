import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  COST_SCOPE_KEYS,
  CostFilterOptions,
  costLastMonth,
  costThisMonth,
  costWindowPreset,
  formatCostWindowRange,
  freshnessLabel,
  importableLabel,
  persistCostScope,
  resolvedCostWindow,
  storedCostScope,
} from '../lib/cost';

type CostFilterBarProps = {
  showBasis?: boolean;
  options?: CostFilterOptions | null;
  explorer?: boolean;
  exporting?: boolean;
  onExport?: () => void;
  visibleAccounts?: number;
  totalAccounts?: number;
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
  visibleAccounts,
  totalAccounts,
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
  const family = typeof router.query.family === 'string' ? router.query.family : '';
  const preset = costWindowPreset(from, to);
  const thisMonth = costThisMonth();
  const lastMonth = costLastMonth();
  const window = resolvedCostWindow(from, to);
  const extraOn = Boolean(project || cloud || environment || freshness || importStatus || service || region || team || account || family);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const secondaryOn = Boolean(freshness || importStatus || service || region || team || account || family);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!router.isReady || hydrated.current) return;
    hydrated.current = true;
    const stored = storedCostScope();
    const hasUrlScope = COST_SCOPE_KEYS.some((key) => typeof router.query[key] === 'string');
    if (!hasUrlScope && Object.keys(stored).length) {
      void router.replace({ pathname: router.pathname, query: { ...stored, ...router.query } }, undefined, { shallow: true });
      return;
    }
    persistCostScope(router.query);
  }, [router.isReady, router.pathname, router.query]);

  useEffect(() => {
    if (router.isReady) persistCostScope(router.query);
  }, [router.isReady, router.query]);

  const patch = (next: Record<string, string | undefined>) => {
    const query = { ...router.query };
    Object.entries(next).forEach(([key, value]) => {
      if (value) query[key] = value;
      else delete query[key];
    });
    persistCostScope(query);
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

  const projectName = options?.projects.find((item) => String(item.id) === project)?.name || project;
  const chips = [
    project ? { key: 'project', label: `Project ${projectName}` } : null,
    cloud ? { key: 'cloud', label: `Cloud ${cloud}` } : null,
    environment ? { key: 'environment', label: `Env ${environment}` } : null,
    freshness ? { key: 'freshness', label: freshnessLabel(freshness) } : null,
    importStatus ? { key: 'import', label: importableLabel(importStatus) } : null,
    family ? { key: 'family', label: `Family ${family}` } : null,
    service ? { key: 'service', label: `Product ${service}` } : null,
    team ? { key: 'team', label: team.toLowerCase() === 'unallocated' ? 'No team' : `Team ${team}` } : null,
    region ? { key: 'region', label: `Region ${region}` } : null,
    account ? { key: 'account', label: 'Account filter' } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  return (
    <div className="cost-toolbar-wrap">
      <section className="cost-toolbar" aria-label="Cost filters">
        <label className="cost-toolbar__field">
          <span>Window</span>
          <select className="input" value={preset === 'all' ? 'this' : preset} onChange={(event) => setPreset(event.target.value)}>
            <option value="this">This month</option>
            <option value="last">Last month</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <span className="cost-toolbar__dates">{formatCostWindowRange(window.from, window.to)}</span>
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
        <div className="cost-toolbar__actions">
          {options || explorer ? (
            <button type="button" className={`btn btn-sm ${secondaryOn ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDrawerOpen(true)}>
              More filters
            </button>
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
                family: undefined,
              })}
            >
              Clear all
            </button>
          ) : null}
          {onExport ? (
            <button type="button" className="btn btn-sm btn-secondary" disabled={exporting} onClick={onExport}>
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          ) : null}
        </div>
      </section>
      {drawerOpen ? (
        <div className="cost-drawer" role="presentation" onClick={() => setDrawerOpen(false)}>
          <aside className="cost-drawer__panel" role="dialog" aria-label="More filters" onClick={(event) => event.stopPropagation()}>
            <header className="cost-drawer__head">
              <h2>More filters</h2>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDrawerOpen(false)}>Done</button>
            </header>
            {explorer ? (
              <>
                <DraftField label="Product" value={service} placeholder="Product" onCommit={(next) => patch({ service: next || undefined })} />
                <DraftField label="Team" value={team} placeholder="Team" onCommit={(next) => patch({ team: next || undefined })} />
                <DraftField label="Region" value={region} placeholder="Region" onCommit={(next) => patch({ region: next || undefined })} />
                <DraftField label="Account" value={account} placeholder="Account" onCommit={(next) => patch({ account: next || undefined })} />
              </>
            ) : null}
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
          </aside>
        </div>
      ) : null}
      {chips.length || typeof visibleAccounts === 'number' ? (
        <div className="cost-chips" aria-label="Active filters">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="cost-chips__chip"
              onClick={() => patch({ [chip.key]: undefined })}
            >
              {chip.label} ×
            </button>
          ))}
          {typeof visibleAccounts === 'number' && typeof totalAccounts === 'number' ? (
            <span className="cost-chips__count">{visibleAccounts} of {totalAccounts} accounts</span>
          ) : null}
          {extraOn && options ? (
            <span className="cost-chips__note">Operating bill is the billed window, not this list.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
