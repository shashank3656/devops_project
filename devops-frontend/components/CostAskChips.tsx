import { COST_COPILOT_CHIPS } from '../lib/cost';

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
          onClick={() => {
            const params = new URLSearchParams(window.location.search);
            const from = params.get('from') || '';
            const to = params.get('to') || '';
            const basis = params.get('basis') || 'actual';
            window.dispatchEvent(new CustomEvent('opstrellis-cost-ask', {
              detail: {
                question,
                context: `Period ${from && to ? `${from} to ${to}` : 'this month'}. Basis ${basis}. Source labelled CUR 2.0.`,
              },
            }));
          }}
        >
          {SHORT[question] || question}
        </button>
      ))}
    </div>
  );
}
