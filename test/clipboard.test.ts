/**
 * Contract B19: the iPhone clipboard boost is opt-in. A spy clipboard proves the
 * SDK never touches the clipboard unless the app set clipboardBoost: true, and
 * then only on the once-per-install iPhone check, reading only when a URL is likely.
 */
import { describe, expect, it, vi } from 'vitest';
import { createStrait, fromExpoClipboard, type ClipboardAccess, type KeyValueStore, type LinkEvent, type StraitRuntime } from '../src/index.js';

const PK = 'st_pub_test_appowner01';
const ENDPOINT = 'https://hilltop.links.test';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const HANDOFF = `https://hilltop.links.test/h/${TOKEN}`;
const CLICK = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const device = { screenWidth: 390, pixelRatio: 3, language: 'en', timezone: 'Asia/Kolkata' };

function runtime(platform: 'ios' | 'android' = 'ios', initialURL: string | null = null): StraitRuntime {
  return {
    platform: () => platform,
    collectDevice: () => device,
    getInstallReferrer: async () => null,
    getInitialURL: async () => initialURL,
    onURL: () => () => undefined,
    onAppState: () => () => undefined,
    now: () => 1_800_000_000_000,
  };
}

function spyClipboard(opts: { url?: boolean; text?: string | null; throws?: boolean } = {}) {
  const calls: string[] = [];
  const clip: ClipboardAccess = {
    hasProbableWebUrl: async () => {
      calls.push('detect');
      if (opts.throws) throw new Error('boom');
      return opts.url ?? true;
    },
    readText: async () => {
      calls.push('read');
      return opts.text === undefined ? HANDOFF : opts.text;
    },
  };
  return { clip, calls };
}

function engine(routes: Record<string, { status?: number; body?: unknown } | undefined>) {
  const calls: Array<{ path: string; body: any }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = routes[path];
    const status = r?.status ?? (r ? 200 : 404);
    return { ok: status < 300, status, json: async () => r?.body ?? {} } as Response;
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}

const noMatch = { '/v1/match': { body: { matched: false, matchMethod: 'none' } } };
const claimed = { '/v1/handoff/claim': { body: { matched: true, longUrl: 'https://shop.example/p/42', linkId: 'lnk_42', matchMethod: 'clipboard', clickId: CLICK } } };

async function run(cfg: { clipboardBoost?: boolean; clipboard?: ClipboardAccess; platform?: 'ios' | 'android'; initialURL?: string | null }, routes: Parameters<typeof engine>[0]) {
  const e = engine(routes);
  const storage = store();
  const strait = createStrait({
    publishableKey: PK, endpoint: ENDPOINT, runtime: runtime(cfg.platform ?? 'ios', cfg.initialURL ?? null), fetch: e.fetch, storage,
    clipboardBoost: cfg.clipboardBoost, clipboard: cfg.clipboard,
  });
  const events: LinkEvent[] = [];
  strait.onLink((ev) => events.push(ev));
  await strait.start();
  await new Promise((r) => setTimeout(r, 0));
  return { strait, events, calls: e.calls, storage };
}

describe('B19: no clipboard access unless the app opted in', () => {
  it('default config: the clipboard is never touched (start, checkDeferred, fingerprint report)', async () => {
    const { clip, calls } = spyClipboard();
    const { strait, calls: http } = await run({ clipboard: clip }, noMatch);
    await strait.checkDeferred();
    await strait.reportFingerprint().catch(() => undefined);
    expect(calls).toEqual([]);
    expect(http.map((c) => c.path)).not.toContain('/v1/handoff/claim');
  });

  it('clipboardBoost: false explicitly: never touched', async () => {
    const { clip, calls } = spyClipboard();
    await run({ clipboardBoost: false, clipboard: clip }, noMatch);
    expect(calls).toEqual([]);
  });

  it('Android with the boost on: never touched', async () => {
    const { clip, calls } = spyClipboard();
    await run({ clipboardBoost: true, clipboard: clip, platform: 'android' }, noMatch);
    expect(calls).toEqual([]);
  });

  it('the debug checkDeferred() never touches it, even with the boost on', async () => {
    const { clip, calls } = spyClipboard();
    const { strait } = await run({ clipboardBoost: true, clipboard: clip, initialURL: 'https://shop.example/x' }, noMatch);
    expect(calls).toEqual([]); // first launch opened by a link: no deferred check
    await strait.checkDeferred();
    expect(calls).toEqual([]);
  });

  it('not the first launch: never touched', async () => {
    const { clip, calls } = spyClipboard();
    const e = engine(noMatch);
    const storage = store();
    storage.data.set('strait.deferredChecked', '1');
    const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: runtime(), fetch: e.fetch, storage, clipboardBoost: true, clipboard: clip });
    await strait.start();
    expect(calls).toEqual([]);
  });
});

