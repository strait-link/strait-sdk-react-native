import { describe, expect, it, vi } from 'vitest';
import { createStrait, type StraitRuntime, type KeyValueStore, type LinkEvent } from '../src/index.js';

// Contract B14: every link open is reported exactly once, retried until it
// gets through, and never delays navigation. Plus the B6/B7 revisions.

const PK = 'bk_pub_test_appowner01';
const ENDPOINT = 'https://links.test';
const CLICK = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const OPEN_ID = /^o_[a-z0-9]+_[a-z0-9]{12}$/;
const device = { screenWidth: 411, pixelRatio: 2.625, language: 'en', timezone: 'Asia/Kolkata' };

function fakeRuntime(opts: { initialURL?: string | null; referrer?: string | null; platform?: 'android' | 'ios' } = {}) {
  let urlCb: ((u: string) => void) | null = null;
  let stateCb: ((s: 'active' | 'background' | 'inactive') => void) | null = null;
  let t = 1_800_000_000_000;
  const runtime: StraitRuntime = {
    platform: () => opts.platform ?? 'android',
    collectDevice: () => device,
    getInstallReferrer: async () => opts.referrer ?? null,
    getInitialURL: async () => opts.initialURL ?? null,
    onURL: (cb) => ((urlCb = cb), () => (urlCb = null)),
    onAppState: (cb) => ((stateCb = cb), () => (stateCb = null)),
    now: () => t,
  };
  return { runtime, tap: (u: string) => urlCb?.(u), setState: (s: 'active' | 'background' | 'inactive') => stateCb?.(s), advance: (ms: number) => (t += ms) };
}

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}

type Reply = { status?: number; body?: unknown } | 'offline' | 'hang';
/** Fake engine whose answer per path can change mid-test. */
function fakeEngine(routes: Record<string, Reply>) {
  const calls: Array<{ path: string; body: any }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = routes[path] ?? { status: 404, body: { error: 'not found' } };
    if (r === 'offline') throw new TypeError('Network request failed');
    if (r === 'hang') return new Promise<Response>(() => undefined);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body ?? {} } as Response;
  }) as unknown as typeof fetch;
  return { fetch, calls, routes, of: (path: string) => calls.filter((c) => c.path === path) };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function make(rt: ReturnType<typeof fakeRuntime>, engine: ReturnType<typeof fakeEngine>, storage = memoryStore()) {
  const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: rt.runtime, fetch: engine.fetch, storage });
  const events: LinkEvent[] = [];
  strait.onLink((e) => events.push(e));
  return { strait, events, storage };
}

const RESOLVED = { body: { matched: true, longUrl: 'https://shop.example/p/42', linkId: 'lnk_42', slug: 'sale', recorded: true } };
const ACCEPTED = { status: 202, body: { ok: true, duplicate: false } };
const NO_MATCH = { body: { matched: false, matchMethod: 'none' } };
const returning = () => {
  const s = memoryStore();
  s.data.set('strait.deferredChecked', '1'); // not the first launch
  return s;
};

describe('browser hand-off (custom scheme) with a tap id', () => {
  it('reports the open with its tap id; the app never sees the tap id', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine({ '/v1/open': ACCEPTED });
    const { strait, events } = make(rt, engine, returning());
    await strait.start();
    rt.setState('background'); rt.advance(5000); rt.setState('active'); rt.advance(200);
    rt.tap(`straitlink://shop.example/p/42?color=red&strait_click=${CLICK}`);
    await settle();
    const e = events.at(-1)!;
    expect(e).toMatchObject({ route: 'custom_scheme', url: 'https://shop.example/p/42?color=red', params: { color: 'red' }, appState: 'background' });
    expect(e.id).toMatch(OPEN_ID);
    expect(engine.of('/v1/open')).toHaveLength(1);
    expect(engine.of('/v1/open')[0]!.body).toMatchObject({
      publishableKey: PK, openId: e.id, kind: 'direct', route: 'custom_scheme', appState: 'background',
      platform: 'android', url: 'https://shop.example/p/42', clickId: CLICK, matched: true, firstLaunch: false, // B18: no query
    });
  });
  it('navigation never waits for the report', async () => {
    const rt = fakeRuntime({ initialURL: `straitlink://shop.example/p/1?strait_click=${CLICK}` });
    const engine = fakeEngine({ '/v1/open': 'hang' });
    const { strait, events } = make(rt, engine, returning());
    await strait.start();
    expect(events).toHaveLength(1);
    expect(events[0]!.url).toBe('https://shop.example/p/1');
  });
  it("the customer's own https link is reported too (no tap id)", async () => {
    const rt = fakeRuntime({ initialURL: 'https://shop.example/p/9' });
    const engine = fakeEngine({ '/v1/open': ACCEPTED });
    await make(rt, engine, returning()).strait.start();
    await settle();
    expect(engine.of('/v1/open')[0]!.body).toMatchObject({ route: 'app_link', url: 'https://shop.example/p/9', appState: 'closed' });
    expect(engine.of('/v1/open')[0]!.body.clickId).toBeUndefined();
  });
});

