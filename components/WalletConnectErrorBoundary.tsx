import React from 'react';

/**
 * Isolates <AppKit /> (the WalletConnect modal UI) so a render-time crash in
 * it can't take down the rest of the app — WalletConnect is fully optional
 * here, the app has a complete local-wallet fallback (see
 * lib/walletconnect.ts). Complements lib/globalErrorHandler.ts, which
 * guards the OTHER way this SDK has crashed the app live on a real device:
 * an unhandled promise rejection from AppKit's constructor firing
 * initConnectors() (async) without awaiting it. A React error boundary only
 * catches throws during render/lifecycle, not async rejections, so both
 * guards are needed — this one for whatever DID reach a render pass, the
 * other for whatever never did.
 */
export class WalletConnectErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[WalletConnectErrorBoundary] AppKit render crashed — continuing without it:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
