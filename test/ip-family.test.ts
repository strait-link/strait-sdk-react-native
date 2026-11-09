/**
 * Contract B24 (engine ADR 0101): the first-launch check asked over IPv6 and found nothing; the engine names
 * its IPv4-only URL and the SDK asks once more there, same openId, same fields. Only a match there counts.
 */
import { describe, expect, it, vi } from 'vitest';
import { ipv4MatchUrl } from '../src/strait.js';
import { createStrait, type KeyValueStore, type LinkEvent, type StraitRuntime } from '../src/index.js';

const PK = 'st_pub_test_appowner01';
const ENDPOINT = 'https://hilltop.links.test';
const V4 = 'https://v4.straitlink.test/v1/match';
const device = { screenWidth: 390, pixelRatio: 3, language: 'en', timezone: 'Asia/Kolkata' };
const missV6 = { matched: false, matchMethod: 'none', reasons: ['no_candidate'], ios: { deviceMatching: true, pasteHandoff: false }, ipv4Match: V4 };
const hitV4 = {
  matched: true, longUrl: 'https://shop.example/p/42', linkId: 'lnk_42', clickId: '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f', matchMethod: 'exact_ext',
  reasons: ['exact_ext', 'ip_family'], match: { method: 'fingerprint', confidence: 'probable' },
};

function runtime(): StraitRuntime {
  return {
    platform: () => 'ios',
    collectDevice: () => device,
    getInstallReferrer: async () => null,
    getInitialURL: async () => null,
    onURL: () => () => undefined,
    onAppState: () => () => undefined,
    now: () => 1_800_000_000_000,
  };
}

/** Routes keyed by host + path. `offline` hosts throw. */
function engine(routes: Record<string, unknown>, offline: string[] = []) {
  const calls: Array<{ host: string; path: string; body: any }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push({ host: u.host, path: u.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (offline.includes(u.host)) throw new TypeError('Network request failed');
    const body = routes[`${u.host}${u.pathname}`];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body ?? {} } as Response;
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

function store(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}

async function run(routes: Record<string, unknown>, offline: string[] = []) {
  const e = engine(routes, offline);
  const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: runtime(), fetch: e.fetch, storage: store() });
  const events: LinkEvent[] = [];
  strait.onLink((ev) => events.push(ev));
  await strait.start();
  await new Promise((r) => setTimeout(r, 0));
  return { strait, events, calls: e.calls };
}

describe('B24: ask the IPv4-only URL once after an IPv6 miss', () => {
  it('same body to the named URL; its match is the answer (probable)', async () => {
    const { events, calls } = await run({ 'hilltop.links.test/v1/match': missV6, 'v4.straitlink.test/v1/match': hitV4 });
    const asks = calls.filter((c) => c.path === '/v1/match');
    expect(asks.map((c) => c.host)).toEqual(['hilltop.links.test', 'v4.straitlink.test']);
    expect(asks[1]!.body).toEqual(asks[0]!.body);
    expect(asks[0]!.body.openId).toBeTruthy();
    expect(events[0]).toMatchObject({ kind: 'deferred', matched: true, url: 'https://shop.example/p/42', linkId: 'lnk_42', match: { confidence: 'probable' } });
  });

  it('no match there, or the URL unreachable: the first answer stands', async () => {
    const a = await run({ 'hilltop.links.test/v1/match': missV6, 'v4.straitlink.test/v1/match': { matched: false } });
    expect(a.events[0]).toMatchObject({ matched: false, reason: 'no_match' });
    const b = await run({ 'hilltop.links.test/v1/match': missV6, 'v4.straitlink.test/v1/match': hitV4 }, ['v4.straitlink.test']);
    expect(b.events[0]).toMatchObject({ matched: false, reason: 'no_match' });
  });

  it('no second ask without the field, with a bad URL, or on the read-only checkDeferred()', async () => {
    for (const bad of [undefined, 'http://v4.straitlink.test/v1/match', 'https://v4.straitlink.test/v1/open', `${V4}?x=1`, 'javascript:alert(1)', '/v1/match']) {
      const { calls } = await run({ 'hilltop.links.test/v1/match': { ...missV6, ipv4Match: bad }, 'v4.straitlink.test/v1/match': hitV4 });
      expect(calls.filter((c) => c.host === 'v4.straitlink.test')).toHaveLength(0);
    }
    const { strait, calls } = await run({ 'hilltop.links.test/v1/match': missV6, 'v4.straitlink.test/v1/match': { matched: false } });
    const before = calls.length;
    await strait.checkDeferred();
    expect(calls.slice(before).map((c) => c.host)).toEqual(['hilltop.links.test']);
  });

  it('switched off during the first ask: nothing is sent to the IPv4 URL', async () => {
    const e = engine({ 'hilltop.links.test/v1/match': missV6, 'v4.straitlink.test/v1/match': hitV4 });
    let strait!: ReturnType<typeof createStrait>;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const res = await (e.fetch as any)(url, init);
      if (new URL(url).host === 'hilltop.links.test') await strait.setEnabled(false);
      return res;
    }) as unknown as typeof globalThis.fetch;
    strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: runtime(), fetch, storage: store() });
    await strait.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(e.calls.filter((c) => c.host === 'v4.straitlink.test')).toHaveLength(0);
  });

  it('paste handoff (B19) follows the first answer: still runs when the IPv4 ask misses, never when it matches', async () => {
    const pasteMiss = { ...missV6, ios: { deviceMatching: true, pasteHandoff: true } };
    const claimOk = { matched: true, longUrl: 'https://shop.example/x', linkId: 'lnk_1', matchMethod: 'clipboard' };
    const clip = () => {
      const seen: string[] = [];
      return { seen, clip: { hasProbableWebUrl: async () => (seen.push('detect'), true), readText: async () => (seen.push('read'), 'https://hilltop.links.test/h/AbCdEfGhIjKlMnOpQrStUv') } };
    };
    for (const [second, expectClaim] of [[{ matched: false }, true], [hitV4, false]] as const) {
      const c = clip();
      const e = engine({ 'hilltop.links.test/v1/match': pasteMiss, 'v4.straitlink.test/v1/match': second, 'hilltop.links.test/v1/handoff/claim': claimOk });
      const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: runtime(), fetch: e.fetch, storage: store(), clipboard: c.clip });
      const events: LinkEvent[] = [];
      strait.onLink((ev) => events.push(ev));
      await strait.start();
      await new Promise((r) => setTimeout(r, 0));
      expect(e.calls.some((x) => x.path === '/v1/handoff/claim')).toBe(expectClaim);
      expect(c.seen.length > 0).toBe(expectClaim);
      expect(events[0]).toMatchObject(expectClaim ? { route: 'clipboard', matched: true } : { route: 'fingerprint', linkId: 'lnk_42' });
    }
  });

  it('ipv4MatchUrl accepts only a plain https …/v1/match URL', () => {
    expect(ipv4MatchUrl('https://v4.straitlink.in/v1/match')).toBe('https://v4.straitlink.in/v1/match');
    for (const bad of [null, 1, '', 'https://v4.straitlink.in/v1/match/', 'https://u:p@v4.straitlink.in/v1/match', 'https://v4.straitlink.in/v1/match#x', 'ftp://x/v1/match']) {
      expect(ipv4MatchUrl(bad)).toBeNull();
    }
  });
});
