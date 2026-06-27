import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import { Link } from 'wouter';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error inside ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.fallback) {
        return this.fallback;
      }

      return (
        <div className="min-h-screen bg-[#030712] text-slate-100 flex items-center justify-center p-6 font-sans">
          <div className="max-w-xl w-full bg-slate-900/40 border border-rose-500/20 rounded-2xl p-6 md:p-8 space-y-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex items-center gap-4 border-b border-slate-800 pb-4">
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Application Error</h1>
                <p className="text-xs text-rose-400/80 font-mono mt-0.5">Fatal React render lifecycle crash detected</p>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-300">Error Description:</h2>
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl text-xs font-mono text-rose-300 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48">
                {this.state.error?.toString() || 'Unknown rendering error'}
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl transition-all text-xs font-semibold cursor-pointer shadow-lg shadow-rose-900/20"
              >
                <RotateCcw className="w-4 h-4" /> Reset Application State
              </button>
              <Link href="/new">
                <a className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all text-xs font-semibold">
                  <Home className="w-4 h-4" /> Go to Control Center
                </a>
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }

  // Helper getter to avoid TS compiler issues with props/state destructuring in some environments
  private get fallback() {
    return this.props.fallback;
  }
}
