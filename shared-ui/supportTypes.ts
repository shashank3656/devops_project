export interface SupportAction {
  label: string;
  href?: string;
  externalHref?: string;
}

export interface SupportArticle {
  id: string;
  category: string;
  title: string;
  summary: string;
  content: string;
  keywords: string[];
  routePrefixes: string[];
  actions: SupportAction[];
}
