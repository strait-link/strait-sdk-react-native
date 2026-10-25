/**
 * React Native runtime with static imports. Bundlers (Metro) and the
 * react-native Jest preset load `index.native.js`, which uses this, so apps
 * never depend on dynamic import().
 */
// @ts-expect-error optional peer dependency, present in React Native apps
import { AppState, Dimensions, Linking, NativeModules, PixelRatio, Platform } from 'react-native';
import { deviceClassForSize, portraitScreenWidth } from './core.js';
import { reactNativeStoreSheetOpener } from './store-sheet.js';
import type { StraitRuntime } from './strait.js';

export function nativeRuntime(opts: { installReferrer?: () => Promise<string | null> } = {}): StraitRuntime {
  return {
    storeSheet: reactNativeStoreSheetOpener({ NativeModules, Linking }),
    platform: () => (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other'),
    isWeb: () => Platform.OS === 'web',
    collectDevice: () => ({
      screenWidth: portraitScreenWidth(Dimensions.get('screen').width, Dimensions.get('screen').height),
      pixelRatio: PixelRatio.get(),
      language: intl('locale', 'en'),
      timezone: intl('timeZone', 'XX'),
    }),
    // Contract B14: iOS by the device idiom (iPad), Android by the smallest-width rule (sw600dp).
    deviceClass: () =>
      Platform.OS === 'ios'
        ? Platform.isPad ? 'tablet' : 'phone'
        : Platform.OS === 'android'
          ? deviceClassForSize(Math.min(Dimensions.get('screen').width, Dimensions.get('screen').height))
          : undefined,
    getInstallReferrer: async () =>
      Platform.OS === 'android' && opts.installReferrer ? opts.installReferrer() : null,
    getInitialURL: () => Linking.getInitialURL(),
    onURL: (cb) => {
      const sub = Linking.addEventListener('url', ({ url }: { url: string }) => cb(url));
      return () => sub.remove();
    },
    onAppState: (cb) => {
      const sub = AppState.addEventListener('change', cb);
      return () => sub.remove();
    },
    now: () => Date.now(),
  };
}

/**
 * For the legacy `resolveDeferredLink`: the Play Install Referrer from the app's own
 * `StraitInstallReferrer` native module (`getInstallReferrer(): Promise<string>`), or null.
 */
export async function moduleInstallReferrer(): Promise<string | null> {
  try {
    return (await NativeModules?.StraitInstallReferrer?.getInstallReferrer?.()) ?? null;
  } catch {
    return null;
  }
}

function intl(field: 'locale' | 'timeZone', fallback: string): string {
  try {
    const o = Intl.DateTimeFormat().resolvedOptions();
    return (field === 'locale' ? o.locale : o.timeZone) || fallback;
  } catch {
    return fallback;
  }
}
