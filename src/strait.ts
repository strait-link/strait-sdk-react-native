import type { DeviceFields } from './adapter.js';
import {
  reactNativeStoreSheetOpener,
  runStoreSheet,
  type StoreSheetOpener,
  type StoreSheetOptions,
  type StoreSheetResult,
} from './store-sheet.js';
import {
  AppStateTracker,
  portraitScreenWidth,
  classifyUrl,
  eventClickId,
  reportUrl,
  staleTap,
  newOpenId,
  normalizeLinkHosts,
  parseHandoffUrl,
  parseStraitClick,
  parseStraitLink,
  pruneOpenQueue,
  rememberTap,
  replyClickId,
  replyReferralCode,
  shouldRetryReport,
  splitUrl,
} from './core.js';

export { browserScreenWidth, portraitScreenWidth, splitUrl, parseHandoffUrl } from './core.js';

/** B21: `{ referralCode }` for a matched deferred reply that carries a valid code, else nothing. */
const referral = (matched: boolean, code: unknown): { referralCode?: string } => {
  const c = matched ? replyReferralCode(code) : null;
  return c ? { referralCode: c } : {};
};

/**
 * Clipboard access for the iPhone clipboard boost (contract B19), supplied by
 * the app (e.g. expo-clipboard or @react-native-clipboard/clipboard). Strait
 * never calls it unless `clipboardBoost: true`.
 */
export interface ClipboardAccess {
  /**
   * Without any prompt: does the clipboard probably hold a web URL? On iOS use
   * UIPasteboard detectPatterns(.probableWebURL) or hasURLs (expo-clipboard
   * `hasUrlAsync`, @react-native-clipboard `hasURL`), which do not show the
   * paste prompt.
   */
  hasProbableWebUrl(): Promise<boolean>;
  /** Read the clipboard text. On iOS this shows the system "Allow Paste" prompt. */
  readText(): Promise<string | null>;
  /** Write clipboard text (optional; only the store sheet's copyHandoffLink uses it). */
  writeText?(text: string): Promise<void>;
}

/**
 * Everything the SDK needs from the phone, behind one interface so the logic
 * runs (and is tested) in plain Node. `createReactNativeRuntime` is the real one.
 */
export interface StraitRuntime {
  platform(): 'ios' | 'android' | 'other';
  collectDevice(): DeviceFields;
  /** Android Play Install Referrer string, or null. */
  getInstallReferrer(): Promise<string | null>;
  /** The URL that launched the app from closed, or null. */
  getInitialURL(): Promise<string | null>;
  /** URLs delivered while the app is running (background or on screen). */
  onURL(cb: (url: string) => void): () => void;
  onAppState(cb: (state: 'active' | 'background' | 'inactive') => void): () => void;
  now(): number;
  /** How the store sheet opens stores (optional; the React Native runtimes supply one). */
  storeSheet?: StoreSheetOpener;
}

/** Persistent key/value storage, e.g. @react-native-async-storage/async-storage. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface LinkEvent {
  /** Unique per open; also the id Strait records this open under. */
  id: string;
  /** direct = the app was opened by a link; deferred = link tapped before install. */
  kind: 'direct' | 'deferred';
  /**
   * app_link: verified https link opened the app directly ·
   * custom_scheme: a browser handed off to the app (yourapp://…) ·
   * install_referrer / fingerprint / clipboard: how a deferred link was found
   * (clipboard = an exact match from the clipboard boost, B19).
   */
  route: 'app_link' | 'custom_scheme' | 'install_referrer' | 'fingerprint' | 'clipboard';
  /** What the app was doing when the link arrived. */
  appState: 'closed' | 'background' | 'foreground';
  matched: boolean;
  /** Why it didn't match: not_found, expired, password_protected, network, … */
  reason?: string;
  /** The URL the OS gave the app (direct links). */
  rawUrl?: string;
  /** The destination to navigate to. */
  url?: string;
  path?: string;
  params?: Record<string, string>;
  linkId?: string;
  /**
   * Deferred links only: the referral code the tap carried (the tap's
   * `?strait_ref=`, else the link's `referralCode`), when the engine sends one.
   * Who invited this install; reward them from your server (the
   * `referral.converted` webhook). Referrals are a preview (contract B21).
   */
  referralCode?: string;
  /** Time spent resolving, ms. */
  ms: number;
  at: number;
}

