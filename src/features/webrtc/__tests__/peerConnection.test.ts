/**
 * Unit tests for the PeerConnection wrapper (DMY-16).
 *
 * Drives a fake `RTCPeerConnection` constructor (no native dependency) and
 * asserts the wrapper: creates offers/answers + sets the local description,
 * applies remote description / ICE, forwards events to subscribers, tracks
 * remote-description presence, normalises native state, and tears down cleanly.
 */
import {
  createPeerConnection,
  normalizePeerState,
  DEFAULT_ICE_SERVERS,
} from '../peerConnection';
import type {
  RtcPeerConnectionCtor,
  RtcPeerConnectionLike,
} from '../peerConnection';
import type { PeerConnectionState } from '../signalingTypes';

class FakeRtcPeerConnection implements RtcPeerConnectionLike {
  connectionState = 'new';
  iceConnectionState = 'new';
  onicecandidate: RtcPeerConnectionLike['onicecandidate'] = null;
  onconnectionstatechange: RtcPeerConnectionLike['onconnectionstatechange'] =
    null;
  oniceconnectionstatechange: RtcPeerConnectionLike['oniceconnectionstatechange'] =
    null;
  ontrack: RtcPeerConnectionLike['ontrack'] = null;

  readonly created: { iceServers: unknown };

  createOffer = jest.fn(async () => ({ type: 'offer', sdp: 'O' }));
  createAnswer = jest.fn(async () => ({ type: 'answer', sdp: 'A' }));
  setLocalDescription = jest.fn(async () => {});
  setRemoteDescription = jest.fn(async () => {});
  addIceCandidate = jest.fn(async () => {});
  addTrack = jest.fn();
  close = jest.fn(() => {
    this.connectionState = 'closed';
  });

  constructor(config: { iceServers: unknown }) {
    this.created = config;
  }

  setState(state: string): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

function makeCtor(): {
  Ctor: RtcPeerConnectionCtor;
  instances: FakeRtcPeerConnection[];
} {
  const instances: FakeRtcPeerConnection[] = [];
  const Ctor = jest.fn(function (this: unknown, config: { iceServers: unknown }) {
    const inst = new FakeRtcPeerConnection(config);
    instances.push(inst);
    return inst;
  }) as unknown as RtcPeerConnectionCtor;
  return { Ctor, instances };
}

describe('normalizePeerState', () => {
  const cases: Array<[string | undefined, PeerConnectionState]> = [
    ['new', 'new'],
    [undefined, 'new'],
    ['connecting', 'connecting'],
    ['checking', 'connecting'],
    ['connected', 'connected'],
    ['completed', 'connected'],
    ['disconnected', 'disconnected'],
    ['failed', 'failed'],
    ['closed', 'closed'],
    ['weird', 'new'],
  ];
  it.each(cases)('maps %s -> %s', (raw, expected) => {
    expect(normalizePeerState(raw)).toBe(expected);
  });
});

describe('createPeerConnection', () => {
  it('passes default (empty) ICE servers to the native ctor', () => {
    const { Ctor, instances } = makeCtor();
    createPeerConnection(undefined, Ctor);
    expect(instances[0].created).toEqual({ iceServers: [] });
    expect(DEFAULT_ICE_SERVERS).toEqual([]);
  });

  it('forwards configured ICE servers', () => {
    const { Ctor, instances } = makeCtor();
    createPeerConnection(
      { iceServers: [{ urls: 'stun:stun.example:3478' }] },
      Ctor,
    );
    expect(instances[0].created).toEqual({
      iceServers: [{ urls: 'stun:stun.example:3478' }],
    });
  });

  it('throws when no constructor is available', () => {
    expect(() => createPeerConnection(undefined, null)).toThrow(
      /no RTCPeerConnection constructor/,
    );
  });

  it('createOffer sets the local description and returns the SDP', async () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    const offer = await pc.createOffer();
    expect(offer).toEqual({ type: 'offer', sdp: 'O' });
    expect(instances[0].setLocalDescription).toHaveBeenCalledWith({
      type: 'offer',
      sdp: 'O',
    });
  });

  it('createAnswer sets the local description and returns the SDP', async () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    const answer = await pc.createAnswer();
    expect(answer).toEqual({ type: 'answer', sdp: 'A' });
    expect(instances[0].setLocalDescription).toHaveBeenCalled();
  });

