import { describe, expect, it, vi } from 'vitest';
import { createStrait, type KeyValueStore, type LinkEvent, type StraitRuntime } from '../src/index.js';

// react-native-web (Expo web): there is no install on the web, so the once-per-install
// deferred check never runs and an open never counts as a first launch (the engine
// would record a website visit as an install). A page URL is reported as an open only
// when it carries a Strait tap id (strait_click); other page URLs still reach the link
// callback for routing but are never reported. Same rule in sdk-web and Flutter web.

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

  // A web open is counted only for a landing from a Strait tap: the engine appends
  // strait_click=<tap id> when it sends a tap to the web. Anything else is a page view.
  it('a landing with strait_click sends one /v1/open joined to the tap, under openId web-<tap id>', async () => {
    const t = setup({ initialURL: `https://shop.example.com/p/42?color=red&strait_click=${CLICK.toUpperCase()}` });
    await t.strait.start();
    await t.strait.flushOpenReports();
    await settle();
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({ id: `web-${CLICK}`, matched: true, path: '/p/42', params: { color: 'red' } });
    const opens = t.calls.filter((c) => c.path === '/v1/open');
    expect(opens).toHaveLength(1);
    expect(opens[0]!.body).toMatchObject({
      openId: `web-${CLICK}`, kind: 'direct', route: 'app_link', platform: 'web',
      url: 'https://shop.example.com/p/42', clickId: CLICK, matched: true, firstLaunch: false,
    });
    await t.strait.trackEvent('purchase');
    expect(t.calls.find((c) => c.path === '/v1/event')!.body).toMatchObject({ clickId: CLICK });
  });

  it('a reload of the same landing reports the same openId (the engine de-duplicates it)', async () => {
    const url = `https://shop.example.com/p/42?strait_click=${CLICK}`;
    const a = setup({ initialURL: url });
    const b = setup({ initialURL: url });
    await a.strait.start();
    await b.strait.start();
    await settle();
    const ids = [...a.calls, ...b.calls].filter((c) => c.path === '/v1/open').map((c) => c.body.openId);
    expect(ids).toEqual([`web-${CLICK}`, `web-${CLICK}`]);
  });

  it('a page URL without strait_click is a page view: link callback for routing, nothing reported', async () => {
    for (const url of [
      'https://shop.example.com/p/42?color=red',
      'https://shop.example.com/p/42?strait_click=not-a-tap-id',
      'https://acme.strait.link/abc', // even on a link host: no /v1/resolve from a web page
    ]) {
      const t = setup({ initialURL: url });
      await t.strait.start();
      await t.strait.flushOpenReports();
      await t.strait.trackEvent('purchase');
      await settle();
      expect(t.calls.map((c) => c.path)).toEqual(['/v1/event']);
      expect(t.calls[0]!.body.clickId).toBeUndefined();
      expect(t.events).toHaveLength(1);
      expect(t.events[0]).toMatchObject({ matched: true, url: url.replace(/\?strait_click=.*$/, '') });
      expect(await t.strait.pendingOpenReports()).toBe(0);
    }
  });

  it('apps (isWeb false or not given) still run the first-launch check', async () => {
    const t = setup({ isWeb: false });
    await t.strait.start();
    await settle();
    expect(t.calls.map((c) => c.path)).toContain('/v1/match');
  });
});
