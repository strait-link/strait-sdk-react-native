/**
 * Contract B21 (proposal): a matched deferred reply's `referralCode` reaches the
 * app on the LinkEvent, unchanged, only when it is a valid code. No code (older
 * engine, no referral, or not matched) = no field.
 */
import { describe, expect, it, vi } from 'vitest';
import { createStrait, replyReferralCode, type ClipboardAccess, type KeyValueStore, type LinkEvent, type StraitRuntime } from '../src/index.js';

const PK = 'st_pub_test_appowner01';
const ENDPOINT = 'https://hilltop.links.test';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const HANDOFF = `https://hilltop.links.test/h/${TOKEN}`;
const CLICK = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const MATCHED = { matched: true, longUrl: 'https://shop.example/invite', linkId: 'lnk_42', clickId: CLICK };

function runtime(platform: 'ios' | 'android', referrer: string | null = null): StraitRuntime {
  return {
    platform: () => platform,
    collectDevice: () => ({ screenWidth: 390, pixelRatio: 3, language: 'en', timezone: 'Asia/Kolkata' }),
    getInstallReferrer: async () => referrer,
    getInitialURL: async () => null,
    onURL: () => () => undefined,
    onAppState: () => () => undefined,
    now: () => 1_800_000_000_000,
  };
}

function store(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}

async function run(platform: 'ios' | 'android', routes: Record<string, unknown>, extra: { referrer?: string; clipboard?: ClipboardAccess } = {}) {
  const fetch = vi.fn(async (url: string) => {
    const body = routes[new URL(url).pathname];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body ?? {} } as Response;
  }) as unknown as typeof globalThis.fetch;
  const strait = createStrait({
    publishableKey: PK, endpoint: ENDPOINT, runtime: runtime(platform, extra.referrer ?? null), fetch, storage: store(),
    clipboard: extra.clipboard,
  });
  const events: LinkEvent[] = [];
  strait.onLink((e) => events.push(e));
  await strait.start();
  await new Promise((r) => setTimeout(r, 0));
  return { strait, events };
}

describe('replyReferralCode', () => {
  it('keeps a valid code exactly as sent', () => {
    for (const c of ['ASHA42', 'a', 'user_12-b', 'x'.repeat(64)]) expect(replyReferralCode(c)).toBe(c);
  });
  it('anything else is null', () => {
    for (const c of [undefined, null, '', 'x'.repeat(65), 'a b', 'me@example.com', '+919999', 'ü', 42, {}, ['A']]) expect(replyReferralCode(c)).toBeNull();
  });
});

describe('B21: referralCode on deferred LinkEvents', () => {
  it('Android Play referrer', async () => {
    const { events } = await run('android', { '/v1/referrer': { ...MATCHED, matchMethod: 'install_referrer', referralCode: 'ASHA42' } }, { referrer: 'strait_link=lnk_42' });
    expect(events[0]).toMatchObject({ kind: 'deferred', route: 'install_referrer', matched: true, referralCode: 'ASHA42' });
  });
  it('iPhone match', async () => {
    const { events } = await run('ios', { '/v1/match': { ...MATCHED, matchMethod: 'exact_ext', referralCode: 'RAVI7' } });
    expect(events[0]).toMatchObject({ route: 'fingerprint', matched: true, referralCode: 'RAVI7' });
  });
  it('clipboard boost claim', async () => {
    const clipboard: ClipboardAccess = { hasProbableWebUrl: async () => true, readText: async () => HANDOFF };
    const { events } = await run('ios', {
      '/v1/match': { matched: false, ios: { deviceMatching: true, pasteHandoff: true } }, // the workspace turned Paste handoff on
      '/v1/handoff/claim': { ...MATCHED, matchMethod: 'clipboard', referralCode: 'ASHA42' },
    }, { clipboard });
    expect(events[0]).toMatchObject({ route: 'clipboard', matched: true, referralCode: 'ASHA42' });
  });
  it('Paste button (claimHandoff)', async () => {
    const { strait } = await run('ios', { '/v1/match': { matched: false }, '/v1/handoff/claim': { ...MATCHED, matchMethod: 'clipboard', referralCode: 'ASHA42' } });
    expect(await strait.claimHandoff(HANDOFF)).toMatchObject({ matched: true, referralCode: 'ASHA42' });
  });
  it('no code, an invalid code, or no match: no field', async () => {
    for (const reply of [{ ...MATCHED }, { ...MATCHED, referralCode: 'not valid' }, { ...MATCHED, referralCode: null }, { matched: false, referralCode: 'ASHA42' }]) {
      const { events } = await run('ios', { '/v1/match': reply });
      expect(events[0]).not.toHaveProperty('referralCode');
    }
  });
});
