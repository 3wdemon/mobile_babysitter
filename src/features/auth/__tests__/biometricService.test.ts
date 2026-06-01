import {
  __resetBiometricInstance,
  authenticate,
  isSensorAvailable,
} from '../biometricService';

const bioMock = jest.requireMock('react-native-biometrics') as {
  __resetBiometricsMock: () => void;
  __setSensorAvailable: (available: boolean, type?: string) => void;
  __setNextPromptSuccess: (success: boolean) => void;
  mockIsSensorAvailable: jest.Mock;
  mockSimplePrompt: jest.Mock;
};

describe('biometricService', () => {
  beforeEach(() => {
    bioMock.__resetBiometricsMock();
    __resetBiometricInstance();
  });

  describe('isSensorAvailable', () => {
    it('reports an available sensor with its type', async () => {
      bioMock.__setSensorAvailable(true, 'FaceID');
      await expect(isSensorAvailable()).resolves.toEqual({
        available: true,
        biometryType: 'FaceID',
      });
    });

    it('reports an unavailable sensor', async () => {
      bioMock.__setSensorAvailable(false);
      await expect(isSensorAvailable()).resolves.toEqual({ available: false });
    });

    it('treats a native error as "no sensor" (non-throwing)', async () => {
      bioMock.mockIsSensorAvailable.mockRejectedValueOnce(
        new Error('native boom'),
      );
      await expect(isSensorAvailable()).resolves.toEqual({ available: false });
    });
  });

  describe('authenticate', () => {
    it('returns success when the user passes the prompt', async () => {
      bioMock.__setSensorAvailable(true);
      bioMock.__setNextPromptSuccess(true);
      await expect(authenticate('Unlock')).resolves.toEqual({ success: true });
    });

    it('returns declined when the user cancels the prompt', async () => {
      bioMock.__setSensorAvailable(true);
      bioMock.__setNextPromptSuccess(false);
      await expect(authenticate('Unlock')).resolves.toEqual({
        success: false,
        reason: 'declined',
      });
    });

    it('returns unavailable without prompting when there is no sensor', async () => {
      bioMock.__setSensorAvailable(false);
      const result = await authenticate('Unlock');
      expect(result).toEqual({ success: false, reason: 'unavailable' });
      expect(bioMock.mockSimplePrompt).not.toHaveBeenCalled();
    });

    it('returns error (non-throwing) when the prompt rejects natively', async () => {
      bioMock.__setSensorAvailable(true);
      bioMock.mockSimplePrompt.mockRejectedValueOnce(new Error('lockout'));
      await expect(authenticate('Unlock')).resolves.toEqual({
        success: false,
        reason: 'error',
      });
    });
  });
});