/**
 * Fired the moment a link arrives, before it's resolved (resolving can take a
 * second or more on slow networks): show a "Opening link…" state until the
 * matching LinkEvent (same `id`) arrives.
 */
export interface LinkStart {
  id: string;
  kind: 'direct' | 'deferred';
  appState: LinkEvent['appState'];
  rawUrl?: string;
  at: number;
}

export interface CreateStraitConfig {
  /** Workspace publishable key (st_pub_live_…), Dashboard → Get started. */
  publishableKey: string;
  /** Your Strait link host, e.g. https://<your-handle>.strait.link */
  endpoint: string;
  /** Extra hosts that serve your short links (custom domains). */
  linkHosts?: string[];
  /** Persist "deferred check done" across launches (pass AsyncStorage). */
  storage?: KeyValueStore;
  /** Android: returns the Play Install Referrer. See `fromPlayInstallReferrer`. */
  installReferrer?: () => Promise<string | null>;
  /**
   * iPhone clipboard boost (contract B19), default false. When true and device
   * matching finds nothing on the first launch, the SDK checks the clipboard
   * (via `clipboard`) for the one-time link the tap page copied, for an exact match. Reading it shows iOS's paste prompt. Needs
   * the workspace's "Clipboard boost" setting on. Never touched when false.
   */
  clipboardBoost?: boolean;
  /** Clipboard access for `clipboardBoost` (see ClipboardAccess). */
  clipboard?: ClipboardAccess;
  /** Tests / custom platforms. */
  runtime?: StraitRuntime;
  fetch?: typeof fetch;
}

export interface Strait {
  /** Reads the launch link, listens for new ones, runs the deferred check once. */
  start(): Promise<void>;
  /** Every link event, including ones that happened before you subscribed. */
  onLink(cb: (event: LinkEvent) => void): () => void;
  /** A link just arrived and is being resolved (for a loading state). */
  onLinkStart(cb: (start: LinkStart) => void): () => void;
  /** Re-run the deferred check now (debugging); doesn't touch the once-per-install flag or the clipboard. */
  checkDeferred(): Promise<LinkEvent>;
  /**
   * Claim a clipboard-boost handoff link the app got itself, e.g. from Apple's
   * Paste button (no prompt; contract B19). Text that is not a Strait handoff
   * link gives `matched:false, reason:'not_handoff'` without a network call.
   */
  claimHandoff(text: string): Promise<LinkEvent>;
  /** Send this app's fingerprint to the engine (debug comparison with the browser). */
  reportFingerprint(): Promise<unknown>;
  /** Engine's comparison of the app and browser fingerprints on this network. */
  compareFingerprint(): Promise<unknown>;
  /**
   * Conversion / revenue event. Resolves true when accepted. Carries the tap
   * id of the last attributed link open (≤7 days, contract B15) unless you
   * pass `clickId` yourself.
   */
  trackEvent(
    name: string,
    extra?: { value?: number; currency?: string; linkId?: string; clickId?: string },
  ): Promise<boolean>;
  /**
   * Store sheet (beta; iPhone is beta): show the app store inside your app for
   * one of your short links and keep the deep link for the app being
   * installed. Never throws. See README "Store sheet".
   */
  openStoreSheet(url: string, options?: StoreSheetOptions): Promise<StoreSheetResult>;
  /** Open reports saved while offline, waiting to be sent (debugging). */
  pendingOpenReports(): Promise<number>;
  /** Send saved open reports now (also happens on start and on resume). */
  flushOpenReports(): Promise<void>;
  stop(): void;
}

