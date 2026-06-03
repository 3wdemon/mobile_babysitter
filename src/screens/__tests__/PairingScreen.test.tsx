/**
 * Screen-level tests for PairingScreen — the mode-selection entry point.
 *
 * Focus (DMY-73): the previously hard-coded title and the two mode buttons now
 * render from the i18n catalog via `t()`. We assert the English labels resolve,
 * that the buttons carry an explicit i18n accessibilityLabel + role=button (so
 * VoiceOver/TalkBack announce a localized name), that tapping routes to the
 * Baby/Parent screens, and — with the locale switched to ru — that the Russian
 * catalog renders (proving the strings actually flow through i18n rather than
 * being baked in).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import PairingScreen from '../PairingScreen';
import { setLocale } from '../../services/i18n';
import en from '../../../locales/en.json';
import ru from '../../../locales/ru.json';

const navigate = jest.fn();

/** Minimal navigation prop; PairingScreen only calls `navigation.navigate`. */
function renderScreen() {
  return render(
    <PairingScreen
      navigation={{ navigate } as never}
      route={{ key: 'Pairing', name: 'Pairing' } as never}
    />,
  );
}

afterEach(() => {
  jest.clearAllMocks();
  setLocale('en');
});

describe('PairingScreen', () => {
  it('renders the title and mode buttons from the English catalog', () => {
    renderScreen();
    expect(screen.getByText(en.pairing.modeSelect.title)).toBeTruthy();
    expect(screen.getByText(en.pairing.modeSelect.useAsBaby)).toBeTruthy();
    expect(screen.getByText(en.pairing.modeSelect.useAsParent)).toBeTruthy();
  });

  it('exposes a localized accessibilityLabel + button role on each mode action', () => {
    renderScreen();
    const baby = screen.getByLabelText(en.pairing.modeSelect.useAsBabyA11y);
    const parent = screen.getByLabelText(en.pairing.modeSelect.useAsParentA11y);
    expect(baby.props.accessibilityRole).toBe('button');
    expect(parent.props.accessibilityRole).toBe('button');
  });

  it('routes to the Baby unit when the baby button is pressed', () => {
    renderScreen();
    fireEvent.press(screen.getByText(en.pairing.modeSelect.useAsBaby));
    expect(navigate).toHaveBeenCalledWith('Baby');
  });

  it('routes to the Parent unit when the parent button is pressed', () => {
    renderScreen();
    fireEvent.press(screen.getByText(en.pairing.modeSelect.useAsParent));
    expect(navigate).toHaveBeenCalledWith('Parent');
  });

  it('renders Russian copy when the active locale is ru', () => {
    setLocale('ru');
    renderScreen();
    expect(screen.getByText(ru.pairing.modeSelect.useAsBaby)).toBeTruthy();
    expect(screen.getByText(ru.pairing.modeSelect.useAsParent)).toBeTruthy();
    expect(
      screen.getByLabelText(ru.pairing.modeSelect.useAsBabyA11y),
    ).toBeTruthy();
  });
});
