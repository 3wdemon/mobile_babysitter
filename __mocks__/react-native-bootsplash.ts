/**
 * Jest mock for `react-native-bootsplash` (DMY-58).
 *
 * The real library bridges to the native iOS storyboard / Android SplashScreen
 * window — there is no JS fallback under Jest. This inert mock exposes the
 * surface the app uses (`hide`, `show`, `getVisibilityStatus`, `isVisible`) so
 * any test mounting <App /> (which hides the splash once the navigator is ready)
 * runs without touching native code, and so the hide wiring can be asserted.
 */
const hide = jest.fn(() => Promise.resolve());
const show = jest.fn(() => Promise.resolve());
const getVisibilityStatus = jest.fn(() => Promise.resolve('hidden'));
const isVisible = jest.fn(() => Promise.resolve(false));

export default {
  hide,
  show,
  getVisibilityStatus,
  isVisible,
};
