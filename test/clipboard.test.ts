/**
 * Contract B19: the iPhone paste handoff is the workspace's choice (Dashboard →
 * Settings → iPhone installs), read from the engine's /v1/match reply at
 * runtime (`ios.pasteHandoff`). A spy clipboard proves the SDK touches the
 * clipboard only when that reply found no match and says Paste handoff is on,
 * only on the once-per-install iPhone check, reading only when a URL is likely.
 * The old app-side `clipboardBoost` flag is ignored.
 */
import { describe, expect, it, vi } from 'vitest';
import { createStrait, fromExpoClipboard, pasteHandoffOn, type ClipboardAccess, type KeyValueStore, type LinkEvent, type StraitRuntime } from '../src/index.js';

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

const noMatch = { '/v1/match': { body: { matched: false, matchMethod: 'none' } } }; // an older engine: no `ios` field
/** /v1/match reply carrying the workspace's live iPhone choice. */
const reply = (deviceMatching: boolean, pasteHandoff: boolean, matched = false) => ({
  '/v1/match': {
    body: matched
      ? { matched: true, longUrl: 'https://shop.example/p/7', linkId: 'lnk_7', matchMethod: 'exact_ext', ios: { deviceMatching, pasteHandoff } }
      : { matched: false, matchMethod: 'none', reasons: [deviceMatching ? 'no_candidate' : 'device_matching_off'], ios: { deviceMatching, pasteHandoff } },
  },
});
const pasteOn = reply(true, true);
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

describe('B19: no clipboard access unless the engine says Paste handoff is on', () => {
  it('reply without the `ios` field (older engine): the clipboard is never touched (start, checkDeferred, fingerprint report)', async () => {
    const { clip, calls } = spyClipboard();
    const { strait, calls: http } = await run({ clipboard: clip }, noMatch);
    await strait.checkDeferred();
    await strait.reportFingerprint().catch(() => undefined);
    expect(calls).toEqual([]);
    expect(http.map((c) => c.path)).not.toContain('/v1/handoff/claim');
  });

  it('the deprecated clipboardBoost flag is ignored both ways', async () => {
    const a = spyClipboard();
    await run({ clipboardBoost: true, clipboard: a.clip }, noMatch); // app says on, engine says nothing: off
    expect(a.calls).toEqual([]);
    const b = spyClipboard();
    const { events } = await run({ clipboardBoost: false, clipboard: b.clip }, { ...pasteOn, ...claimed }); // app says off, workspace on: on
    expect(b.calls).toEqual(['detect', 'read']);
    expect(events[0]).toMatchObject({ route: 'clipboard', matched: true });
  });

  it('Android, even if a reply said Paste handoff is on: never touched', async () => {
    const { clip, calls } = spyClipboard();
    await run({ clipboard: clip, platform: 'android' }, pasteOn);
    expect(calls).toEqual([]);
  });

  it('the debug checkDeferred() never touches it, even with Paste handoff on', async () => {
    const { clip, calls } = spyClipboard();
    const { strait } = await run({ clipboard: clip, initialURL: 'https://shop.example/x' }, pasteOn);
    expect(calls).toEqual([]); // first launch opened by a link: no deferred check
    await strait.checkDeferred();
    expect(calls).toEqual([]);
  });

  it('not the first launch: never touched', async () => {
    const { clip, calls } = spyClipboard();
    const e = engine(pasteOn);
    const storage = store();
    storage.data.set('strait.deferredChecked', '1');
    const strait = createStrait({ publishableKey: PK, endpoint: ENDPOINT, runtime: runtime(), fetch: e.fetch, storage, clipboard: clip });
    await strait.start();
    expect(calls).toEqual([]);
  });
});

describe('B19: the first-launch flow with Paste handoff on (from the engine)', () => {
  it('no URL detected: the clipboard is never read (no paste prompt) and signal matching runs', async () => {
    const { clip, calls } = spyClipboard({ url: false });
    const { calls: http, events } = await run({ clipboard: clip }, pasteOn);
    expect(calls).toEqual(['detect']);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
    expect(events[0]).toMatchObject({ route: 'fingerprint', matched: false });
  });

  it('a handoff link: claims the token for an exact match and remembers the tap (B16)', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events, storage } = await run({ clipboard: clip }, { ...pasteOn, ...claimed });
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
      const { calls: http } = await run({ clipboard: clip }, pasteOn);
      expect(http.map((c) => c.path)).toEqual(['/v1/match']);
      expect(JSON.stringify(http)).not.toContain('evil.example');
    }
  });

  it('a device match wins: the clipboard is never touched (no paste prompt)', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events } = await run({ clipboard: clip }, {
      ...claimed,
      '/v1/match': { body: { matched: true, longUrl: 'https://shop.example/p/7', linkId: 'lnk_7', matchMethod: 'exact_ext' } },
    });
    expect(calls).toEqual([]);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: 'fingerprint', matched: true, linkId: 'lnk_7' });
  });

  it('no answer / 429 / 5xx from /v1/match: the choice is unknown, so the clipboard is untouched; network, retried next launch', async () => {
    for (const status of [429, 503]) {
      const { clip, calls } = spyClipboard();
      const { calls: http, events, storage } = await run({ clipboard: clip }, { ...claimed, '/v1/match': { status } });
      expect(calls).toEqual([]);
      expect(http.map((c) => c.path)).toEqual(['/v1/match']);
      expect(events[0]).toMatchObject({ route: 'fingerprint', matched: false, reason: 'network' });
      expect(storage.data.get('strait.deferredChecked')).toBeUndefined();
    }
  });

  it('claim refused (used/expired/unknown): keeps the device match result, same openId', async () => {
    const { clip } = spyClipboard();
    const { calls: http, events } = await run({ clipboard: clip }, {
      ...pasteOn,
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
      const { events, storage, calls: http } = await run({ clipboard: clip }, { ...pasteOn, '/v1/handoff/claim': { status } });
      expect(events[0]).toMatchObject({ matched: false, reason: 'network' });
      expect(storage.data.get('strait.deferredChecked')).toBeUndefined();
      expect(http.map((c) => c.path)).toEqual(['/v1/match', '/v1/handoff/claim']);
    }
  });

  it('a clipboard adapter that throws counts as no link', async () => {
    const { clip } = spyClipboard({ throws: true });
    const { calls: http } = await run({ clipboard: clip }, pasteOn);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
  });

  it('boost on without an adapter: plain signal matching', async () => {
    const { calls: http } = await run({}, pasteOn);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
  });
});

