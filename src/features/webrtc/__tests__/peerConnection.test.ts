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
  wrapDataChannel,
  DEFAULT_ICE_SERVERS,
} from '../peerConnection';
import type {
  RtcDataChannelLike,
  RtcPeerConnectionCtor,
  RtcPeerConnectionLike,
} from '../peerConnection';
import type { DataChannel, PeerConnectionState } from '../signalingTypes';

/** Minimal fake native data channel: open by default, drives onmessage/onclose. */
class FakeRtcDataChannel implements RtcDataChannelLike {
  readyState = 'open';
  onopen: RtcDataChannelLike['onopen'] = null;
  onmessage: RtcDataChannelLike['onmessage'] = null;
  onclose: RtcDataChannelLike['onclose'] = null;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = 'closed';
  });
  constructor(readonly label = 'baby-monitor-alert') {}

  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

class FakeRtcPeerConnection implements RtcPeerConnectionLike {
  connectionState = 'new';
  iceConnectionState = 'new';
  onicecandidate: RtcPeerConnectionLike['onicecandidate'] = null;
  onconnectionstatechange: RtcPeerConnectionLike['onconnectionstatechange'] =
    null;
  oniceconnectionstatechange: RtcPeerConnectionLike['oniceconnectionstatechange'] =
    null;
  ontrack: RtcPeerConnectionLike['ontrack'] = null;
  ondatachannel: RtcPeerConnectionLike['ondatachannel'] = null;

  readonly created: { iceServers: unknown };
  readonly dataChannels: FakeRtcDataChannel[] = [];

  createOffer = jest.fn(async () => ({ type: 'offer', sdp: 'O' }));
  createAnswer = jest.fn(async () => ({ type: 'answer', sdp: 'A' }));
  setLocalDescription = jest.fn(async () => {});
  setRemoteDescription = jest.fn(async () => {});
  addIceCandidate = jest.fn(async () => {});
  addTrack = jest.fn();
  createDataChannel = jest.fn((label: string) => {
    const dc = new FakeRtcDataChannel(label);
    this.dataChannels.push(dc);
    return dc;
  });
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
  it('defaults to public Google STUN (primary + fallback) — DMY-47', () => {
    // The two public Google STUN endpoints: primary + fallback.
    expect(DEFAULT_ICE_SERVERS).toEqual([
      {
        urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
      },
    ]);
    const urls = DEFAULT_ICE_SERVERS.flatMap(s =>
      Array.isArray(s.urls) ? s.urls : [s.urls],
    );
    expect(urls).toContain('stun:stun.l.google.com:19302');
    expect(urls).toContain('stun:stun1.l.google.com:19302');
    // STUN-only / $0 mode: NO TURN credentials are configured here (DMY-19).
    expect(
      DEFAULT_ICE_SERVERS.some(s => s.username || s.credential),
    ).toBe(false);
  });

  it('passes the default STUN ICE servers to the native ctor', () => {
    const { Ctor, instances } = makeCtor();
    createPeerConnection(undefined, Ctor);
    expect(instances[0].created).toEqual({
      iceServers: [
        {
          urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
          ],
        },
      ],
    });
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
    expect(instances[0].ondatachannel).toBeNull();
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

  describe('data channel (DMY-50)', () => {
    it('createDataChannel opens a reliable+ordered native channel and wraps it', () => {
      const { Ctor, instances } = makeCtor();
      const pc = createPeerConnection(undefined, Ctor);
      const channel = pc.createDataChannel('baby-monitor-alert');
      expect(channel).not.toBeNull();
      expect(channel?.label).toBe('baby-monitor-alert');
      expect(instances[0].createDataChannel).toHaveBeenCalledWith(
        'baby-monitor-alert',
        { ordered: true },
      );
    });

    it('createDataChannel returns null when the native connection lacks support', () => {
      const { Ctor, instances } = makeCtor();
      const pc = createPeerConnection(undefined, Ctor);
      (instances[0] as { createDataChannel?: unknown }).createDataChannel =
        undefined;
      expect(pc.createDataChannel('x')).toBeNull();
    });

    it('createDataChannel returns null (does not throw) if native throws', () => {
      const { Ctor, instances } = makeCtor();
      const pc = createPeerConnection(undefined, Ctor);
      instances[0].createDataChannel = jest.fn((_label: string) => {
        throw new Error('boom');
      }) as unknown as FakeRtcPeerConnection['createDataChannel'];
      expect(pc.createDataChannel('x')).toBeNull();
    });

    it('forwards a remote data channel via the datachannel event (wrapped)', () => {
      const { Ctor, instances } = makeCtor();
      const pc = createPeerConnection(undefined, Ctor);
      const received: DataChannel[] = [];
      pc.on('datachannel', ch => received.push(ch));
      const native = new FakeRtcDataChannel('baby-monitor-alert');
      instances[0].ondatachannel?.({ channel: native });
      expect(received).toHaveLength(1);
      expect(received[0].label).toBe('baby-monitor-alert');
    });

    it('ignores an ondatachannel event with no channel', () => {
      const { Ctor, instances } = makeCtor();
      const pc = createPeerConnection(undefined, Ctor);
      const received: DataChannel[] = [];
      pc.on('datachannel', ch => received.push(ch));
      instances[0].ondatachannel?.({} as never);
      expect(received).toHaveLength(0);
    });

    it('a throwing datachannel subscriber does not break others', () => {
      const { Ctor, instances } = makeCtor();
      const pc = createPeerConnection(undefined, Ctor);
      const good: DataChannel[] = [];
      pc.on('datachannel', () => {
        throw new Error('bad subscriber');
      });
      pc.on('datachannel', ch => good.push(ch));
      expect(() =>
        instances[0].ondatachannel?.({
          channel: new FakeRtcDataChannel(),
        }),
      ).not.toThrow();
      expect(good).toHaveLength(1);
    });
  });
});

