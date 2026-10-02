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
  if (!referrer) return null;
  for (const pair of referrer.split('&')) {
    const i = pair.indexOf('=');
    if (i < 0 || pair.slice(0, i) !== 'strait_link') continue;
    const v = decode(pair.slice(i + 1));
    return v || null;
  }
  return null;
}

export type ClassifiedUrl =
  | { route: 'app_link'; needsResolve: true }
  | { route: 'app_link' | 'custom_scheme'; needsResolve: false; url: string; path: string; params: Record<string, string> }
  | null;

/**
 * What a URL handed to the app means:
 * - https on a Strait link host → a short link; ask /v1/resolve for the destination.
 * - other https (a verified link on the customer's own site) → it IS the destination.
 * - yourapp://host/path (browser hand-off) → destination https://host/path.
 * Returns null for anything that isn't a URL.
 */
export function classifyUrl(raw: string, linkHosts: string[]): ClassifiedUrl {
  const p = splitUrl(raw);
  if (!p) return null;
  const isWeb = p.scheme === 'https' || p.scheme === 'http';
  if (isWeb && linkHosts.map((h) => h.toLowerCase()).includes(p.host)) {
    return { route: 'app_link', needsResolve: true };
  }
  const url = isWeb ? raw.trim() : raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, 'https://');
  return { route: isWeb ? 'app_link' : 'custom_scheme', needsResolve: false, url, path: p.path, params: p.params };
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
