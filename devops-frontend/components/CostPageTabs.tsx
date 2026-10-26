export default function CostPageTabs({
  tabs,
  current,
  onSelect,
}: {
  tabs: { id: string; label: string }[];
  current: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="cost-page-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={current === tab.id}
          className={`cost-page-tabs__link${current === tab.id ? ' is-active' : ''}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
