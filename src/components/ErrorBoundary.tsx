/**
 * ErrorBoundary — top-level React error boundary (DMY-41).
 *
 * Catches render / lifecycle errors anywhere in its subtree so an uncaught
 * exception degrades to a neutral fallback instead of a white screen / crash
 * (supports the >99.5% crash-free sessions target in product-spec).
 *
 * On catch it logs through the app `logger.error` — NOT raw `console.error` —
 * so the error and component stack pass through the logger's redaction before
 * being written. The fallback can be reset, which clears the error state and
 * remounts the children.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { logger } from '../services/logger';
import ErrorFallback from './ErrorFallback';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional custom fallback. Receives a `reset` callback that clears the
   * error state and remounts the subtree. When omitted, the default
   * {@link ErrorFallback} is rendered.
   */
  fallback?: (reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    // Render phase: flip into the error state so the next render shows the
    // fallback. No side effects allowed here.
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Commit phase: safe to perform side effects. Route through the redacting
    // logger so any sensitive payload in the message/stack is scrubbed.
    logger.error('ErrorBoundary caught an error', error, {
      componentStack: info.componentStack,
    });
  }

  reset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallback } = this.props;
      if (fallback) {
        return fallback(this.reset);
      }
      return <ErrorFallback onReset={this.reset} />;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
