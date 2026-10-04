/**
 * React Native runtime with static imports. Bundlers (Metro) and the
 * react-native Jest preset load `index.native.js`, which uses this, so apps
 * never depend on dynamic import().
 */
// @ts-expect-error optional peer dependency, present in React Native apps
import { AppState, Dimensions, Linking, PixelRatio, Platform } from 'react-native';
import { portraitScreenWidth } from './core.js';
import type { StraitRuntime } from './strait.js';

export function nativeRuntime(opts: { installReferrer?: () => Promise<string | null> } = {}): StraitRuntime {
  return {
    platform: () => (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other'),
    collectDevice: () => ({
      screenWidth: portraitScreenWidth(Dimensions.get('screen').width, Dimensions.get('screen').height),
      pixelRatio: PixelRatio.get(),
      language: intl('locale', 'en'),
      timezone: intl('timeZone', 'XX'),
    }),
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

function intl(field: 'locale' | 'timeZone', fallback: string): string {
  try {
    const o = Intl.DateTimeFormat().resolvedOptions();
    return (field === 'locale' ? o.locale : o.timeZone) || fallback;
  } catch {
    return fallback;
  }
}
