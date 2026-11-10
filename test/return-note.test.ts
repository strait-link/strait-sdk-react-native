import { describe, expect, it } from 'vitest';
import { createStrait, type KeyValueStore, type StraitRuntime } from '../src/index.js';
import { DAY_MS, installTapValue, returnNote } from '../src/core.js';

// B28 (shared-spec ADR 0012): at most three "came back" notes per install (day 1, 7, 30), carrying the install's tap id.

const CLICK = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const T = 1_800_000_000_000;

describe('returnNote (pure)', () => {
  it('is due exactly on day 1, 7 and 30, once each', () => {
    const s = installTapValue(CLICK, T);
    expect(returnNote(s, T + DAY_MS - 1)).toBeNull();
    expect(returnNote(s, T + DAY_MS)).toEqual({ day: 1, clickId: CLICK, openId: `r1-${CLICK}` });
    expect(returnNote(s, T + 2 * DAY_MS)).toBeNull();
    expect(returnNote(s, T + 7 * DAY_MS + 5)).toMatchObject({ day: 7 });
    expect(returnNote(s, T + 30 * DAY_MS)).toMatchObject({ day: 30 });
    expect(returnNote(s, T + 31 * DAY_MS)).toBeNull();
    expect(returnNote(JSON.stringify({ clickId: CLICK, at: T, sent: [1] }), T + DAY_MS)).toBeNull();
  });
  it('anything unreadable is no note', () => {
    expect(returnNote(null, T)).toBeNull();
    expect(returnNote('', T)).toBeNull();
    expect(returnNote('{', T + DAY_MS)).toBeNull();
    expect(returnNote(JSON.stringify({ clickId: 'nope', at: T }), T + DAY_MS)).toBeNull();
    expect(returnNote(JSON.stringify({ clickId: CLICK, at: T + DAY_MS }), T)).toBeNull();
  });
});

function runtime(now: { t: number }): { runtime: StraitRuntime; active: () => void; open: (u: string) => void } {
  let stateCb: ((s: 'active' | 'background' | 'inactive') => void) | null = null;
  let urlCb: ((u: string) => void) | null = null;
  return {
    runtime: {
      platform: () => 'ios',
      collectDevice: () => ({ screenWidth: 390, pixelRatio: 3, language: 'en', timezone: 'Asia/Kolkata' }),
      getInstallReferrer: async () => null,
      getInitialURL: async () => null,
      onURL: (cb) => ((urlCb = cb), () => (urlCb = null)),
      onAppState: (cb) => ((stateCb = cb as typeof stateCb), () => (stateCb = null)),
      now: () => now.t,
    },
    active: () => stateCb?.('active'),
    open: (u) => urlCb?.(u),
  };
}
function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}
function engine(reply: (path: string, body: Record<string, unknown>) => { status: number; json: object }) {
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetch = (async (url: string, init?: { body?: string }) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : {};
    sent.push({ path, body });
    const r = reply(path, body);
    return { ok: r.status < 300, status: r.status, json: async () => r.json, headers: { get: () => null } } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetch, sent };
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };
const matchReply = (path: string) => (path === '/v1/match' ? { status: 200, json: { matched: true, clickId: CLICK.toUpperCase(), longUrl: 'https://shop.example/p/1' } } : { status: 202, json: { ok: true } });
const notes = (e: ReturnType<typeof engine>) => e.sent.filter((x) => x.body.kind === 'return');

