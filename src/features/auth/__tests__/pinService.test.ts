import {
  PIN_KEYCHAIN_SERVICE,
  clearPin,
  hasPin,
  setPin,
  verifyPin,
} from '../pinService';

const keychainMock = jest.requireMock('react-native-keychain') as {
  __resetKeychainMock: () => void;
  __getStored: (service?: string) => { username: string; password: string } | undefined;
  setGenericPassword: jest.Mock;
  getGenericPassword: jest.Mock;
};

describe('pinService', () => {
  beforeEach(() => {
    keychainMock.__resetKeychainMock();
  });

  describe('setPin', () => {
    it('persists only a salt:hash in the keychain — never the raw PIN', async () => {
      const result = await setPin('1234');
      expect(result).toEqual({ ok: true });

      const stored = keychainMock.__getStored(PIN_KEYCHAIN_SERVICE);
      expect(stored).toBeDefined();
      // Stored value is `salt:hash`, both lowercase hex.
      expect(stored!.password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
      // The raw PIN must NOT appear anywhere in the stored blob.
      expect(stored!.password).not.toContain('1234');
    });

    it('stores with device-only accessibility (no iCloud/backup sync)', async () => {
      await setPin('123456');
      expect(keychainMock.setGenericPassword).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          service: PIN_KEYCHAIN_SERVICE,
          accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
        }),
      );
    });

    it('uses a fresh random salt per set (same PIN -> different stored hash)', async () => {
      await setPin('1234');
      const first = keychainMock.__getStored(PIN_KEYCHAIN_SERVICE)!.password;
      await setPin('1234');
      const second = keychainMock.__getStored(PIN_KEYCHAIN_SERVICE)!.password;
      expect(first).not.toBe(second);
    });

    it('rejects a too-short PIN without storing anything', async () => {
      const result = await setPin('12');
      expect(result).toEqual({ ok: false, reason: 'invalid-format' });
      expect(keychainMock.setGenericPassword).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric PIN', async () => {
      const result = await setPin('12ab');
      expect(result).toEqual({ ok: false, reason: 'invalid-format' });
    });

    it('returns an error result (no throw) when the keychain write fails', async () => {
      keychainMock.setGenericPassword.mockRejectedValueOnce(
        new Error('keystore unavailable'),
      );
      const result = await setPin('1234');
      expect(result).toEqual({ ok: false, reason: 'error' });
    });
  });

  describe('verifyPin', () => {
    it('returns true for the correct PIN', async () => {
      await setPin('4242');
      await expect(verifyPin('4242')).resolves.toBe(true);
    });

    it('returns false for an incorrect PIN (without throwing)', async () => {
      await setPin('4242');
      await expect(verifyPin('0000')).resolves.toBe(false);
    });

    it('returns false when no PIN is configured', async () => {
      await expect(verifyPin('1234')).resolves.toBe(false);
    });

    it('returns false for an invalid format without hitting the keychain', async () => {
      await setPin('1234');
      keychainMock.getGenericPassword.mockClear();
      await expect(verifyPin('1')).resolves.toBe(false);
      expect(keychainMock.getGenericPassword).not.toHaveBeenCalled();
    });

    it('fails closed (false) when the stored credential is malformed', async () => {
      keychainMock.getGenericPassword.mockResolvedValueOnce({
        service: PIN_KEYCHAIN_SERVICE,
        username: 'parent-pin',
        password: 'no-separator-here',
        storage: 'keychain',
      });
      await expect(verifyPin('1234')).resolves.toBe(false);
    });

    it('fails closed (false) when the keychain read throws', async () => {
      await setPin('1234');
      keychainMock.getGenericPassword.mockRejectedValueOnce(
        new Error('locked'),
      );
      await expect(verifyPin('1234')).resolves.toBe(false);
    });
  });

  describe('privacy', () => {
    it('never writes the raw PIN to any console/log sink', async () => {
      const spies = (['log', 'info', 'warn', 'error'] as const).map(m =>
        jest.spyOn(console, m).mockImplementation(() => {}),
      );
      try {
        await setPin('192837');
        await verifyPin('192837');
        await verifyPin('000000');

        const allLogged = spies
          .flatMap(s => s.mock.calls)
          .flat()
          .map(arg =>
            typeof arg === 'string' ? arg : JSON.stringify(arg),
          )
          .join(' ');
        expect(allLogged).not.toContain('192837');
        expect(allLogged).not.toContain('000000');
      } finally {
        spies.forEach(s => s.mockRestore());
      }
    });
  });

  describe('hasPin / clearPin', () => {
    it('reports whether a PIN is configured', async () => {
      await expect(hasPin()).resolves.toBe(false);
      await setPin('1234');
      await expect(hasPin()).resolves.toBe(true);
    });

    it('clearPin removes the stored PIN', async () => {
      await setPin('1234');
      await expect(clearPin()).resolves.toBe(true);
      await expect(hasPin()).resolves.toBe(false);
      await expect(verifyPin('1234')).resolves.toBe(false);
    });
  });
});
