import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupportAction, SupportArticle } from '../lib/supportContent';

type SupportTab = 'chat' | 'docs';

interface ChatCitation {
  number?: string;
  title?: string;
  href?: string;
}

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  actions?: SupportAction[];
  citations?: ChatCitation[];
}

interface SupportHubProps {
  open: boolean;
  initialTab: SupportTab;
  onClose: () => void;
  portalName: string;
  currentPath: string;
  currentTitle: string;
  articles: SupportArticle[];
  quickPrompts: string[];
  externalDocsHref?: string;
  escalationActions?: SupportAction[];
  apiUrl?: string;
  token?: string | null;
}

function matchesRoute(article: SupportArticle, currentPath: string): boolean {
  return article.routePrefixes.some((prefix) => currentPath === prefix || currentPath.startsWith(`${prefix}/`) || currentPath.startsWith(prefix));
}

function buildGreeting(portalName: string, currentTitle: string, article: SupportArticle | null): ChatMessage {
  const contextLine = article
    ? `You are on ${currentTitle}. A good place to start is "${article.title}".`
    : `You are on ${currentTitle}. Ask me about this page or common ${portalName} workflows.`;
  return {
    id: 'greeting',
    role: 'assistant',
    text: `Hi, I’m the SetuOps support assistant for ${portalName}.\n\n${contextLine}\n\nI can explain workflows, point you to the right page, and surface the most relevant docs without sending you hunting through the menu.`,
    actions: article?.actions,
  };
}

function buildReply(query: string, portalName: string, articles: SupportArticle[], currentPath: string, currentTitle: string): ChatMessage {
  const normalized = query.trim().toLowerCase();
  const contextArticle = articles.find((article) => matchesRoute(article, currentPath)) || null;

  if (!normalized) {
    return {
      id: `assistant-empty-${Date.now()}`,
      role: 'assistant',
      text: `Try asking about ${currentTitle}, incidents, templates, request history, or the current page.`,
      actions: contextArticle?.actions,
    };
  }

  if (['hi', 'hello', 'hey', 'help'].includes(normalized)) {
    return buildGreeting(portalName, currentTitle, contextArticle);
  }

  if (normalized.includes('this page') || normalized.includes('current page') || normalized.includes(currentTitle.toLowerCase())) {
    if (contextArticle) {
      return {
        id: `assistant-context-${Date.now()}`,
        role: 'assistant',
        text: `${contextArticle.summary}\n\n${contextArticle.content}`,
        actions: contextArticle.actions,
      };
    }
  }

  let best: { article: SupportArticle; score: number } | null = null;
  for (const article of articles) {
    let score = 0;
    if (matchesRoute(article, currentPath)) score += 2;
    if (article.title.toLowerCase().includes(normalized)) score += 4;
    if (article.category.toLowerCase().includes(normalized)) score += 2;
    for (const keyword of article.keywords) {
      if (normalized.includes(keyword.toLowerCase())) score += 2;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { article, score };
    }
  }

  if (best) {
    return {
      id: `assistant-article-${Date.now()}`,
      role: 'assistant',
      text: `${best.article.summary}\n\n${best.article.content}`,
      actions: best.article.actions,
    };
  }

  const fallbackActions = [contextArticle, ...articles].filter(Boolean).slice(0, 2).flatMap((article) => article?.actions || []);
  return {
    id: `assistant-fallback-${Date.now()}`,
    role: 'assistant',
    text: 'I could not match that exactly, but I can still help. Try asking about requests, incidents, templates, projects, or switch to Documentation for structured guidance.',
    actions: fallbackActions,
  };
}

function renderMessageText(text: string) {
  return text.split('\n\n').map((part, index) => <p key={`${part.slice(0, 12)}-${index}`}>{part}</p>);
}

