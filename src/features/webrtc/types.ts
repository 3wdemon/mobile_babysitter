/**
 * Types for the parent-unit audio-only low-power mode (DMY-24).
 *
 * In audio-only mode the parent-unit receives the baby-unit's audio but does
 * NOT request its video track — saving bandwidth, battery and mobile data over
 * long overnight sessions. The user can momentarily peek at the picture on
 * demand (a tap) and then drop back to audio-only.
 *
 * The actual video track lives in the WebRTC layer (an `RTCRtpSender` /
 * transceiver direction, or a renegotiated media line). That layer does not
 * exist yet — real signalling/media is DMY-16/17/18. To keep the mode logic
 * testable WITHOUT a WebRTC dependency, all video-track control is funnelled
 * through the abstract {@link VideoTrackController} below. Production wires a
 * real controller backed by the peer connection; tests inject a spy; and when
 * no controller is provided a safe no-op is used so nothing throws.
 */

/**
 * Which media the parent-unit is currently consuming.
 *  - `'audio-only'` — audio received, video NOT requested (low-power baseline).
 *  - `'video'`      — video is being requested/shown (either because the user
 *    opted out of audio-only, or is momentarily peeking at the picture).
 */
export type ParentMediaMode = 'audio-only' | 'video';

/**
 * Device-effect backend for the parent video track. This is the single
 * integration point for the WebRTC layer (DMY-17): every method MUST be safe to
 * call (never throw) and is expected to be cheap. A no-op implementation is a
 * valid controller.
 *
 * Honest boundary: the JS mode logic owns ONLY the sequencing (when video is
 * allowed to be requested). Whether `enableVideo` flips an `RTCRtpSender`,
 * un-pauses a transceiver, or triggers renegotiation is entirely the
 * controller's concern and is implemented under DMY-17.
 */
export interface VideoTrackController {
  /**
   * Request / resume the remote video track so the parent can see the picture.
   * Called when the user opts out of audio-only, or momentarily peeks at video.
   */
  enableVideo(): void;
  /**
   * Stop requesting the remote video track (audio continues). Called on entering
   * audio-only mode and when a momentary peek ends.
   */
  disableVideo(): void;
}