describe('short link (verified App Link from WhatsApp/Gmail): the lookup is the report', () => {
  it('sends openId + app state with /v1/resolve, and nothing else once recorded', async () => {
    const rt = fakeRuntime({ initialURL: 'https://links.test/sale' });
    const engine = fakeEngine({ '/v1/resolve': RESOLVED, '/v1/open': ACCEPTED });
    const { strait, events } = make(rt, engine, returning());
    await strait.start();
    await settle();
    expect(engine.of('/v1/resolve')[0]!.body).toMatchObject({ openId: events[0]!.id, appState: 'closed', firstLaunch: false, at: events[0]!.at });
    expect(engine.of('/v1/open')).toHaveLength(0);
  });
  it('engine answered but could not record → retried via /v1/open with the same openId', async () => {
    const rt = fakeRuntime({ initialURL: 'https://links.test/sale' });
    const engine = fakeEngine({ '/v1/resolve': { body: { ...RESOLVED.body, recorded: false } }, '/v1/open': ACCEPTED });
    const { strait, events } = make(rt, engine, returning());
    await strait.start();
    await settle();
    expect(events[0]!.matched).toBe(true);
    expect(engine.of('/v1/open')[0]!.body).toMatchObject({ openId: events[0]!.id, route: 'app_link', url: 'https://links.test/sale', matched: true, linkId: 'lnk_42' });
  });
  it('offline: saved, then sent (same openId) when the app comes back with network', async () => {
    const rt = fakeRuntime();
    const storage = returning();
    const engine = fakeEngine({ '/v1/resolve': 'offline', '/v1/open': 'offline' });
    const { strait, events } = make(rt, engine, storage);
    await strait.start();
    rt.tap('https://links.test/sale');
    await settle();
    expect(events.at(-1)).toMatchObject({ matched: false, reason: 'network' });
    expect(await strait.pendingOpenReports()).toBe(1);
    // network returns; user leaves and comes back
    engine.routes['/v1/open'] = ACCEPTED;
    rt.setState('background'); rt.advance(10_000); rt.setState('active');
    await settle();
    const sent = engine.of('/v1/open').filter((c) => c.body.openId === events.at(-1)!.id);
    expect(sent.at(-1)!.body).toMatchObject({ route: 'app_link', url: 'https://links.test/sale', matched: false, reason: 'network' });
    expect(await strait.pendingOpenReports()).toBe(0);
  });
});

describe('the retry queue', () => {
  it('keeps reports on 5xx / 429, drops them on 4xx', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine({ '/v1/open': { status: 503 } });
    const { strait } = make(rt, engine, returning());
    await strait.start();
    rt.tap('straitlink://a.b/1');
    await settle();
    expect(await strait.pendingOpenReports()).toBe(1);
    engine.routes['/v1/open'] = { status: 429 };
    await strait.flushOpenReports();
    expect(await strait.pendingOpenReports()).toBe(1);
    engine.routes['/v1/open'] = { status: 400, body: { error: 'bad' } };
    await strait.flushOpenReports();
    expect(await strait.pendingOpenReports()).toBe(0);
  });
  it('survives an app restart (stored), and is sent on the next start', async () => {
    const storage = returning();
    const rt1 = fakeRuntime();
    const e1 = fakeEngine({ '/v1/open': 'offline' });
    const first = make(rt1, e1, storage);
    await first.strait.start();
    rt1.tap('straitlink://a.b/1');
    rt1.tap('straitlink://a.b/2');
    await settle();
    expect(await first.strait.pendingOpenReports()).toBe(2);
    first.strait.stop();

    const rt2 = fakeRuntime();
    const e2 = fakeEngine({ '/v1/open': ACCEPTED });
    const second = make(rt2, e2, storage);
    await second.strait.start();
    await settle();
    expect(e2.of('/v1/open').map((c) => c.body.url)).toEqual(['https://a.b/1', 'https://a.b/2']);
    expect(await second.strait.pendingOpenReports()).toBe(0);
  });
  it('a successful report also sends anything saved earlier', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine({ '/v1/open': 'offline' });
    const { strait } = make(rt, engine, returning());
    await strait.start();
    rt.tap('straitlink://a.b/old');
    await settle();
    engine.routes['/v1/open'] = ACCEPTED;
    rt.tap('straitlink://a.b/new');
    await settle();
    expect(await strait.pendingOpenReports()).toBe(0);
    expect(new Set(engine.of('/v1/open').filter((c) => c.body.url === 'https://a.b/old').map((c) => c.body.openId)).size).toBe(1);
  });
  it('every open has its own id', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine({ '/v1/open': ACCEPTED });
    const { strait, events } = make(rt, engine, returning());
    await strait.start();
    for (let i = 0; i < 5; i++) rt.tap(`straitlink://a.b/${i}`);
    await settle();
    expect(new Set(events.map((e) => e.id)).size).toBe(5);
  });
});

