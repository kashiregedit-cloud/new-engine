import React, { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children?: ReactNode;
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
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background text-foreground">
          <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
          <div className="bg-destructive/10 p-4 rounded-md mb-4 max-w-lg overflow-auto">
            <code className="text-sm text-destructive">{this.state.error?.message}</code>
          </div>
          <Button onClick={() => window.location.reload()}>
            Reload Page
          </Button>
          <Button variant="outline" className="mt-2" onClick={() => window.location.href = '/'}>
            Go Home
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
