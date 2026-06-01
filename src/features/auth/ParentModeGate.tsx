/**
 * ParentModeGate — biometric/PIN gate around the parent monitoring UI (DMY-10).
 *
 * Wraps the parent screen so it is only revealed after authentication when the
 * lock is enabled:
 *  - `settings.biometricLockEnabled === false` (default, opt-in feature off)
 *    -> render `children` immediately. Behaviour is unchanged from before this
 *       feature: no gate, no prompt.
 *  - `settings.biometricLockEnabled === true` -> render {@link LockScreen} until
 *    the user authenticates (Face ID/Touch ID/biometric, or PIN fallback), then
 *    render `children`.
 *
 * The unlocked state is component-local: it lasts for as long as this gate is
 * mounted (i.e. the current visit to parent mode) and is re-evaluated on the
 * next mount. Nothing about the unlock is persisted.
 */
import { useCallback, useState } from 'react';

import { useAppStore } from '../../store/useAppStore';
import LockScreen from './screens/LockScreen';

export interface ParentModeGateProps {
  children: React.ReactNode;
}

function ParentModeGate({ children }: ParentModeGateProps) {
  const biometricLockEnabled = useAppStore(
    s => s.settings.biometricLockEnabled,
  );
  const [unlocked, setUnlocked] = useState(false);

  const onUnlock = useCallback(() => setUnlocked(true), []);

  if (biometricLockEnabled && !unlocked) {
    return <LockScreen onUnlock={onUnlock} />;
  }

  return <>{children}</>;
}

export default ParentModeGate;
