/**
 * Store sheet (beta; iPhone is beta). Show the app store INSIDE your app for
 * one of your Strait links and keep the deep link for the app being installed.
 * Same flow as sdk-android `StoreSheet` and sdk-swift `StoreSheet.swift`:
 *
 *  1. POST /v1/store-sheet records the tap (sent_to 'store_sheet').
 *  2. Android: try Google Play inline install, then market://, then the Play
 *     web page, each with referrer=strait_link=<id>&strait_click=<tap>.
 *     iPhone: save this device's match fields for the tap (/v1/match-save),
 *     optionally copy the clipboard-boost handoff link, then show the App Store.
 *
 * Inline install (Android) and the in-app App Store sheet (iPhone) need a
 * native module named `StraitStoreSheet` in your app (README "Store sheet").
 * Without it the SDK opens the Play app / App Store app instead
 * (method 'market' / 'app_store'): the deep link is still kept, but the user
 * leaves your app.
 *
 * It works only where your app is the host. A link tapped inside another
 * company's app can't open a store sheet there.
 */

/** An Android store Intent: `Intent(action, Uri.parse(data)).setPackage(packageName)` + extras. */
export interface StoreIntent {
  kind: 'inline_install' | 'market' | 'web';
  action: 'android.intent.action.VIEW';
  data: string;
  packageName: string | null;
  extras: Record<string, boolean | string>;
}

export interface StoreProduct {
  appStoreId: string;
  campaignToken?: string;
  providerToken?: string;
  customProductPageId?: string;
}

export type StoreSheetStyle = 'product_page' | 'overlay';

/** How the app opens a store. Each resolves true when something opened. */
export interface StoreSheetOpener {
  /** Start an Android Intent (native module). Missing → only market/web via openURL. */
  androidIntent?(intent: StoreIntent): Promise<boolean>;
  /** Show SKStoreProductViewController / SKOverlay (native module). Missing → openURL. */
  iosProduct?(product: StoreProduct, style: StoreSheetStyle): Promise<boolean>;
  /** Open a URL with the OS (React Native Linking.openURL). */
  openURL?(url: string): Promise<boolean>;
  /** Write text to the clipboard (iPhone handoff link, only with copyHandoffLink). */
  writeClipboard?(text: string): Promise<void>;
}

export interface StoreSheetOptions {
  /** Android: the app to install. Default: the workspace's package from the engine. */
  androidPackage?: string;
  /** Android: your own package (Play's callerId). Needed for the inline sheet. */
  callerId?: string;
  /** Android: a Play custom store listing name. */
  listing?: string;
  /** Android: false skips the inline half-sheet. Default true. */
  inline?: boolean;
  /** iPhone: the app to install. Default: the workspace's App Store id from the engine. */
  appStoreId?: string;
  providerToken?: string;
  customProductPageId?: string;
  style?: StoreSheetStyle;
  /** iPhone: save this device's match fields for the tap. Default true. */
  saveDeviceMatch?: boolean;
  /** iPhone: copy the one-time handoff link (clipboard boost on). Default false: it replaces what the user copied. */
  copyHandoffLink?: boolean;
  /** Override how stores open (tests, custom native modules). */
  opener?: StoreSheetOpener;
}

export interface StoreSheetResult {
  opened: boolean;
  /** inline_install | market | web | product_page | overlay | app_store | none */
  method: string;
  clickId?: string;
  linkId?: string;
  /** Android: the Play Install Referrer sent. */
  referrer?: string;
  /** iPhone: device match fields saved for this tap. */
  matchSaved?: boolean;
  /** iPhone: handoff link copied to the clipboard. */
  handoffCopied?: boolean;
  /** not_found, expired, offline, no_package, no_app_store_id, no_store, not_shown… */
  reason?: string;
}

const VIEW = 'android.intent.action.VIEW' as const;
const PLAY = 'com.android.vending';
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
export const CAMPAIGN_TOKEN_MAX = 30;

export const isPackageName = (s: unknown): s is string => typeof s === 'string' && s.length <= 255 && PACKAGE.test(s);
export const isAppStoreId = (s: unknown): s is string => typeof s === 'string' && /^[0-9]{1,20}$/.test(s);
const enc = encodeURIComponent;

