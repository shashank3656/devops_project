export interface StepperStep {
  id: string;
  label: string;
}

export default function Stepper({
  steps,
  current,
  onSelect,
}: {
  steps: StepperStep[];
  current: string;
  onSelect?: (id: string) => void;
}) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === current));

  return (
    <ol className="ig-stepper" aria-label="Progress">
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
        const marker = state === 'done' ? '✓' : String(index + 1);
        const content = (
          <>
            <span className="ig-stepper__marker" aria-hidden>
              {marker}
            </span>
            <span className="ig-stepper__label">{step.label}</span>
          </>
        );
        return (
          <li
            key={step.id}
            className={`ig-stepper__step ig-stepper__step--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {state === 'done' && onSelect ? (
              <button type="button" className="ig-stepper__button" onClick={() => onSelect(step.id)}>
                {content}
              </button>
            ) : (
              <span className="ig-stepper__button">{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
