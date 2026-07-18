import { LogBox } from 'react-native';

/**
 * @reown/appkit-react-native's AppKit constructor calls `this.initConnectors()`
 * — an async method — WITHOUT awaiting it (constructors can't be async), then
 * `initConnectors()` awaits `this.createWalletConnectConnector()`, which
 * constructs @walletconnect/core's Core/Subscriber. Confirmed live on a real
 * Android device: a "TypeError: Cannot convert undefined value to object"
 * thrown deep inside that Subscriber init becomes an unhandled promise
 * rejection with NO app-level call site able to catch it — createAppKit()'s
 * own try/catch (lib/walletconnect.ts) only covers the synchronous
 * constructor call, which has already returned before initConnectors()'s
 * promise ever settles. React Native treats that unhandled rejection as
 * fatal, crashing the entire app on launch even though WalletConnect is
 * fully optional here (the app has a complete local-wallet fallback — see
 * walletconnect.ts's own "degrades to local-wallet-only instead of an
 * unrecoverable crash" comment, which this closes the one gap in: it only
 * protected the synchronous path).
 *
 * This installs a global handler for exactly that class of failure — an
 * uncaught error/rejection that would otherwise be fatal — logs it loudly
 * (so it stays visible in adb logcat/Metro, not silently swallowed) and lets
 * the app keep running instead of hard-crashing. A synchronous, non-fatal
 * error still goes through the previous/default handler unchanged.
 *
 * Imported for its side effect ONLY, as the very first line of
 * app/_layout.tsx, so it's installed before any other module (including
 * lib/walletconnect.ts, which calls createAppKit() at module load) has a
 * chance to kick off the async chain this guards against.
 */
type ErrorUtilsGlobal = {
  ErrorUtils?: {
    getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
    setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
  };
};

const g = globalThis as unknown as ErrorUtilsGlobal;

if (g.ErrorUtils && typeof g.ErrorUtils.setGlobalHandler === 'function') {
  const previousHandler = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal) {
      console.error('[GlobalError] FATAL error suppressed — app continues running:', error);
      return;
    }
    console.error('[GlobalError]', error);
    previousHandler?.(error, isFatal);
  });
}

/**
 * react-native-vision-camera's own native torch-prop watcher (not our call
 * site) tries to switch the flash off as biometric-capture.tsx's
 * `torchMode` prop flips to 'off' when the fingertip-pulse step ends — but
 * by then the underlying camera session has often already torn down (the
 * step's Camera component unmounts/deactivates in the same render pass),
 * so CameraX throws `OperationCanceledException: Camera is not active`.
 * Harmless: the camera closing turns the torch off regardless. Confirmed
 * live via logcat (androidx.camera.camera2.impl.TorchControl.setTorchAsync)
 * — there is no app-level call to wrap in try/catch here, it's entirely
 * inside VisionCamera's native bridge, so LogBox's own ignore list is the
 * only place this specific, known-benign class of rejection can be
 * silenced without touching react-native-vision-camera itself. Still fully
 * logged to adb logcat/Metro for real debugging, just not surfaced as a
 * user-facing red toast mid-capture.
 */
LogBox.ignoreLogs(['CameraControl$OperationCanceledException: Camera is not active']);
