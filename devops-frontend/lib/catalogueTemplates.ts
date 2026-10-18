export type CatalogueInput = { id: string; label: string };

export type CatalogueTemplate = {
  key: 'storage-bucket' | 'application-onboarding' | 'database';
  name: string;
  version: string;
  owner: string;
  approval: string;
  summary: string;
  inputs: CatalogueInput[];
};

export const CATALOGUE_TEMPLATES: CatalogueTemplate[] = [
  {
    key: 'storage-bucket',
    name: 'Storage bucket',
    version: '1',
    owner: 'Service owner',
    approval: 'Manager, then DevOps. Approval does not create the bucket.',
    summary: 'Request a storage bucket with a purpose and region.',
    inputs: [
      { id: 'purpose', label: 'Purpose' },
      { id: 'region', label: 'Region' },
    ],
  },
  {
    key: 'application-onboarding',
    name: 'Application onboarding',
    version: '1',
    owner: 'Application owner',
    approval: 'Manager, then DevOps. Approval does not deploy the application.',
    summary: 'Register an application with its repository and runtime.',
    inputs: [
      { id: 'repository', label: 'Repository' },
      { id: 'runtime', label: 'Runtime' },
    ],
  },
  {
    key: 'database',
    name: 'Database',
    version: '1',
    owner: 'Service owner',
    approval: 'Manager, then DevOps. Approval does not create the database.',
    summary: 'Request a database with an engine and a purpose.',
    inputs: [
      { id: 'engine', label: 'Engine' },
      { id: 'purpose', label: 'Purpose' },
    ],
  },
];

export function catalogueTemplate(key: string): CatalogueTemplate | undefined {
  return CATALOGUE_TEMPLATES.find((item) => item.key === key);
}

export function catalogueNote(template: CatalogueTemplate, values: Record<string, string>): string {
  const lines = [
    `Catalogue ${template.name} version ${template.version}.`,
    `Owner: ${template.owner}.`,
    `Approval: ${template.approval}`,
  ];
  template.inputs.forEach((input) => {
    const value = (values[input.id] || '').trim();
    if (value) lines.push(`${input.label}: ${value}`);
  });
  return lines.join('\n');
}