/** One app open as reported to POST /v1/open (contract B14). */
interface OpenReport {
  openId: string;
  kind: 'direct' | 'deferred';
  route: LinkEvent['route'];
  appState: LinkEvent['appState'];
  platform: string;
  url?: string;
  clickId?: string;
  linkId?: string;
  matched: boolean;
  reason?: string;
  firstLaunch: boolean;
  at: number;
}

const DEFERRED_FLAG = 'strait.deferredChecked';
const QUEUE_KEY = 'strait.pendingOpens';
const TAP_KEY = 'strait.lastTap';
export function createStrait(config: CreateStraitConfig): Strait {
  const doFetch = config.fetch ?? globalThis.fetch;
  const base = config.endpoint.replace(/\/+$/, '');
  const linkHosts = normalizeLinkHosts(base, config.linkHosts);
  const storage = config.storage ?? memoryStore();
  const events: LinkEvent[] = [];
  const listeners = new Set<(e: LinkEvent) => void>();
  const unsubs: Array<() => void> = [];
  let runtime: StraitRuntime | undefined = config.runtime;
  const tracker = new AppStateTracker();
  const startListeners = new Set<(s: LinkStart) => void>();
  let isFirstLaunch = false;

  const rt = async (): Promise<StraitRuntime> =>
    (runtime ??= await createReactNativeRuntime({ installReferrer: config.installReferrer }));

  const newId = (at: number) => newOpenId(at);
  // App listeners are isolated: one that throws must not stop the others or
  // be mistaken for a failed resolve (which would emit a false 'network').
  const safely = <T,>(cb: (v: T) => void, v: T) => {
    try {
      cb(v);
    } catch (err) {
      console.error('[strait] link listener threw:', err);
    }
  };
  const announce = (s: LinkStart) => {
    for (const cb of startListeners) safely(cb, s);
  };
  const emit = (id: string, e: Omit<LinkEvent, 'id'>) => {
    const event = { id, ...e };
    events.push(event);
    for (const cb of listeners) safely(cb, event);
    return event;
  };

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json: json as Record<string, any> };
  };

  // ── Remembered tap (B15/B16): the tap id of the last attributed link open,
  // sent with conversion events. Short links and deferred matches learn it
  // from the engine's reply (B16); an attributed open without a known tap id
  // forgets it: the newer touch wins. Writes are chained so a trackEvent right
  // after an open sees it; failures are ignored.
  let tapWrite: Promise<unknown> = Promise.resolve();
  const setTap = (value: string) => {
    tapWrite = tapWrite.then(() => storage.setItem(TAP_KEY, value)).catch(() => undefined);
  };
  const noteTap = (clickId: string | null | undefined, at: number) => setTap(clickId ? rememberTap(clickId, at) : '');
  /** B18: delete an expired remembered tap instead of only ignoring it. Re-read
   *  inside the write chain so a newer tap written meanwhile is never lost. */
  const dropStaleTap = (now: number) => {
    tapWrite = tapWrite
      .then(async () => {
        if (staleTap(await storage.getItem(TAP_KEY), now)) await storage.setItem(TAP_KEY, '');
      })
      .catch(() => undefined);
  };

  // ── Open reports (B14): every open is reported once; failures are saved and
  // retried. Queue operations run one at a time (storage is async).
  let queueOp: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = queueOp.then(fn, fn);
    queueOp = p.catch(() => undefined);
    return p;
  };
  const readQueue = async (): Promise<OpenReport[]> => {
    try {
      const v = JSON.parse((await storage.getItem(QUEUE_KEY)) ?? '[]');
      // B18: reports saved by an older SDK may hold a full URL; strip it here
      // so the next write leaves no query or fragment on the device.
      return Array.isArray(v) ? v.map((rep) => (typeof rep?.url === 'string' ? { ...rep, url: reportUrl(rep.url) } : rep)) : [];
    } catch {
      return [];
    }
  };
  const writeQueue = (q: OpenReport[]) => storage.setItem(QUEUE_KEY, JSON.stringify(q)).catch(() => undefined);
  const enqueue = (report: OpenReport) =>
    serial(async () => {
      const r = await rt();
      await writeQueue(pruneOpenQueue([...(await readQueue()), report], r.now()));
    });
  /** POST /v1/open; resolves the HTTP status, or null when there was no answer. */
  const sendReport = async (report: OpenReport): Promise<number | null> => {
    try {
      return (await call('POST', '/v1/open', { publishableKey: config.publishableKey, ...report })).status;
    } catch {
      return null;
    }
  };
  /** Report an open now; keep it for retry if it doesn't get through. */
  const report = async (rep: OpenReport) => {
    const status = await sendReport(rep);
    if (shouldRetryReport(status)) await enqueue(rep);
    else void flush(); // the network works: send anything saved earlier
  };
  let flushing: Promise<void> | null = null;
  const flush = (): Promise<void> =>
    (flushing ??= serial(async () => {
      const r = await rt();
      const queue = pruneOpenQueue(await readQueue(), r.now());
      const keep: OpenReport[] = [];
      let offline = false;
      for (const rep of queue) {
        // Once one gets no answer at all, keep the rest for later.
        if (offline) {
          keep.push(rep);
          continue;
        }
        const status = await sendReport(rep);
        offline = status === null;
        if (shouldRetryReport(status)) keep.push(rep);
      }
      await writeQueue(keep);
    }).finally(() => {
      flushing = null;
    }));

  async function handleUrl(raw: string, appState: LinkEvent['appState'], firstLaunch = false) {
    const r = await rt();
    const t0 = r.now();
    const id = newId(t0);
    const platform = r.platform();
    announce({ id, kind: 'direct', appState, rawUrl: raw, at: t0 });
    const c = classifyUrl(raw, linkHosts);
    if (!c) {
      return emit(id, { kind: 'direct', route: 'app_link', appState, rawUrl: raw, matched: false, reason: 'invalid_url', ms: r.now() - t0, at: t0 });
    }
    if (c.needsResolve) {
      // The lookup is also the open report (openId); the engine says whether
      // it recorded it, and anything short of that is retried via /v1/open.
      // B18: only host + path (+ utm_source) leave the device or reach storage.
      const base: OpenReport = { openId: id, kind: 'direct', route: 'app_link', appState, platform, url: reportUrl(raw), matched: false, firstLaunch, at: t0 };
      try {
        const { json } = await call('POST', '/v1/resolve', {
          publishableKey: config.publishableKey, url: base.url, platform, openId: id, appState, firstLaunch, at: t0,
        });
        const matched = json.matched === true;
        const reason = matched ? undefined : json.reason ?? json.error;
        if (matched) noteTap(replyClickId(json.clickId), t0);
        if (json.recorded !== true) void report({ ...base, matched, reason, linkId: json.linkId });
        return emit(id, {
          kind: 'direct', route: 'app_link', appState, rawUrl: raw, matched, reason,
          ...destination(matched ? json.longUrl : undefined), linkId: json.linkId,
          ms: r.now() - t0, at: t0,
        });
      } catch {
        void enqueue({ ...base, reason: 'network' });
        return emit(id, { kind: 'direct', route: 'app_link', appState, rawUrl: raw, matched: false, reason: 'network', ms: r.now() - t0, at: t0 });
      }
    }
    if (c.clickId) noteTap(c.clickId, t0);
    // Navigation never waits for the report.
    void report({
      openId: id, kind: 'direct', route: c.route, appState, platform, url: reportUrl(c.url),
      clickId: c.clickId ?? undefined, matched: true, firstLaunch, at: t0,
    });
    return emit(id, {
      kind: 'direct', route: c.route, appState, rawUrl: raw, matched: true,
      url: c.url, path: c.path, params: c.params, ms: r.now() - t0, at: t0,
    });
  }

  /**
   * The deferred check. `record` (the once-per-install run) sends the openId so
   * the engine records this first open + install exactly once; the debug
   * re-check doesn't, so it never adds installs.
   */
  async function runDeferred(record: boolean): Promise<LinkEvent> {
    const r = await rt();
    const t0 = r.now();
    const id = newId(t0);
    const tag = record ? { openId: id, at: t0 } : {};
    announce({ id, kind: 'deferred', appState: 'closed', at: t0 });
    // No answer, 429 or 5xx = try again next launch (reported as 'network').
    const answered = async (path: string, body: unknown) => {
      const res = await call('POST', path, body);
      if (shouldRetryReport(res.status)) throw new Error(`HTTP ${res.status}`);
      return res;
    };
    // Signal matching (B7 referrer / B8 match). Returns the event, not emitted.
    const signal = async (): Promise<Omit<LinkEvent, 'id'>> => {
      if (r.platform() === 'android') {
        const referrer = await r.getInstallReferrer().catch(() => null);
        const linkId = parseStraitLink(referrer);
        if (linkId) {
          const clickId = parseStraitClick(referrer) ?? undefined;
          const { json } = await answered('/v1/referrer', {
            publishableKey: config.publishableKey, linkId, clickId, platform: 'android', ...tag,
          });
          if (json.matched) {
            if (record) noteTap(replyClickId(json.clickId, clickId), t0);
            return {
              kind: 'deferred', route: 'install_referrer', appState: 'closed', matched: true,
              ...destination(json.longUrl), linkId: json.linkId ?? linkId, ...referral(true, json.referralCode), ms: r.now() - t0, at: t0,
            };
          }
        }
      }
      const { json } = await answered('/v1/match', {
        publishableKey: config.publishableKey, platform: r.platform(), ...r.collectDevice(), ...tag,
      });
      if (record && json.matched === true) noteTap(replyClickId(json.clickId), t0);
      return {
        kind: 'deferred', route: 'fingerprint', appState: 'closed', matched: json.matched === true,
        reason: json.matched ? undefined : 'no_match', ...destination(json.matched ? json.longUrl : undefined),
        linkId: json.linkId, ...referral(json.matched === true, json.referralCode), ms: r.now() - t0, at: t0,
      };
    };
    let result: Omit<LinkEvent, 'id'>;
    try {
      result = await signal();
    } catch {
      result = { kind: 'deferred', route: 'fingerprint', appState: 'closed', matched: false, reason: 'network', ms: r.now() - t0, at: t0 };
    }
    // B19: device matching first; the clipboard only when it found nothing, and
    // only on the once-per-install iPhone check. Same openId, one event.
    const clip = config.clipboard;
    if (result.matched || !(record && config.clipboardBoost === true && clip && r.platform() === 'ios')) {
      return emit(id, result);
    }
    const token = await handoffToken(clip);
    if (!token) return emit(id, result);
    try {
      const { json } = await answered('/v1/handoff/claim', {
        publishableKey: config.publishableKey, token, platform: 'ios', ...tag,
      });
      if (json.matched !== true) return emit(id, result); // not claimable: keep the match result
      noteTap(replyClickId(json.clickId), t0);
      return emit(id, {
        kind: 'deferred', route: 'clipboard', appState: 'closed', matched: true,
        ...destination(json.longUrl), linkId: json.linkId, ...referral(true, json.referralCode), ms: r.now() - t0, at: t0,
      });
    } catch {
      return emit(id, { kind: 'deferred', route: 'clipboard', appState: 'closed', matched: false, reason: 'network', ms: r.now() - t0, at: t0 });
    }
  }

  /** B19 steps 1–3: detect (no prompt) → read only if a URL is likely → parse. Never throws. */
  async function handoffToken(clip: ClipboardAccess): Promise<string | null> {
    try {
      if (!(await clip.hasProbableWebUrl())) return null;
      return parseHandoffUrl(await clip.readText(), linkHosts);
    } catch {
      return null;
    }
  }

  async function claimHandoff(text: string): Promise<LinkEvent> {
    const r = await rt();
    const t0 = r.now();
    const id = newId(t0);
    const token = parseHandoffUrl(text, linkHosts);
    if (!token) {
      return emit(id, { kind: 'deferred', route: 'clipboard', appState: 'closed', matched: false, reason: 'not_handoff', ms: 0, at: t0 });
    }
    announce({ id, kind: 'deferred', appState: 'closed', at: t0 });
    try {
      const res = await call('POST', '/v1/handoff/claim', {
        publishableKey: config.publishableKey, token, platform: r.platform(), openId: id, at: t0, firstLaunch: isFirstLaunch,
      });
      if (shouldRetryReport(res.status)) throw new Error(`HTTP ${res.status}`);
      const json = res.json;
      const matched = json.matched === true;
      if (matched) noteTap(replyClickId(json.clickId), t0);
      return emit(id, {
        kind: 'deferred', route: 'clipboard', appState: 'closed', matched,
        reason: matched ? undefined : json.reason ?? json.error ?? 'no_match',
        ...destination(matched ? json.longUrl : undefined), linkId: json.linkId, ...referral(matched, json.referralCode), ms: r.now() - t0, at: t0,
      });
    } catch {
      return emit(id, { kind: 'deferred', route: 'clipboard', appState: 'closed', matched: false, reason: 'network', ms: r.now() - t0, at: t0 });
    }
  }

  return {
    async openStoreSheet(url: string, options: StoreSheetOptions = {}): Promise<StoreSheetResult> {
      try {
        const r = await rt();
        const base = options.opener ?? r.storeSheet ?? {};
        const clip = config.clipboard?.writeText ? (t: string) => config.clipboard!.writeText!(t) : undefined;
        const opener: StoreSheetOpener = { ...base, ...(base.writeClipboard || !clip ? {} : { writeClipboard: clip }) };
        return await runStoreSheet(
          { call, publishableKey: config.publishableKey, platform: r.platform(), device: () => ({ ...r.collectDevice() }) },
          url,
          options,
          opener,
        );
      } catch {
        return { opened: false, method: 'none', reason: 'error' };
      }
    },
    async start() {
      const r = await rt();
      dropStaleTap(r.now());
      unsubs.push(
        r.onAppState((s) => {
          tracker.onState(s, r.now());
          if (s === 'active') void flush();
        }),
        r.onURL((u) => void handleUrl(u, tracker.classify(r.now()))),
      );
      const initial = await r.getInitialURL().catch(() => null);
      // Unreadable storage counts as "already checked": never risk a stale
      // deferred jump on every launch. Write failures are ignored (never throw).
      const firstLaunch = (await storage.getItem(DEFERRED_FLAG).catch(() => '1')) !== '1';
      isFirstLaunch = firstLaunch;
      const markChecked = () => storage.setItem(DEFERRED_FLAG, '1').catch(() => undefined);
      if (initial) {
        // Opened by a link on first launch = the user's intent right now: no
        // deferred check, but this open still counts as the install's first.
        if (firstLaunch) await markChecked();
        await handleUrl(initial, 'closed', firstLaunch);
      } else if (firstLaunch) {
        // Marked done only once the engine answered: offline → next launch.
        const e = await runDeferred(true);
        if (e.reason !== 'network') await markChecked();
      }
      void flush();
    },
    onLink(cb) {
      for (const e of events) safely(cb, e);
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onLinkStart(cb) {
      startListeners.add(cb);
      return () => startListeners.delete(cb);
    },
    checkDeferred: () => runDeferred(false),
    claimHandoff,
    async reportFingerprint() {
      const r = await rt();
      return (await call('POST', '/v1/debug/fingerprint', {
        publishableKey: config.publishableKey, origin: 'app', ...r.collectDevice(),
      })).json;
    },
    async compareFingerprint() {
      return (await call('GET', `/v1/debug/fingerprint?publishableKey=${encodeURIComponent(config.publishableKey)}`)).json;
    },
    async trackEvent(name, extra = {}) {
      const r = await rt();
      try {
        await tapWrite;
        const stored = await storage.getItem(TAP_KEY).catch(() => null);
        if (staleTap(stored, r.now())) dropStaleTap(r.now());
        const clickId = eventClickId(stored, r.now(), extra.clickId) ?? undefined;
        return (await call('POST', '/v1/event', {
          publishableKey: config.publishableKey, event: name, platform: r.platform(), ...extra, clickId,
        })).ok;
      } catch {
        return false;
      }
    },
    async pendingOpenReports() {
      return serial(async () => (await readQueue()).length);
    },
    flushOpenReports: () => flush(),
    stop() {
      for (const u of unsubs.splice(0)) u();
    },
  };
}

