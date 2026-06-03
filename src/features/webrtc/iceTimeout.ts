/**
 * ICE connect-timeout controller (DMY-47).
 *
 * STUN-only ICE (DMY-47) reaches most home NATs but CANNOT traverse symmetric
 * NAT on both ends — the case that would otherwise need a paid TURN relay
 * (DMY-19). When that happens the peer connection sits in `connecting` forever
 * with no error: the native stack just never reports `connected`. A monitor that
 * hangs silently is worse than one that says "this isn't working" — so this
 * controller arms a single timer when negotiation enters `connecting` and, if
 * `connected` has not arrived within {@link ICE_CONNECT_TIMEOUT_MS}, fires once to
 * tell the UI to show guidance ("check Wi-Fi / restart connection").
 *
 * ## Pure + injectable (HONEST)
 * The controller owns NO wall-clock: the timer primitives (`setTimer` /
 * `clearTimer`) are INJECTED, defaulting to the host `setTimeout`/`clearTimeout`.
 * Tests pass a fake scheduler and advance it deterministically — no real timers,
 * no flake. The controller never inspects `Date.now()`; "elapsed" is entirely the
 * injected scheduler's concern. It also never derives `connected` itself — it is
 * DRIVEN by the genuine peer-connection state transitions fed to {@link onState}.
 *
 * ## State model (why a controller, not a one-shot policy)
 * The trigger is edge-sensitive across a SEQUENCE of states (a real connection
 * may go `new → connecting → connected`, or churn `connecting → disconnected →
 * connecting`), so the correct unit is a small state machine, not a stateless
 * `tick(now)` predicate:
 *   - entering `connecting`     → (re)arm the timer if not already armed;
 *   - entering `connected`      → CANCEL the pending timer (this is what prevents
 *     false guidance when the link comes up just before the deadline);
 *   - entering `disconnected` / `failed` / `closed` → cancel too (a definite
 *     outcome already happened; the timeout's job is only to catch the SILENT
 *     hang, and `failed` will surface its own error path);
 *   - the timer firing          → invoke `onTimeout` exactly once and disarm.
 *
 * The fire is one-shot per arming: re-entering `connecting` after a cancel
 * re-arms a fresh timer (so a reconnect attempt is given its own full window).
 */
import type { PeerConnectionState } from './signalingTypes';

/**
 * How long ICE may stay in `connecting` before we conclude STUN-only traversal
 * has likely failed and show guidance. 10s is long enough for a normal
 * STUN round-trip + checks on a home network, short enough that a parent setting
 * up the monitor is not left staring at a spinner.
 */
export const ICE_CONNECT_TIMEOUT_MS = 10_000;

/** Inject `setTimeout`; returns an opaque handle the matching clear understands. */
export type SetTimer = (callback: () => void, delayMs: number) => unknown;
/** Inject `clearTimeout`; receives a handle previously returned by {@link SetTimer}. */
export type ClearTimer = (handle: unknown) => void;

/** Options for {@link createIceTimeout}. */
export interface IceTimeoutOptions {
  /**
   * Called ONCE when the connect window elapses without reaching `connected`.
   * The hook maps this to a UI guidance flag. Never called after a `connected`
   * (or other terminal) transition cancelled the timer.
   */
  readonly onTimeout: () => void;
  /** Window length; defaults to {@link ICE_CONNECT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Injected `setTimeout`. Defaults to the global. Tests pass a fake. */
  readonly setTimer?: SetTimer;
  /** Injected `clearTimeout`. Defaults to the global. Tests pass a fake. */
  readonly clearTimer?: ClearTimer;
}

/** Live ICE timeout controller. */
export interface IceTimeout {
  /**
   * Feed a peer-connection state transition. Idempotent on repeats of the same
   * state (re-arms only on a genuine ENTRY into `connecting`).
   */
  onState(state: PeerConnectionState): void;
  /** Cancel any pending timer without firing. Idempotent. Use on teardown. */
  cancel(): void;
  /** Whether a timer is currently armed (diagnostic / test aid). */
  isArmed(): boolean;
}

/**
 * Create a pure-ish ICE connect-timeout controller (DMY-47).
 *
 * The controller is "pure" in the sense that it touches no wall-clock and no
 * global state: all time flows through the injected scheduler, so a test fully
 * controls when (and whether) {@link IceTimeoutOptions.onTimeout} fires.
 */
export function createIceTimeout(options: IceTimeoutOptions): IceTimeout {
  const {
    onTimeout,
    timeoutMs = ICE_CONNECT_TIMEOUT_MS,
    // Resolve the host primitives lazily so importing this module never assumes
    // a particular global; tests override both with a fake scheduler.
    setTimer = (cb, ms) => setTimeout(cb, ms),
    clearTimer = handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  let handle: unknown = null;
  /** The state we last armed/cancelled on, to make `onState` edge-sensitive. */
  let lastState: PeerConnectionState | null = null;

  function disarm(): void {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  }

  function arm(): void {
    // Re-arm fresh: a reconnect attempt gets its own full window.
    disarm();
    handle = setTimer(() => {
      // Fire is one-shot: drop the handle BEFORE the callback so a re-entrant
      // onState() inside onTimeout sees a disarmed controller.
      handle = null;
      onTimeout();
    }, timeoutMs);
  }

  return {
    onState(state: PeerConnectionState): void {
      // Edge-sensitive: ignore repeats of the current state (e.g. duplicate
      // `connecting` events must not reset the window and hide a real hang).
      if (state === lastState) {
        return;
      }
      lastState = state;

      switch (state) {
        case 'connecting':
          arm();
          break;
        case 'connected':
        case 'disconnected':
        case 'failed':
        case 'closed':
          // A definite outcome arrived (or the session ended): cancel the
          // pending timer so no false guidance is shown. `connected` is the
          // important happy-path cancel; the others stop a stale timer leaking
          // past teardown / a real failure that has its own surfaced error.
          disarm();
          break;
        case 'new':
        default:
          // `new` carries no obligation; leave any (unlikely) armed timer as-is.
          break;
      }
    },

    cancel(): void {
      disarm();
      // Allow a subsequent `connecting` to re-arm after an explicit cancel.
      lastState = null;
    },

    isArmed(): boolean {
      return handle !== null;
    },
  };
}
