import { COST_COPILOT_CHIPS } from '../lib/cost';

export default function CostAskChips() {
  return (
    <div className="cost-ask" aria-label="Ask Copilot">
      {COST_COPILOT_CHIPS.map((question) => (
        <button
          key={question}
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('opstrellis-cost-ask', { detail: { question } }));
          }}
        >
          {question}
        </button>
      ))}
    </div>
  );
}
