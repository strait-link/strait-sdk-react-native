import { describe, expect, it, vi } from 'vitest';
import { createStrait, type StraitRuntime, type KeyValueStore, type LinkEvent } from '../src/index.js';

const PK = 'bk_pub_test_appowner01';
const ENDPOINT = 'https://links.test';
const device = { screenWidth: 411, pixelRatio: 2.625, language: 'en', timezone: 'Asia/Kolkata' };

/** A controllable fake of the phone: initial URL, URL events, app state, clock. */
function fakeRuntime(opts: { initialURL?: string | null; referrer?: string | null } = {}) {
  let urlCb: ((u: string) => void) | null = null;
  let stateCb: ((s: 'active' | 'background' | 'inactive') => void) | null = null;
  let t = 1_000_000;
  const runtime: StraitRuntime = {
    platform: () => 'android',
    collectDevice: () => device,
    getInstallReferrer: async () => opts.referrer ?? null,
    getInitialURL: async () => opts.initialURL ?? null,
    onURL: (cb) => ((urlCb = cb), () => (urlCb = null)),
    onAppState: (cb) => ((stateCb = cb), () => (stateCb = null)),
    now: () => t,
  };
  return {
    runtime,
    tap: (u: string) => urlCb?.(u),
    setState: (s: 'active' | 'background' | 'inactive') => stateCb?.(s),
    advance: (ms: number) => (t += ms),
  };
}

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}

/** Fake engine: routes by path, records every call. */
function fakeEngine(routes: Record<string, unknown>) {
  const calls: Array<{ path: string; body: any; method: string }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const payload = routes[path];
    return { ok: payload !== undefined, status: payload === undefined ? 404 : 200, json: async () => payload } as Response;
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function start(rt: ReturnType<typeof fakeRuntime>, engine: ReturnType<typeof fakeEngine>, storage = memoryStore()) {
  const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: rt.runtime, fetch: engine.fetch, storage });
  const events: LinkEvent[] = [];
  strait.onLink((e) => events.push(e));
  return { strait, events, storage };
}

const resolved = { '/v1/resolve': { matched: true, longUrl: 'https://shop.example/p/42?color=red', linkId: 'lnk_42', slug: 'sale' } };

