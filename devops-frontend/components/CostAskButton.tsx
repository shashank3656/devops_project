import { askCostCopilot } from '../lib/cost';

export default function CostAskButton({
  question,
  context,
  children,
}: {
  question: string;
  context?: string;
  children?: string;
}) {
  return (
    <button
      type="button"
      className="cost-ask__link"
      onClick={() => askCostCopilot(question, context)}
    >
      {children || question}
    </button>
  );
}
