/**
 * Types for local-network discovery of baby-units over mDNS/Bonjour (DMY-7).
 *
 * Both phones on the SAME Wi-Fi network can find each other WITHOUT scanning a
 * QR code: the baby-unit advertises a Bonjour/mDNS service, and the parent-unit
 * browses for it. This is the privacy-first, no-cloud sibling of the QR path
 * (DMY-6/14) — discovery never leaves the local link.
 *
 * ## Service type
 * We advertise under {@link DISCOVERY_SERVICE_TYPE} (`_mobilebabysitter._tcp`).
 * A dedicated, app-specific service type means a parent-unit browse only ever
 * surfaces OUR baby-units, never unrelated `_http`/`_airplay`/etc. services on
 * the LAN.
 *
 * ## What the TXT record may carry (privacy contract)
 * The TXT record is broadcast in the clear on the local link, so it carries the
 * MINIMUM needed to recognise and route to a session — the SAME bar as the QR
 * payload (see `../types.ts`). Concretely it carries only:
 *   - `sid`     — the ephemeral, per-session {@link PairingPayload.sessionId}
 *     (a random UUID v4; not derived from device/user, useless after the
 *     session). This is what lets a parent match a discovered unit to a pairing
 *     attempt and bootstrap signalling.
 *   - `v`       — the pairing payload schema version, so an old parent app
 *     degrades gracefully against a newer baby-unit.
 *
 * It carries NO account identifiers, NO long-lived secrets, NO SDP/ICE, and NO
 * personal data. The session id is NOT a secret in the cryptographic sense (it
 * is also shown in the QR), but the redactor still masks `sessionId` in logs
 * (an exact redactor key) so we never print it in the clear (defence-in-depth,
 * matching the QR path).
 *
 * ## Honest scope
 * Discovery surfaces a baby-unit's name/host/port + its session id. It does NOT
 * establish a connection: the real WebRTC signalling handshake is DMY-16/18.
 * Selecting a discovered unit records the SAME `paired` state the QR scanner
 * records (sessionId + `connectionStatus: 'paired'`), and the signalling
 * kick-off is the same TODO. We never fake a live media session.
 */
import {
  PAIRING_PAYLOAD_VERSION,
  type PairingPayloadVersion,
} from '../types';

/**
 * The Bonjour/mDNS service TYPE the baby-unit advertises and the parent-unit
 * browses for. Note: react-native-zeroconf splits this into `type` +
 * `protocol`; see {@link DISCOVERY_SERVICE_NAME} / {@link DISCOVERY_PROTOCOL}.
 * The combined string is what appears on the wire and in Info.plist
 * `NSBonjourServices`.
 */
export const DISCOVERY_SERVICE_TYPE = '_mobilebabysitter._tcp' as const;

/** The service-name component zeroconf wants (the `_mobilebabysitter` half). */
export const DISCOVERY_SERVICE_NAME = 'mobilebabysitter' as const;

/** The transport-protocol component zeroconf wants (the `tcp` half). */
export const DISCOVERY_PROTOCOL = 'tcp' as const;

/** Local mDNS domain. */
export const DISCOVERY_DOMAIN = 'local.' as const;

/** TXT record key carrying the ephemeral pairing session id. */
export const TXT_KEY_SESSION_ID = 'sid' as const;

/** TXT record key carrying the pairing payload schema version. */
export const TXT_KEY_VERSION = 'v' as const;

/**
 * The minimal, privacy-reviewed TXT record we publish. Keep this in lockstep
 * with the privacy contract above — adding a field here is a privacy decision.
 */
export interface DiscoveryTxtRecord {
  /** Ephemeral pairing session id (UUID v4). See {@link TXT_KEY_SESSION_ID}. */
  readonly [TXT_KEY_SESSION_ID]: string;
  /** Pairing payload schema version. See {@link TXT_KEY_VERSION}. */
  readonly [TXT_KEY_VERSION]: string;
}