describe('direct links', () => {
  it('app closed: a verified link resolves the short URL to its destination', async () => {
    const rt = fakeRuntime({ initialURL: 'https://links.test/sale' });
    const engine = fakeEngine(resolved);
    const { strait, events } = start(rt, engine);
    await strait.start();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'direct', route: 'app_link', appState: 'closed', matched: true,
      rawUrl: 'https://links.test/sale', url: 'https://shop.example/p/42?color=red',
      path: '/p/42', params: { color: 'red' }, linkId: 'lnk_42',
    });
    expect(engine.calls.find((c) => c.path === '/v1/resolve')?.body).toMatchObject({
      publishableKey: PK, url: 'https://links.test/sale', platform: 'android',
    });
  });

  it('app in background: classified as background', async () => {
    const rt = fakeRuntime();
    const { strait, events } = start(rt, fakeEngine(resolved));
    await strait.start();
    rt.setState('background');
    rt.advance(60_000);
    rt.setState('active');
    rt.advance(300);
    rt.tap('https://links.test/sale');
    await flush(); await flush();
    expect(events.at(-1)).toMatchObject({ kind: 'direct', appState: 'background', matched: true });
  });

  it('app in background: link delivered before the app reports active (real Android order)', async () => {
    const rt = fakeRuntime();
    const { strait, events } = start(rt, fakeEngine(resolved));
    await strait.start();
    rt.setState('background');
    rt.advance(60_000);
    rt.tap('https://links.test/sale'); // onNewIntent fires before onResume
    rt.setState('active');
    await flush(); await flush();
    expect(events.at(-1)).toMatchObject({ kind: 'direct', appState: 'background' });
  });

  it('app on screen: the brief pause Android makes to deliver the link is not "background"', async () => {
    const rt = fakeRuntime();
    const { strait, events } = start(rt, fakeEngine(resolved));
    await strait.start();
    rt.advance(30_000);
    rt.setState('background'); // onPause caused by the incoming intent
    rt.advance(40);
    rt.tap('https://links.test/sale');
    rt.advance(30);
    rt.setState('active');
    await flush(); await flush();
    expect(events.at(-1)).toMatchObject({ kind: 'direct', appState: 'foreground' });
  });

  it('app on screen: classified as foreground', async () => {
    const rt = fakeRuntime();
    const { strait, events } = start(rt, fakeEngine(resolved));
    await strait.start();
    rt.advance(30_000);
    rt.tap('https://links.test/sale');
    await flush(); await flush();
    expect(events.at(-1)).toMatchObject({ kind: 'direct', appState: 'foreground' });
  });

  it('browser hand-off (custom scheme) carries the destination, no network call', async () => {
    const rt = fakeRuntime({ initialURL: 'straitlink://shop.example/p/42?color=red' });
    const engine = fakeEngine({});
    const { strait, events } = start(rt, engine);
    await strait.start();
    expect(events[0]).toMatchObject({
      kind: 'direct', route: 'custom_scheme', appState: 'closed', matched: true,
      url: 'https://shop.example/p/42?color=red', path: '/p/42', params: { color: 'red' },
    });
    expect(engine.calls.filter((c) => c.path === '/v1/resolve')).toHaveLength(0);
  });

  it('an expired short link is reported, not silently dropped', async () => {
    const rt = fakeRuntime({ initialURL: 'https://links.test/old' });
    const { strait, events } = start(rt, fakeEngine({ '/v1/resolve': { matched: false, reason: 'expired' } }));
    await strait.start();
    expect(events[0]).toMatchObject({ kind: 'direct', route: 'app_link', matched: false, reason: 'expired' });
  });

  it('late subscribers still receive events that already happened', async () => {
    const rt = fakeRuntime({ initialURL: 'straitlink://shop.example/cart' });
    const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: rt.runtime, fetch: fakeEngine({}).fetch, storage: memoryStore() });
    await strait.start();
    const late: LinkEvent[] = [];
    strait.onLink((e) => late.push(e));
    expect(late).toHaveLength(1);
    expect(late[0]!.path).toBe('/cart');
  });
});

describe('loading state (onLinkStart)', () => {
  it('announces a link before it resolves, with the same id as the result', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine(resolved);
    const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: rt.runtime, fetch: engine.fetch, storage: memoryStore() });
    const order: string[] = [];
    const ids: string[] = [];
    strait.onLinkStart((s) => { order.push(`start:${s.kind}:${s.appState}`); ids.push(s.id); });
    strait.onLink((e) => { order.push(`event:${e.kind}`); ids.push(e.id); });
    await strait.start();
    rt.advance(30_000);
    rt.tap('https://links.test/sale');
    await flush(); await flush();
    expect(order).toEqual(['start:deferred:closed', 'event:deferred', 'start:direct:foreground', 'event:direct']);
    expect(ids[2]).toBe(ids[3]);
  });
});

describe('subscriber isolation', () => {
  it("an app listener that throws doesn't produce a false 'network' event or stop others", async () => {
    const rt = fakeRuntime({ initialURL: 'https://links.test/sale' });
    const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: rt.runtime, fetch: fakeEngine(resolved).fetch, storage: memoryStore() });
    const seen: LinkEvent[] = [];
    strait.onLink(() => { throw new Error('app bug'); });
    strait.onLink((e) => seen.push(e));
    await strait.start();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ matched: true, url: 'https://shop.example/p/42?color=red' });
  });
});

