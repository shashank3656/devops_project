import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  title?: string;
}

interface State {
  error: Error | null;
}

function safeErrorText(error: Error): string {
  const text = `${error.name || 'Error'}: ${error.message || 'The page could not be drawn.'}`.replace(/\s+/g, ' ').trim();
  if (/bearer|password|secret|token|eyJ/i.test(text)) return 'The page could not be drawn.';
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

export default class PortalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Portal render error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="portal-page" role="alert">
          <div className="portal-surface" style={{ padding: 24 }}>
            <h1 className="portal-page__title">{this.props.title || 'Something went wrong'}</h1>
            <p className="portal-page__subtitle">Try refreshing the page. If the problem continues, contact your platform admin.</p>
            <p className="portal-page__subtitle">{safeErrorText(this.state.error)}</p>
            <button type="button" className="btn btn-secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
