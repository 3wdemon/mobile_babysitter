import {
  PBKDF2_ITERATIONS,
  PIN_KDF_ALGO,
  PIN_KEYCHAIN_SERVICE,
  clearPin,
  getStoredPinFormat,
  hasPin,
  setPin,
  verifyPin,
} from '../pinService';
import { sha256Hex } from '../sha256';

const keychainMock = jest.requireMock('react-native-keychain') as {
  __resetKeychainMock: () => void;
  __getStored: (
    service?: string,
  ) => { username: string; password: string } | undefined;
  setGenericPassword: jest.Mock;
  getGenericPassword: jest.Mock;
};

/**
 * Write a raw stored value into the in-memory keychain (to seed legacy / corrupt
 * blobs). Uses the real mock store so it does not override the
 * `getGenericPassword` implementation (which would leak across tests).
 */
async function seedStored(password: string): Promise<void> {
  await keychainMock.setGenericPassword('parent-pin', password, {
    service: PIN_KEYCHAIN_SERVICE,
  } as never);
}

describe('pinService', () => {
  beforeEach(() => {
    keychainMock.__resetKeychainMock();
  });

  describe('setPin (slow KDF, DMY-44)', () => {
    it('persists a self-describing PBKDF2 record — never the raw PIN', async () => {
      const result = await setPin('1234');
      expect(result).toEqual({ ok: true });

      const stored = keychainMock.__getStored(PIN_KEYCHAIN_SERVICE);
      expect(stored).toBeDefined();
      const record = JSON.parse(stored!.password);
      expect(record.algo).toBe(PIN_KDF_ALGO);
      expect(record.iterations).toBe(PBKDF2_ITERATIONS);
      expect(record.salt).toMatch(/^[0-9a-f]{32}$/); // 16-byte salt
      expect(record.hash).toMatch(/^[0-9a-f]{64}$/); // 32-byte derived key
      // The raw PIN must NOT appear anywhere in the stored blob.
      expect(stored!.password).not.toContain('1234');
    });

    it('uses a sensible iteration count (>= 100k)', async () => {
      await setPin('1234');
      const record = JSON.parse(
        keychainMock.__getStored(PIN_KEYCHAIN_SERVICE)!.password,
      );
      expect(record.iterations).toBeGreaterThanOrEqual(100_000);
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

    it('uses a fresh random salt per set (same PIN -> different record)', async () => {
      await setPin('1234');
      const first = keychainMock.__getStored(PIN_KEYCHAIN_SERVICE)!.password;
      await setPin('1234');
      const second = keychainMock.__getStored(PIN_KEYCHAIN_SERVICE)!.password;
      expect(first).not.toBe(second);
      // ...and specifically a different salt + hash.
      expect(JSON.parse(first).salt).not.toBe(JSON.parse(second).salt);
      expect(JSON.parse(first).hash).not.toBe(JSON.parse(second).hash);
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

  describe('verifyPin (PBKDF2)', () => {
    it('returns true for the correct PIN', async () => {
      await setPin('4242');
      await expect(verifyPin('4242')).resolves.toBe(true);
    });

    it('is deterministic for the same PIN + stored salt', async () => {
      await setPin('4242');
      await expect(verifyPin('4242')).resolves.toBe(true);
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

    it('fails closed (false) when the stored credential is unknown garbage', async () => {
      await seedStored('no-separator-here');
      await expect(verifyPin('1234')).resolves.toBe(false);
    });

    it('fails closed (false) when the stored JSON record is corrupt', async () => {
      await seedStored('{"algo":"pbkdf2-sha256","iterations":');
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

  describe('legacy sha256 migration (DMY-44)', () => {
    /** Build a legacy DMY-10 record: "<saltHex>:<sha256(saltHex + ':' + pin)>". */
    function legacyStored(saltHex: string, pin: string): string {
      return `${saltHex}:${sha256Hex(`${saltHex}:${pin}`)}`;
    }

    it('verifies a correct PIN against a legacy sha256 record', async () => {
      const salt = 'a'.repeat(32);
      await seedStored(legacyStored(salt, '7788'));
      await expect(verifyPin('7788')).resolves.toBe(true);
    });

    it('rejects a wrong PIN against a legacy record (no upgrade)', async () => {
      const salt = 'b'.repeat(32);
      await seedStored(legacyStored(salt, '7788'));
      keychainMock.setGenericPassword.mockClear();
      await expect(verifyPin('0000')).resolves.toBe(false);
      // A wrong attempt must NOT re-write / migrate.
      expect(keychainMock.setGenericPassword).not.toHaveBeenCalled();
    });

    it('upgrades-on-success: re-derives + re-stores as PBKDF2 after a correct legacy verify', async () => {
      const salt = 'c'.repeat(32);
      // Use the in-memory store so the upgrade write is observable.
      keychainMock.__resetKeychainMock();
      await keychainMock.setGenericPassword('parent-pin', legacyStored(salt, '5566'), {
        service: PIN_KEYCHAIN_SERVICE,
      });
      keychainMock.setGenericPassword.mockClear();

      await expect(verifyPin('5566')).resolves.toBe(true);

      // The stored value was overwritten with a PBKDF2 record.
      const after = keychainMock.__getStored(PIN_KEYCHAIN_SERVICE)!.password;
      const record = JSON.parse(after);
      expect(record.algo).toBe(PIN_KDF_ALGO);
      expect(record.iterations).toBe(PBKDF2_ITERATIONS);
      // And the migrated record still verifies the same PIN.
      await expect(verifyPin('5566')).resolves.toBe(true);
    });

    it('still authenticates even if the upgrade re-store fails', async () => {
      const salt = 'd'.repeat(32);
      await seedStored(legacyStored(salt, '4455'));
      keychainMock.setGenericPassword.mockRejectedValueOnce(
        new Error('write failed'),
      );
      // Correct PIN authenticates despite the failed migration write.
      await expect(verifyPin('4455')).resolves.toBe(true);
    });

    it('getStoredPinFormat reports the stored format', async () => {
      await expect(getStoredPinFormat()).resolves.toBe('none');

      await seedStored(legacyStored('e'.repeat(32), '1234'));
      await expect(getStoredPinFormat()).resolves.toBe('legacy');

      await seedStored('total-garbage');
      await expect(getStoredPinFormat()).resolves.toBe('unknown');
    });

    it('getStoredPinFormat reports pbkdf2 for a freshly-set PIN', async () => {
      await setPin('1234');
      await expect(getStoredPinFormat()).resolves.toBe('pbkdf2');
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
          .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
          .join(' ');
        expect(allLogged).not.toContain('192837');
        expect(allLogged).not.toContain('000000');
      } finally {
        spies.forEach(s => s.mockRestore());
      }
    });

    it('never passes the PIN to the logger arguments', async () => {
      // Spy the logger directly to assert the PIN is not in ANY arg, including
      // structured objects (which redact() would otherwise stringify).
      const { logger } = jest.requireActual('../../../services/logger');
      const infoSpy = jest.spyOn(logger, 'info');
      const warnSpy = jest.spyOn(logger, 'warn');
      try {
        await setPin('246802');
        await verifyPin('246802');
        const args = [...infoSpy.mock.calls, ...warnSpy.mock.calls]
          .flat()
          .map(a => JSON.stringify(a))
          .join(' ');
        expect(args).not.toContain('246802');
      } finally {
        infoSpy.mockRestore();
        warnSpy.mockRestore();
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
