import { COST_COPILOT_CHIPS } from '../lib/cost';

const SHORT: Record<string, string> = {
  'Why is this Unknown?': 'Unknown?',
  'Explain CALC-COST IDs': 'CALC-COST',
  'What does incomplete coverage mean?': 'Coverage',
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
          onClick={() => {
            window.dispatchEvent(new CustomEvent('opstrellis-cost-ask', { detail: { question } }));
          }}
        >
          {SHORT[question] || question}
        </button>
      ))}
    </div>
  );
}
