import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useWorkspaceScope } from '@infragate/ui';
import {
  COST_SCOPE_KEYS,
  CostExplorerFilterOptions,
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
  showPeriod?: boolean;
  hydrateScope?: boolean;
  options?: CostFilterOptions | null;
  explorer?: boolean;
  explorerOptions?: CostExplorerFilterOptions | null;
  exporting?: boolean;
  onExport?: () => void;
  exportDisabled?: boolean;
  exportDisabledReason?: string;
  sample?: boolean;
  visibleAccounts?: number;
  totalAccounts?: number;
};

function withCurrent(list: string[] | undefined, current: string) {
  const values = list || [];
  if (current && !values.includes(current)) return [current, ...values];
  return values;
}

function FilterSelect({
  label,
  value,
  emptyLabel,
  options,
  optionLabel,
  onChange,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  options: string[];
  optionLabel?: (value: string) => string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="cost-toolbar__field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {options.map((item) => (
          <option key={item} value={item}>{optionLabel ? optionLabel(item) : item}</option>
        ))}
      </select>
    </label>
  );
}

function useCostQuery(hydrateScope = false) {
  const router = useRouter();
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrateScope || !router.isReady || hydrated.current) return;
    hydrated.current = true;
    const stored = storedCostScope();
    const hasUrlScope = COST_SCOPE_KEYS.some((key) => key !== 'sample' && typeof router.query[key] === 'string');
    if (!hasUrlScope && Object.keys(stored).length) {
      void router.replace({ pathname: router.pathname, query: { ...stored, ...router.query } }, undefined, { shallow: true });
      return;
    }
    persistCostScope(router.query);
  }, [hydrateScope, router.isReady, router.pathname, router.query]);

  useEffect(() => {
    if (hydrateScope && router.isReady) persistCostScope(router.query);
  }, [hydrateScope, router.isReady, router.query]);

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

  return { router, from, to, basis, patch, applyWindow };
}

export function focusWorkspaceScope() {
  const control = document.querySelector<HTMLElement>('.devops-navbar .ig-scope-bar__control, .ig-scope-bar__control');
  control?.focus();
  control?.scrollIntoView({ block: 'nearest' });
}

function CostWindowPicker({
  from,
  to,
  range,
  onChange,
  label = 'Window',
}: {
  from: string;
  to: string;
  range?: string;
  onChange: (next: { from?: string; to?: string; range?: string }) => void;
  label?: string;
}) {
  const thisMonth = costThisMonth();
  const lastMonth = costLastMonth();
  const window = resolvedCostWindow(from, to);
  const detected = costWindowPreset(from, to, range);
  const preset = detected === 'all' ? 'this' : detected;
  const setPreset = (value: string) => {
    if (value === 'last') onChange({ from: lastMonth.from, to: lastMonth.to, range: undefined });
    else if (value === 'custom') onChange({ from: window.from, to: window.to, range: 'custom' });
    else onChange({ from: thisMonth.from, to: thisMonth.to, range: undefined });
  };
  const setDate = (nextFrom: string, nextTo: string) => {
    let start = nextFrom || window.from;
    let end = nextTo || window.to;
    if (start && end && start > end) {
      const swap = start;
      start = end;
      end = swap;
    }
    onChange({ from: start, to: end, range: 'custom' });
  };
  return (
    <div className="cost-period">
      <label className="cost-toolbar__field">
        <span>{label}</span>
        <select className="input" value={preset} onChange={(event) => setPreset(event.target.value)}>
          <option value="this">This month</option>
          <option value="last">Last month</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {preset === 'custom' ? (
        <>
          <label className="cost-toolbar__field cost-toolbar__field--date">
            <span>From</span>
            <input
              className="input"
              type="date"
              value={window.from}
              onChange={(event) => setDate(event.target.value, window.to)}
            />
          </label>
          <label className="cost-toolbar__field cost-toolbar__field--date">
            <span>To</span>
            <input
              className="input"
              type="date"
              value={window.to}
              onChange={(event) => setDate(window.from, event.target.value)}
            />
          </label>
        </>
      ) : (
        <span className="cost-toolbar__dates">{formatCostWindowRange(window.from, window.to)}</span>
      )}
    </div>
  );
}

export function CostPeriodControls() {
  const { from, to, router, patch } = useCostQuery(false);
  const range = typeof router.query.range === 'string' ? router.query.range : '';
  return (
    <CostWindowPicker
      from={from}
      to={to}
      range={range}
      label="Period"
      onChange={(next) => patch(next)}
    />
  );
}

