import { COST_COPILOT_CHIPS, askCostCopilot } from '../lib/cost';

const SHORT: Record<string, string> = {
  'Why is spend Unknown?': 'Unknown?',
  'Why is coverage incomplete?': 'Coverage',
};

export default function CostAskChips() {
  return (
    <div className="cost-ask" aria-label="Ask Copilot">
      {COST_COPILOT_CHIPS.map((question) => (
        <button
          key={question}
          type="button"
          className="cost-ask__link"
          title={question}
          onClick={() => askCostCopilot(question)}
        >
          {SHORT[question] || question}
        </button>
      ))}
    </div>
  );
}
