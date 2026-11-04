import { describe, expect, it } from 'vitest';
import { createStrait, type StraitRuntime, type KeyValueStore, type LinkEvent } from '../src/index.js';
import { firstLaunchState } from '../src/core.js';

// Contract B6a (shared-spec ADR 0003): storage restored from a backup of another install
// (Android Auto Backup, a restored phone) must not skip the once-per-install deferred check.

const T_OLD = 1_780_000_000_000;
const T_NEW = 1_790_000_000_000;

describe('firstLaunchState (B6a)', () => {
  it('normal launch, SDK upgrade, restored storage, first launch', () => {
    expect(firstLaunchState('1', String(T_NEW), T_NEW)).toEqual({ firstLaunch: false, clearFlag: false, storeInstallTime: null });
    expect(firstLaunchState('1', null, T_NEW)).toEqual({ firstLaunch: false, clearFlag: false, storeInstallTime: String(T_NEW) });
    expect(firstLaunchState('1', String(T_OLD), T_NEW)).toEqual({ firstLaunch: true, clearFlag: true, storeInstallTime: String(T_NEW) });
    expect(firstLaunchState(null, null, T_NEW)).toEqual({ firstLaunch: true, clearFlag: false, storeInstallTime: String(T_NEW) });
    expect(firstLaunchState('1', String(T_OLD), null)).toEqual({ firstLaunch: false, clearFlag: false, storeInstallTime: null });
  });
});

function runtime(): StraitRuntime {
  return {
    platform: () => 'ios',
    collectDevice: () => ({ screenWidth: 390, pixelRatio: 3, language: 'en', timezone: 'Asia/Kolkata' }),
    getInstallReferrer: async () => null,
    getInitialURL: async () => null,
    onURL: () => () => undefined,
    onAppState: () => () => undefined,
    now: () => 1_800_000_000_000,
  };
}
function store(init: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}
function engine(match: { status: number; body?: unknown } | 'offline' = { status: 200, body: { matched: false } }) {
  const calls: Array<{ path: string; body: any }> = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === '/v1/match' && match === 'offline') throw new TypeError('Network request failed');
    const r = path === '/v1/match' && match !== 'offline' ? match : { status: 202, body: { ok: true } };
    return { ok: r.status < 400, status: r.status, json: async () => r.body ?? {} } as Response;
  }) as unknown as typeof fetch;
  return { fetch, matches: () => calls.filter((c) => c.path === '/v1/match') };
}
async function launch(s: ReturnType<typeof store>, e: ReturnType<typeof engine>, installTime?: () => Promise<number | null>) {
  const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://links.test', runtime: runtime(), fetch: e.fetch, storage: s, installTime });
  const events: LinkEvent[] = [];
  strait.onLink((ev) => events.push(ev));
  await strait.start();
  return events;
}

describe('start() with installTime (B6a)', () => {
  it('storage restored from another install: the deferred check runs again and counts the install', async () => {
    const s = store({ 'strait.deferredChecked': '1', 'strait.installTime': String(T_OLD) });
    const e = engine();
    const events = await launch(s, e, async () => T_NEW);
    expect(e.matches()).toHaveLength(1);
    expect(e.matches()[0]!.body.openId).toMatch(/^o_/);
    expect(events.map((x) => x.kind)).toEqual(['deferred']);
    expect(s.data.get('strait.deferredChecked')).toBe('1');
    expect(s.data.get('strait.installTime')).toBe(String(T_NEW));
    // and only once: the next launch is a normal one
    await launch(s, e, async () => T_NEW);
    expect(e.matches()).toHaveLength(1);
  });

  it('app updated from an SDK without installTime: adopts the time, no new install', async () => {
    const s = store({ 'strait.deferredChecked': '1' });
    const e = engine();
    expect(await launch(s, e, async () => T_NEW)).toEqual([]);
    expect(e.matches()).toHaveLength(0);
    expect(s.data.get('strait.installTime')).toBe(String(T_NEW));
  });

  it('restored storage + offline first launch: the flag stays cleared, so the next launch retries', async () => {
    const s = store({ 'strait.deferredChecked': '1', 'strait.installTime': String(T_OLD) });
    await launch(s, engine('offline'), async () => T_NEW);
    expect(s.data.get('strait.deferredChecked')).toBe('');
    const e = engine();
    await launch(s, e, async () => T_NEW);
    expect(e.matches()).toHaveLength(1);
    expect(s.data.get('strait.deferredChecked')).toBe('1');
  });

  it('installTime missing, throwing or invalid: behaves as before (no reset)', async () => {
    for (const it of [undefined, async () => { throw new Error('no package info'); }, async () => 0, async () => NaN as number]) {
      const s = store({ 'strait.deferredChecked': '1', 'strait.installTime': String(T_OLD) });
      const e = engine();
      await launch(s, e, it as (() => Promise<number | null>) | undefined);
      expect(e.matches()).toHaveLength(0);
      expect(s.data.get('strait.installTime')).toBe(String(T_OLD));
    }
  });

  it('a fresh install stores its install time with the flag', async () => {
    const s = store();
    const e = engine();
    await launch(s, e, async () => T_NEW);
    expect(e.matches()).toHaveLength(1);
    expect(s.data.get('strait.installTime')).toBe(String(T_NEW));
    expect(s.data.get('strait.deferredChecked')).toBe('1');
  });
});
