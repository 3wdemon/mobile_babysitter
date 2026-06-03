/**
 * Reconnect backoff policy + controller (DMY-61).
 *
 * When a previously-connected P2P session drops UNCLEANLY (the peer connection
 * reports `disconnected`/`failed` rather than a user-initiated stop), the
 * monitor should try to come back on its own instead of silently dying. This
 * module owns the *policy* for how those re-attempts are paced: exponential
 * backoff (1s, 2s, 4s, …) capped at a ceiling, with optional jitter, and a hard
 * cap on the number of attempts so a permanently-down link does NOT spin in an
 * infinite reconnect loop.
 *
 * ## Scope boundary (does NOT duplicate teardown — DMY-45)
 * This layer adds ONLY the retry/backoff timing. It does not tear the session
 * down, send `bye`, or re-establish the transport itself — the hook
 * ({@link useSignaling}) owns that. The controller simply tells the hook *when*
 * to make the next attempt and *when to stop*. Distinguishing a clean remote
 * `bye` from an unclean drop is the DMY-45 concern; until that lands the hook
 * suppresses reconnect on local `stop()` only (see useSignaling for the honest
 * boundary).
 *
 * ## Pure + injectable (HONEST)
 * {@link nextDelayMs} is a pure function. The controller owns NO wall-clock and
 * NO randomness source of its own: the timer primitives (`setTimer`/`clearTimer`,
 * mirroring {@link createIceTimeout}) and the jitter RNG are INJECTED, defaulting
 * to the host `setTimeout`/`clearTimeout` and `Math.random`. Tests pass a fake
 * scheduler and a deterministic RNG, so every delay and the attempt cap are
 * exhaustively unit-testable with no real timers and no flakiness — we never call
 * `Math.random()` directly.
 */
import type { SetTimer, ClearTimer } from './iceTimeout';

/** Base backoff (ms): the delay before the FIRST reconnect attempt. */
export const RECONNECT_BASE_MS = 1000;
/** Upper bound (ms) on a single backoff delay after exponential growth. */
export const RECONNECT_MAX_DELAY_MS = 30_000;
/**
 * Hard cap on reconnect attempts before giving up. Reaching it STOPS the loop
 * and surfaces a permanent failure (manual retry only) — this is what prevents
 * an infinite reconnect loop on a link that is never coming back.
 */
export const RECONNECT_MAX_ATTEMPTS = 5;

/** Re-export the injected timer primitive types for callers/tests. */
export type { SetTimer, ClearTimer } from './iceTimeout';

/** Inject the jitter RNG; must return a value in `[0, 1)` like `Math.random`. */
export type Rng = () => number;

/** Tunable backoff parameters. Defaults are the exported named constants. */
export interface ReconnectPolicy {
  /** Base delay (ms) for attempt 0; doubled per attempt. */
  readonly baseMs: number;
  /** Ceiling (ms) for a single delay after exponential growth. */
  readonly maxDelayMs: number;
  /** Maximum number of attempts before giving up permanently. */
  readonly maxAttempts: number;
  /**
   * Jitter as a fraction of the computed delay, in `[0, 1]`. `0` disables
   * jitter (fully deterministic 1s/2s/4s…). A value of e.g. `0.2` spreads the
   * delay across `[delay, delay * 1.2)` using the injected RNG, to avoid a
   * thundering-herd of synchronised reconnects. Defaults to `0`.
   */
  readonly jitterRatio: number;
}

/** Default policy: 1s base, 30s cap, 5 attempts, no jitter. */
export const DEFAULT_RECONNECT_POLICY: Readonly<ReconnectPolicy> =
  Object.freeze({
    baseMs: RECONNECT_BASE_MS,
    maxDelayMs: RECONNECT_MAX_DELAY_MS,
    maxAttempts: RECONNECT_MAX_ATTEMPTS,
    jitterRatio: 0,
  });

/**
 * PURE: the delay (ms) before the `attempt`-th reconnect (0-indexed).
 *
 * `min(base * 2^attempt, maxDelay)` plus optional jitter. With `jitterRatio = 0`
 * (the default) this is a deterministic 1s, 2s, 4s, 8s, … capped at `maxDelay`.
 * With jitter, the injected `rng` (default `Math.random`) spreads the result
 * across `[delay, delay * (1 + jitterRatio))`; passing a fixed `rng` makes the
 * value deterministic in tests. The jitter is applied AFTER the cap so the
 * worst-case delay is bounded by `maxDelay * (1 + jitterRatio)`.
 *
 * A negative `attempt` is clamped to `0`.
 */
