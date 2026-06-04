/**
 * Unit tests for useCryAlertSource (DMY-77) — the baby-unit adapter that turns
 * on-device cry detection (DMY-49) into the {@link AlertChannelSource} the
 * fan-out (DMY-66/71) pushes over each parent's alert data channel.
 *
 * Asserts the hook:
 *  - exposes a STABLE source across renders (so threading it through the fan-out
 *    does not churn the manager);
 *  - on a detected cry, broadcasts a privacy-safe `'cry'` AlertEvent
 *    (type + timestamp + soundId) to EVERY subscriber;
 *  - supports multiple subscribers (one cry reaches all parents) and detaches
 *    cleanly on unsubscribe (no leak, no stale delivery);
 *  - stays INERT with no cry-feature source (never fabricates a cry);
 *  - isolates a throwing subscriber (one bad channel never breaks the others).
 *
 * No real audio: the cry-feature source is a stub pushing synthetic samples
 * through the SAME CrySampleSource contract production will use.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useCryAlertSource } from '../useCryAlertSource';
import { soundIdForType } from '../../alerts/alertSoundMap';
import type { AlertEvent } from '../../alerts/alertTypes';
import type { CrySample, CrySampleSource } from '../cryTypes';

function makeStubCrySource() {
  let listener: ((sample: CrySample) => void) | null = null;
  const unsubscribe = jest.fn(() => {
    listener = null;
  });
  const source: CrySampleSource = onSample => {
    listener = onSample;
    return unsubscribe;
  };
  const emit = (sample: CrySample) => listener?.(sample);
  return { source, emit, unsubscribe };
}

/** ~7s sustained, in-band cry: enough samples to cross the 5s rule. */
function sustainedCry(startMs = 0): CrySample[] {
  const out: CrySample[] = [];
  for (let i = 0; i < 70; i += 1) {
    out.push({ rms: 0.75, bandEnergyRatio: 0.7, timestamp: startMs + i * 100 });
  }
  return out;
}

describe('useCryAlertSource (DMY-77)', () => {
  it('exposes a stable source identity across renders', () => {
    const { source } = makeStubCrySource();
    const { result, rerender } = renderHook(() => useCryAlertSource({ source }));
    const first = result.current;
    rerender({});
    expect(result.current).toBe(first);
  });

  it('broadcasts a privacy-safe cry AlertEvent to a subscriber', () => {
    const { source, emit } = makeStubCrySource();
    const { result } = renderHook(() => useCryAlertSource({ source }));

    const received: AlertEvent[] = [];
    act(() => {
      result.current.subscribe(e => received.push(e));
    });

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'cry',
      soundId: soundIdForType('cry'),
    });
    expect(typeof received[0].timestamp).toBe('number');
    // PRIVACY: nothing beyond the three AlertEvent fields leaks (no rms / ratio).
    expect(Object.keys(received[0]).sort()).toEqual([
      'soundId',
      'timestamp',
      'type',
    ]);
  });

  it('fans a single cry out to every subscriber (multiple parents)', () => {
    const { source, emit } = makeStubCrySource();
    const { result } = renderHook(() => useCryAlertSource({ source }));

    const a: AlertEvent[] = [];
    const b: AlertEvent[] = [];
    act(() => {
      result.current.subscribe(e => a.push(e));
      result.current.subscribe(e => b.push(e));
    });

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('detaches a subscriber on unsubscribe (no stale delivery, no leak)', () => {
    const { source, emit } = makeStubCrySource();
    const { result } = renderHook(() => useCryAlertSource({ source }));

    const received: AlertEvent[] = [];
    let unsub: (() => void) | undefined;
    act(() => {
      unsub = result.current.subscribe(e => received.push(e));
    });
    act(() => unsub?.());

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    expect(received).toHaveLength(0);
  });

  it('stays inert with no cry-feature source (never fabricates a cry)', () => {
    const { result } = renderHook(() => useCryAlertSource());
    const received: AlertEvent[] = [];
    act(() => {
      result.current.subscribe(e => received.push(e));
    });
    // No source → no samples → nothing to broadcast.
    expect(received).toHaveLength(0);
  });

  it('isolates a throwing subscriber (one bad channel never breaks the others)', () => {
    const { source, emit } = makeStubCrySource();
    const { result } = renderHook(() => useCryAlertSource({ source }));

    const good: AlertEvent[] = [];
    act(() => {
      result.current.subscribe(() => {
        throw new Error('boom');
      });
      result.current.subscribe(e => good.push(e));
    });

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    // The throwing subscriber did not prevent the healthy one from receiving.
    expect(good).toHaveLength(1);
  });
});
