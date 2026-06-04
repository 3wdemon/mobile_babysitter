/**
 * useCryAlertSource — baby-unit adapter that turns on-device cry detection
 * (DMY-49) into the {@link AlertChannelSource} the baby fan-out (DMY-66/71)
 * pushes over each parent's alert data channel (DMY-50). The final live wiring
 * of part (в)/(б) of DMY-77.
 *
 * ## Where this sits in the live contract (DMY-71 / DMY-75)
 * After DMY-75 the baby has a SINGLE publish path: the {@link createBabyBroadcast}
 * fan-out, one responder session per parent. Each session opens the alert data
 * channel and, given a {@link BabyBroadcastOptions.alertSource}, feeds it every
 * raised {@link AlertEvent} via {@link pushAlertsToChannel}. So an alert raised
 * ONCE on the baby fans out to ALL connected parents, each of which fires its
 * local notification (DMY-46) + haptic (DMY-28) through `useMediaSession`'s
 * `alertReceiver` (part (а)).
 *
 * This hook is the SOURCE end of that wire:
 *  - it mounts {@link useCryDetection} with the baby's cry-feature source, and
 *  - on each detected cry episode it builds the privacy-safe `'cry'`
 *    {@link AlertEvent} (type + timestamp + soundId) and broadcasts it to every
 *    subscriber of the returned {@link AlertChannelSource}.
 *
 * The returned source has a STABLE identity for the hook's lifetime so threading
 * it through {@link useBabyBroadcast} does not churn the fan-out manager — each
 * per-peer `subscribe` is called once when its channel opens and detached when
 * that peer leaves (the fan-out owns that lifecycle). Multiple parents each get
 * their own subscription; a single cry reaches all of them.
 *
 * ## Honest boundary
 * The cry-FEATURE source (`CrySampleSource` — RMS + 250-2000Hz band energy from
 * the audio DSP) is INJECTED. The real on-device DSP tap arrives with the audio
 * capture work (DMY-18/DMY-9); until then the SHIPPED default is
 * {@link noopCrySampleSource} (subscribes nothing), so mounting this hook on the
 * baby screen is SAFE and INERT — it never fabricates a cry. Tests inject a stub
 * that pushes synthetic samples to drive the whole source→channel→receiver wire.
 *
 * ## Privacy
 * Only the privacy-safe {@link AlertEvent} (type + timestamp + soundId) ever
 * leaves this hook; the {@link CryEvent}'s features/confidence are logged by
 * {@link useCryDetection} alone and NEVER cross the channel. No audio buffer,
 * frame or raw metric is exposed here.
 *
 * ## Scope note (follow-up)
 * Only CRY is mounted here for DMY-77. Motion (DMY-25) and noise (DMY-8) have
 * working detectors but their real on-device metric sources are equally pending
 * (same DSP/vision-tap gap), so wiring them as additional sources is a trivial
 * follow-up once those taps exist — the {@link AlertChannelSource} contract and
 * the fan-out push already support every {@link AlertType}.
 */
import { useCallback, useMemo, useRef } from 'react';

import { soundIdForType } from '../alerts/alertSoundMap';
import type { AlertChannelSource } from '../alerts/alertChannel';
import type { AlertEvent } from '../alerts/alertTypes';
import { useCryDetection } from './useCryDetection';
import { DEFAULT_CRY_CONFIG } from './cryConfig';
import type { CryEvent, CryHeuristicConfig, CrySampleSource } from './cryTypes';

/** Options for {@link useCryAlertSource}. */
export interface UseCryAlertSourceOptions {
  /**
   * Cry-feature source for {@link useCryDetection}. Omit to leave the hook inert
   * (the real DSP tap — DMY-18/DMY-9 — is not yet wired); the returned source
   * then simply never emits. Tests inject a stub.
   */
  readonly source?: CrySampleSource;
  /**
   * Heuristic thresholds. Defaults to {@link DEFAULT_CRY_CONFIG} (the DMY-49
   * tuning) so a call site only needs to provide the feature source.
   */
  readonly config?: CryHeuristicConfig;
  /** When `false`, cry detection is not subscribed. Defaults to `true`. */
  readonly enabled?: boolean;
}

/**
 * Mount cry detection on the baby and expose it as an {@link AlertChannelSource}
 * for the fan-out's per-peer alert channels. Returns a STABLE source object.
 */
export function useCryAlertSource(
  options: UseCryAlertSourceOptions = {},
): AlertChannelSource {
  const { source, config = DEFAULT_CRY_CONFIG, enabled = true } = options;

  // The live set of per-peer subscribers. Each parent's alert channel subscribes
  // once when it opens (via pushAlertsToChannel) and unsubscribes when that peer
  // leaves; a single cry is broadcast to all of them.
  const subscribersRef = useRef<Set<(event: AlertEvent) => void>>(new Set());

  // Adapt a detected cry into the privacy-safe AlertEvent and fan it out to every
  // subscriber. Stable identity (reads the live set via the ref) so it never
  // re-subscribes the detector source.
  const onCry = useCallback((event: CryEvent) => {
    const alert: AlertEvent = {
      type: 'cry',
      timestamp: event.timestamp,
      soundId: soundIdForType('cry'),
    };
    // Snapshot so a subscriber detaching mid-iteration cannot disturb the loop.
    for (const handler of [...subscribersRef.current]) {
      try {
        handler(alert);
      } catch {
        // A misbehaving subscriber (one channel) must never break the others.
      }
    }
  }, []);

  useCryDetection({ source, config, onCry, enabled });

  // Stable AlertChannelSource: the fan-out calls subscribe() once per parent
  // channel; the returned unsubscribe removes just that subscriber (no leak).
  return useMemo<AlertChannelSource>(
    () => ({
      subscribe(handler) {
        subscribersRef.current.add(handler);
        return () => {
          subscribersRef.current.delete(handler);
        };
      },
    }),
    [],
  );
}
