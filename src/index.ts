import {
  createReactNativeAdapter,
  parseStraitLink,
  type NativeAdapter,
} from './adapter.js';

export type { DeviceFields, NativeAdapter } from './adapter.js';
export { parseStraitLink } from './adapter.js';
export { computeSignature, h32 } from './signature.js';

export interface StraitConfig {
  /**
   * Your workspace's publishable key (`bk_pub_live_…`), from Dashboard →
   * Get started. Safe to ship in apps/websites — never use the secret key here.
   */
  publishableKey: string;
  /** The Strait link host, e.g. https://go.yourbrand.com. */
  endpoint: string;
  /** Override the native adapter (tests / custom platforms). */
  adapter?: NativeAdapter;
  /** Override fetch (tests). */
  fetch?: typeof fetch;
}

export interface MatchResult {
  matched: boolean;
  /** The deferred deep link to route to, when matched. */
  longUrl?: string;
  linkId?: string;
  matchMethod: 'install_referrer' | 'exact_ext' | 'exact_core' | 'none';
}

const NONE: MatchResult = { matched: false, matchMethod: 'none' };

/**
 * Call once on first launch. Resolves the deferred deep link this device
 * clicked before installing:
 *   • Android → Play Install Referrer (deterministic, exact) when present;
 *   • otherwise → fingerprint match via /v1/match (probabilistic).
 * Never throws — returns a no-match result on any error.
 */
export async function resolveDeferredLink(config: StraitConfig): Promise<MatchResult> {
  const doFetch = config.fetch ?? globalThis.fetch;
  let adapter: NativeAdapter;
  try {
    adapter = config.adapter ?? (await createReactNativeAdapter());
  } catch {
    return NONE;
  }

  const platform = adapter.platform();
  const base = config.endpoint.replace(/\/+$/, '');

  const post = async (path: string, body: unknown): Promise<MatchResult> => {
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return NONE;
      return (await res.json()) as MatchResult;
    } catch {
      return NONE;
    }
  };

  // 1. Android deterministic path — exact, no fingerprint needed.
  if (platform === 'android') {
    let linkId: string | null = null;
    try {
      linkId = parseStraitLink(await adapter.getInstallReferrer());
    } catch {
      linkId = null;
    }
    if (linkId) {
      const r = await post('/v1/referrer', { publishableKey: config.publishableKey, linkId, platform });
      if (r.matched) return r;
      // else fall through to the probabilistic path
    }
  }

  // 2. Probabilistic fingerprint path (iOS, and Android fallback).
  let device;
  try {
    device = adapter.collectDevice();
  } catch {
    return NONE;
  }
  return post('/v1/match', { publishableKey: config.publishableKey, platform, ...device });
}

export {
  createStrait,
  createReactNativeRuntime,
  fromPlayInstallReferrer,
  type Strait,
  type StraitRuntime,
  type CreateStraitConfig,
  type KeyValueStore,
  type LinkEvent,
  type LinkStart,
} from './strait.js';
export {
  AppStateTracker,
  classifyUrl,
  normalizeLinkHosts,
  splitUrl,
  browserScreenWidth,
  parseStraitClick,
  takeClickId,
  newOpenId,
  pruneOpenQueue,
  shouldRetryReport,
  eventClickId,
  rememberTap,
  ATTRIBUTION_WINDOW_MS,
  OPEN_QUEUE_MAX,
  OPEN_QUEUE_MAX_AGE_MS,
  RESUME_WINDOW_MS,
  TRANSIENT_PAUSE_MS,
  type ClassifiedUrl,
} from './core.js';