export function nextDelayMs(
  attempt: number,
  policy: ReconnectPolicy = DEFAULT_RECONNECT_POLICY,
  rng: Rng = Math.random,
): number {
  const n = attempt > 0 ? attempt : 0;
  const exponential = policy.baseMs * 2 ** n;
  const capped = Math.min(exponential, policy.maxDelayMs);
  if (policy.jitterRatio <= 0) {
    return capped;
  }
  // Spread across [capped, capped * (1 + jitterRatio)). rng() ∈ [0, 1).
  return capped + capped * policy.jitterRatio * rng();
}

/** Options for {@link createReconnectController}. */
export interface ReconnectControllerOptions {
  /**
   * Make one reconnect attempt. The hook re-runs its connect path here (it owns
   * teardown/re-establish; this controller only schedules the call). Pure timing
   * concern: the controller does not interpret the attempt's outcome — the host
   * feeds the resulting peer state back via {@link ReconnectController.onState}.
   */
  readonly attemptReconnect: () => void;
  /**
   * Called ONCE when {@link ReconnectPolicy.maxAttempts} attempts have been
   * scheduled without reaching `connected`. The host surfaces a permanent
   * failure (manual retry only) and the controller stops scheduling — this is
   * the no-infinite-loop guarantee.
   */
  readonly onExhausted: () => void;
  /** Backoff parameters. Defaults to {@link DEFAULT_RECONNECT_POLICY}. */
  readonly policy?: ReconnectPolicy;
  /** Injected `setTimeout`. Defaults to the global. Tests pass a fake. */
  readonly setTimer?: SetTimer;
  /** Injected `clearTimeout`. Defaults to the global. Tests pass a fake. */
  readonly clearTimer?: ClearTimer;
  /** Injected jitter RNG. Defaults to `Math.random`. Tests pass a fixed fn. */
  readonly rng?: Rng;
}

/** Live view of the reconnect controller for the UI/host. */
export interface ReconnectSnapshot {
  /** Whether a reconnect attempt is currently scheduled/in flight. */
  readonly reconnecting: boolean;
  /** 1-based number of the attempt currently scheduled (0 when idle). */
  readonly attempt: number;
  /** Delay (ms) before the currently-scheduled attempt fires (0 when idle). */
  readonly nextRetryInMs: number;
  /** `true` once attempts are exhausted: stopped, awaiting a manual retry. */
  readonly failedPermanently: boolean;
}

/** Live reconnect controller. */
export interface ReconnectController {
  /**
   * Feed a real peer-connection-derived session state. Edge-sensitive:
   *  - entering `disconnected`/`failed` after having been `connected` (or while
   *    already retrying) → schedule the next backoff attempt (or exhaust);
   *  - entering `connected` → success: reset the backoff and stop retrying;
   *  - other states are observed for the connected/disconnected edge only.
   */
  onState(state: PeerLikeState): void;
  /**
   * Manual retry after permanent failure: resets the attempt counter and
   * schedules a fresh attempt immediately (delay for attempt 0). No-op while a
   * retry is already pending. This is the "Connection lost — Retry" affordance.
   */
  retry(): void;
  /** Cancel any pending attempt without firing. Idempotent. Use on teardown. */
  cancel(): void;
  /** Reset to the initial state (backoff + counters + permanent-failure flag). */
  reset(): void;
  /** Current snapshot for the UI. */
  snapshot(): ReconnectSnapshot;
}

/**
 * The subset of session/peer states the controller reacts to. Mirrors the
 * relevant {@link PeerConnectionState} values plus `connecting`; kept local so
 * this policy module has no dependency on the peer-connection types beyond what
 * it needs.
 */
export type PeerLikeState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

/**
 * Create a reconnect controller (DMY-61).
 *
 * Pure timing: all time flows through the injected scheduler and all randomness
 * through the injected RNG, so a test fully controls when (and whether) an
 * attempt fires and exactly how long the backoff is.
 */
