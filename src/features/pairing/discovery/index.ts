/**
 * Public surface of the pairing local-discovery feature (DMY-7).
 *
 * mDNS/Bonjour discovery so two phones on the same Wi-Fi find each other
 * WITHOUT a QR scan. The native zeroconf module is abstracted behind
 * {@link ZeroconfBackend}; the shipped default adapter degrades to a safe no-op
 * when the native module is unavailable. The TXT record carries only the
 * ephemeral session id + schema version — no PII, no secrets. Discovery
 * surfaces a connectable endpoint for the FUTURE WebRTC handshake (DMY-16/18);
 * it does not itself connect.
 */
export {
  DiscoveryService,
  createDiscoveryService,
  createZeroconfBackend,
  noopZeroconfBackend,
  buildPublishConfig,
  parseResolvedService,
  DEFAULT_SIGNALLING_PORT,
} from './discoveryService';
export type { DiscoveryListener } from './discoveryService';
export {
  useDiscoveredUnits,
  usePublishService,
  DISCOVERY_SETTLE_MS,
} from './useDiscovery';
export type {
  UseDiscoveredUnits,
  UseDiscoveredUnitsOptions,
  UsePublishService,
  UsePublishServiceOptions,
} from './useDiscovery';
export { default as DiscoveredUnitsList } from './DiscoveredUnitsList';
export type { DiscoveredUnitsListProps } from './DiscoveredUnitsList';
export {
  DISCOVERY_SERVICE_TYPE,
  DISCOVERY_SERVICE_NAME,
  DISCOVERY_PROTOCOL,
  DISCOVERY_DOMAIN,
  TXT_KEY_SESSION_ID,
  TXT_KEY_VERSION,
  isKnownPairingVersion,
} from './types';
export type {
  DiscoveredBabyUnit,
  DiscoveryTxtRecord,
  PublishServiceConfig,
  ZeroconfBackend,
  ZeroconfBackendEvents,
  ZeroconfResolvedService,
} from './types';
