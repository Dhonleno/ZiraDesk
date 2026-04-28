import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro capturado pelo ErrorBoundary:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--txt)', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 420, textAlign: 'center', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 28 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--red-dim)', color: 'var(--red)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 8v5M12 17h.01M10.3 3.9L2.6 17.2A2 2 0 004.3 20h15.4a2 2 0 001.7-2.8L13.7 3.9a2 2 0 00-3.4 0z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Algo saiu do esperado</h1>
          <p style={{ color: 'var(--txt-2)', marginBottom: 18 }}>A tela encontrou um erro de renderização. Tente novamente para recarregar este trecho.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{ height: 36, padding: '0 14px', borderRadius: 'var(--r)', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', fontWeight: 700, cursor: 'pointer' }}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }
}
