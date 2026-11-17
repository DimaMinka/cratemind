import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';

declare global {
  interface Window {
    __CRATEMIND_READY__?: boolean;
  }
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class TerminalErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[CrateMind Pocket] Uncaught React Error:', error, info);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-black text-white p-6 font-mono flex flex-col items-center justify-center text-center">
          <div className="border border-red-500/50 bg-red-950/20 p-6 rounded-lg max-w-md w-full">
            <h1 className="text-red-400 font-bold text-sm tracking-wider mb-2">
              ★ SYSTEM RECOVERY TERMINAL
            </h1>
            <p className="text-xs text-neutral-400 mb-4 break-words">
              {this.state.error.message || 'Unknown runtime error occurred.'}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              className="w-full py-2 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 text-white text-xs font-bold rounded transition-colors"
            >
              RECOVER STANDALONE UI
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <TerminalErrorBoundary>
        <App />
      </TerminalErrorBoundary>
    </React.StrictMode>
  );
  window.__CRATEMIND_READY__ = true;
}