describe('B18: no query or fragment leaves the device or reaches storage', () => {
  const TAP_KEY = 'strait.lastTap';
  it('the /v1/open report keeps only host, path and utm_source; the app still gets the full URL', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine({ '/v1/open': ACCEPTED });
    const { strait, events } = make(rt, engine, returning());
    await strait.start();
    rt.tap('https://shop.example/p/42?email=jo%40x.com&utm_source=sms#reset-token');
    await settle();
    expect(events.at(-1)!).toMatchObject({ url: 'https://shop.example/p/42?email=jo%40x.com&utm_source=sms#reset-token', params: { email: 'jo@x.com', utm_source: 'sms' } });
    expect(engine.of('/v1/open')[0]!.body.url).toBe('https://shop.example/p/42?utm_source=sms');
  });
  it('a failed short-link lookup is queued and resolved without its query or fragment', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine({ '/v1/resolve': 'offline', '/v1/open': 'offline' });
    const { strait, storage } = make(rt, engine, returning());
    await strait.start();
    rt.tap('https://links.test/sale?session=s3cr3t&utm_source=wa#frag');
    await settle();
    expect(engine.of('/v1/resolve')[0]!.body.url).toBe('https://links.test/sale?utm_source=wa');
    const saved = storage.data.get('strait.pendingOpens')!;
    expect(saved).not.toContain('s3cr3t');
    expect(JSON.parse(saved)[0].url).toBe('https://links.test/sale?utm_source=wa');
  });
  it('reports saved by an older SDK are stripped before they are sent or saved again', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine({ '/v1/open': 'offline' });
    const storage = returning();
    storage.data.set('strait.pendingOpens', JSON.stringify([
      { openId: 'o_old_aaaaaaaaaaaa', kind: 'direct', route: 'app_link', appState: 'closed', platform: 'android', url: 'https://shop.example/p?token=abc#x', matched: true, firstLaunch: false, at: 1_800_000_000_000 - 1000 },
    ]));
    const { strait } = make(rt, engine, storage);
    await strait.start();
    await strait.flushOpenReports();
    expect(engine.of('/v1/open')[0]!.body.url).toBe('https://shop.example/p');
    expect(storage.data.get('strait.pendingOpens')).not.toContain('token');
  });
  it('an expired remembered tap is deleted at start, not only ignored', async () => {
    const rt = fakeRuntime();
    const storage = returning();
    storage.data.set(TAP_KEY, JSON.stringify({ clickId: CLICK, at: 1_800_000_000_000 - 8 * 24 * 3600 * 1000 }));
    const { strait } = make(rt, fakeEngine({}), storage);
    await strait.start();
    await settle();
    expect(storage.data.get(TAP_KEY)).toBe('');
  });
  it('a tap that expires while the app runs is deleted by trackEvent and not sent', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine({ '/v1/event': ACCEPTED });
    const storage = returning();
    storage.data.set(TAP_KEY, JSON.stringify({ clickId: CLICK, at: 1_800_000_000_000 }));
    const { strait } = make(rt, engine, storage);
    await strait.start();
    await settle();
    expect(storage.data.get(TAP_KEY)).toContain(CLICK); // still valid at start
    rt.advance(7 * 24 * 3600 * 1000 + 1);
    await strait.trackEvent('purchase');
    await settle();
    expect(engine.of('/v1/event')[0]!.body.clickId).toBeUndefined();
    expect(storage.data.get(TAP_KEY)).toBe('');
  });
  it('a valid remembered tap is kept and sent', async () => {
    const rt = fakeRuntime();
    const engine = fakeEngine({ '/v1/event': ACCEPTED });
    const storage = returning();
    storage.data.set(TAP_KEY, JSON.stringify({ clickId: CLICK, at: 1_800_000_000_000 - 1000 }));
    const { strait } = make(rt, engine, storage);
    await strait.start();
    await strait.trackEvent('purchase');
    await settle();
    expect(engine.of('/v1/event')[0]!.body.clickId).toBe(CLICK);
    expect(storage.data.get(TAP_KEY)).toContain(CLICK);
  });
});

