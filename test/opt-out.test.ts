import { describe, expect, it } from 'vitest';
import { createStrait, type StraitRuntime, type KeyValueStore } from '../src/index.js';

// Opt-out (td2-27): setEnabled(false) = no reports, no events, no install matching, kept across
// launches; a link that carries its own destination still reaches onLink (the app's own navigation).

const t = 1_800_000_000_000;
function runtime(initial: string | null = null): { runtime: StraitRuntime; open: (u: string) => void } {
  let urlCb: ((u: string) => void) | null = null;
  return {
    runtime: {
      platform: () => 'android',
      collectDevice: () => ({ screenWidth: 411, pixelRatio: 2.625, language: 'en', timezone: 'Asia/Kolkata' }),
      getInstallReferrer: async () => null,
      getInitialURL: async () => initial,
      onURL: (cb) => ((urlCb = cb), () => (urlCb = null)),
      onAppState: () => () => undefined,
      now: () => t,
    },
    open: (u) => urlCb?.(u),
  };
}
/** Empty storage = a first launch (the deferred check is due). */
function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}
function engine(reply: (path: string) => { status: number; json: object } = () => ({ status: 202, json: { matched: false } })) {
  const calls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const fetch = (async (url: string, init?: { body?: string }) => {
    const path = new URL(url).pathname;
    calls.push(path);
    bodies.push(init?.body ? JSON.parse(init.body) : {});
    const r = reply(path);
    return { ok: r.status < 300, status: r.status, json: async () => r.json, headers: { get: () => null } } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetch, calls, bodies };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
const make = (e: ReturnType<typeof engine>, s: KeyValueStore, rt = runtime()) =>
  ({ strait: createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://acme.strait.link', runtime: rt.runtime, fetch: e.fetch, storage: s }), rt });

describe('setEnabled (opt-out)', () => {
  it('disabled: sends nothing (no deferred check, no open report, no event, no flush), links still route', async () => {
    const e = engine();
    const s = store();
    s.data.set('strait.pendingOpens', JSON.stringify([{ openId: 'o_1', kind: 'direct', route: 'app_link', appState: 'closed', platform: 'android', matched: true, firstLaunch: false, at: t }]));
    const { strait, rt } = make(e, s);
    const links: Array<{ matched: boolean; url?: string; reason?: string }> = [];
    strait.onLink((l) => links.push(l));
    await strait.setEnabled(false);
    await strait.start();
    rt.open('acme://product/42');
    expect(await strait.trackEvent('purchase', { value: 5, eventId: 'ord_1' })).toBe(false);
    await strait.flushOpenReports();
    expect(await strait.checkDeferred()).toMatchObject({ matched: false, reason: 'disabled' });
    await settle();
    expect(e.calls).toEqual([]);
    expect(links).toContainEqual(expect.objectContaining({ matched: true, rawUrl: 'acme://product/42' }));
    expect(await strait.pendingOpenReports()).toBe(0); // reports saved before the opt-out are deleted
    expect(s.data.get('strait.deferredChecked') ?? '').toBe(''); // the check is still due
  });

  it('disabled: a short link still routes through /v1/lookup (records nothing), and nothing else is sent', async () => {
    const e = engine((p) => p === '/v1/lookup'
      ? { status: 200, json: { matched: true, longUrl: 'https://shop.example/p/42?color=red', linkId: 'lnk_42', slug: 'sale' } }
      : { status: 202, json: {} });
    const s = store();
    const { strait, rt } = make(e, s);
    const links: Array<{ matched: boolean; path?: string; params?: Record<string, string>; reason?: string; clickId?: string }> = [];
    strait.onLink((l) => links.push(l));
    await strait.setEnabled(false);
    await strait.start();
    rt.open('https://acme.strait.link/sale?utm_source=sms&secret=1');
    await settle();
    await strait.flushOpenReports();
    await settle();
    expect(e.calls).toEqual(['/v1/lookup']);
    // Only the key and host + path leave the device: no query, openId, platform, device or app state.
    expect(e.bodies[0]).toEqual({ publishableKey: 'st_pub_test_x', url: 'https://acme.strait.link/sale' });
    expect(links).toContainEqual(expect.objectContaining({ matched: true, path: '/p/42', params: { color: 'red' } }));
    expect(links[0]).not.toHaveProperty('clickId');
    expect(await strait.pendingOpenReports()).toBe(0);
    expect(s.data.get('strait.lastTap') ?? '').toBe(''); // no tap remembered
  });

  it('disabled: an engine without /v1/lookup (404) or no network: reason disabled, nothing queued; a 200 miss keeps its reason', async () => {
    const cases: Array<[(p: string) => { status: number; json: object }, string]> = [
      [() => ({ status: 404, json: { error: 'not found' } }), 'disabled'],
      [() => { throw new TypeError('Network request failed'); }, 'disabled'],
      [() => ({ status: 200, json: { matched: false, reason: 'expired' } }), 'expired'],
    ];
    for (const [reply, reason] of cases) {
      const s = store();
      const { strait, rt } = make(engine(reply), s);
      const links: Array<{ matched: boolean; reason?: string }> = [];
      strait.onLink((l) => links.push(l));
      await strait.setEnabled(false);
      await strait.start();
      rt.open('https://acme.strait.link/sale');
      await settle();
      expect(links).toEqual([expect.objectContaining({ matched: false, reason })]);
      expect(await strait.pendingOpenReports()).toBe(0);
    }
  });

  it('persists across launches', async () => {
    const s = store();
    await make(engine(), s).strait.setEnabled(false);
    const e = engine();
    const { strait } = make(e, s); // next launch, same storage
    expect(await strait.isEnabled()).toBe(false);
    await strait.start();
    await strait.trackEvent('signup');
    await settle();
    expect(e.calls).toEqual([]);
  });

  it('setEnabled(true) resumes: the skipped first-launch check runs and events are sent', async () => {
    const e = engine();
    const s = store();
    const { strait } = make(e, s);
    await strait.setEnabled(false);
    await strait.start();
    await settle();
    expect(e.calls).toEqual([]);
    await strait.setEnabled(true);
    await settle();
    expect(await strait.isEnabled()).toBe(true);
    expect(e.calls).toContain('/v1/match');
    expect(s.data.get('strait.deferredChecked')).toBe('1');
    expect(await strait.trackEvent('purchase', { eventId: 'ord_2' })).toBe(true);
    expect(e.calls).toContain('/v1/event');
  });
});
