/**
 * Pairing payload contract (DMY-6).
 *
 * The baby-unit encodes a {@link PairingPayload} into a QR code. The parent-unit
 * scans it (DMY-7) and uses it to bootstrap the WebRTC signalling handshake
 * (DMY-16/18). There is NO cloud account anywhere in this flow — the QR carries
 * everything the two phones need to find and connect to each other locally
 * (privacy-first, per product-spec: "Pairing через QR-код, без облачных
 * аккаунтов в локальном режиме").
 *
 * Privacy contract: the payload deliberately carries the MINIMUM needed to
 * establish a session. It is shown on-screen and may be photographed, so it
 * must NOT contain anything sensitive beyond what is strictly required to
 * connect. In particular it carries NO biometric data, NO account identifiers,
 * NO long-lived secrets, and NO personal data. The `sessionId` is an ephemeral,
 * per-session random value (not derived from the device or the user) and is
 * useless once the session ends.
 *
 * Extensibility: WebRTC is not implemented yet, so `connection` is OPTIONAL and
 * its SDP/ICE fields are placeholders. The shape is designed so the real
 * signalling material can be slotted in later WITHOUT a breaking change to the
 * envelope — consumers gate on {@link PAIRING_PAYLOAD_VERSION} and treat an
 * absent `connection` (or absent fields within it) as "not yet negotiated".
 */

/**
 * Schema version of the pairing payload envelope.
 *
 * Bump this when the payload shape changes in a way that older scanners cannot
 * understand. Scanners MUST check it before trusting the rest of the payload so
 * a future, richer payload degrades gracefully on an old app.
 */
export const PAIRING_PAYLOAD_VERSION = 1 as const;

/** The literal version type, derived from the constant. */
export type PairingPayloadVersion = typeof PAIRING_PAYLOAD_VERSION;

/**
 * Placeholder for the WebRTC connection / signalling material.
 *
 * All fields are OPTIONAL on purpose: in this issue (DMY-6) WebRTC does not
 * exist yet, so the baby-unit emits a payload with NO `connection` block (or an
 * empty one). When signalling lands (DMY-16/18) the offer SDP and gathered ICE
 * candidates will be populated here, and an out-of-band/local-discovery hint
 * (mDNS service name, DMY local-discovery) can be carried in `discovery`.
 *
 * NOTE: SDP/ICE are connection-negotiation data, not user secrets, but they are
 * still treated as sensitive by the logger's redactor (keys `sdp`/`candidate`)
 * so they never leak into logs.
 */
export interface PairingConnectionInfo {
  /**
   * The WebRTC offer SDP produced by the baby-unit. Placeholder until DMY-18.
   */
  readonly sdp?: string;
  /**
   * Gathered ICE candidates (trickle disabled / bundled into the QR).
   * Placeholder until DMY-18.
   */
  readonly iceCandidates?: readonly string[];
  /**
   * Optional local-discovery hint (e.g. mDNS/Bonjour service name) so the
   * parent-unit can locate the baby-unit on the LAN without the cloud.
   * Placeholder for the local-discovery issue.
   */
  readonly discovery?: {
    /** mDNS/Bonjour service instance name advertised by the baby-unit. */
    readonly serviceName?: string;
    /** Resolved port, if known at QR-generation time. */
    readonly port?: number;
  };
}

/**
 * The full envelope encoded into the pairing QR code.
 */
export interface PairingPayload {
  /**
   * Discriminator so a scanner can be sure the QR belongs to this app before
   * parsing it. Always the literal {@link PAIRING_TYPE}.
   */
  readonly type: typeof PAIRING_TYPE;
  /** Envelope schema version. See {@link PAIRING_PAYLOAD_VERSION}. */
  readonly version: PairingPayloadVersion;
  /**
   * Ephemeral, cryptographically-random session identifier (UUID v4 string).
   * Uniquely names THIS pairing attempt; not derived from device/user and
   * meaningless after the session ends.
   */
  readonly sessionId: string;
  /**
   * Unix epoch milliseconds when the payload was generated. Lets the scanner
   * reject a stale QR (e.g. a screenshot from a previous session).
   */
  readonly createdAt: number;
  /**
   * WebRTC connection / signalling material. Absent in DMY-6 (WebRTC not yet
   * implemented); populated by the signalling issues. See
   * {@link PairingConnectionInfo}.
   */
  readonly connection?: PairingConnectionInfo;
}

/**
 * QR discriminator value. A scanned string that does not parse to an object
 * with this `type` is not one of our pairing QRs and must be rejected.
 */
export const PAIRING_TYPE = 'mbs-pair' as const;