describe('first launch and the deferred check (B6/B7 revised)', () => {
  it('first launch opened by a link: no deferred check, and the open counts as the install', async () => {
    const rt = fakeRuntime({ initialURL: 'https://links.test/sale' });
    const engine = fakeEngine({ '/v1/resolve': RESOLVED });
    const { strait, storage } = make(rt, engine);
    await strait.start();
    expect(engine.of('/v1/resolve')[0]!.body.firstLaunch).toBe(true);
    expect(engine.of('/v1/referrer')).toHaveLength(0);
    expect(engine.of('/v1/match')).toHaveLength(0);
    expect(storage.data.get('strait.deferredChecked')).toBe('1');
  });
  it('Play referrer: sends the tap id and the openId', async () => {
    const rt = fakeRuntime({ referrer: `utm_source=google-play&strait_link=lnk_42&strait_click=${CLICK}` });
    const engine = fakeEngine({ '/v1/referrer': { body: { matched: true, longUrl: 'https://shop.example/p/42', linkId: 'lnk_42', matchMethod: 'install_referrer' } } });
    const { strait, events } = make(rt, engine);
    await strait.start();
    expect(engine.of('/v1/referrer')[0]!.body).toMatchObject({ linkId: 'lnk_42', clickId: CLICK, openId: events[0]!.id, at: events[0]!.at, platform: 'android' });
    expect(events[0]).toMatchObject({ kind: 'deferred', route: 'install_referrer', matched: true });
  });
  it('fingerprint (iOS): sends the openId', async () => {
    const rt = fakeRuntime({ platform: 'ios' });
    const engine = fakeEngine({ '/v1/match': NO_MATCH });
    const { strait, events } = make(rt, engine);
    await strait.start();
    expect(engine.of('/v1/match')[0]!.body).toMatchObject({ openId: events[0]!.id, platform: 'ios', ...device });
  });
  it('offline: not marked done, so the next launch checks again', async () => {
    const storage = memoryStore();
    const e1 = fakeEngine({ '/v1/match': 'offline' });
    const first = make(fakeRuntime(), e1, storage);
    await first.strait.start();
    expect(first.events[0]).toMatchObject({ kind: 'deferred', reason: 'network' });
    expect(storage.data.get('strait.deferredChecked')).toBeUndefined();

    const e2 = fakeEngine({ '/v1/match': NO_MATCH });
    await make(fakeRuntime(), e2, storage).strait.start();
    expect(e2.of('/v1/match')).toHaveLength(1);
    expect(storage.data.get('strait.deferredChecked')).toBe('1');

    const e3 = fakeEngine({ '/v1/match': NO_MATCH });
    await make(fakeRuntime(), e3, storage).strait.start();
    expect(e3.of('/v1/match')).toHaveLength(0); // once per install
  });
  it('server error (5xx) counts as not answered', async () => {
    const storage = memoryStore();
    const engine = fakeEngine({ '/v1/match': { status: 502 } });
    const { strait, events } = make(fakeRuntime(), engine, storage);
    await strait.start();
    expect(events[0]!.reason).toBe('network');
    expect(storage.data.get('strait.deferredChecked')).toBeUndefined();
  });
  it('the debug re-check never records an install (no openId)', async () => {
    const engine = fakeEngine({ '/v1/match': NO_MATCH });
    const { strait } = make(fakeRuntime(), engine, returning());
    await strait.start();
    await strait.checkDeferred();
    expect(engine.of('/v1/match')).toHaveLength(1);
    expect(engine.of('/v1/match')[0]!.body.openId).toBeUndefined();
  });
  it('unreadable storage = already checked (no deferred jump); write failures never throw', async () => {
    const broken: KeyValueStore = { getItem: async () => { throw new Error('io'); }, setItem: async () => { throw new Error('io'); } };
    const engine = fakeEngine({ '/v1/match': NO_MATCH, '/v1/resolve': RESOLVED });
    await make(fakeRuntime(), engine, broken as any).strait.start();
    expect(engine.of('/v1/match')).toHaveLength(0);
    const writeOnly: KeyValueStore = { getItem: async () => null, setItem: async () => { throw new Error('full'); } };
    const e2 = fakeEngine({ '/v1/match': NO_MATCH });
    await expect(make(fakeRuntime(), e2, writeOnly as any).strait.start()).resolves.toBeUndefined();
    const e3 = fakeEngine({ '/v1/resolve': RESOLVED });
    await expect(make(fakeRuntime({ initialURL: 'https://links.test/sale' }), e3, writeOnly as any).strait.start()).resolves.toBeUndefined();
  });
});
