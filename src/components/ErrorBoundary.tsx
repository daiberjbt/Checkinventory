import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      let errorMessage = 'Ocurrió un error inesperado.';
      
      try {
        const parsedError = JSON.parse(this.state.error?.message || '');
        if (parsedError.error && parsedError.error.includes('insufficient permissions')) {
          errorMessage = 'No tienes permisos suficientes para realizar esta acción.';
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-black/5 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl font-bold">!</span>
            </div>
            <h2 className="text-xl font-bold mb-4">¡Ups! Algo salió mal</h2>
            <p className="text-muted text-sm mb-8">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-black text-white py-4 rounded-2xl font-bold hover:bg-black/80 transition-all"
            >
              Recargar Aplicación
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