  it('tracks remote-description presence', async () => {
    const { Ctor } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    expect(pc.hasRemoteDescription()).toBe(false);
    await pc.setRemoteDescription({ type: 'offer', sdp: 'remote' });
    expect(pc.hasRemoteDescription()).toBe(true);
  });

  it('applies ICE candidates with normalised null fields', async () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    await pc.addIceCandidate({ candidate: 'cand' });
    expect(instances[0].addIceCandidate).toHaveBeenCalledWith({
      candidate: 'cand',
      sdpMid: null,
      sdpMLineIndex: null,
    });
  });

  it('forwards connection-state changes (deduped) to subscribers', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    const states: PeerConnectionState[] = [];
    pc.on('connectionstatechange', s => states.push(s));

    instances[0].setState('connecting');
    instances[0].setState('connecting'); // duplicate — deduped
    instances[0].setState('connected');

    expect(states).toEqual(['connecting', 'connected']);
    expect(pc.getConnectionState()).toBe('connected');
  });

  it('forwards ICE candidates (and the end-of-candidates null sentinel)', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    const seen: unknown[] = [];
    pc.on('icecandidate', c => seen.push(c));

    instances[0].onicecandidate?.({ candidate: { candidate: 'x' } as never });
    instances[0].onicecandidate?.({ candidate: null });

    expect(seen).toEqual([{ candidate: 'x' }, null]);
  });

  it('forwards remote tracks', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    const tracks: unknown[] = [];
    pc.on('track', e => tracks.push(e));
    instances[0].ontrack?.({ streams: ['s'] });
    expect(tracks).toEqual([{ streams: ['s'] }]);
  });

  it('addAudioTrack publishes the track+stream onto the native connection (DMY-18)', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    const track = { kind: 'audio', enabled: true, stop: jest.fn() };
    const stream = { getTracks: () => [track] };
    pc.addAudioTrack(track, stream);
    expect(instances[0].addTrack).toHaveBeenCalledWith(track, stream);
  });

  it('addAudioTrack is safe when the native connection has no addTrack', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    // Simulate a minimal native connection without media support.
    (instances[0] as { addTrack?: unknown }).addTrack = undefined;
    const track = { kind: 'audio', enabled: true, stop: jest.fn() };
    expect(() =>
      pc.addAudioTrack(track, { getTracks: () => [track] }),
    ).not.toThrow();
  });

  it('addAudioTrack does not throw if native addTrack throws', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    instances[0].addTrack = jest.fn(() => {
      throw new Error('boom');
    });
    const track = { kind: 'audio', enabled: true, stop: jest.fn() };
    expect(() =>
      pc.addAudioTrack(track, { getTracks: () => [track] }),
    ).not.toThrow();
  });

  it('an unsubscribed handler stops receiving events', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    const states: PeerConnectionState[] = [];
    const off = pc.on('connectionstatechange', s => states.push(s));
    instances[0].setState('connecting');
    off();
    instances[0].setState('connected');
    expect(states).toEqual(['connecting']);
  });

  it('close() detaches native handlers, closes once, and is idempotent', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    const states: PeerConnectionState[] = [];
    pc.on('connectionstatechange', s => states.push(s));

    pc.close();
    pc.close(); // idempotent

    expect(instances[0].close).toHaveBeenCalledTimes(1);
    expect(instances[0].onicecandidate).toBeNull();
    expect(instances[0].onconnectionstatechange).toBeNull();
    expect(instances[0].ontrack).toBeNull();
    expect(pc.getConnectionState()).toBe('closed');
  });

  it('does not throw if the native close() throws', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    instances[0].close = jest.fn(() => {
      throw new Error('boom');
    });
    expect(() => pc.close()).not.toThrow();
  });

  it('a throwing subscriber does not break other subscribers', () => {
    const { Ctor, instances } = makeCtor();
    const pc = createPeerConnection(undefined, Ctor);
    const good: PeerConnectionState[] = [];
    pc.on('connectionstatechange', () => {
      throw new Error('bad subscriber');
    });
    pc.on('connectionstatechange', s => good.push(s));
    expect(() => instances[0].setState('connected')).not.toThrow();
    expect(good).toEqual(['connected']);
  });
});