describe('deferred links (installed after tapping)', () => {
  const referrerHit = { '/v1/referrer': { matched: true, longUrl: 'https://shop.example/promo/DIWALI20', linkId: 'lnk_7', matchMethod: 'install_referrer' } };

  it('first launch: Play install referrer → the link they tapped before installing', async () => {
    const rt = fakeRuntime({ referrer: 'utm_source=google-play&strait_link=lnk_7' });
    const engine = fakeEngine(referrerHit);
    const { strait, events } = start(rt, engine);
    await strait.start();
    expect(events[0]).toMatchObject({
      kind: 'deferred', route: 'install_referrer', appState: 'closed', matched: true,
      url: 'https://shop.example/promo/DIWALI20', path: '/promo/DIWALI20', linkId: 'lnk_7',
    });
    expect(engine.calls.find((c) => c.path === '/v1/referrer')?.body).toMatchObject({ publishableKey: PK, linkId: 'lnk_7' });
  });

  it('runs only once per install', async () => {
    const storage = memoryStore();
    const rt = fakeRuntime({ referrer: 'strait_link=lnk_7' });
    await start(rt, fakeEngine(referrerHit), storage).strait.start();
    const second = start(fakeRuntime({ referrer: 'strait_link=lnk_7' }), fakeEngine(referrerHit), storage);
    await second.strait.start();
    expect(second.events.filter((e) => e.kind === 'deferred')).toHaveLength(0);
  });

  it('no referrer link → fingerprint match, reported as not matched when nothing found', async () => {
    const rt = fakeRuntime({ referrer: 'utm_source=google-play&utm_medium=organic' });
    const engine = fakeEngine({ '/v1/match': { matched: false, matchMethod: 'none' } });
    const { strait, events } = start(rt, engine);
    await strait.start();
    expect(events[0]).toMatchObject({ kind: 'deferred', route: 'fingerprint', matched: false });
    expect(engine.calls.find((c) => c.path === '/v1/match')?.body).toMatchObject({ publishableKey: PK, platform: 'android', ...device });
  });

  it('first launch that was itself opened by a link skips the deferred check', async () => {
    const storage = memoryStore();
    const rt = fakeRuntime({ initialURL: 'straitlink://shop.example/cart', referrer: 'strait_link=lnk_7' });
    const { strait, events } = start(rt, fakeEngine(referrerHit), storage);
    await strait.start();
    expect(events.map((e) => e.kind)).toEqual(['direct']);
    expect(await storage.getItem('strait.deferredChecked')).toBe('1');
  });
});

describe('fingerprint check + events', () => {
  it('reports the app side and reads the comparison', async () => {
    const engine = fakeEngine({
      '/v1/debug/fingerprint': { extHash: 'abc', coreHash: 'def', inputs: {} },
    });
    const { strait } = start(fakeRuntime(), engine);
    await strait.reportFingerprint();
    const post = engine.calls.find((c) => c.method === 'POST' && c.path === '/v1/debug/fingerprint');
    expect(post?.body).toMatchObject({ publishableKey: PK, origin: 'app', ...device });
    await strait.compareFingerprint();
    expect(engine.calls.some((c) => c.method === 'GET' && c.path === '/v1/debug/fingerprint')).toBe(true);
  });

  it('trackEvent sends the publishable key', async () => {
    const engine = fakeEngine({ '/v1/event': { ok: true } });
    const { strait } = start(fakeRuntime(), engine);
    expect(await strait.trackEvent('purchase', { value: 49.99, currency: 'USD', linkId: 'lnk_42' })).toBe(true);
    expect(engine.calls.at(-1)?.body).toMatchObject({ publishableKey: PK, event: 'purchase', value: 49.99, linkId: 'lnk_42' });
  });
});

