import { browserScreenWidth, parseStraitLink, type DeviceFields } from './adapter.js';

export { browserScreenWidth };

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
/** A URL arriving this soon after the app came back to the front came "from background". */
const RESUME_WINDOW_MS = 2000;
/** Pauses shorter than this are Android delivering the link, not the user leaving. */
const TRANSIENT_PAUSE_MS = 1000;

export function createStrait(config: CreateStraitConfig): Strait {
  const doFetch = config.fetch ?? globalThis.fetch;
  const base = config.endpoint.replace(/\/+$/, '');
  const shortHosts = new Set(
    [base, ...(config.linkHosts ?? [])].map((h) => hostOf(h)).filter((h): h is string => !!h),
  );
  const storage = config.storage ?? memoryStore();
  const events: LinkEvent[] = [];
  const listeners = new Set<(e: LinkEvent) => void>();
  const unsubs: Array<() => void> = [];
  let runtime: StraitRuntime | undefined = config.runtime;
  let lastResumeAt = Number.NEGATIVE_INFINITY;
  let lastBackgroundAt = Number.NEGATIVE_INFINITY;
  let lastBackgroundFor = 0;
  let lastState: 'active' | 'background' | 'inactive' = 'active';
  let seq = 0;

  const rt = async (): Promise<StraitRuntime> =>
    (runtime ??= await createReactNativeRuntime({ installReferrer: config.installReferrer }));

  const emit = (e: Omit<LinkEvent, 'id'>) => {
    const event = { id: `evt_${e.at}_${++seq}`, ...e };
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
    const host = hostOf(raw);
    const isWeb = /^https?:\/\//i.test(raw);
    if (isWeb && host && shortHosts.has(host)) {
      try {
        const { json } = await call('POST', '/v1/resolve', {
          publishableKey: config.publishableKey,
          url: raw,
          platform: r.platform(),
        });
        return emit({
          kind: 'direct', route: 'app_link', appState, rawUrl: raw,
          matched: json.matched === true, reason: json.matched ? undefined : json.reason ?? json.error,
          ...destination(json.matched ? json.longUrl : undefined), linkId: json.linkId,
          ms: r.now() - t0, at: t0,
        });
      } catch {
        return emit({ kind: 'direct', route: 'app_link', appState, rawUrl: raw, matched: false, reason: 'network', ms: r.now() - t0, at: t0 });
      }
    }
    // A verified link on the customer's own site, or a browser hand-off via the
    // app's scheme (yourapp://host/path → https://host/path): the URL already
    // is the destination.
    const url = isWeb ? raw : raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, 'https://');
    return emit({
      kind: 'direct', route: isWeb ? 'app_link' : 'custom_scheme', appState, rawUrl: raw,
      matched: true, ...destination(url), ms: r.now() - t0, at: t0,
    });
  }

  async function runDeferred(): Promise<LinkEvent> {
    const r = await rt();
    const t0 = r.now();
    try {
      if (r.platform() === 'android') {
        const linkId = parseStraitLink(await r.getInstallReferrer().catch(() => null));
        if (linkId) {
          const { json } = await call('POST', '/v1/referrer', {
            publishableKey: config.publishableKey, linkId, platform: 'android',
          });
          if (json.matched) {
            return emit({
              kind: 'deferred', route: 'install_referrer', appState: 'closed', matched: true,
              ...destination(json.longUrl), linkId: json.linkId ?? linkId, ms: r.now() - t0, at: t0,
            });
          }
        }
      }
      const { json } = await call('POST', '/v1/match', {
        publishableKey: config.publishableKey, platform: r.platform(), ...r.collectDevice(),
      });
      return emit({
        kind: 'deferred', route: 'fingerprint', appState: 'closed', matched: json.matched === true,
        reason: json.matched ? undefined : 'no_match', ...destination(json.matched ? json.longUrl : undefined),
        linkId: json.linkId, ms: r.now() - t0, at: t0,
      });
    } catch {
      return emit({ kind: 'deferred', route: 'fingerprint', appState: 'closed', matched: false, reason: 'network', ms: r.now() - t0, at: t0 });
    }
  }

  return {
    async start() {
      const r = await rt();
      unsubs.push(
        r.onAppState((s) => {
          if (s !== 'active' && lastState === 'active') lastBackgroundAt = r.now();
          if (s === 'active' && lastState !== 'active') {
            lastResumeAt = r.now();
            lastBackgroundFor = lastResumeAt - lastBackgroundAt;
          }
          lastState = s;
        }),
        r.onURL((u) => {
          // Android delivers a link with a brief pause/resume around it, and the
          // link (onNewIntent) can arrive before or after the resume. A pause
          // shorter than TRANSIENT_PAUSE_MS is that delivery itself (the app was
          // on screen); a longer one means the user had left the app.
          let away: number | null = null;
          if (lastState !== 'active') away = r.now() - lastBackgroundAt;
          else if (r.now() - lastResumeAt <= RESUME_WINDOW_MS) away = lastBackgroundFor;
          const state = away !== null && away >= TRANSIENT_PAUSE_MS ? 'background' : 'foreground';
          void handleUrl(u, state);
        }),
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

/**
 * Minimal URL split. React Native's global URL doesn't implement host,
 * pathname or searchParams (they throw), so the SDK never relies on it.
 */
export function splitUrl(u: string): { scheme: string; host: string; path: string; params: Record<string, string> } | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(u.trim());
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const pair of (m[4] ?? '').split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? '' : pair.slice(i + 1);
    try {
      params[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      params[k] = v;
    }
  }
  return { scheme: m[1]!.toLowerCase(), host: m[2]!.toLowerCase(), path: m[3] || '/', params };
}

function hostOf(u: string): string | null {
  return splitUrl(u)?.host || null;
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