/**
 * Wrap `react-native-play-install-referrer` for `installReferrer`:
 *   import { PlayInstallReferrer } from 'react-native-play-install-referrer';
 *   createStrait({ …, installReferrer: fromPlayInstallReferrer(PlayInstallReferrer) })
 */
export function fromPlayInstallReferrer(mod: {
  getInstallReferrerInfo(cb: (info: { installReferrer?: string } | null, error: unknown) => void): void;
}): () => Promise<string | null> {
  return () =>
    new Promise((resolve) => {
      try {
        mod.getInstallReferrerInfo((info, error) => resolve(error ? null : info?.installReferrer ?? null));
      } catch {
        resolve(null);
      }
    });
}

/**
 * Wrap `expo-clipboard` for `clipboard` (contract B19):
 *   import * as Clipboard from 'expo-clipboard';
 *   createStrait({ …, clipboardBoost: true, clipboard: fromExpoClipboard(Clipboard) })
 * `hasUrlAsync` uses iOS's hasURLs (no prompt); `getStringAsync` shows the paste prompt.
 */
export function fromExpoClipboard(mod: {
  hasUrlAsync(): Promise<boolean>;
  getStringAsync(): Promise<string>;
  setStringAsync?(text: string): Promise<unknown>;
}): ClipboardAccess {
  return {
    hasProbableWebUrl: () => mod.hasUrlAsync(),
    readText: async () => (await mod.getStringAsync()) || null,
    ...(mod.setStringAsync ? { writeText: async (t: string) => void (await mod.setStringAsync!(t)) } : {}),
  };
}

