/**
 * Pure, platform-free link logic. Every Strait SDK implements these exactly;
 * shared-spec/conformance-vectors.json is the cross-language contract
 * (see shared-spec/SDK-CONTRACT.md).
 */

/** How the app received a link. */
export type LinkRoute = 'app_link' | 'custom_scheme' | 'install_referrer' | 'fingerprint';
/** What the app was doing when the link arrived. */
export type AppStateAtLink = 'closed' | 'background' | 'foreground';

/**
 * Screen width as a browser reports it (`screen.width`). Chrome rounds
 * fractional logical widths UP (1080 px at 2.625 = 411.43 → 412). Matching
 * needs the app and the browser at the tap to agree.
 */
export function browserScreenWidth(logicalWidth: number): number {
  return Math.ceil(logicalWidth - 0.001);
}

export interface SplitUrl {
  scheme: string;
  host: string;
  path: string;
  params: Record<string, string>;
}

/**
 * Split a URL without relying on platform URL classes (React Native's global
 * URL doesn't implement host/pathname/searchParams). Scheme and host are
 * lower-cased; '+' and %-escapes in the query are decoded; fragment dropped.
 */
export function splitUrl(u: string): SplitUrl | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(u.trim());
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const pair of (m[4] ?? '').split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? '' : pair.slice(i + 1);
    params[decode(k)] = decode(v);
  }
  return { scheme: m[1]!.toLowerCase(), host: m[2]!.toLowerCase(), path: m[3] || '/', params };
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/**
 * The hosts that serve this app's short links: the endpoint's host plus any
 * configured link domains, given either as URLs ("https://go.brand.com") or
 * bare hosts ("go.brand.com"). Lower-cased, de-duplicated, order kept;
 * anything else (blank, paths, spaces) is ignored.
 */
export function normalizeLinkHosts(endpoint: string, linkHosts: string[] = []): string[] {
  const out: string[] = [];
  for (const h of [endpoint, ...linkHosts]) {
    const host = splitUrl(h)?.host ?? (/^[a-z0-9.-]+(:\d+)?$/i.test(h.trim()) ? h.trim().toLowerCase() : null);
    if (host && !out.includes(host)) out.push(host);
  }
  return out;
}

/** The strait_link id inside a Play Install Referrer string, or null. */
export function parseStraitLink(referrer: string | null | undefined): string | null {
  return referrerParam(referrer, 'strait_link');
}

/**
 * The tap id (strait_click) inside a Play Install Referrer string, or null.
 * Joins the install to the exact tap that sent the user to the store.
 */
export function parseStraitClick(referrer: string | null | undefined): string | null {
  const v = referrerParam(referrer, 'strait_click');
  return v && CLICK_ID.test(v) ? v : null;
}

function referrerParam(referrer: string | null | undefined, key: string): string | null {
  if (!referrer) return null;
  for (const pair of referrer.split('&')) {
    const i = pair.indexOf('=');
    if (i < 0 || pair.slice(0, i) !== key) continue;
    const v = decode(pair.slice(i + 1));
    return v || null;
  }
  return null;
}

/** A tap id as Strait issues it (uuid); anything else is ignored. */
const CLICK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remove every `strait_click` parameter from a URL's query, keeping the rest
 * of the URL byte-for-byte (fragment included). Returns the cleaned URL and
 * the tap id (null when absent or malformed). The app never sees the tap id.
 */
export function takeClickId(raw: string): { url: string; clickId: string | null } {
  const s = raw.trim();
  const hash = s.indexOf('#');
  const beforeHash = hash < 0 ? s : s.slice(0, hash);
  const frag = hash < 0 ? '' : s.slice(hash);
  const q = beforeHash.indexOf('?');
  if (q < 0) return { url: s, clickId: null };
  let clickId: string | null = null;
  const kept = beforeHash
    .slice(q + 1)
    .split('&')
    .filter((pair) => {
      const i = pair.indexOf('=');
      if (decode(i < 0 ? pair : pair.slice(0, i)) !== 'strait_click') return true;
      const v = decode(i < 0 ? '' : pair.slice(i + 1));
      if (CLICK_ID.test(v)) clickId = v.toLowerCase();
      return false;
    });
  const query = kept.join('&');
  return { url: beforeHash.slice(0, q) + (query ? `?${query}` : '') + frag, clickId };
}

export type ClassifiedUrl =
  | { route: 'app_link'; needsResolve: true }
  | {
      route: 'app_link' | 'custom_scheme';
      needsResolve: false;
      url: string;
      path: string;
      params: Record<string, string>;
      /** Tap id from a Strait hand-off (removed from url/params), else null. */
      clickId: string | null;
    }
  | null;

