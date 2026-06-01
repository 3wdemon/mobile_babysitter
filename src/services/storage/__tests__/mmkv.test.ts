import { mmkvStateStorage, storage } from '../mmkv';

// `__resetAllMmkv` is a test-only helper on the in-memory mock (see
// `__mocks__/react-native-mmkv.ts`); not part of the real module's types.
const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

describe('mmkvStateStorage adapter', () => {
  beforeEach(() => {
    __resetAllMmkv();
  });

  it('returns null for a missing key', () => {
    expect(mmkvStateStorage.getItem('missing')).toBeNull();
  });

  it('round-trips a value through setItem/getItem', () => {
    mmkvStateStorage.setItem('k', 'v');
    expect(mmkvStateStorage.getItem('k')).toBe('v');
  });

  it('removeItem deletes the value', () => {
    mmkvStateStorage.setItem('k', 'v');
    mmkvStateStorage.removeItem('k');
    expect(mmkvStateStorage.getItem('k')).toBeNull();
  });

  it('writes through to the shared MMKV instance', () => {
    mmkvStateStorage.setItem('k', 'v');
    expect(storage.getString('k')).toBe('v');
  });
});