describe('conversion events carry the tap id (B15/B16)', () => {
  const TAP = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
  const OTHER = '11111111-2222-4333-8444-555555555555';
  const DAY = 24 * 60 * 60 * 1000;
  const eventBody = (engine: ReturnType<typeof fakeEngine>) => engine.calls.filter((c) => c.path === '/v1/event').at(-1)?.body;

  it('a browser hand-off tap is remembered and attached to a purchase', async () => {
    const rt = fakeRuntime({ initialURL: `straitlink://shop.example/p/42?strait_click=${TAP}` });
    const engine = fakeEngine({ '/v1/event': { ok: true }, '/v1/open': { ok: true } });
    const { strait, storage } = start(rt, engine);
    await strait.start();
    rt.advance(DAY);
    await strait.trackEvent('purchase', { value: 5, currency: 'USD' });
    expect(eventBody(engine)).toMatchObject({ event: 'purchase', clickId: TAP });
    expect(JSON.parse(storage.data.get('strait.lastTap')!)).toEqual({ clickId: TAP, at: 1_000_000 });
  });

  it('not after 7 days', async () => {
    const rt = fakeRuntime({ initialURL: `straitlink://shop.example/p/42?strait_click=${TAP}` });
    const engine = fakeEngine({ '/v1/event': { ok: true }, '/v1/open': { ok: true } });
    const { strait } = start(rt, engine);
    await strait.start();
    rt.advance(7 * DAY + 1);
    await strait.trackEvent('purchase');
    expect(eventBody(engine)).not.toHaveProperty('clickId');
  });

  it('an explicit clickId overrides the remembered tap', async () => {
    const rt = fakeRuntime({ initialURL: `straitlink://shop.example/p/42?strait_click=${TAP}` });
    const engine = fakeEngine({ '/v1/event': { ok: true }, '/v1/open': { ok: true } });
    const { strait } = start(rt, engine);
    await strait.start();
    await strait.trackEvent('purchase', { clickId: OTHER });
    expect(eventBody(engine)?.clickId).toBe(OTHER);
  });

  it('no remembered tap: no clickId', async () => {
    const engine = fakeEngine({ '/v1/event': { ok: true }, '/v1/match': { matched: false } });
    const { strait } = start(fakeRuntime(), engine);
    await strait.start();
    await strait.trackEvent('signup');
    expect(eventBody(engine)).not.toHaveProperty('clickId');
  });

  it('the Play referrer tap is remembered on a deferred install', async () => {
    const rt = fakeRuntime({ referrer: `strait_link=lnk_7&strait_click=${TAP}` });
    const engine = fakeEngine({ '/v1/event': { ok: true }, '/v1/referrer': { matched: true, longUrl: 'https://shop.example/p/7', linkId: 'lnk_7' } });
    const { strait } = start(rt, engine);
    await strait.start();
    await strait.trackEvent('purchase');
    expect(eventBody(engine)?.clickId).toBe(TAP);
  });

  it('a newer short-link open with no tap id in the reply (older engine) forgets the older tap', async () => {
    const rt = fakeRuntime({ initialURL: `straitlink://shop.example/p/42?strait_click=${TAP}` });
    const engine = fakeEngine({ ...resolved, '/v1/event': { ok: true }, '/v1/open': { ok: true } });
    const { strait } = start(rt, engine);
    await strait.start();
    rt.tap('https://links.test/sale');
    await flush();
    await flush();
    await strait.trackEvent('purchase');
    expect(eventBody(engine)).not.toHaveProperty('clickId');
  });

  it('B16: a short-link open remembers the tap id the engine returns, replacing the older tap', async () => {
    const rt = fakeRuntime({ initialURL: `straitlink://shop.example/p/42?strait_click=${OTHER}` });
    const engine = fakeEngine({ '/v1/resolve': { ...resolved['/v1/resolve'], recorded: true, clickId: TAP.toUpperCase() }, '/v1/event': { ok: true }, '/v1/open': { ok: true } });
    const { strait, storage } = start(rt, engine);
    await strait.start();
    rt.advance(1000);
    rt.tap('https://links.test/sale');
    await flush();
    await flush();
    await strait.trackEvent('purchase');
    expect(eventBody(engine)?.clickId).toBe(TAP);
    expect(JSON.parse(storage.data.get('strait.lastTap')!)).toEqual({ clickId: TAP, at: 1_001_000 });
  });

  it('B16: a fingerprint match remembers the tap id the engine returns', async () => {
    const engine = fakeEngine({ '/v1/event': { ok: true }, '/v1/match': { matched: true, longUrl: 'https://shop.example/p/9', linkId: 'lnk_9', clickId: TAP } });
    const { strait } = start(fakeRuntime(), engine);
    await strait.start();
    await strait.trackEvent('purchase');
    expect(eventBody(engine)?.clickId).toBe(TAP);
  });

  it('B16: the referrer reply\'s tap id wins over the parsed one', async () => {
    const rt = fakeRuntime({ referrer: `strait_link=lnk_7&strait_click=${OTHER}` });
    const engine = fakeEngine({ '/v1/event': { ok: true }, '/v1/referrer': { matched: true, longUrl: 'https://shop.example/p/7', linkId: 'lnk_7', clickId: TAP } });
    const { strait } = start(rt, engine);
    await strait.start();
    await strait.trackEvent('purchase');
    expect(eventBody(engine)?.clickId).toBe(TAP);
  });

  it('B16: a malformed reply tap id counts as none (forgets)', async () => {
    const rt = fakeRuntime({ initialURL: `straitlink://shop.example/p/42?strait_click=${TAP}` });
    const engine = fakeEngine({ '/v1/resolve': { ...resolved['/v1/resolve'], clickId: 'nope' }, '/v1/event': { ok: true }, '/v1/open': { ok: true } });
    const { strait } = start(rt, engine);
    await strait.start();
    rt.tap('https://links.test/sale');
    await flush();
    await flush();
    await strait.trackEvent('purchase');
    expect(eventBody(engine)).not.toHaveProperty('clickId');
  });

  it('unreadable storage never blocks the event', async () => {
    const broken: KeyValueStore = { getItem: async () => { throw new Error('io'); }, setItem: async () => { throw new Error('io'); } };
    const engine = fakeEngine({ '/v1/event': { ok: true }, '/v1/open': { ok: true } });
    const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: fakeRuntime({ initialURL: `straitlink://x.example/?strait_click=${TAP}` }).runtime, fetch: engine.fetch, storage: broken });
    await strait.start();
    expect(await strait.trackEvent('purchase')).toBe(true);
    expect(eventBody(engine)).not.toHaveProperty('clickId');
  });
});