/** The real runtime, backed by React Native's Linking, AppState and Dimensions. */
export async function createReactNativeRuntime(
  opts: { installReferrer?: () => Promise<string | null> } = {},
): Promise<StraitRuntime> {
  // @ts-expect-error optional peer dependency, resolved at app runtime
  const rn = await import('react-native');
  const { Linking, AppState, Dimensions, PixelRatio, Platform } = rn;
  return {
    storeSheet: reactNativeStoreSheetOpener(rn),
    platform: () => (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other'),
    collectDevice: () => ({
      screenWidth: portraitScreenWidth(Dimensions.get('screen').width, Dimensions.get('screen').height),
      pixelRatio: PixelRatio.get(),
      language: deviceLanguage(),
      timezone: deviceTimezone(),
    }),
    getInstallReferrer: async () =>
      Platform.OS === 'android' && opts.installReferrer ? opts.installReferrer() : null,
    getInitialURL: () => Linking.getInitialURL(),
    onURL: (cb) => {
      const sub = Linking.addEventListener('url', ({ url }: { url: string }) => cb(url));
      return () => sub.remove();
    },
    onAppState: (cb) => {
      const sub = AppState.addEventListener('change', cb);
      return () => sub.remove();
    },
    now: () => Date.now(),
  };
}

function deviceLanguage(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  } catch {
    return 'en';
  }
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'XX';
  } catch {
    return 'XX';
  }
}



function destination(url: string | undefined): Pick<LinkEvent, 'url' | 'path' | 'params'> {
  if (!url) return {};
  const p = splitUrl(url);
  return p ? { url, path: p.path, params: p.params } : { url };
}

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) };
}