describe('came-back notes (client)', () => {
  it('the install match keeps the tap; day 1 sends one note on start, a second foreground sends nothing', async () => {
    const now = { t: T };
    const e = engine(matchReply);
    const s = store();
    const rt = runtime(now);
    const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://acme.strait.link', runtime: rt.runtime, fetch: e.fetch, storage: s, appVersion: '2.1.0' });
    await strait.start();
    await settle();
    expect(JSON.parse(s.data.get('strait.installTap')!)).toEqual({ clickId: CLICK, at: T, sent: [] });
    expect(notes(e)).toEqual([]); // day 0: nothing
    strait.stop();

    now.t = T + DAY_MS + 60_000;
    const rt2 = runtime(now);
    const again = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://acme.strait.link', runtime: rt2.runtime, fetch: e.fetch, storage: s, appVersion: '2.1.0' });
    await again.start();
    await settle();
    rt2.active();
    await settle();
    expect(notes(e)).toEqual([{ path: '/v1/open', body: {
      publishableKey: 'st_pub_test_x', openId: `r1-${CLICK}`, kind: 'return', day: 1, clickId: CLICK, platform: 'ios', at: now.t,
      appVersion: '2.1.0', sdkVersion: expect.stringMatching(/^react-native\//),
    } }]);
    expect(JSON.parse(s.data.get('strait.installTap')!).sent).toEqual([1]);
  });

  it('a later tap never replaces the install tap; a fresh first launch (restored backup) clears it', async () => {
    const OTHER = '11111111-2222-4333-8444-555555555555';
    const now = { t: T };
    const e = engine(matchReply);
    const s = store();
    s.data.set('strait.installTap', installTapValue(OTHER, T - 40 * DAY_MS)); // a backup of another install
    const rt = runtime(now);
    const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://acme.strait.link', runtime: rt.runtime, fetch: e.fetch, storage: s });
    await strait.start();
    rt.open(`acme://p/2?strait_click=${OTHER}`);
    await settle();
    expect(JSON.parse(s.data.get('strait.installTap')!).clickId).toBe(CLICK);
    expect(JSON.parse(s.data.get('strait.lastTap')!).clickId).toBe(OTHER);
  });

  it('a first launch opened by a link with a tap id keeps that tap', async () => {
    const now = { t: T };
    const e = engine(() => ({ status: 202, json: { ok: true } }));
    const s = store();
    const rt = runtime(now);
    rt.runtime.getInitialURL = async () => `acme://p/2?strait_click=${CLICK}`;
    const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://acme.strait.link', runtime: rt.runtime, fetch: e.fetch, storage: s });
    await strait.start();
    await settle();
    expect(JSON.parse(s.data.get('strait.installTap')!)).toEqual({ clickId: CLICK, at: T, sent: [] });
  });

  it('offline: the note is queued and flushed later; opted out: nothing, and the install tap is deleted', async () => {
    const now = { t: T + 7 * DAY_MS };
    let down = true;
    const e = engine(() => (down ? { status: 503, json: {} } : { status: 202, json: { ok: true } }));
    const s = store();
    s.data.set('strait.deferredChecked', '1');
    s.data.set('strait.installTap', JSON.stringify({ clickId: CLICK, at: T, sent: [1] }));
    const rt = runtime(now);
    const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://acme.strait.link', runtime: rt.runtime, fetch: e.fetch, storage: s });
    await strait.start();
    await settle();
    const queued = JSON.parse(s.data.get('strait.pendingOpens')!);
    expect(queued).toEqual([expect.objectContaining({ type: 'return', openId: `r7-${CLICK}`, day: 7, clickId: CLICK })]);
    expect(queued[0].publishableKey).toBeUndefined();
    down = false;
    now.t += 120_000; // past the C1 hold
    await strait.flushOpenReports();
    expect(e.sent.at(-1)).toMatchObject({ path: '/v1/open', body: { openId: `r7-${CLICK}`, kind: 'return', day: 7, publishableKey: 'st_pub_test_x' } });
    expect(e.sent.at(-1)!.body.type).toBeUndefined();
    expect(await strait.pendingOpenReports()).toBe(0);

    await strait.setEnabled(false);
    expect(s.data.get('strait.installTap')).toBe('');
    now.t = T + 30 * DAY_MS;
    const before = e.sent.length;
    rt.active();
    await settle();
    expect(e.sent.length).toBe(before);
  });

  it('web never sends a note', async () => {
    const now = { t: T + DAY_MS };
    const e = engine(() => ({ status: 202, json: {} }));
    const s = store();
    s.data.set('strait.installTap', installTapValue(CLICK, T));
    const rt = runtime(now);
    rt.runtime.isWeb = () => true;
    const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://acme.strait.link', runtime: rt.runtime, fetch: e.fetch, storage: s });
    await strait.start();
    await settle();
    expect(notes(e)).toEqual([]);
  });
});