/**
 * What a URL handed to the app means:
 * - https on a Strait link host → a short link; ask /v1/resolve for the destination.
 * - other https (a verified link on the customer's own site) → it IS the destination.
 * - yourapp://host/path (browser hand-off) → destination https://host/path.
 * A `strait_click` tap id is removed from the destination and returned apart.
 * Returns null for anything that isn't a URL.
 */
export function classifyUrl(raw: string, linkHosts: string[]): ClassifiedUrl {
  const p0 = splitUrl(raw);
  if (!p0) return null;
  const isWeb = p0.scheme === 'https' || p0.scheme === 'http';
  if (isWeb && linkHosts.map((h) => h.toLowerCase()).includes(p0.host)) {
    return { route: 'app_link', needsResolve: true };
  }
  const { url: clean, clickId } = takeClickId(raw);
  const p = splitUrl(clean)!;
  const url = isWeb ? clean : clean.replace(/^[a-z][a-z0-9+.-]*:\/\//i, 'https://');
  return { route: isWeb ? 'app_link' : 'custom_scheme', needsResolve: false, url, path: p.path, params: p.params, clickId };
}

/** Open reports waiting to be sent are kept at most this long… */
export const OPEN_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** …and at most this many (oldest dropped first). */
export const OPEN_QUEUE_MAX = 100;

/**
 * Prune a pending-report queue: drop reports older than OPEN_QUEUE_MAX_AGE_MS
 * (by their `at`), then keep the newest OPEN_QUEUE_MAX. Order is kept.
 */
export function pruneOpenQueue<T extends { at: number }>(queue: T[], now: number): T[] {
  return queue.filter((r) => now - r.at <= OPEN_QUEUE_MAX_AGE_MS).slice(-OPEN_QUEUE_MAX);
}

/**
 * Conversion events carry the tap id of the most recent attributed link open
 * for this long (contract B15).
 */
export const ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Storage value for the remembered tap (key `strait.lastTap`): `{"clickId":…,"at":<epoch ms>}`. */
export function rememberTap(clickId: string, at: number): string {
  return JSON.stringify({ clickId: clickId.toLowerCase(), at });
}

/**
 * The `clickId` a conversion event sends (contract B15): an explicit non-empty
 * `explicit` wins; otherwise the remembered tap (`stored`, see `rememberTap`)
 * when it is a valid tap id opened at most ATTRIBUTION_WINDOW_MS before `now`
 * (and not after it). Anything unreadable means no tap.
 */
export function eventClickId(stored: string | null | undefined, now: number, explicit?: string | null): string | null {
  if (typeof explicit === 'string' && explicit !== '') return explicit;
  if (!stored) return null;
  let tap: unknown;
  try {
    tap = JSON.parse(stored);
  } catch {
    return null;
  }
  const { clickId, at } = (tap ?? {}) as { clickId?: unknown; at?: unknown };
  if (typeof clickId !== 'string' || !CLICK_ID.test(clickId)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  const age = now - at;
  return age >= 0 && age <= ATTRIBUTION_WINDOW_MS ? clickId.toLowerCase() : null;
}

/** Whether a failed report should be kept for retry: no answer, 429 or 5xx. */
export function shouldRetryReport(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

/** A unique id for one link open (the engine de-duplicates retries by it). */
export function newOpenId(now: number, random: () => number = Math.random): string {
  let r = '';
  for (let i = 0; i < 12; i++) r += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)];
  return `o_${now.toString(36)}_${r}`;
}

/** A link arriving this soon after the app came back to the front came "from background". */
export const RESUME_WINDOW_MS = 2000;
/** Pauses shorter than this are Android delivering the link, not the user leaving. */
export const TRANSIENT_PAUSE_MS = 1000;

/**
 * Tracks app lifecycle to label a link delivered while the app is running.
 * Android wraps link delivery in a brief pause/resume, and the link can arrive
 * before or after the resume: a pause under TRANSIENT_PAUSE_MS is that
 * delivery (app was on screen); a longer one means the user had left.
 */
export class AppStateTracker {
  private state: 'active' | 'background' | 'inactive' = 'active';
  private backgroundAt = Number.NEGATIVE_INFINITY;
  private resumeAt = Number.NEGATIVE_INFINITY;
  private backgroundFor = 0;

  onState(s: 'active' | 'background' | 'inactive', now: number): void {
    if (s !== 'active' && this.state === 'active') this.backgroundAt = now;
    if (s === 'active' && this.state !== 'active') {
      this.resumeAt = now;
      this.backgroundFor = now - this.backgroundAt;
    }
    this.state = s;
  }

  /** Label for a link delivered (while running) at `now`. */
  classify(now: number): 'background' | 'foreground' {
    let away: number | null = null;
    if (this.state !== 'active') away = now - this.backgroundAt;
    else if (now - this.resumeAt <= RESUME_WINDOW_MS) away = this.backgroundFor;
    return away !== null && away >= TRANSIENT_PAUSE_MS ? 'background' : 'foreground';
  }
}
