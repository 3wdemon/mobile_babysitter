/**
 * Detox starter smoke test (skeleton placeholder).
 *
 * SKIPPED on purpose: a real Detox run needs the native app built for a
 * simulator/emulator (`npm run e2e:native:build`) plus a booted device, which
 * is heavy and not yet available in this environment or CI. This file exists to
 * prove the Detox + Jest wiring is valid and to host the first real scenario.
 *
 * Enable (drop `.skip`) once a Detox build is available in env/CI — see DMY-40.
 */
// eslint-disable-next-line jest/no-disabled-tests -- intentional skeleton skip; see file header
describe.skip('app launch (enable when detox build available in env/CI)', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('launches the app', async () => {
    // Placeholder assertion: the app process is alive after launch.
    // Replace with a real on-screen element matcher when scenarios land.
    // NB: use Detox's `expect` (detox.expect) explicitly — this program also
    // pulls in jest's global `expect`, whose matchers don't include `toExist`.
    await detox.expect(element(by.id('app-root'))).toExist();
  });
});
