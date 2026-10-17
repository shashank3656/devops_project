export interface ProductionAction {
  project: string;
  environment: string;
  resource: string;
  consequence: string;
}

/** Detail lines for a destructive confirmation. Missing names stay Unknown, never blank. */
export function productionDetailLines(action: ProductionAction): string[] {
  const known = (value: string, fallback: string) => {
    const text = value.trim();
    return text || fallback;
  };
  return [
    `Project: ${known(action.project, 'Unknown project')}`,
    `Environment: ${known(action.environment, 'Unknown environment')}`,
    `Resource: ${known(action.resource, 'Unknown resource')}`,
    `Consequence: ${known(action.consequence, 'This cannot be undone from this screen.')}`,
  ];
}
