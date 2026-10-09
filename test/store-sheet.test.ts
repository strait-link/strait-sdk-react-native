import { describe, expect, it, vi } from 'vitest';
import {
  androidStorePlan,
  appStoreAppUrl,
  createStrait,
  iosStoreProduct,
  reactNativeStoreSheetOpener,
  type StoreIntent,
  type StoreSheetOpener,
  type StraitRuntime,
} from '../src/index.js';

const CLICK = '9a1c7e52-4b3d-4f8e-a6d1-0c2b5e7f9a34';
const REFERRER = `strait_link=lnk_42&strait_click=${CLICK}`;
const HANDOFF = 'https://hilltop.strait.link/h/AbCdEfGhIjKlMnOpQrStUv';
const device = { screenWidth: 393, pixelRatio: 3, language: 'en-IN', timezone: 'Asia/Kolkata' };

function runtime(platform: 'ios' | 'android', storeSheet?: StoreSheetOpener): StraitRuntime {
  return {
    platform: () => platform,
    collectDevice: () => device,
    getInstallReferrer: async () => null,
    getInitialURL: async () => null,
    onURL: () => () => {},
    onAppState: () => () => {},
    now: () => 1_000_000,
    ...(storeSheet ? { storeSheet } : {}),
  };
}

function engine(routes: Record<string, unknown>, offline = false) {
  const calls: Array<{ path: string; body: any }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (offline) throw new TypeError('Network request failed');
    const payload = routes[path];
    if (payload === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const androidReply = { ok: true, beta: true, clickId: CLICK, linkId: 'lnk_42', android: { package: 'shoes.hilltop.app', referrer: REFERRER } };
const iosReply = (extra: Record<string, unknown> = {}) => ({
  ok: true, beta: true, clickId: CLICK, linkId: 'lnk_42',
  ios: { appStoreId: '6474676842', campaignToken: 'autumn-sale', deviceMatching: true, handoffUrl: null, ...extra },
});

function strait(platform: 'ios' | 'android', e: ReturnType<typeof engine>, opener?: StoreSheetOpener, clipboard?: { writeText(t: string): Promise<void> }) {
  return createStrait({
    publishableKey: 'bk_pub_test_appowner01',
    endpoint: 'https://hilltop.strait.link',
    fetch: e.fetch,
    runtime: runtime(platform, opener),
    ...(clipboard ? { clipboard: { hasProbableWebUrl: async () => false, readText: async () => null, ...clipboard } } : {}),
  });
}

describe('store sheet: pure helpers', () => {
  it('builds the Play inline install intent, then market, then web; referrer round-trips', () => {
    const plan = androidStorePlan('shoes.hilltop.app', REFERRER, 'com.partner.app', true, 'autumn');
    expect(plan.map((i) => i.kind)).toEqual(['inline_install', 'market', 'web']);
    const inline = plan[0]!;
    expect(inline.packageName).toBe('com.android.vending');
    expect(inline.extras).toEqual({ overlay: true, callerId: 'com.partner.app' });
    const u = new URL(inline.data);
    expect(`${u.origin}${u.pathname}`).toBe('https://play.google.com/d');
    expect(u.searchParams.get('id')).toBe('shoes.hilltop.app');
    expect(u.searchParams.get('referrer')).toBe(REFERRER);
    expect(u.searchParams.get('listing')).toBe('autumn');
    expect(plan[1]!.data).toBe(`market://details?id=shoes.hilltop.app&referrer=${encodeURIComponent(REFERRER)}`);
    expect(androidStorePlan('a.b', REFERRER, undefined).map((i) => i.kind)).toEqual(['market', 'web']);
    expect(androidStorePlan('a.b', REFERRER, 'c.d', false).map((i) => i.kind)).toEqual(['market', 'web']);
  });

  it('iPhone product: options win, ct clipped to 30, App Store app URL', () => {
    expect(iosStoreProduct({ appStoreId: 'id1' })).toBeNull();
    const p = iosStoreProduct({ appStoreId: '6474676842', campaignToken: 'c'.repeat(50) }, { customProductPageId: 'pg-1' })!;
    expect(p.campaignToken).toHaveLength(30);
    expect(iosStoreProduct({ appStoreId: '1' }, { appStoreId: '2' })!.appStoreId).toBe('2');
    expect(appStoreAppUrl({ appStoreId: '6474676842', campaignToken: 'autumn-sale', customProductPageId: 'pg-1' }))
      .toBe('itms-apps://apps.apple.com/app/id6474676842?ct=autumn-sale&ppid=pg-1');
  });
});

describe('strait.openStoreSheet (Android)', () => {
  it('opens the inline sheet through the native module with the engine referrer', async () => {
    const e = engine({ '/v1/store-sheet': androidReply });
    const seen: StoreIntent[] = [];
    const s = strait('android', e, { androidIntent: async (i) => (seen.push(i), true) });
    const r = await s.openStoreSheet('https://hilltop.strait.link/promo', { callerId: 'com.partner.app' });
    expect(r).toEqual({ opened: true, method: 'inline_install', clickId: CLICK, linkId: 'lnk_42', referrer: REFERRER });
    expect(seen).toHaveLength(1);
    expect(e.calls[0]!.body).toEqual({ publishableKey: 'bk_pub_test_appowner01', url: 'https://hilltop.strait.link/promo', platform: 'android' });
  });

  it('without a native module: market:// through openURL, never the inline sheet', async () => {
    const urls: string[] = [];
    const s = strait('android', engine({ '/v1/store-sheet': androidReply }), { openURL: async (u) => (urls.push(u), true) });
    const r = await s.openStoreSheet('https://hilltop.strait.link/promo', { callerId: 'com.partner.app' });
    expect(r.method).toBe('market');
    expect(urls).toEqual([`market://details?id=shoes.hilltop.app&referrer=${encodeURIComponent(REFERRER)}`]);
  });

  it('offline: still opens the store with androidPackage, without the deep link', async () => {
    const s = strait('android', engine({}, true), { androidIntent: async () => true });
    const r = await s.openStoreSheet('https://hilltop.strait.link/promo', { androidPackage: 'shoes.hilltop.app' });
    expect(r).toEqual({ opened: true, method: 'market', reason: 'offline' });
  });

  it('unknown link and no package: opens nothing', async () => {
    const s = strait('android', engine({ '/v1/store-sheet': { ok: false, reason: 'not_found' } }), { androidIntent: async () => true });
    expect(await s.openStoreSheet('https://hilltop.strait.link/nope')).toEqual({ opened: false, method: 'none', reason: 'no_package' });
  });

  it('an opener that throws falls through to the next intent', async () => {
    const s = strait('android', engine({ '/v1/store-sheet': androidReply }), {
      androidIntent: async (i) => {
        if (i.kind !== 'web') throw new Error('ActivityNotFound');
        return true;
      },
    });
    expect((await s.openStoreSheet('https://hilltop.strait.link/promo')).method).toBe('web');
  });
});

describe('strait.openStoreSheet (iPhone, beta)', () => {
  it('saves the device match for the tap, then shows the product page', async () => {
    const e = engine({ '/v1/store-sheet': iosReply(), '/v1/match-save': {} });
    const shown: unknown[] = [];
    const s = strait('ios', e, { iosProduct: async (p, style) => (shown.push([p, style]), true) });
    const r = await s.openStoreSheet('https://hilltop.strait.link/promo');
    expect(r).toEqual({ opened: true, method: 'product_page', clickId: CLICK, linkId: 'lnk_42', matchSaved: true, handoffCopied: false });
    expect(shown).toEqual([[{ appStoreId: '6474676842', campaignToken: 'autumn-sale' }, 'product_page']]);
    expect(e.calls.find((c) => c.path === '/v1/match-save')!.body).toEqual({ ...device, linkId: 'lnk_42', clickId: CLICK });
  });

  it('device matching off: no match-save', async () => {
    const e = engine({ '/v1/store-sheet': iosReply({ deviceMatching: false }) });
    const r = await strait('ios', e, { iosProduct: async () => true }).openStoreSheet('https://hilltop.strait.link/promo');
    expect(r.matchSaved).toBe(false);
    expect(e.calls.some((c) => c.path === '/v1/match-save')).toBe(false);
  });

  it('copies the handoff link only when asked, via the configured clipboard', async () => {
    const written: string[] = [];
    const e = engine({ '/v1/store-sheet': iosReply({ handoffUrl: HANDOFF }), '/v1/match-save': {} });
    const s = strait('ios', e, { iosProduct: async () => true }, { writeText: async (t) => void written.push(t) });
    expect((await s.openStoreSheet('https://hilltop.strait.link/promo')).handoffCopied).toBe(false);
    expect((await s.openStoreSheet('https://hilltop.strait.link/promo', { copyHandoffLink: true })).handoffCopied).toBe(true);
    expect(written).toEqual([HANDOFF]);
  });

  it('without the native module: the App Store app, deep link still saved', async () => {
    const urls: string[] = [];
    const e = engine({ '/v1/store-sheet': iosReply(), '/v1/match-save': {} });
    const r = await strait('ios', e, { openURL: async (u) => (urls.push(u), true) }).openStoreSheet('https://hilltop.strait.link/promo');
    expect(r.method).toBe('app_store');
    expect(r.matchSaved).toBe(true);
    expect(urls).toEqual(['itms-apps://apps.apple.com/app/id6474676842?ct=autumn-sale']);
  });

  it('nothing can show the store: not_shown', async () => {
    const r = await strait('ios', engine({ '/v1/store-sheet': iosReply(), '/v1/match-save': {} }), {}).openStoreSheet('https://hilltop.strait.link/promo');
    expect(r.opened).toBe(false);
    expect(r.reason).toBe('not_shown');
  });
});

describe('reactNativeStoreSheetOpener', () => {
  it('uses the StraitStoreSheet native module when present, Linking otherwise', async () => {
    const openIntent = vi.fn(async () => true);
    const openURL = vi.fn(async () => undefined);
    const o = reactNativeStoreSheetOpener({ NativeModules: { StraitStoreSheet: { openIntent } }, Linking: { openURL } });
    expect(o.iosProduct).toBeUndefined();
    expect(await o.androidIntent!(androidStorePlan('a.b')[0]!)).toBe(true);
    expect(await o.openURL!('market://details?id=a.b')).toBe(true);
    const bare = reactNativeStoreSheetOpener({ NativeModules: {}, Linking: { openURL } });
    expect(bare.androidIntent).toBeUndefined();
  });
});
