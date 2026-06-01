/**
 * BabyScreen — baby unit (camera/mic streaming side).
 *
 * Skeleton route for DMY-35. The first concrete step is QR pairing (DMY-6):
 * this screen renders the baby-unit pairing view that shows the QR code the
 * parent phone scans. Streaming, mic capture and the foreground service arrive
 * in later issues (DMY-7/14/17/18).
 */
import BabyPairingScreen from '../features/pairing/screens/BabyPairingScreen';
import type { RootStackScreenProps } from '../navigation/types';

function BabyScreen(_props: RootStackScreenProps<'Baby'>) {
  return <BabyPairingScreen />;
}

export default BabyScreen;