export default function SupportHub({
  open,
  initialTab,
  onClose,
  portalName,
  currentPath,
  currentTitle,
  articles,
  quickPrompts,
  externalDocsHref,
  escalationActions = [],
  apiUrl,
  token,
}: SupportHubProps) {
  const [activeTab, setActiveTab] = useState<SupportTab>(initialTab);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [docsQuery, setDocsQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const docsSearchRef = useRef<HTMLInputElement>(null);
  const contextArticle = useMemo(() => articles.find((article) => matchesRoute(article, currentPath)) || null, [articles, currentPath]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!open) return;
    setMessages([buildGreeting(portalName, currentTitle, contextArticle)]);
    setInput('');
    setDocsQuery('');
    setSelectedCategory('All');
  }, [open, portalName, currentTitle, contextArticle]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const nextFocus = activeTab === 'chat' ? textareaRef.current : docsSearchRef.current;
    const raf = window.requestAnimationFrame(() => {
      (nextFocus || closeButtonRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open, activeTab]);

  const categories = useMemo(() => {
    const nextCategories = articles.reduce<string[]>((list, article) => {
      if (!list.includes(article.category)) list.push(article.category);
      return list;
    }, []);
    return ['All', ...nextCategories];
  }, [articles]);

  const filteredArticles = useMemo(() => {
    const normalized = docsQuery.trim().toLowerCase();
    const withContextFirst = contextArticle
      ? [contextArticle, ...articles.filter((article) => article.id !== contextArticle.id)]
      : articles;
    const categoryFiltered = selectedCategory === 'All'
      ? withContextFirst
      : withContextFirst.filter((article) => article.category === selectedCategory);
    if (!normalized) return categoryFiltered;
    return categoryFiltered.filter((article) =>
      article.title.toLowerCase().includes(normalized) ||
      article.summary.toLowerCase().includes(normalized) ||
      article.content.toLowerCase().includes(normalized) ||
      article.keywords.some((keyword) => keyword.toLowerCase().includes(normalized))
    );
  }, [articles, contextArticle, docsQuery, selectedCategory]);

  const handleSend = (seed?: string) => {
    const question = (seed ?? input).trim();
    if (!question) return;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', text: question };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    const fallback = buildReply(question, portalName, articles, currentPath, currentTitle);
    if (!apiUrl || !token) {
      setMessages((current) => [...current, fallback]);
      return;
    }
    fetch(`${apiUrl.replace(/\/+$/, '')}/api/copilot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: question,
        path: currentPath,
        title: currentTitle,
        portal: portalName,
        context: { article: contextArticle?.title },
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const text = typeof data?.reply === 'string' && data.reply.trim() ? data.reply : fallback.text;
        const citations = Array.isArray(data?.citations) ? data.citations.map((item: ChatCitation) => {
          if (item.href && item.href.startsWith('/incidents/') && !item.href.includes('/edit')) {
            return { ...item, href: `${item.href}/edit` };
          }
          return item;
        }) : [];
        setMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: 'assistant', text, actions: fallback.actions, citations }]);
      })
      .catch(() => setMessages((current) => [...current, fallback]));
  };

  return (
    <>
      <div className={`portal-assistant-overlay ${open ? 'portal-assistant-overlay--open' : ''}`} aria-hidden={!open} onClick={onClose} />
      <aside className={`portal-assistant ${open ? 'portal-assistant--open' : ''}`} role="dialog" aria-modal="true" aria-label={`${portalName} support assistant`}>
        <div className="portal-assistant__header">
          <div>
            <span className="portal-assistant__eyebrow">SetuOps Support</span>
            <h2 className="portal-assistant__title">{portalName} assistant</h2>
            <p className="portal-assistant__subtitle">Support works like a chatbot here, while Documentation keeps the structured guidance close by.</p>
          </div>
          <button ref={closeButtonRef} type="button" className="portal-assistant__close" onClick={onClose}>Close</button>
        </div>
        <div className="portal-assistant__tabs" role="tablist" aria-label="Support assistant tabs">
          <button type="button" className={`portal-assistant__tab ${activeTab === 'chat' ? 'portal-assistant__tab--active' : ''}`} onClick={() => setActiveTab('chat')}>Support chat</button>
          <button type="button" className={`portal-assistant__tab ${activeTab === 'docs' ? 'portal-assistant__tab--active' : ''}`} onClick={() => setActiveTab('docs')}>Documentation</button>
        </div>
        {activeTab === 'chat' ? (
          <div className="portal-assistant__body portal-assistant__body--chat">
            <div className="portal-assistant__messages">
              {messages.map((message) => (
                <div key={message.id} className={`portal-assistant__message portal-assistant__message--${message.role}`}>
                  <div className="portal-assistant__message-copy">{renderMessageText(message.text)}</div>
                  {message.citations && message.citations.length > 0 ? (
                    <div className="portal-assistant__message-actions">
                      {message.citations.map((citation) => (
                        citation.href
                          ? <Link key={`${message.id}-${citation.number}`} href={citation.href} className="portal-assistant__link" onClick={onClose}>{citation.number || citation.title}</Link>
                          : <span key={`${message.id}-${citation.number}`}>{citation.number}</span>
                      ))}
                    </div>
                  ) : null}
                  {message.actions && message.actions.length > 0 ? (
                    <div className="portal-assistant__message-actions">
                      {message.actions.map((action) => (
                        action.href ? <Link key={`${message.id}-${action.label}`} href={action.href} className="portal-assistant__link" onClick={onClose}>{action.label}</Link>
                        : action.externalHref ? <a key={`${message.id}-${action.label}`} href={action.externalHref} className="portal-assistant__link" target="_blank" rel="noreferrer">{action.label}</a>
                        : null
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="portal-assistant__prompts">
              {quickPrompts.map((prompt) => (
                <button key={prompt} type="button" className="portal-assistant__prompt-chip" onClick={() => handleSend(prompt)}>{prompt}</button>
              ))}
            </div>
            <div className="portal-assistant__composer">
              <textarea
                ref={textareaRef}
                className="portal-assistant__textarea"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={`Ask about ${currentTitle}, common workflows, or where to go next...`}
                rows={3}
              />
              <div className="portal-assistant__composer-actions">
                <button type="button" className="portal-assistant__ghost" onClick={() => setMessages([buildGreeting(portalName, currentTitle, contextArticle)])}>Reset chat</button>
                <button type="button" className="portal-assistant__send" onClick={() => handleSend()}>Send</button>
              </div>
            </div>
            {escalationActions.length > 0 ? (
              <div className="portal-assistant__escalation">
                <div>
                  <span className="portal-assistant__escalation-eyebrow">Need a human?</span>
                  <h3 className="portal-assistant__escalation-title">Escalate this to the platform team</h3>
                  <p className="portal-assistant__escalation-copy">If the chatbot guidance is not enough, use one of these paths to get direct help with the current workflow.</p>
                </div>
                <div className="portal-assistant__article-actions">
                  {escalationActions.map((action) => (
                    action.href ? <Link key={`escalation-${action.label}`} href={action.href} className="portal-assistant__link" onClick={onClose}>{action.label}</Link>
                    : action.externalHref ? <a key={`escalation-${action.label}`} href={action.externalHref} className="portal-assistant__link" target="_blank" rel="noreferrer">{action.label}</a>
                    : null
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="portal-assistant__body portal-assistant__body--docs">
            <div className="portal-assistant__docs-toolbar">
              <input ref={docsSearchRef} type="search" className="portal-assistant__docs-search" value={docsQuery} onChange={(event) => setDocsQuery(event.target.value)} placeholder="Search guides, workflows, and page help" />
              {externalDocsHref ? <a href={externalDocsHref} className="portal-assistant__link" target="_blank" rel="noreferrer">Open full docs</a> : null}
            </div>
            {contextArticle ? (
              <div className="portal-assistant__recommended">
                <span className="portal-assistant__recommended-badge">Recommended for this page</span>
                <h3>{contextArticle.title}</h3>
                <p>{contextArticle.summary}</p>
              </div>
            ) : null}
            <div className="portal-assistant__category-bar">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`portal-assistant__category-chip ${selectedCategory === category ? 'portal-assistant__category-chip--active' : ''}`}
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="portal-assistant__docs-list">
              {filteredArticles.length === 0 ? (
                <div className="portal-assistant__empty">
                  <strong className="portal-assistant__empty-title">No documentation match yet</strong>
                  <p className="portal-assistant__empty-copy">Try a broader search like request, incident, team, template, or project. You can also reset the search, switch categories, and use the recommended guide for this page.</p>
                  <div className="portal-assistant__empty-actions">
                    <button type="button" className="portal-assistant__ghost" onClick={() => setDocsQuery('')}>Reset search</button>
                    {selectedCategory !== 'All' ? <button type="button" className="portal-assistant__ghost" onClick={() => setSelectedCategory('All')}>Show all categories</button> : null}
                  </div>
                </div>
              ) : filteredArticles.map((article) => (
                <article key={article.id} className="portal-assistant__article">
                  <div className="portal-assistant__article-head">
                    <div className="portal-assistant__article-title-wrap">
                      <h3 className="portal-assistant__article-title">{article.title}</h3>
                      <span className="portal-assistant__article-category">{article.category}</span>
                    </div>
                    {matchesRoute(article, currentPath) ? <span className="portal-assistant__article-tag">Current area</span> : null}
                  </div>
                  <p className="portal-assistant__article-summary">{article.summary}</p>
                  <p className="portal-assistant__article-content">{article.content}</p>
                  <div className="portal-assistant__article-actions">
                    {article.actions.map((action) => (
                      action.href ? <Link key={`${article.id}-${action.label}`} href={action.href} className="portal-assistant__link" onClick={onClose}>{action.label}</Link>
                      : action.externalHref ? <a key={`${article.id}-${action.label}`} href={action.externalHref} className="portal-assistant__link" target="_blank" rel="noreferrer">{action.label}</a>
                      : null
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