export default function CostFilterBar({
  showBasis = false,
  showPeriod = true,
  hydrateScope = true,
  options,
  explorer = false,
  explorerOptions,
  exporting = false,
  onExport,
  exportDisabled = false,
  exportDisabledReason,
  sample = false,
  visibleAccounts,
  totalAccounts,
}: CostFilterBarProps) {
  const { scope } = useWorkspaceScope();
  const { router, from, to, basis, patch } = useCostQuery(hydrateScope);
  const cloud = typeof router.query.cloud === 'string' ? router.query.cloud : '';
  const freshness = typeof router.query.freshness === 'string' ? router.query.freshness : '';
  const importStatus = typeof router.query.import === 'string' ? router.query.import : '';
  const service = typeof router.query.service === 'string' ? router.query.service : '';
  const region = typeof router.query.region === 'string' ? router.query.region : '';
  const team = typeof router.query.team === 'string' ? router.query.team : '';
  const account = typeof router.query.account === 'string' ? router.query.account : '';
  const family = typeof router.query.family === 'string' ? router.query.family : '';
  const extraOn = Boolean(cloud || freshness || importStatus || service || region || team || account || family);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const secondaryOn = extraOn;
  const range = typeof router.query.range === 'string' ? router.query.range : '';
  const projectName = options?.projects.find((item) => String(item.id) === scope.projectId)?.name
    || (scope.projectId ? 'Selected project' : 'All projects');
  const environmentName = scope.environment || 'All environments';
  const chips = [
    cloud ? { key: 'cloud', label: `Cloud ${cloud}` } : null,
    freshness ? { key: 'freshness', label: freshnessLabel(freshness) } : null,
    importStatus ? { key: 'import', label: importableLabel(importStatus) } : null,
    family ? { key: 'family', label: `Family ${family}` } : null,
    service ? { key: 'service', label: `Product ${service}` } : null,
    team ? { key: 'team', label: team.toLowerCase() === 'unallocated' ? 'No team' : `Team ${team}` } : null,
    region ? { key: 'region', label: `Region ${region}` } : null,
    account ? { key: 'account', label: `Account ${account}` } : null,
  ].filter(Boolean) as { key: string; label: string }[];
  const exportTitle = exportDisabled
    ? (exportDisabledReason || 'Connect a billing source to export costs.')
    : undefined;

  return (
    <div className="cost-toolbar-wrap">
      <section className="cost-toolbar" aria-label="Cost filters">
        {sample ? (
          <p className="cost-scope-label">Scope: Sample billed window</p>
        ) : (
          <p className="cost-scope-label">
            Scope: {projectName} / {environmentName}{' '}
            <button type="button" className="cost-scope-label__change" onClick={focusWorkspaceScope}>Change</button>
          </p>
        )}
        {showPeriod ? (
          <CostWindowPicker
            from={from}
            to={to}
            range={range}
            onChange={(next) => patch(next)}
          />
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
                cloud: undefined,
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
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={exporting || exportDisabled}
              title={exportTitle}
              aria-label={exportDisabled ? exportTitle : 'Export costs'}
              onClick={onExport}
            >
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
                <FilterSelect
                  label="Product"
                  value={service}
                  emptyLabel="All products"
                  options={withCurrent(explorerOptions?.products, service)}
                  onChange={(next) => patch({ service: next || undefined })}
                />
                <FilterSelect
                  label="Team"
                  value={team}
                  emptyLabel="All teams"
                  options={withCurrent(explorerOptions?.teams, team)}
                  optionLabel={(item) => (item.toLowerCase() === 'unallocated' ? 'Unallocated' : item)}
                  onChange={(next) => patch({ team: next || undefined })}
                />
                <FilterSelect
                  label="Region"
                  value={region}
                  emptyLabel="All regions"
                  options={withCurrent(explorerOptions?.regions, region)}
                  onChange={(next) => patch({ region: next || undefined })}
                />
                <FilterSelect
                  label="Account"
                  value={account}
                  emptyLabel="All accounts"
                  options={withCurrent(explorerOptions?.accounts, account)}
                  onChange={(next) => patch({ account: next || undefined })}
                />
              </>
            ) : null}
            {options ? (
              <>
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
      {chips.length || (!sample && typeof visibleAccounts === 'number' && typeof totalAccounts === 'number' && totalAccounts > 0) ? (
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
          {!sample && typeof visibleAccounts === 'number' && typeof totalAccounts === 'number' && totalAccounts > 0 ? (
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