export function inlineInstallIntent(pkg: string, referrer: string | undefined, callerId: string, listing?: string): StoreIntent {
  let data = `https://play.google.com/d?id=${enc(pkg)}`;
  if (referrer) data += `&referrer=${enc(referrer)}`;
  if (listing) data += `&listing=${enc(listing)}`;
  return { kind: 'inline_install', action: VIEW, data, packageName: PLAY, extras: { overlay: true, callerId } };
}

export function marketIntent(pkg: string, referrer?: string): StoreIntent {
  const data = `market://details?id=${enc(pkg)}${referrer ? `&referrer=${enc(referrer)}` : ''}`;
  return { kind: 'market', action: VIEW, data, packageName: PLAY, extras: {} };
}

export function playWebIntent(pkg: string, referrer?: string): StoreIntent {
  const data = `https://play.google.com/store/apps/details?id=${enc(pkg)}${referrer ? `&referrer=${enc(referrer)}` : ''}`;
  return { kind: 'web', action: VIEW, data, packageName: null, extras: {} };
}

/** The Android Intents to try, in order. Inline only with a valid callerId. */
export function androidStorePlan(pkg: string, referrer?: string, callerId?: string, inline = true, listing?: string): StoreIntent[] {
  const out: StoreIntent[] = [];
  if (inline && isPackageName(callerId)) out.push(inlineInstallIntent(pkg, referrer, callerId, listing));
  out.push(marketIntent(pkg, referrer), playWebIntent(pkg, referrer));
  return out;
}

/** The iPhone product from the engine's `ios` reply and the options (options win). */
export function iosStoreProduct(ios: Record<string, unknown> | undefined, o: StoreSheetOptions = {}): StoreProduct | null {
  const id = o.appStoreId ?? ios?.appStoreId;
  if (!isAppStoreId(id)) return null;
  const ct = typeof ios?.campaignToken === 'string' ? ios.campaignToken.slice(0, CAMPAIGN_TOKEN_MAX) : undefined;
  return {
    appStoreId: id,
    ...(ct ? { campaignToken: ct } : {}),
    ...(o.providerToken ? { providerToken: o.providerToken } : {}),
    ...(o.customProductPageId ? { customProductPageId: o.customProductPageId } : {}),
  };
}

/** App Store app URL (fallback without the native module): the user leaves your app. */
export function appStoreAppUrl(p: StoreProduct): string {
  const q = new URLSearchParams();
  if (p.campaignToken) q.set('ct', p.campaignToken);
  if (p.providerToken) q.set('pt', p.providerToken);
  if (p.customProductPageId) q.set('ppid', p.customProductPageId);
  const qs = q.toString();
  return `itms-apps://apps.apple.com/app/id${p.appStoreId}${qs ? `?${qs}` : ''}`;
}