/**
 * A baby-unit the parent-unit has discovered (and resolved) on the LAN.
 *
 * `host`/`port` are present once the service has been RESOLVED; a service that
 * has only been "found" (announced but not yet resolved) is not surfaced to the
 * UI as connectable. `sessionId` is parsed out of the TXT record and validated
 * as a UUID v4 — a discovered unit with no/invalid session id is dropped (it is
 * not one of our well-formed advertisements).
 */
export interface DiscoveredBabyUnit {
  /** The Bonjour service instance name (unique on the LAN; the map key). */
  readonly name: string;
  /** Resolved host (IP or .local hostname). */
  readonly host: string;
  /** Resolved TCP port the baby-unit listens on for signalling. */
  readonly port: number;
  /** Ephemeral pairing session id parsed from the TXT record (UUID v4). */
  readonly sessionId: string;
  /** Advertised pairing payload schema version, if parseable. */
  readonly version?: PairingPayloadVersion;
}

/**
 * Raw service object as delivered by the zeroconf `resolved` event. We model
 * only the fields we consume; the real object carries more (addresses,
 * fullName, etc.) that we deliberately ignore.
 */
export interface ZeroconfResolvedService {
  readonly name: string;
  readonly host?: string;
  readonly port?: number;
  readonly txt?: Record<string, unknown> | null;
}

/** Service descriptor the baby-unit publishes. */
export interface PublishServiceConfig {
  /** Bonjour instance name (e.g. `mbs-<short>`); unique on the LAN. */
  readonly name: string;
  /** TCP port advertised for the (future) signalling endpoint. */
  readonly port: number;
  /** TXT record — sessionId + version only. See {@link DiscoveryTxtRecord}. */
  readonly txt: DiscoveryTxtRecord;
}

/**
 * The events a {@link ZeroconfBackend} surfaces to the discovery service. A
 * deliberately small subset of the library's event set — enough to maintain the
 * resolved-units list and report failures, nothing native-specific leaks here.
 */
export interface ZeroconfBackendEvents {
  /** A matching service was resolved (host/port/txt now known). */
  resolved: (service: ZeroconfResolvedService) => void;
  /** A previously-seen service went away (by instance name). */
  removed: (name: string) => void;
  /** The backend reported an error. Never fatal — logged, scanning continues. */
  error: (error: unknown) => void;
}

/**
 * Abstraction over the native zeroconf module (react-native-zeroconf).
 *
 * This is the SINGLE integration point for the native dependency. Production
 * wires {@link createZeroconfBackend} (the real adapter); tests inject a fake
 * that drives `resolved`/`removed`/`error` synchronously; and when no native
 * module is present the service falls back to {@link noopZeroconfBackend} so
 * nothing throws (mirrors the powersaver/audio-source pattern).
 *
 * Every method MUST be safe to call (never throw) — the discovery service wraps
 * them defensively, but a well-behaved backend should not surface rejections.
 */
export interface ZeroconfBackend {
  /** Start browsing for {@link DISCOVERY_SERVICE_TYPE} services on the LAN. */
  scan(): void;
  /** Stop the current browse, if any. */
  stop(): void;
  /** Publish (advertise) a baby-unit service. */
  publish(config: PublishServiceConfig): void;
  /** Unpublish a previously-published service by instance name. */
  unpublish(name: string): void;
  /**
   * Subscribe to a backend event. Returns nothing; use {@link removeListeners}
   * to tear all subscriptions down. The same handler set is used for the whole
   * service lifetime.
   */
  on<K extends keyof ZeroconfBackendEvents>(
    event: K,
    handler: ZeroconfBackendEvents[K],
  ): void;
  /** Remove ALL listeners this service registered. */
  removeListeners(): void;
}

/**
 * Whether `v` is a valid pairing payload version we understand. Currently only
 * {@link PAIRING_PAYLOAD_VERSION}.
 */
export function isKnownPairingVersion(v: number): v is PairingPayloadVersion {
  return v === PAIRING_PAYLOAD_VERSION;
}