describe('Founder decision 10 Oct 2026: the customer picks the iPhone method in the dashboard, applied at runtime', () => {
  const claimable = { '/v1/handoff/claim': claimed['/v1/handoff/claim'] };

  it('off / off: no device match, clipboard never touched (a handoff link on it is ignored), no claim', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events } = await run({ clipboard: clip }, { ...reply(false, false), ...claimable });
    expect(calls).toEqual([]);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']); // the install is still counted
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'deferred', route: 'fingerprint', matched: false, reason: 'no_match' });
  });

  it('device matching only: a match routes; clipboard untouched', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events } = await run({ clipboard: clip }, { ...reply(true, false, true), ...claimable });
    expect(calls).toEqual([]);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
    expect(events[0]).toMatchObject({ route: 'fingerprint', matched: true, linkId: 'lnk_7', url: 'https://shop.example/p/7' });
  });

  it('device matching only: no match, clipboard still untouched', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events } = await run({ clipboard: clip }, { ...reply(true, false), ...claimable });
    expect(calls).toEqual([]);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
    expect(events[0]).toMatchObject({ route: 'fingerprint', matched: false, reason: 'no_match' });
  });

  it('paste handoff only: reads the clipboard and claims with the same openId', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events } = await run({ clipboard: clip }, { ...reply(false, true), ...claimable });
    expect(calls).toEqual(['detect', 'read']);
    expect(http.map((c) => c.path)).toEqual(['/v1/match', '/v1/handoff/claim']);
    expect(http[1]!.body.openId).toBe(http[0]!.body.openId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: 'clipboard', matched: true, linkId: 'lnk_42' });
  });

  it('both: a device match wins and the clipboard is never touched (no paste prompt)', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events } = await run({ clipboard: clip }, { ...reply(true, true, true), ...claimable });
    expect(calls).toEqual([]);
    expect(http.map((c) => c.path)).toEqual(['/v1/match']);
    expect(events[0]).toMatchObject({ route: 'fingerprint', matched: true, linkId: 'lnk_7' });
  });

  it('both: no device match, the paste handoff is the fallback', async () => {
    const { clip, calls } = spyClipboard();
    const { calls: http, events } = await run({ clipboard: clip }, { ...reply(true, true), ...claimable });
    expect(calls).toEqual(['detect', 'read']);
    expect(http.map((c) => c.path)).toEqual(['/v1/match', '/v1/handoff/claim']);
    expect(events[0]).toMatchObject({ route: 'clipboard', matched: true });
  });

  it('nothing is baked in or stored: two fresh installs of the same build follow their own replies', async () => {
    const first = spyClipboard();
    const a = await run({ clipboard: first.clip }, { ...reply(true, false), ...claimable });
    expect(first.calls).toEqual([]);
    const second = spyClipboard();
    const b = await run({ clipboard: second.clip }, { ...reply(true, true), ...claimable });
    expect(second.calls).toEqual(['detect', 'read']);
    expect(b.events[0]).toMatchObject({ route: 'clipboard', matched: true });
    for (const st of [a.storage, b.storage]) {
      expect([...st.data.keys()].some((k) => /paste|ios|setting/i.test(k))).toBe(false);
      expect([...st.data.values()].join(' ')).not.toContain('pasteHandoff');
    }
  });

  it('pasteHandoffOn: only an explicit ios.pasteHandoff true counts', () => {
    expect(pasteHandoffOn({ ios: { deviceMatching: false, pasteHandoff: true } })).toBe(true);
    for (const r of [{}, null, undefined, { ios: null }, { ios: { pasteHandoff: false } }, { ios: { pasteHandoff: 'true' } }, { pasteHandoff: true }]) {
      expect(pasteHandoffOn(r)).toBe(false);
    }
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
