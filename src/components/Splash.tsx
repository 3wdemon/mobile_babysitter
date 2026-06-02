/**
 * Splash — bootsplash lifecycle binding (DMY-58).
 *
 * The native bootsplash (PLACEHOLDER brand: brand-blue field + "MB" monogram,
 * see assets/branding + react-native-bootsplash config) is drawn by the OS
 * launch window / storyboard while the JS bundle loads. There is no React UI to
 * render for it — once the root navigator is mounted and laid out we simply hide
 * the native splash with a fade.
 *
 * This component renders nothing; it exists so the hide wiring is a single,
 * testable unit. Mount it inside NavigationContainer's `onReady`, or drive it
 * directly via `useHideBootSplash`.
 */
import { useEffect, useRef } from 'react';
import BootSplash from 'react-native-bootsplash';

/**
 * Hide the native bootsplash exactly once, after the caller signals the root
 * navigator is ready. `ready` defaults to true so the simplest usage
 * (`useHideBootSplash()` at the app root) hides on first mount.
 *
 * Hiding is guarded by a ref so re-renders / repeated `ready` transitions never
 * call `BootSplash.hide` more than once.
 */
export function useHideBootSplash(ready: boolean = true): void {
  const hidden = useRef(false);

  useEffect(() => {
    if (!ready || hidden.current) {
      return;
    }
    hidden.current = true;
    // fade so the placeholder logo dissolves into the first screen rather than
    // popping; errors are swallowed (a missing splash must never crash the app).
    BootSplash.hide({ fade: true }).catch(() => {});
  }, [ready]);
}

/** Renders nothing; binds the bootsplash hide to its own mount. */
function Splash(): null {
  useHideBootSplash(true);
  return null;
}

export default Splash;
