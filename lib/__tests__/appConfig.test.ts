// app.json: was iOS (docs/IOS_SIDESTORE.md) und Android gemeinsam halten
// muessen. release-ios.yml veroeffentlicht nur eine IPA mit derselben
// Version wie das Release -- und SideStore erkennt Updates an der
// Build-Nummer.
const app = require('../../app.json');

describe('app.json fuer iOS und Android', () => {
  const e = app.expo;

  it('has the same identity on both platforms', () => {
    expect(e.ios.bundleIdentifier).toBe('digital.aequitas.app');
    expect(e.android.package).toBe(e.ios.bundleIdentifier);
  });

  it('keeps the iOS build number equal to the Android versionCode', () => {
    expect(e.ios.buildNumber).toBe(String(e.android.versionCode));
    expect(e.version).toMatch(/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/);
  });

  it('asks for no microphone on iOS either', () => {
    const kamera = e.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-camera');
    expect(kamera[1].microphonePermission).toBe(false);
    const audio = e.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-audio');
    expect(audio[1].microphonePermission).toBe(false);
    expect(JSON.stringify(e.ios)).not.toMatch(/Microphone|Location|entitlements/);
  });

  it('targets iOS 15.5 (minimum of the face detector, ML Kit)', () => {
    const props = e.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-build-properties');
    expect(props[1].ios.deploymentTarget).toBe('15.5');
  });
});
