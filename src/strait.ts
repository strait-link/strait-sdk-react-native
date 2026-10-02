import type { DeviceFields } from './adapter.js';
import { AppStateTracker, browserScreenWidth, classifyUrl, normalizeLinkHosts, parseStraitLink, splitUrl } from './core.js';

export { browserScreenWidth, splitUrl } from './core.js';

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
}

/** Persistent key/value storage, e.g. @react-native-async-storage/async-storage. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface LinkEvent {
  id: string;
  /** direct = the app was opened by a link; deferred = link tapped before install. */
  kind: 'direct' | 'deferred';
  /**
   * app_link: verified https link opened the app directly ·
   * custom_scheme: a browser handed off to the app (yourapp://…) ·
   * install_referrer / fingerprint: how a deferred link was found.
   */
  route: 'app_link' | 'custom_scheme' | 'install_referrer' | 'fingerprint';
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
  /** Workspace publishable key (bk_pub_live_…), Dashboard → Get started. */
  publishableKey: string;
  /** Your Strait link host, e.g. https://bridge-redirect-engine.onrender.com */
  endpoint: string;
  /** Extra hosts that serve your short links (custom domains). */
  linkHosts?: string[];
  /** Persist "deferred check done" across launches (pass AsyncStorage). */
  storage?: KeyValueStore;
  /** Android: returns the Play Install Referrer. See `fromPlayInstallReferrer`. */
  installReferrer?: () => Promise<string | null>;
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
  /** Re-run the deferred check now (debugging); doesn't touch the once-per-install flag. */
  checkDeferred(): Promise<LinkEvent>;
  /** Send this app's fingerprint to the engine (debug comparison with the browser). */
  reportFingerprint(): Promise<unknown>;
  /** Engine's comparison of the app and browser fingerprints on this network. */
  compareFingerprint(): Promise<unknown>;
  /** Conversion / revenue event. Resolves true when accepted. */
  trackEvent(
    name: string,
    extra?: { value?: number; currency?: string; linkId?: string },
  ): Promise<boolean>;
  stop(): void;
}

const DEFERRED_FLAG = 'strait.deferredChecked';
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
  let seq = 0;

  const rt = async (): Promise<StraitRuntime> =>
    (runtime ??= await createReactNativeRuntime({ installReferrer: config.installReferrer }));

  const newId = (at: number) => `evt_${at}_${++seq}`;
  const announce = (s: LinkStart) => {
    for (const cb of startListeners) cb(s);
  };
  const emit = (id: string, e: Omit<LinkEvent, 'id'>) => {
    const event = { id, ...e };
    events.push(event);
    for (const cb of listeners) cb(event);
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

  async function handleUrl(raw: string, appState: LinkEvent['appState']) {
    const r = await rt();
    const t0 = r.now();
    const id = newId(t0);
    announce({ id, kind: 'direct', appState, rawUrl: raw, at: t0 });
    const c = classifyUrl(raw, linkHosts);
    if (!c) {
      return emit(id, { kind: 'direct', route: 'app_link', appState, rawUrl: raw, matched: false, reason: 'invalid_url', ms: r.now() - t0, at: t0 });
    }
    if (c.needsResolve) {
      try {
        const { json } = await call('POST', '/v1/resolve', {
          publishableKey: config.publishableKey,
          url: raw,
          platform: r.platform(),
        });
        return emit(id, {
          kind: 'direct', route: 'app_link', appState, rawUrl: raw,
          matched: json.matched === true, reason: json.matched ? undefined : json.reason ?? json.error,
          ...destination(json.matched ? json.longUrl : undefined), linkId: json.linkId,
          ms: r.now() - t0, at: t0,
        });
      } catch {
        return emit(id, { kind: 'direct', route: 'app_link', appState, rawUrl: raw, matched: false, reason: 'network', ms: r.now() - t0, at: t0 });
      }
    }
    return emit(id, {
      kind: 'direct', route: c.route, appState, rawUrl: raw, matched: true,
      url: c.url, path: c.path, params: c.params, ms: r.now() - t0, at: t0,
    });
  }

  async function runDeferred(): Promise<LinkEvent> {
    const r = await rt();
    const t0 = r.now();
    const id = newId(t0);
    announce({ id, kind: 'deferred', appState: 'closed', at: t0 });
    try {
      if (r.platform() === 'android') {
        const linkId = parseStraitLink(await r.getInstallReferrer().catch(() => null));
        if (linkId) {
          const { json } = await call('POST', '/v1/referrer', {
            publishableKey: config.publishableKey, linkId, platform: 'android',
          });
          if (json.matched) {
            return emit(id, {
              kind: 'deferred', route: 'install_referrer', appState: 'closed', matched: true,
              ...destination(json.longUrl), linkId: json.linkId ?? linkId, ms: r.now() - t0, at: t0,
            });
          }
        }
      }
      const { json } = await call('POST', '/v1/match', {
        publishableKey: config.publishableKey, platform: r.platform(), ...r.collectDevice(),
      });
      return emit(id, {
        kind: 'deferred', route: 'fingerprint', appState: 'closed', matched: json.matched === true,
        reason: json.matched ? undefined : 'no_match', ...destination(json.matched ? json.longUrl : undefined),
        linkId: json.linkId, ms: r.now() - t0, at: t0,
      });
    } catch {
      return emit(id, { kind: 'deferred', route: 'fingerprint', appState: 'closed', matched: false, reason: 'network', ms: r.now() - t0, at: t0 });
    }
  }

  return {
    async start() {
      const r = await rt();
      unsubs.push(
        r.onAppState((s) => tracker.onState(s, r.now())),
        r.onURL((u) => void handleUrl(u, tracker.classify(r.now()))),
      );
      const initial = await r.getInitialURL().catch(() => null);
      if (initial) await handleUrl(initial, 'closed');
      if ((await storage.getItem(DEFERRED_FLAG)) !== '1') {
        await storage.setItem(DEFERRED_FLAG, '1');
        // Opened by a link on first launch = the user's intent right now.
        if (!initial) await runDeferred();
      }
    },
    onLink(cb) {
      for (const e of events) cb(e);
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onLinkStart(cb) {
      startListeners.add(cb);
      return () => startListeners.delete(cb);
    },
    checkDeferred: runDeferred,
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
        return (await call('POST', '/v1/event', {
          publishableKey: config.publishableKey, event: name, platform: r.platform(), ...extra,
        })).ok;
      } catch {
        return false;
      }
    },
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

/** The real runtime, backed by React Native's Linking, AppState and Dimensions. */
export async function createReactNativeRuntime(
  opts: { installReferrer?: () => Promise<string | null> } = {},
): Promise<StraitRuntime> {
  // @ts-expect-error optional peer dependency, resolved at app runtime
  const rn = await import('react-native');
  const { Linking, AppState, Dimensions, PixelRatio, Platform } = rn;
  return {
    platform: () => (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other'),
    collectDevice: () => ({
      screenWidth: browserScreenWidth(Dimensions.get('screen').width),
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
