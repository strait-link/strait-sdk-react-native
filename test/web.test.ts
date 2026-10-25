import { describe, expect, it, vi } from 'vitest';
import { createStrait, type KeyValueStore, type LinkEvent, type StraitRuntime } from '../src/index.js';

// react-native-web (Expo web): there is no install on the web, so the once-per-install
// deferred check never runs and an open never counts as a first launch (the engine
// would record a website visit as an install). Links in the page URL still open,
// are reported and attribute events. Same rule as strait_sdk 0.9.6 (Flutter web).

const CLICK = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';

function setup(opts: { initialURL?: string | null; isWeb?: boolean } = {}) {
  const data = new Map<string, string>();
  const storage: KeyValueStore = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
  const runtime: StraitRuntime = {
    platform: () => 'other',
    collectDevice: () => ({ screenWidth: 390, pixelRatio: 3, language: 'en', timezone: 'Asia/Kolkata' }),
    getInstallReferrer: async () => null,
    getInitialURL: async () => opts.initialURL ?? null,
    onURL: () => () => undefined,
    onAppState: () => () => undefined,
    now: () => 1_800_000_000_000,
    isWeb: () => opts.isWeb ?? true,
  };
  const calls: Array<{ path: string; body: any }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ path: new URL(url).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return { ok: true, status: 200, json: async () => ({ ok: true, matched: false, matchMethod: 'none' }) } as Response;
  }) as unknown as typeof globalThis.fetch;
  const strait = createStrait({ publishableKey: 'st_pub_test_web', endpoint: 'https://acme.strait.link', runtime, fetch, storage });
  const events: LinkEvent[] = [];
  strait.onLink((e) => events.push(e));
  return { strait, calls, events, data };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('react-native-web', () => {
  it('first visit: no deferred check, nothing recorded as an install', async () => {
    const t = setup();
    await t.strait.start();
    await settle();
    expect(t.calls.map((c) => c.path)).not.toContain('/v1/match');
    expect(t.calls.map((c) => c.path)).not.toContain('/v1/referrer');
    expect(t.events).toEqual([]);
  });

  it('a link in the page URL opens and is reported, never as a first launch', async () => {
    const t = setup({ initialURL: `https://shop.example.com/p/42?color=red&strait_click=${CLICK}` });
    await t.strait.start();
    await t.strait.flushOpenReports();
    await settle();
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({ matched: true, path: '/p/42', params: { color: 'red' } });
    const opens = t.calls.filter((c) => c.path === '/v1/open');
    expect(opens.length).toBeGreaterThan(0);
    expect(opens[0]!.body).toMatchObject({ firstLaunch: false, clickId: CLICK });
  });

  it('apps (isWeb false or not given) still run the first-launch check', async () => {
    const t = setup({ isWeb: false });
    await t.strait.start();
    await settle();
    expect(t.calls.map((c) => c.path)).toContain('/v1/match');
  });
});
