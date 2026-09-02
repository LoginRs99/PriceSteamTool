import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          padding: '32px 16px',
          textAlign: 'center',
          color: 'var(--text, #f8fafc)'
        }}>
          <div style={{
            background: 'rgba(239, 68, 68, 0.12)',
            padding: '16px',
            borderRadius: '50%',
            marginBottom: '16px',
            border: '1px solid rgba(239, 68, 68, 0.25)'
          }}>
            <AlertTriangle size={48} color="#ef4444" />
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
            Something went wrong
          </h2>
          <p style={{
            color: 'var(--text-muted, #94a3b8)',
            fontSize: '14px',
            maxWidth: '460px',
            marginBottom: '24px',
            lineHeight: 1.5
          }}>
            An unexpected error occurred while rendering the interface. Your saved settings and data are safe.
          </p>
          {this.state.error?.message && (
            <div style={{
              background: 'var(--surface-raised, #1e293b)',
              border: '1px solid var(--border, #334155)',
              borderRadius: '6px',
              padding: '10px 14px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '12px',
              color: '#f87171',
              maxWidth: '560px',
              overflowX: 'auto',
              marginBottom: '20px'
            }}>
              {this.state.error.message}
            </div>
          )}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={this.handleReset}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              Try Again
            </button>
            <button
              onClick={this.handleReload}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <RefreshCw size={14} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
