import { describe, expect, it } from 'vitest';
import { createStrait, type StraitRuntime, type KeyValueStore } from '../src/index.js';
import { newEventId } from '../src/core.js';

// Contract B13a (shared-spec ADR 0004): trackEvent sends an eventId (the app's order id, else one
// the SDK makes) and keeps events that don't get through in the open-report queue.

const EVENT_ID = /^e_[a-z0-9]+_[a-z0-9]{12}$/;
let t = 1_800_000_000_000;
function runtime(): { runtime: StraitRuntime; setState: (s: 'active') => void } {
  let stateCb: ((s: 'active' | 'background' | 'inactive') => void) | null = null;
  return {
    runtime: {
      platform: () => 'android',
      collectDevice: () => ({ screenWidth: 411, pixelRatio: 2.625, language: 'en', timezone: 'Asia/Kolkata' }),
      getInstallReferrer: async () => null,
      getInitialURL: async () => null,
      onURL: () => () => undefined,
      onAppState: (cb) => ((stateCb = cb), () => (stateCb = null)),
      now: () => t,
    },
    setState: (s) => stateCb?.(s),
  };
}
function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>([['strait.deferredChecked', '1']]);
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}
function engine() {
  const routes: Record<string, number | 'offline'> = { '/v1/event': 202, '/v1/open': 202 };
  const calls: Array<{ path: string; body: any }> = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = routes[path] ?? 404;
    if (r === 'offline') throw new TypeError('Network request failed');
    return { ok: r < 400, status: r, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
  return { fetch, routes, events: () => calls.filter((c) => c.path === '/v1/event').map((c) => c.body), opens: () => calls.filter((c) => c.path === '/v1/open') };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
async function make(e = engine(), s = store()) {
  const rt = runtime();
  const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://links.test', runtime: rt.runtime, fetch: e.fetch, storage: s });
  await strait.start();
  await settle();
  return { strait, e, s, rt };
}
const queue = (s: ReturnType<typeof store>) => JSON.parse(s.data.get('strait.pendingOpens') ?? '[]');

describe('newEventId', () => {
  it('has the engine eventId shape and is unique', () => {
    const a = newEventId(t);
    expect(a).toMatch(EVENT_ID);
    expect(a).toMatch(/^[A-Za-z0-9_.:-]{1,64}$/);
    expect(newEventId(t)).not.toBe(a);
  });
});

describe('trackEvent v2 (B13a)', () => {
  it("sends the app's eventId (order id) as is", async () => {
    const { strait, e } = await make();
    expect(await strait.trackEvent('purchase', { value: 499, currency: 'INR', eventId: 'ord_1001' })).toBe(true);
    expect(e.events()[0]).toMatchObject({ publishableKey: 'st_pub_test_x', event: 'purchase', value: 499, currency: 'INR', eventId: 'ord_1001', platform: 'android' });
  });

  it('makes an eventId when the app gives none', async () => {
    const { strait, e } = await make();
    await strait.trackEvent('signup');
    expect(e.events()[0].eventId).toMatch(EVENT_ID);
  });

  it('offline: returns false, keeps the event (no key) and sends it with the same eventId later', async () => {
    const { strait, e, s, rt } = await make();
    e.routes['/v1/event'] = 'offline';
    expect(await strait.trackEvent('purchase', { value: 5, currency: 'USD', eventId: 'ord_7' })).toBe(false);
    await settle();
    const saved = queue(s);
    expect(saved).toEqual([{ type: 'event', at: t, event: 'purchase', platform: 'android', value: 5, currency: 'USD', eventId: 'ord_7' }]);
    expect(JSON.stringify(saved)).not.toContain('st_pub_');
    expect(await strait.pendingOpenReports()).toBe(1);
    e.routes['/v1/event'] = 202;
    rt.setState('active');
    await settle();
    expect(e.events().at(-1)).toEqual({ publishableKey: 'st_pub_test_x', event: 'purchase', platform: 'android', value: 5, currency: 'USD', eventId: 'ord_7' });
    expect(e.opens()).toHaveLength(0); // never sent as an open report
    expect(queue(s)).toEqual([]);
  });

  it('5xx and 429 are kept; another 4xx (bad eventId) is not', async () => {
    const { strait, e, s } = await make();
    e.routes['/v1/event'] = 400;
    expect(await strait.trackEvent('c', { eventId: 'bad id!' })).toBe(false);
    await settle();
    e.routes['/v1/event'] = 503;
    await strait.trackEvent('a');
    e.routes['/v1/event'] = 429;
    await strait.trackEvent('b');
    await settle();
    expect(queue(s).map((q: any) => q.event)).toEqual(['a', 'b']);
  });

  it('a retried event is sent once per flush and dropped after the engine takes it; opens and events share the queue in order', async () => {
    const { strait, e, s } = await make();
    e.routes['/v1/event'] = 'offline';
    await strait.trackEvent('purchase', { eventId: 'ord_9' });
    await settle();
    // An open report saved earlier by the B14 path sits in the same queue.
    s.data.set('strait.pendingOpens', JSON.stringify([{ openId: 'o_1_aaaaaaaaaaaa', kind: 'direct', route: 'app_link', appState: 'closed', platform: 'android', matched: true, firstLaunch: false, at: t }, ...queue(s)]));
    e.routes['/v1/event'] = 202;
    await strait.flushOpenReports();
    expect(e.opens().map((c) => c.body.openId)).toEqual(['o_1_aaaaaaaaaaaa']);
    expect(e.events().filter((b) => b.eventId === 'ord_9')).toHaveLength(2); // the failed try + one retry
    expect(queue(s)).toEqual([]);
  });

  it('a number order id (plain JS: order.id) is sent as its string, so it still dedupes', async () => {
    // Review 5 Nov: a number failed the engine's string rule (400) and the purchase was lost.
    const { strait, e } = await make();
    expect(await strait.trackEvent('purchase', { eventId: 1001 as unknown as string })).toBe(true);
    expect(e.events().at(-1).eventId).toBe('1001');
  });

  it('the tap id is chosen when the app calls, not at retry time', async () => {
    const { strait, e, s } = await make();
    const TAP = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
    s.data.set('strait.lastTap', JSON.stringify({ clickId: TAP, at: t }));
    e.routes['/v1/event'] = 'offline';
    await strait.trackEvent('purchase', { eventId: 'ord_10' });
    await settle();
    expect(queue(s)[0].clickId).toBe(TAP);
  });
});
