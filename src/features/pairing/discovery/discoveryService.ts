/**
 * discoveryService — mDNS/Bonjour local discovery orchestration (DMY-7).
 *
 * Two roles, one service type ({@link DISCOVERY_SERVICE_TYPE}):
 *  - baby-unit  : `startPublishing(sessionId)` advertises a service whose TXT
 *    record carries only the ephemeral session id + schema version (no PII, no
 *    secrets). `stopPublishing()` withdraws it. Idempotent.
 *  - parent-unit: `startScanning()` browses the LAN and maintains a list of
 *    RESOLVED baby-units (name/host/port + parsed sessionId). `stopScanning()`
 *    stops the browse and clears the list. Subscribers get notified on change.
 *
 * ## Design boundary (HONEST)
 * The JS layer owns ONLY: event wiring, the resolved-units list, TXT
 * (de)serialisation, validation and idempotency. The actual mDNS traffic is
 * whatever {@link ZeroconfBackend} is injected. The default backend
 * ({@link createZeroconfBackend}) adapts react-native-zeroconf; under Jest / a
 * bare JS context / before the native module is available it transparently
 * falls back to {@link noopZeroconfBackend} so nothing throws. Discovery
 * surfaces a connectable endpoint (host/port) + sessionId for the FUTURE WebRTC
 * signalling handshake (DMY-16/18) — it does NOT itself connect.
 *
 * ## Privacy
 * Logs only coarse, non-PII facts. The session id is logged through the
 * redacting logger, which masks `sessionId` (an exact redactor key), so it
 * never prints in the clear; we also avoid printing host/port and never log
 * the raw TXT map verbatim.
 */
import { logger } from '../../../services/logger';
import { isValidSessionId } from '../pairingService';
import { PAIRING_PAYLOAD_VERSION } from '../types';
import {
  DISCOVERY_DOMAIN,
  DISCOVERY_PROTOCOL,
  DISCOVERY_SERVICE_NAME,
  isKnownPairingVersion,
  TXT_KEY_SESSION_ID,
  TXT_KEY_VERSION,
  type DiscoveredBabyUnit,
  type PublishServiceConfig,
  type ZeroconfBackend,
  type ZeroconfResolvedService,
} from './types';

/**
 * Default port advertised for the (future) signalling endpoint. WebRTC does not
 * exist yet (DMY-16/18), so this is a PLACEHOLDER: it makes the advertised
 * service well-formed (Bonjour requires a port) and gives the parent a concrete
 * endpoint to aim signalling at later. The real port is decided when the
 * signalling listener is implemented.
 */
export const DEFAULT_SIGNALLING_PORT = 8443;

/**
 * Build the TXT record + a deterministic-ish instance name for a session.
 *
 * The instance name embeds a short slice of the session id so two baby-units on
 * the same LAN don't collide, WITHOUT exposing the full id in the (also-visible)
 * service name — the full id lives in the TXT record where the parent reads it.
 */
export function buildPublishConfig(
  sessionId: string,
  port: number = DEFAULT_SIGNALLING_PORT,
): PublishServiceConfig {
  // First UUID group (8 hex) is plenty to disambiguate instances on one LAN.
  const shortId = sessionId.slice(0, 8);
  return {
    name: `mbs-${shortId}`,
    port,
    txt: {
      [TXT_KEY_SESSION_ID]: sessionId,
      [TXT_KEY_VERSION]: String(PAIRING_PAYLOAD_VERSION),
    },
  };
}

/**
 * Parse a resolved zeroconf service into a {@link DiscoveredBabyUnit}, or
 * `null` if it is not a well-formed advertisement from our app.
 *
 * Rejects (returns null) when: host/port missing or invalid, the TXT record has
 * no/invalid `sid` (not a UUID v4 → not our advertisement, or corrupt). A
 * present-but-unknown `v` is tolerated (kept as undefined) so a NEWER baby-unit
 * still appears — the parent can still attempt to pair; gating richer behaviour
 * on version is deferred to signalling.
 */
export function parseResolvedService(
  service: ZeroconfResolvedService,
): DiscoveredBabyUnit | null {
  const { name, host, port, txt } = service;
  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }
  if (typeof host !== 'string' || host.length === 0) {
    return null;
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0) {
    return null;
  }
  if (txt === null || typeof txt !== 'object') {
    return null;
  }

  const rawSid = (txt as Record<string, unknown>)[TXT_KEY_SESSION_ID];
  const sessionId = typeof rawSid === 'string' ? rawSid : undefined;
  if (!sessionId || !isValidSessionId(sessionId)) {
    return null;
  }

  const rawVersion = (txt as Record<string, unknown>)[TXT_KEY_VERSION];
  let version: typeof PAIRING_PAYLOAD_VERSION | undefined;
  if (typeof rawVersion === 'string' && rawVersion.length > 0) {
    const parsed = Number(rawVersion);
    if (Number.isFinite(parsed) && isKnownPairingVersion(parsed)) {
      version = parsed;
    }
  }

  return {
    name,
    host,
    port,
    sessionId,
    ...(version !== undefined ? { version } : {}),
  };
}

