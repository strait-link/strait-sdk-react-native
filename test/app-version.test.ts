/**
 * td2-23 (engine ADR 0086): every call that records an app open or install carries the app's version
 * (`appVersion`, from the `appVersion` config option) and this SDK's own (`sdkVersion`), so support can ask
 * "which version?" from the record. Never on /v1/lookup (the opt-out path) or /v1/event, and nothing at all
 * while opted out. Saved open reports keep the versions they were built with.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SDK_VERSION, cleanVersion } from '../src/core.js';
import { createStrait, resolveDeferredLink, type ClipboardAccess, type KeyValueStore, type StraitRuntime } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const V = { appVersion: '4.12.0 (812)', sdkVersion: pkg.version };
const ENDPOINT = 'https://hilltop.links.test';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const HANDOFF = `${ENDPOINT}/h/${TOKEN}`;
const device = { screenWidth: 390, pixelRatio: 3, language: 'en', timezone: 'Asia/Kolkata' };
const t = 1_800_000_000_000;

function runtime(platform: 'ios' | 'android', referrer: string | null = null): StraitRuntime & { open: (u: string) => void } {
  let urlCb: ((u: string) => void) | null = null;
  return {
    platform: () => platform,
    collectDevice: () => device,
    getInstallReferrer: async () => referrer,
    getInitialURL: async () => null,
    onURL: (cb) => ((urlCb = cb), () => (urlCb = null)),
    onAppState: () => () => undefined,
    now: () => t,
    open: (u) => urlCb?.(u),
  };
}
function engine(reply: (path: string) => { status: number; json?: object } = () => ({ status: 200 })) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const r = reply(path);
    return { ok: r.status < 300, status: r.status, json: async () => r.json ?? {}, headers: { get: () => null } } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetch, calls };
}
function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}
const clipboard: ClipboardAccess = { hasProbableWebUrl: async () => true, readText: async () => HANDOFF };
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
const make = (e: ReturnType<typeof engine>, rt: StraitRuntime, s: KeyValueStore = store(), appVersion: string | null = ' 4.12.0 (812) ') =>
  createStrait({ publishableKey: 'st_pub_test_x', endpoint: ENDPOINT, runtime: rt, fetch: e.fetch, storage: s, clipboard, appVersion: appVersion ?? undefined });
const bodyOf = (e: ReturnType<typeof engine>, path: string) => e.calls.find((c) => c.path === path)?.body;

describe('appVersion + sdkVersion on recording calls', () => {
  it('SDK_VERSION is the package.json version', () => {
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it('cleanVersion: trimmed, capped to 64, printable ASCII only, else dropped', () => {
    expect(cleanVersion(' 4.12.0 (812) ')).toBe('4.12.0 (812)');
    expect(cleanVersion('9'.repeat(80))).toBe('9'.repeat(64));
    for (const v of [undefined, null, 4, '', '   ', '1.0\n2', 'versión']) expect(cleanVersion(v)).toBeUndefined();
  });

  it('Android first launch: /v1/referrer carries both', async () => {
    const e = engine((p) => (p === '/v1/referrer' ? { status: 200, json: { matched: true, longUrl: 'https://shop.example/p/1', linkId: 'lnk_1' } } : { status: 200 }));
    await make(e, runtime('android', 'strait_link=lnk_1')).start();
    await settle();
    expect(bodyOf(e, '/v1/referrer')).toMatchObject(V);
  });

  it('iPhone first launch: /v1/match and the paste-handoff /v1/handoff/claim carry both', async () => {
    const e = engine((p) =>
      p === '/v1/match'
        ? { status: 200, json: { matched: false, matchMethod: 'none', ios: { deviceMatching: true, pasteHandoff: true } } }
        : { status: 200, json: { matched: true, longUrl: 'https://shop.example/p/2', linkId: 'lnk_2' } });
    await make(e, runtime('ios')).start();
    await settle();
    expect(bodyOf(e, '/v1/match')).toMatchObject(V);
    expect(bodyOf(e, '/v1/handoff/claim')).toMatchObject(V);
  });

  it('claimHandoff, a short link (/v1/resolve) and a direct open (/v1/open) carry both; /v1/event carries neither', async () => {
    const e = engine((p) => (p === '/v1/resolve' ? { status: 200, json: { matched: true, longUrl: 'https://shop.example/p/3', recorded: true } } : { status: 200, json: { matched: false } }));
    const rt = runtime('android');
    const s = store();
    s.data.set('strait.deferredChecked', '1');
    const strait = make(e, rt, s);
    await strait.start();
    await strait.claimHandoff(HANDOFF);
    rt.open(`${ENDPOINT}/sale`);
    await settle();
    rt.open('hilltop://product/42');
    await settle();
    await strait.trackEvent('purchase', { value: 5, eventId: 'ord_1' });
    expect(bodyOf(e, '/v1/handoff/claim')).toMatchObject(V);
    expect(bodyOf(e, '/v1/resolve')).toMatchObject(V);
    expect(bodyOf(e, '/v1/open')).toMatchObject(V);
    expect(bodyOf(e, '/v1/event')).not.toHaveProperty('appVersion');
    expect(bodyOf(e, '/v1/event')).not.toHaveProperty('sdkVersion');
  });

  it('an open saved offline keeps its versions in the queue and sends them on retry', async () => {
    let up = false;
    const e = engine(() => (up ? { status: 202 } : { status: 503 }));
    const rt = runtime('android');
    const s = store();
    s.data.set('strait.deferredChecked', '1');
    const strait = make(e, rt, s);
    await strait.start();
    rt.open('hilltop://product/42');
    await settle();
    expect(JSON.parse(s.data.get('strait.pendingOpens')!)[0]).toMatchObject(V);
    up = true;
    await strait.flushOpenReports();
    expect(e.calls.at(-1)).toMatchObject({ path: '/v1/open', body: V });
  });

  it('no appVersion option: sdkVersion only', async () => {
    const e = engine();
    await make(e, runtime('ios'), store(), null).start();
    await settle();
    expect(bodyOf(e, '/v1/match')).toMatchObject({ sdkVersion: pkg.version });
    expect(bodyOf(e, '/v1/match')).not.toHaveProperty('appVersion');
  });

  it('opted out: /v1/lookup carries neither, and nothing else is sent', async () => {
    const e = engine((p) => (p === '/v1/lookup' ? { status: 200, json: { matched: true, longUrl: 'https://shop.example/p/4' } } : { status: 200 }));
    const rt = runtime('android');
    const strait = make(e, rt);
    await strait.setEnabled(false);
    await strait.start();
    rt.open(`${ENDPOINT}/sale`);
    rt.open('hilltop://product/42');
    await settle();
    await strait.flushOpenReports();
    expect(e.calls.map((c) => c.path)).toEqual(['/v1/lookup']);
    expect(e.calls[0]!.body).toEqual({ publishableKey: 'st_pub_test_x', url: `${ENDPOINT}/sale` });
  });

  it('legacy resolveDeferredLink: /v1/match carries both', async () => {
    const e = engine(() => ({ status: 200, json: { matched: false, matchMethod: 'none' } }));
    await resolveDeferredLink({ publishableKey: 'st_pub_test_x', endpoint: ENDPOINT, fetch: e.fetch, adapter: runtime('ios'), appVersion: '4.12.0 (812)' });
    expect(bodyOf(e, '/v1/match')).toMatchObject(V);
  });
});
