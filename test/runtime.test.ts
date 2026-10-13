import { afterEach, describe, expect, it, vi } from 'vitest';

// Mutable per test: the platform and the app's own StraitInstallReferrer module.
const rn = vi.hoisted(() => ({
  Platform: { OS: 'ios' },
  NativeModules: {
    // The old adapter read this (en_IN, not BCP-47); the runtime must not.
    SettingsManager: { settings: { AppleLocale: 'en_IN' } },
  } as Record<string, unknown>,
}));

// A phone held in landscape on first launch: Dimensions reports 844×390.
vi.mock('react-native', () => {
  const sub = { remove() {} };
  return {
    AppState: { addEventListener: () => sub },
    Dimensions: { get: () => ({ width: 844, height: 390, scale: 3, fontScale: 1 }) },
    Linking: { getInitialURL: async () => null, addEventListener: () => sub },
    NativeModules: rn.NativeModules,
    PixelRatio: { get: () => 3 },
    Platform: rn.Platform,
  };
});

describe('device fields report the portrait screen width (B17)', () => {
  it('nativeRuntime (the one phone runtime, Metro / index.native)', async () => {
    const { nativeRuntime } = await import('../src/native.js');
    expect(nativeRuntime().collectDevice().screenWidth).toBe(390);
  });
});

describe('language is BCP-47 from Intl (shared-spec), never the iOS AppleLocale', () => {
  afterEach(() => vi.restoreAllMocks());
  const intl = () =>
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ locale: 'en-IN', timeZone: 'Asia/Kolkata' }),
    } as Intl.DateTimeFormat);

  it('nativeRuntime', async () => {
    intl();
    const { nativeRuntime } = await import('../src/native.js');
    expect(nativeRuntime().collectDevice()).toMatchObject({ language: 'en-IN', timezone: 'Asia/Kolkata' });
  });

  it('legacy resolveDeferredLink without an adapter uses the same runtime', async () => {
    intl();
    const { resolveDeferredLink } = await import('../src/index.js');
    let body: Record<string, unknown> = {};
    const fetch = vi.fn(async (_u: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ matched: false, matchMethod: 'none' }) };
    });
    await resolveDeferredLink({ publishableKey: 'st_pub_live_x', endpoint: 'https://x.strait.link', fetch: fetch as never });
    expect(fetch).toHaveBeenCalledOnce();
    expect(body).toMatchObject({ platform: 'ios', screenWidth: 390, language: 'en-IN', timezone: 'Asia/Kolkata' });
  });
});

describe('legacy resolveDeferredLink on Android reads the StraitInstallReferrer module', () => {
  afterEach(() => {
    rn.Platform.OS = 'ios';
    delete rn.NativeModules.StraitInstallReferrer;
  });

  for (const entry of ['../src/index.native.js', '../src/index.js']) {
    it(`${entry}: referrer → /v1/referrer, exact match`, async () => {
      rn.Platform.OS = 'android';
      rn.NativeModules.StraitInstallReferrer = { getInstallReferrer: async () => 'strait_link=lnk_42&utm_source=x' };
      const { resolveDeferredLink } = await import(entry);
      const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
      const fetch = vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, json: async () => ({ matched: true, linkId: 'lnk_42', matchMethod: 'install_referrer' }) };
      });
      const r = await resolveDeferredLink({ publishableKey: 'st_pub_live_x', endpoint: 'https://x.strait.link', fetch });
      expect(r).toMatchObject({ matched: true, matchMethod: 'install_referrer' });
      expect(calls).toEqual([
        { url: 'https://x.strait.link/v1/referrer', body: { publishableKey: 'st_pub_live_x', linkId: 'lnk_42', platform: 'android' } },
      ]);
    });
  }
});
