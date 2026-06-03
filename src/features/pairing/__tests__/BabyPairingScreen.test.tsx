/**
 * Screen-level tests for BabyPairingScreen (DMY-6).
 *
 * Cover: the QR component renders with a NON-EMPTY, valid payload value; the
 * "New code" button regenerates the session (new value); styling comes from
 * design tokens (no hard-coded hex); and the serialized QR string is never
 * leaked as on-screen text.
 *
 * react-native-qrcode-svg is auto-mocked (jest.setup.js) to a View that exposes
 * its `value` via accessibilityLabel + testID="mock-qrcode".
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import BabyPairingScreen from '../screens/BabyPairingScreen';
import { parsePairingPayload } from '../pairingService';
import { lightTheme } from '../../../theme';
import { setLocale } from '../../../services/i18n';
import en from '../../../../locales/en.json';
import ru from '../../../../locales/ru.json';

function getQrValue(): string {
  return screen.getByTestId('mock-qrcode').props.accessibilityLabel as string;
}

afterEach(() => setLocale('en'));

describe('BabyPairingScreen', () => {
  it('renders the QR component with a non-empty, valid payload value', () => {
    render(<BabyPairingScreen />);

    const value = getQrValue();
    expect(value).toBeTruthy();
    expect(value.length).toBeGreaterThan(0);

    const parsed = parsePairingPayload(value);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe('mbs-pair');
  });

  it('regenerates a new QR value when "New code" is pressed', () => {
    render(<BabyPairingScreen />);
    const before = getQrValue();

    fireEvent.press(screen.getByText('New code'));

    const after = getQrValue();
    expect(after).not.toBe(before);
    expect(parsePairingPayload(after)?.sessionId).not.toBe(
      parsePairingPayload(before)?.sessionId,
    );
  });

  it('shows privacy-first copy and never renders the raw payload as text', () => {
    render(<BabyPairingScreen />);
    expect(screen.getByText('Pair this baby unit')).toBeTruthy();
    expect(
      screen.getByText(/Nothing leaves your devices/i),
    ).toBeTruthy();
    // The serialized JSON payload must not appear as visible text anywhere.
    const value = getQrValue();
    expect(screen.queryByText(value)).toBeNull();
  });

  it('shows the network-visibility indicator (DMY-7 mDNS advertising)', () => {
    render(<BabyPairingScreen />);
    // The zeroconf adapter is mocked (inert spies) so publishing succeeds and
    // the baby-unit reports it is discoverable on the LAN.
    expect(screen.getByTestId('network-visibility')).toBeTruthy();
    expect(screen.getByText(/Visible on your Wi-Fi/i)).toBeTruthy();
  });

  it('styles the QR frame from design tokens (no hard-coded colours)', () => {
    render(<BabyPairingScreen />);
    const frame = screen.getByTestId('pairing-qr');
    const flat = Array.isArray(frame.props.style)
      ? Object.assign({}, ...frame.props.style)
      : frame.props.style;

    expect(flat.backgroundColor).toBe(lightTheme.colors.surface);
    expect(flat.borderColor).toBe(lightTheme.colors.border);
    expect(flat.borderRadius).toBe(lightTheme.spacing.md);
    expect(flat.padding).toBe(lightTheme.spacing.lg);
  });

  it('labels the QR frame with a localized accessibilityLabel (DMY-73)', () => {
    render(<BabyPairingScreen />);
    const frame = screen.getByTestId('pairing-qr');
    expect(frame.props.accessibilityLabel).toBe(en.pairing.baby.qrA11y);
  });

  it('renders Russian copy when the active locale is ru (DMY-73)', () => {
    setLocale('ru');
    render(<BabyPairingScreen />);
    expect(screen.getByText(ru.pairing.baby.title)).toBeTruthy();
    expect(screen.getByText(ru.pairing.baby.newCode)).toBeTruthy();
    expect(screen.getByTestId('pairing-qr').props.accessibilityLabel).toBe(
      ru.pairing.baby.qrA11y,
    );
  });
});
