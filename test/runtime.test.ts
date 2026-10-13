import { afterEach, describe, expect, it, vi } from 'vitest';

// A phone held in landscape on first launch: Dimensions reports 844×390.
vi.mock('react-native', () => {
  const sub = { remove() {} };
  return {
    AppState: { addEventListener: () => sub },
    Dimensions: { get: () => ({ width: 844, height: 390, scale: 3, fontScale: 1 }) },
    Linking: { getInitialURL: async () => null, addEventListener: () => sub },
    // The old adapter read this (en_IN, not BCP-47); the runtime must not.
    NativeModules: { SettingsManager: { settings: { AppleLocale: 'en_IN' } } },
    PixelRatio: { get: () => 3 },
    Platform: { OS: 'ios' },
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