/**
 * Safe no-op backend used when no native zeroconf module is available (Jest,
 * bare JS, or before the native bridge is linked). Satisfies the contract
 * without touching any network API. Scanning yields an empty list; publishing
 * is a no-op. This is the same "fail safe, never throw" posture as
 * powerSaver's noopBackend.
 */
export const noopZeroconfBackend: ZeroconfBackend = {
  scan: () => {},
  stop: () => {},
  publish: () => {},
  unpublish: () => {},
  on: () => {},
  removeListeners: () => {},
};

/** Run a backend call, swallowing+logging any error so it never propagates. */
function safe(label: string, fn: () => void): void {
  try {
    fn();
  } catch {
    logger.warn('discovery: backend call failed', { op: label });
  }
}

/** Listener notified when the discovered-units list changes. */
export type DiscoveryListener = (units: readonly DiscoveredBabyUnit[]) => void;

/**
 * Stateful discovery controller. One instance per role/session (the hook owns
 * it). Drive the parent side with {@link startScanning}/{@link stopScanning}
 * and subscribe via {@link subscribe}; drive the baby side with
 * {@link startPublishing}/{@link stopPublishing}.
 */
export class DiscoveryService {
  private readonly backend: ZeroconfBackend;

  /** Resolved baby-units keyed by Bonjour instance name. */
  private readonly units = new Map<string, DiscoveredBabyUnit>();

  /** Change subscribers (the hook). */
  private readonly listeners = new Set<DiscoveryListener>();

  /** Whether a browse is currently active (idempotency guard). */
  private scanning = false;

  /** The instance name we published, while publishing (idempotency guard). */
  private publishedName: string | null = null;

  /** Whether backend event handlers are wired (wired lazily, once). */
  private wired = false;

  constructor(backend: ZeroconfBackend = noopZeroconfBackend) {
    this.backend = backend;
  }

  /** Whether a browse is currently running. */
  get isScanning(): boolean {
    return this.scanning;
  }

  /** Whether a service is currently published. */
  get isPublishing(): boolean {
    return this.publishedName !== null;
  }

  /** Snapshot of currently-resolved baby-units (UI-friendly array). */
  getUnits(): readonly DiscoveredBabyUnit[] {
    return Array.from(this.units.values());
  }