describe('wrapDataChannel (DMY-50)', () => {
  it('exposes the native label', () => {
    const dc = wrapDataChannel(new FakeRtcDataChannel('my-label'));
    expect(dc.label).toBe('my-label');
  });

  it('label falls back to empty string when the native channel has none', () => {
    const native = new FakeRtcDataChannel();
    (native as { label?: string }).label = undefined;
    expect(wrapDataChannel(native).label).toBe('');
  });

  it('send forwards the payload to an open native channel and reports success', () => {
    const native = new FakeRtcDataChannel();
    const dc = wrapDataChannel(native);
    expect(dc.send('hello')).toBe(true);
    expect(native.send).toHaveBeenCalledWith('hello');
  });

  it('send is dropped (returns false, does not throw) when not open', () => {
    const native = new FakeRtcDataChannel();
    native.readyState = 'connecting';
    const dc = wrapDataChannel(native);
    expect(dc.send('hello')).toBe(false);
    expect(native.send).not.toHaveBeenCalled();
  });

  it('send returns false (does not throw) if the native send throws', () => {
    const native = new FakeRtcDataChannel();
    native.send = jest.fn(() => {
      throw new Error('boom');
    });
    const dc = wrapDataChannel(native);
    expect(dc.send('x')).toBe(false);
  });

  it('isOpen reflects the native readyState', () => {
    const native = new FakeRtcDataChannel();
    const dc = wrapDataChannel(native);
    expect(dc.isOpen()).toBe(true);
    native.readyState = 'closed';
    expect(dc.isOpen()).toBe(false);
  });

  it('delivers inbound string messages to subscribers', () => {
    const native = new FakeRtcDataChannel();
    const dc = wrapDataChannel(native);
    const seen: string[] = [];
    dc.onMessage(p => seen.push(p));
    native.receive('payload');
    expect(seen).toEqual(['payload']);
  });

  it('coerces a non-string inbound payload to a string', () => {
    const native = new FakeRtcDataChannel();
    const dc = wrapDataChannel(native);
    const seen: string[] = [];
    dc.onMessage(p => seen.push(p));
    native.receive(undefined);
    native.receive(42);
    expect(seen).toEqual(['', '42']);
  });

  it('an unsubscribed message handler stops receiving', () => {
    const native = new FakeRtcDataChannel();
    const dc = wrapDataChannel(native);
    const seen: string[] = [];
    const off = dc.onMessage(p => seen.push(p));
    native.receive('a');
    off();
    native.receive('b');
    expect(seen).toEqual(['a']);
  });

  it('a throwing message subscriber does not break others', () => {
    const native = new FakeRtcDataChannel();
    const dc = wrapDataChannel(native);
    const good: string[] = [];
    dc.onMessage(() => {
      throw new Error('bad');
    });
    dc.onMessage(p => good.push(p));
    expect(() => native.receive('x')).not.toThrow();
    expect(good).toEqual(['x']);
  });

  it('fires onClose subscribers when the native channel closes', () => {
    const native = new FakeRtcDataChannel();
    const dc = wrapDataChannel(native);
    const closed = jest.fn();
    dc.onClose(closed);
    native.onclose?.();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('a throwing close subscriber does not break others', () => {
    const native = new FakeRtcDataChannel();
    const dc = wrapDataChannel(native);
    const good = jest.fn();
    dc.onClose(() => {
      throw new Error('bad');
    });
    dc.onClose(good);
    expect(() => native.onclose?.()).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it('close() detaches handlers, closes once, and is idempotent', () => {
    const native = new FakeRtcDataChannel();
    const dc = wrapDataChannel(native);
    const seen: string[] = [];
    dc.onMessage(p => seen.push(p));
    dc.close();
    dc.close(); // idempotent
    expect(native.close).toHaveBeenCalledTimes(1);
    expect(native.onmessage).toBeNull();
    expect(native.onclose).toBeNull();
    // After close, send is a no-op false and no further messages are delivered.
    expect(dc.send('x')).toBe(false);
    expect(dc.isOpen()).toBe(false);
  });

  it('close() does not throw if the native close throws', () => {
    const native = new FakeRtcDataChannel();
    native.close = jest.fn(() => {
      throw new Error('boom');
    });
    const dc = wrapDataChannel(native);
    expect(() => dc.close()).not.toThrow();
  });
});