import { splitUrl } from '../src/strait.js';
describe('splitUrl (no reliance on React Native URL)', () => {
  it('splits https and custom-scheme URLs', () => {
    expect(splitUrl('https://Links.Test/sale?utm_source=sms&x=a%20b')).toEqual({
      scheme: 'https', host: 'links.test', path: '/sale', params: { utm_source: 'sms', x: 'a b' },
    });
    expect(splitUrl('straitlink://shop.example/p/42#frag')).toEqual({
      scheme: 'straitlink', host: 'shop.example', path: '/p/42', params: {},
    });
    expect(splitUrl('https://links.test')?.path).toBe('/');
    expect(splitUrl('not a url')).toBeNull();
  });
});

import { browserScreenWidth } from '../src/strait.js';
describe('browserScreenWidth (match what the browser reports at the tap)', () => {
  it('rounds fractional widths up, like Chrome (1080px @ 2.625 → 412)', () => {
    expect(browserScreenWidth(1080 / 2.625)).toBe(412);
    expect(browserScreenWidth(1440 / 3.5)).toBe(412); // 411.43
  });
  it('leaves whole widths alone, including float noise (iPhone points)', () => {
    expect(browserScreenWidth(393)).toBe(393);
    expect(browserScreenWidth(390.0000001)).toBe(390);
  });
});

import { portraitScreenWidth } from '../src/strait.js';
describe('portraitScreenWidth (B17: the shorter side, like Safari screen.width at the tap)', () => {
  it('reports the portrait width when the app starts in landscape', () => {
    expect(portraitScreenWidth(844, 390)).toBe(390);
    expect(portraitScreenWidth(390, 844)).toBe(390);
  });
  it('rounds the shorter side like the browser (Android 1080px @ 2.625)', () => {
    expect(portraitScreenWidth(2340 / 2.625, 1080 / 2.625)).toBe(412);
  });
});