  /**
   * Subscribe to discovered-units changes. Returns an unsubscribe function. The
   * listener is invoked immediately with the current snapshot so a late
   * subscriber is not stuck on an empty list.
   */
  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getUnits());
    } catch {
      // A subscriber must never crash the service.
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getUnits();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Isolate a misbehaving subscriber.
      }
    }
  }

  /** Wire backend event handlers exactly once. */
  private ensureWired(): void {
    if (this.wired) {
      return;
    }
    this.wired = true;

    safe('on:resolved', () =>
      this.backend.on('resolved', service => {
        const unit = parseResolvedService(service);
        if (!unit) {
          // Not one of our well-formed advertisements (foreign/corrupt) — drop.
          logger.debug('discovery: ignored unresolvable service');
          return;
        }
        this.units.set(unit.name, unit);
        // sessionId is masked by the redacting logger; host/port omitted.
        logger.info('discovery: baby-unit resolved', {
          sessionId: unit.sessionId,
        });
        this.notify();
      }),
    );

    safe('on:removed', () =>
      this.backend.on('removed', name => {
        if (this.units.delete(name)) {
          logger.info('discovery: baby-unit removed');
          this.notify();
        }
      }),
    );

    safe('on:error', () =>
      this.backend.on('error', () => {
        // Never fatal: log a coarse fact and keep going.
        logger.warn('discovery: backend reported an error');
      }),
    );
  }

  /**
   * Parent-unit: start browsing the LAN for baby-units. Idempotent — a second
   * call while already scanning is a no-op. Never throws.
   */
  startScanning(): void {
    this.ensureWired();
    if (this.scanning) {
      return;
    }
    this.scanning = true;
    this.units.clear();
    this.notify();
    safe('scan', () => this.backend.scan());
    logger.info('discovery: scan started');
  }

  /**
   * Parent-unit: stop browsing and clear the resolved list. Idempotent — a stop
   * with no active scan is a safe no-op. Never throws.
   */
  stopScanning(): void {
    if (!this.scanning) {
      return;
    }
    this.scanning = false;
    safe('stop', () => this.backend.stop());
    this.units.clear();
    this.notify();
    logger.info('discovery: scan stopped');
  }

  /**
   * Baby-unit: advertise a service for `sessionId`. Idempotent for the SAME
   * session; advertising a DIFFERENT session first withdraws the previous one
   * (a regenerated session id must not leave a stale advertisement on the LAN).
   * Never throws.
   */
  startPublishing(
    sessionId: string,
    port: number = DEFAULT_SIGNALLING_PORT,
  ): void {
    if (!isValidSessionId(sessionId)) {
      // Defensive: a malformed id would publish an unparseable advertisement.
      logger.warn('discovery: refused to publish invalid session id');
      return;
    }
    const config = buildPublishConfig(sessionId, port);

    if (this.publishedName === config.name) {
      return;
    }
    // Withdraw any previously-published (different) service first.
    if (this.publishedName !== null) {
      this.stopPublishing();
    }

    this.publishedName = config.name;
    safe('publish', () => this.backend.publish(config));
    logger.info('discovery: publishing baby-unit', { sessionId });
  }

  /**
   * Baby-unit: withdraw the advertised service. Idempotent — a stop with
   * nothing published is a safe no-op. Never throws.
   */
  stopPublishing(): void {
    if (this.publishedName === null) {
      return;
    }
    const name = this.publishedName;
    this.publishedName = null;
    safe('unpublish', () => this.backend.unpublish(name));
    logger.info('discovery: stopped publishing baby-unit');
  }

  /**
   * Tear everything down: stop scan, unpublish, drop subscribers and remove
   * backend listeners. Safe to call multiple times. Never throws.
   */
  dispose(): void {
    this.stopScanning();
    this.stopPublishing();
    this.listeners.clear();
    if (this.wired) {
      safe('removeListeners', () => this.backend.removeListeners());
      this.wired = false;
    }
  }
}

/** Convenience factory mirroring the project's service-style constructors. */
export function createDiscoveryService(
  backend?: ZeroconfBackend,
): DiscoveryService {
  return new DiscoveryService(backend);
}

/**
 * Real react-native-zeroconf adapter (lazy-loaded, fail-safe).
 *
 * The native module is required ONLY when this factory is called and ONLY if it
 * actually exposes the native side; any failure (module absent, NativeModule
 * not linked, constructor throws) degrades to {@link noopZeroconfBackend} so the
 * app keeps running. This keeps Jest/bare-JS contexts working with zero config
 * and matches the project's "abstract behind a service + no-op fallback"
 * convention (powersaver, audio-source).
 *
 * NOTE: not exercised by the unit suite (it touches the native module); the
 * unit tests drive a fake backend through the {@link ZeroconfBackend} contract.
 */
/* istanbul ignore next -- native adapter; unit tests use a fake backend. */
export function createZeroconfBackend(): ZeroconfBackend {
  try {
    // Required lazily so importing this module under Jest does not pull the
    // native side. Resolved through require to keep it out of the type graph.
    const Zeroconf = require('react-native-zeroconf').default;
    const zeroconf = new Zeroconf();

    return {
      scan: () =>
        zeroconf.scan(
          DISCOVERY_SERVICE_NAME,
          DISCOVERY_PROTOCOL,
          DISCOVERY_DOMAIN,
        ),
      stop: () => zeroconf.stop(),
      publish: (config: PublishServiceConfig) =>
        zeroconf.publishService(
          DISCOVERY_SERVICE_NAME,
          DISCOVERY_PROTOCOL,
          DISCOVERY_DOMAIN,
          config.name,
          config.port,
          { ...config.txt },
        ),
      unpublish: (name: string) => zeroconf.unpublishService(name),
      on: (event, handler) => {
        // Map our small event set onto the library's event names.
        if (event === 'resolved') {
          zeroconf.on('resolved', handler as (s: unknown) => void);
        } else if (event === 'removed') {
          zeroconf.on('remove', handler as (n: string) => void);
        } else if (event === 'error') {
          zeroconf.on('error', handler as (e: unknown) => void);
        }
      },
      removeListeners: () => zeroconf.removeDeviceListeners(),
    };
  } catch {
    logger.warn(
      'discovery: native zeroconf unavailable — using no-op backend',
    );
    return noopZeroconfBackend;
  }
}
