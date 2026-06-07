/**
 * Native bindings the SDK needs, behind an interface so the pure resolution
 * logic is testable in plain Node (no React Native runtime required).
 */
export interface DeviceFields {
  screenWidth: number;
  pixelRatio: number;
  language: string;
  timezone: string;
}

export interface NativeAdapter {
  platform(): 'ios' | 'android' | 'other';
  collectDevice(): DeviceFields;
  /**
   * Android only: the Play Install Referrer string (e.g.
   * "strait_link=lnk_123&utm_source=..."), or null if unavailable / iOS.
   */
  getInstallReferrer(): Promise<string | null>;
}

/**
 * The real React Native adapter. Imports `react-native` lazily so this package
 * can be required in non-RN contexts (tests, SSR tooling) without crashing.
 */
export async function createReactNativeAdapter(): Promise<NativeAdapter> {
  // @ts-expect-error optional peer dependency, resolved at app runtime
  const rn = await import('react-native');
  const { Dimensions, PixelRatio, Platform, NativeModules } = rn;

  return {
    platform() {
      return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';
    },
    collectDevice() {
      const { width } = Dimensions.get('screen');
      return {
        screenWidth: Math.round(width),
        pixelRatio: PixelRatio.get(),
        language: resolveLocale(rn),
        timezone: resolveTimezone(),
      };
    },
    async getInstallReferrer() {
      // Optional native module (react-native-play-install-referrer or our own).
      const mod = NativeModules?.StraitInstallReferrer;
      if (Platform.OS !== 'android' || !mod?.getInstallReferrer) return null;
      try {
        return await mod.getInstallReferrer();
      } catch {
        return null;
      }
    },
  };
}

function resolveLocale(rn: { NativeModules?: Record<string, unknown> }): string {
  // RN exposes locale differently per platform/version; fall back to 'en'.
  const settings = rn.NativeModules?.SettingsManager as
    | { settings?: { AppleLocale?: string; AppleLanguages?: string[] } }
    | undefined;
  const i18n = rn.NativeModules?.I18nManager as { localeIdentifier?: string } | undefined;
  return (
    settings?.settings?.AppleLocale ||
    settings?.settings?.AppleLanguages?.[0] ||
    i18n?.localeIdentifier ||
    'en'
  );
}

function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'XX';
  } catch {
    return 'XX';
  }
}

/** Extract the Strait link id from a Play Install Referrer string. */
export function parseStraitLink(referrer: string | null): string | null {
  if (!referrer) return null;
  const params = new URLSearchParams(referrer);
  return params.get('strait_link');
}
