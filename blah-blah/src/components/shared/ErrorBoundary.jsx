import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught error:', error, info);
    this.setState({ info });
  }

  render() {
    if (this.state.error) {
      const { error, info } = this.state;
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#1a1a2e',
          color: '#f87171', fontFamily: 'monospace', padding: '32px',
          overflowY: 'auto', zIndex: 9999,
        }}>
          <h2 style={{ color: '#fb923c', marginBottom: 8 }}>
            💥 React Crash — {error?.name || 'Error'}
          </h2>
          <pre style={{
            background: '#0f0f1a', padding: 16, borderRadius: 8,
            color: '#fca5a5', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            marginBottom: 16,
          }}>
            {error?.message}{'\n\n'}{error?.stack}
          </pre>
          {info?.componentStack && (
            <>
              <h3 style={{ color: '#fb923c', marginBottom: 8 }}>Component Stack</h3>
              <pre style={{
                background: '#0f0f1a', padding: 16, borderRadius: 8,
                color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {info.componentStack}
              </pre>
            </>
          )}
          <button
            style={{
              marginTop: 24, padding: '8px 20px', background: '#3b82f6',
              color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
              fontSize: 14,
            }}
            onClick={() => this.setState({ error: null, info: null })}
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
