/**
 * B26 (engine ADR 0106): the once-per-install check sends the raw Google Play install referrer as
 * `installReferrer`, so the install row keeps the campaign (utm_source/medium/campaign/term/content) even when
 * the tap never went through a Strait link. The engine keeps only those five tags. Sent only on the calls that
 * record the install (never the record:false re-check), only on Android, only 1..4096 characters, nothing while
 * opted out.
 */
import { describe, expect, it, vi } from 'vitest';
import { INSTALL_REFERRER_MAX, installReferrerField } from '../src/core.js';
import { createStrait, resolveDeferredLink, type KeyValueStore, type StraitRuntime } from '../src/index.js';

const ENDPOINT = 'https://hilltop.links.test';
const ADS = 'utm_source=google&utm_medium=cpc&utm_campaign=strait-qa&gclid=Cj0KCQ';
const STRAIT = 'strait_link=lnk_1&strait_click=3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f&utm_source=google-play';
const device = { screenWidth: 390, pixelRatio: 3, language: 'en', timezone: 'Asia/Kolkata' };

function runtime(platform: 'ios' | 'android', referrer: string | null): StraitRuntime {
  return {
    platform: () => platform,
    collectDevice: () => device,
    getInstallReferrer: async () => referrer,
    getInitialURL: async () => null,
    onURL: () => () => undefined,
    onAppState: () => () => undefined,
    now: () => 1_800_000_000_000,
  };
}
function engine(reply: (path: string) => object = () => ({ matched: false, matchMethod: 'none' })) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ path: new URL(url).pathname, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return { ok: true, status: 200, json: async () => reply(new URL(url).pathname), headers: { get: () => null } } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetch, calls };
}
function store(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
async function firstLaunch(platform: 'ios' | 'android', referrer: string | null, reply?: (path: string) => object) {
  const e = engine(reply);
  await createStrait({ publishableKey: 'st_pub_test_x', endpoint: ENDPOINT, runtime: runtime(platform, referrer), fetch: e.fetch, storage: store() }).start();
  await settle();
  return e.calls;
}
const bodyOf = (calls: Array<{ path: string; body: Record<string, unknown> }>, path: string) => calls.find((c) => c.path === path)?.body;

describe('installReferrer on the install (B26)', () => {
  it('installReferrerField: the raw string when 1..4096 characters, else null', () => {
    expect(INSTALL_REFERRER_MAX).toBe(4096);
    expect(installReferrerField(ADS)).toBe(ADS);
    expect(installReferrerField('a'.repeat(4096))).toBe('a'.repeat(4096));
    for (const v of ['a'.repeat(4097), '', null, undefined, 42]) expect(installReferrerField(v)).toBeNull();
  });

  it('a Google Ads install (no strait_link): /v1/match carries the raw referrer', async () => {
    const calls = await firstLaunch('android', ADS);
    expect(calls.map((c) => c.path)).toEqual(['/v1/match']);
    expect(bodyOf(calls, '/v1/match')).toMatchObject({ installReferrer: ADS, openId: expect.any(String) });
  });

  it('a Strait link install: /v1/referrer carries it; unmatched, the /v1/match fallback carries it too', async () => {
    const matched = await firstLaunch('android', STRAIT, (p) => (p === '/v1/referrer' ? { matched: true, longUrl: 'https://shop.example/p/1', linkId: 'lnk_1' } : {}));
    expect(bodyOf(matched, '/v1/referrer')).toMatchObject({ installReferrer: STRAIT, linkId: 'lnk_1' });
    const unmatched = await firstLaunch('android', STRAIT);
    expect(unmatched.map((c) => c.path)).toEqual(['/v1/referrer', '/v1/match']);
    expect(bodyOf(unmatched, '/v1/match')).toMatchObject({ installReferrer: STRAIT });
  });

  it('over 4096 characters, empty or none: not sent', async () => {
    for (const r of [`${ADS}&x=${'a'.repeat(4096)}`, '', null]) {
      expect(bodyOf(await firstLaunch('android', r), '/v1/match')).not.toHaveProperty('installReferrer');
    }
  });

  it('iPhone: never sent', async () => {
    expect(bodyOf(await firstLaunch('ios', ADS), '/v1/match')).not.toHaveProperty('installReferrer');
  });

  it('checkDeferred() (record:false, no install): not sent', async () => {
    const e = engine();
    const s = store();
    await s.setItem('strait.deferredChecked', '1');
    const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: ENDPOINT, runtime: runtime('android', ADS), fetch: e.fetch, storage: s });
    await strait.start();
    await strait.checkDeferred();
    expect(bodyOf(e.calls, '/v1/match')).toMatchObject({ record: false });
    expect(bodyOf(e.calls, '/v1/match')).not.toHaveProperty('installReferrer');
  });

  it('opted out: nothing is sent at all', async () => {
    const e = engine();
    const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: ENDPOINT, runtime: runtime('android', ADS), fetch: e.fetch, storage: store() });
    await strait.setEnabled(false);
    await strait.start();
    await settle();
    expect(e.calls).toEqual([]);
  });

  it('legacy resolveDeferredLink: /v1/referrer and /v1/match carry it; opted out sends nothing', async () => {
    const e = engine();
    await resolveDeferredLink({ publishableKey: 'st_pub_test_x', endpoint: ENDPOINT, fetch: e.fetch, adapter: runtime('android', STRAIT) });
    expect(bodyOf(e.calls, '/v1/referrer')).toMatchObject({ installReferrer: STRAIT });
    expect(bodyOf(e.calls, '/v1/match')).toMatchObject({ installReferrer: STRAIT });
    const off = engine();
    const s = store();
    await s.setItem('strait.enabled', '0');
    await resolveDeferredLink({ publishableKey: 'st_pub_test_x', endpoint: ENDPOINT, fetch: off.fetch, adapter: runtime('android', ADS), storage: s });
    expect(off.calls).toEqual([]);
  });
});