export function createReconnectController(
  options: ReconnectControllerOptions,
): ReconnectController {
  const {
    attemptReconnect,
    onExhausted,
    policy = DEFAULT_RECONNECT_POLICY,
    setTimer = (cb, ms) => setTimeout(cb, ms),
    clearTimer = handle =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
    rng = Math.random,
  } = options;

  let handle: unknown = null;
  /** 0-based index of the NEXT attempt to schedule in the current retry burst. */
  let attempt = 0;
  /** Delay of the currently-scheduled attempt (for the snapshot). */
  let scheduledDelay = 0;
  let reconnecting = false;
  let failedPermanently = false;
  /**
   * `true` between firing an attempt's timer and observing its outcome. While
   * set, a `disconnected`/`failed` is the in-flight attempt FAILING, so we
   * schedule the NEXT backoff step rather than ignoring it. Cleared on the next
   * `schedule()` or on success/cancel.
   */
  let attemptInFlight = false;
  /**
   * Whether we have ever observed `connected`. A drop is only "unclean and worth
   * retrying" once a connection actually existed; a never-connected initial
   * `connecting → failed` is the handshake's own concern (and the ICE timeout's),
   * not a reconnect.
   */
  let everConnected = false;

  function disarm(): void {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  }

  /** Schedule the current `attempt`, or exhaust if past the cap. */
  function schedule(): void {
    if (attempt >= policy.maxAttempts) {
      // No more attempts: stop, mark permanent failure, signal the host once.
      disarm();
      reconnecting = false;
      scheduledDelay = 0;
      failedPermanently = true;
      onExhausted();
      return;
    }
    const delay = nextDelayMs(attempt, policy, rng);
    scheduledDelay = delay;
    reconnecting = true;
    failedPermanently = false;
    attemptInFlight = false;
    disarm();
    handle = setTimer(() => {
      // Fire is one-shot per scheduling: drop the handle and advance the counter
      // BEFORE invoking the attempt so a re-entrant onState() sees the next
      // attempt index. Mark the attempt in flight so its failure schedules the
      // next backoff step rather than being ignored as "already retrying".
      handle = null;
      attempt += 1;
      attemptInFlight = true;
      attemptReconnect();
    }, delay);
  }

  return {
    onState(state: PeerLikeState): void {
      switch (state) {
        case 'connected':
          // Success: a live link is back. Reset the backoff fully so a LATER
          // drop starts again at attempt 0 (1s), and stop retrying.
          everConnected = true;
          disarm();
          attempt = 0;
          scheduledDelay = 0;
          reconnecting = false;
          failedPermanently = false;
          attemptInFlight = false;
          break;
        case 'disconnected':
        case 'failed':
          // An unclean drop. Ignore if a connection never existed (a
          // never-connected handshake failure is the handshake's / ICE timeout's
          // concern, not a reconnect) or we already gave up permanently.
          if (!everConnected || failedPermanently) {
            return;
          }
          // If a backoff timer is pending (not yet fired), this drop is redundant
          // churn before the scheduled attempt — do not stack a second timer.
          if (reconnecting && !attemptInFlight) {
            return;
          }
          // Either the first drop after a live connection, or the in-flight
          // attempt itself failing → schedule the next backoff step (or exhaust).
          schedule();
          break;
        case 'connecting':
        case 'new':
        case 'closed':
        default:
          // No reconnect decision on these. `connecting` is the in-flight attempt
          // making progress; `closed` is a definite teardown the host drives via
          // cancel(); `new` carries no obligation.
          break;
      }
    },

    retry(): void {
      // Manual retry clears the permanent-failure state and restarts the burst
      // from attempt 0. Treat a manual retry as if we had a connection to come
      // back to (the user explicitly asked).
      everConnected = true;
      failedPermanently = false;
      attempt = 0;
      schedule();
    },

    cancel(): void {
      disarm();
      reconnecting = false;
      scheduledDelay = 0;
      attemptInFlight = false;
    },

    reset(): void {
      disarm();
      attempt = 0;
      scheduledDelay = 0;
      reconnecting = false;
      failedPermanently = false;
      everConnected = false;
      attemptInFlight = false;
    },

    snapshot(): ReconnectSnapshot {
      return {
        reconnecting,
        // 1-based for the UI ("attempt N"): the timer for the 0-based `attempt`
        // index represents the (attempt + 1)-th try.
        attempt: reconnecting ? attempt + 1 : 0,
        nextRetryInMs: reconnecting ? scheduledDelay : 0,
        failedPermanently,
      };
    },
  };
}
