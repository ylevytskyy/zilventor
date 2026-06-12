import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('App crashed:', error, info);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: '#1f1f1f',
            color: '#e0e0e0',
            fontFamily: 'sans-serif',
            padding: '2rem',
            boxSizing: 'border-box',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#aaa', marginBottom: '1rem' }}>
            An unexpected error occurred. Please reload to continue.
          </p>
          <pre
            style={{
              background: '#2a2a2a',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '1rem',
              maxWidth: '600px',
              width: '100%',
              overflowX: 'auto',
              fontSize: '0.85rem',
              color: '#ff6b6b',
              marginBottom: '1.5rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => location.reload()}
            style={{
              padding: '0.6rem 1.6rem',
              fontSize: '1rem',
              background: '#3a7bd5',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