const HANDOFF = /^https:\/\/[^/?#\s]+\/h\/[A-Za-z0-9_-]{22}$/;

type Call = (method: 'POST', path: string, body: unknown) => Promise<{ ok: boolean; status: number; json: Record<string, any> }>;

const attempt = async (f: () => Promise<boolean>): Promise<boolean> => {
  try {
    return (await f()) === true;
  } catch {
    return false;
  }
};

/** The flow behind `strait.openStoreSheet` (exported for tests and custom clients). */
export async function runStoreSheet(
  deps: { call: Call; publishableKey: string; platform: 'ios' | 'android' | 'other'; device: () => Record<string, unknown> },
  url: string,
  options: StoreSheetOptions,
  opener: StoreSheetOpener,
): Promise<StoreSheetResult> {
  const { platform } = deps;
  if (platform !== 'android' && platform !== 'ios') return { opened: false, method: 'none', reason: 'unsupported_platform' };
  let reason: string | undefined;
  let reply: Record<string, any> = {};
  try {
    const r = await deps.call('POST', '/v1/store-sheet', { publishableKey: deps.publishableKey, url, platform });
    if (r.ok && r.json.ok === true) reply = r.json;
    else reason = typeof r.json.reason === 'string' ? r.json.reason : `http_${r.status}`;
  } catch {
    reason = 'offline';
  }
  const clickId = typeof reply.clickId === 'string' ? reply.clickId : undefined;
  const linkId = typeof reply.linkId === 'string' ? reply.linkId : undefined;
  const ids = { ...(clickId ? { clickId } : {}), ...(linkId ? { linkId } : {}) };

  if (platform === 'android') {
    const referrer = typeof reply.android?.referrer === 'string' ? (reply.android.referrer as string) : undefined;
    const pkg = options.androidPackage ?? reply.android?.package;
    if (!isPackageName(pkg)) return { opened: false, method: 'none', ...ids, ...(referrer ? { referrer } : {}), reason: 'no_package' };
    for (const intent of androidStorePlan(pkg, referrer, options.callerId, options.inline ?? true, options.listing)) {
      const ok = opener.androidIntent
        ? await attempt(() => opener.androidIntent!(intent))
        : intent.kind !== 'inline_install' && !!opener.openURL && (await attempt(() => opener.openURL!(intent.data)));
      if (ok) return { opened: true, method: intent.kind, ...ids, ...(referrer ? { referrer } : {}), ...(reason ? { reason } : {}) };
    }
    return { opened: false, method: 'none', ...ids, ...(referrer ? { referrer } : {}), reason: reason ?? 'no_store' };
  }

  const ios = reply.ios as Record<string, unknown> | undefined;
  const product = iosStoreProduct(ios, options);
  if (!product) return { opened: false, method: 'none', ...ids, matchSaved: false, handoffCopied: false, reason: reason ?? 'no_app_store_id' };
  let matchSaved = false;
  if ((options.saveDeviceMatch ?? true) && ios?.deviceMatching === true && clickId && linkId) {
    try {
      matchSaved = (await deps.call('POST', '/v1/match-save', { ...deps.device(), linkId, clickId })).ok;
    } catch {
      matchSaved = false;
    }
  }
  let handoffCopied = false;
  const handoff = typeof ios?.handoffUrl === 'string' && HANDOFF.test(ios.handoffUrl) ? ios.handoffUrl : null;
  if (options.copyHandoffLink && handoff && opener.writeClipboard) {
    try {
      await opener.writeClipboard(handoff);
      handoffCopied = true;
    } catch {
      handoffCopied = false;
    }
  }
  const style = options.style ?? 'product_page';
  const base = { ...ids, matchSaved, handoffCopied };
  if (opener.iosProduct && (await attempt(() => opener.iosProduct!(product, style)))) {
    return { opened: true, method: style, ...base, ...(reason ? { reason } : {}) };
  }
  if (opener.openURL && (await attempt(() => opener.openURL!(appStoreAppUrl(product))))) {
    return { opened: true, method: 'app_store', ...base, ...(reason ? { reason } : {}) };
  }
  return { opened: false, method: 'none', ...base, reason: reason ?? 'not_shown' };
}

/**
 * The default opener from React Native: the optional `StraitStoreSheet`
 * native module (openIntent / presentProduct), Linking.openURL, and the
 * clipboard's writer when one was given.
 */
export function reactNativeStoreSheetOpener(
  rn: { NativeModules?: Record<string, any>; Linking?: { openURL(url: string): Promise<unknown> } },
  writeClipboard?: (text: string) => Promise<void>,
): StoreSheetOpener {
  const mod = rn.NativeModules?.StraitStoreSheet;
  return {
    ...(typeof mod?.openIntent === 'function'
      ? { androidIntent: async (i: StoreIntent) => (await mod.openIntent(i)) === true }
      : {}),
    ...(typeof mod?.presentProduct === 'function'
      ? { iosProduct: async (p: StoreProduct, style: StoreSheetStyle) => (await mod.presentProduct(p, style)) === true }
      : {}),
    ...(rn.Linking
      ? {
          openURL: async (u: string) => {
            await rn.Linking!.openURL(u);
            return true;
          },
        }
      : {}),
    ...(writeClipboard ? { writeClipboard } : {}),
  };
}