describe('B19: the first-launch flow with the boost on', () => {
  it('no URL detected: the clipboard is never read (no paste prompt) and signal matching runs', async () => {
    const { clip, calls } = spyClipboard({ url: false });
    const { calls: http, events } = await run({ clipboardBoost: true, clipboard: clip }, noMatch);
    expect(calls).toEqual(['detect']);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
    expect(events[0]).toMatchObject({ route: 'fingerprint', matched: false });
  });

  it('a handoff link: claims the token for an exact match and remembers the tap (B16)', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events, storage } = await run({ clipboardBoost: true, clipboard: clip }, claimed);
    expect(calls).toEqual(['detect', 'read']);
    expect(http.map((c) => c.path)).toEqual(['/v1/match', '/v1/handoff/claim']); // device matching first
    expect(http[1]!.body).toEqual({ publishableKey: PK, token: TOKEN, platform: 'ios', openId: events[0]!.id, at: 1_800_000_000_000 });
    expect(http[0]!.body.openId).toBe(events[0]!.id); // one install, one openId
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'deferred', route: 'clipboard', matched: true, url: 'https://shop.example/p/42', linkId: 'lnk_42' });
    expect(JSON.parse(storage.data.get('strait.lastTap')!)).toEqual({ clickId: CLICK, at: 1_800_000_000_000 });
    expect(storage.data.get('strait.deferredChecked')).toBe('1');
  });

  it('not a handoff link: nothing about the clipboard is sent; signal matching runs', async () => {
    for (const text of ['https://evil.example/h/' + TOKEN, 'hello', 'https://hilltop.links.test/promo', null]) {
      const { clip } = spyClipboard({ text });
      const { calls: http } = await run({ clipboardBoost: true, clipboard: clip }, noMatch);
      expect(http.map((c) => c.path)).toEqual(['/v1/match']);
      expect(JSON.stringify(http)).not.toContain('evil.example');
    }
  });

  it('a device match wins: the clipboard is never touched (no paste prompt)', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events } = await run({ clipboardBoost: true, clipboard: clip }, {
      ...claimed,
      '/v1/match': { body: { matched: true, longUrl: 'https://shop.example/p/7', linkId: 'lnk_7', matchMethod: 'exact_ext' } },
    });
    expect(calls).toEqual([]);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: 'fingerprint', matched: true, linkId: 'lnk_7' });
  });

  it('device match fails (network): still tries the clipboard', async () => {
    const { clip } = spyClipboard();
    const { calls: http, events, storage } = await run({ clipboardBoost: true, clipboard: clip }, { ...claimed, '/v1/match': { status: 503 } });
    expect(http.map((c) => c.path)).toEqual(['/v1/match', '/v1/handoff/claim']);
    expect(events[0]).toMatchObject({ route: 'clipboard', matched: true });
    expect(storage.data.get('strait.deferredChecked')).toBe('1');
  });

  it('claim refused (used/expired/unknown): keeps the device match result, same openId', async () => {
    const { clip } = spyClipboard();
    const { calls: http, events } = await run({ clipboardBoost: true, clipboard: clip }, {
      ...noMatch,
      '/v1/handoff/claim': { body: { matched: false, matchMethod: 'none', reason: 'handoff_used' } },
    });
    expect(http.map((c) => c.path)).toEqual(['/v1/match', '/v1/handoff/claim']);
    expect(http[1]!.body.openId).toBe(http[0]!.body.openId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: 'fingerprint', matched: false, reason: 'no_match' });
  });

  it('no answer / 429 / 5xx on the claim: reported as network and retried next launch', async () => {
    for (const status of [429, 503]) {
      const { clip } = spyClipboard();
      const { events, storage, calls: http } = await run({ clipboardBoost: true, clipboard: clip }, { ...noMatch, '/v1/handoff/claim': { status } });
      expect(events[0]).toMatchObject({ matched: false, reason: 'network' });
      expect(storage.data.get('strait.deferredChecked')).toBeUndefined();
      expect(http.map((c) => c.path)).toEqual(['/v1/match', '/v1/handoff/claim']);
    }
  });

  it('a clipboard adapter that throws counts as no link', async () => {
    const { clip } = spyClipboard({ throws: true });
    const { calls: http } = await run({ clipboardBoost: true, clipboard: clip }, noMatch);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
  });

  it('boost on without an adapter: plain signal matching', async () => {
    const { calls: http } = await run({ clipboardBoost: true }, noMatch);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
  });
});

describe('B19: claimHandoff (Paste button)', () => {
  it('claims a pasted handoff link', async () => {
    const { strait, calls: http } = await run({ initialURL: 'https://shop.example/x' }, claimed);
    const e = await strait.claimHandoff(`  ${HANDOFF}\n`);
    expect(e).toMatchObject({ kind: 'deferred', route: 'clipboard', matched: true, linkId: 'lnk_42' });
    const claim = http.find((c) => c.path === '/v1/handoff/claim')!;
    expect(claim.body).toMatchObject({ token: TOKEN, openId: e.id });
  });

  it('text that is not a handoff link: not_handoff, no network call', async () => {
    const { strait, calls: http } = await run({ initialURL: 'https://shop.example/x' }, claimed);
    const before = http.length;
    const e = await strait.claimHandoff('https://hilltop.links.test/promo');
    expect(e).toMatchObject({ matched: false, reason: 'not_handoff' });
    expect(http.length).toBe(before);
  });

  it('a refused claim reports the engine’s reason', async () => {
    const { strait } = await run({ initialURL: 'https://shop.example/x' }, { '/v1/handoff/claim': { body: { matched: false, reason: 'handoff_expired' } } });
    expect(await strait.claimHandoff(HANDOFF)).toMatchObject({ matched: false, reason: 'handoff_expired' });
  });
});

describe('fromExpoClipboard', () => {
  it('maps hasUrlAsync / getStringAsync', async () => {
    const c = fromExpoClipboard({ hasUrlAsync: async () => true, getStringAsync: async () => '' });
    expect(await c.hasProbableWebUrl()).toBe(true);
    expect(await c.readText()).toBeNull();
  });
});
