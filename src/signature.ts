/**
 * Strait deferred-match signature — CANONICAL reference implementation.
 *
 * This file generates test-vectors.json. Every SDK (web, RN, Flutter) and the
 * server port this logic and assert against those vectors. See RECIPE.md.
 *
 * Dependency-free and framework-free on purpose: it must be copyable to any
 * language without pulling anything in.
 */

export interface SignatureInputs {
  /** Logical screen width in px (will be rounded). */
  screenWidth: number;
  /** Device pixel ratio. */
  pixelRatio: number;
  /** Primary language tag, e.g. "en-US". */
  language: string;
  /** Public IPv4 as seen by the server. */
  ip: string;
  /** IANA timezone name, e.g. "Asia/Kolkata". */
  timezone: string;
}

export interface Signature {
  coreRaw: string;
  extRaw: string;
  coreHash: string;
  extHash: string;
}

const PLATFORM = 'universal';

const REGION_MAP: Record<string, string> = {
  'Asia/Kolkata': 'IN',
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'Europe/London': 'GB',
  'Europe/Paris': 'EU',
  'Europe/Berlin': 'EU',
  'Asia/Singapore': 'SG',
  'Asia/Dubai': 'AE',
  'Australia/Sydney': 'AU',
};

/** Deterministic 32-bit string hash (Java hashCode → abs → hex). */
export function h32(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0; // coerce to signed 32-bit
  }
  return Math.abs(h).toString(16);
}

/** Format a number the way JS String(Number) does (no trailing .0 on integers). */
export function numStr(n: number): string {
  return String(n);
}

export function regionFromTimezone(timezone: string): string {
  const tz = timezone === 'Asia/Calcutta' ? 'Asia/Kolkata' : timezone;
  return REGION_MAP[tz] ?? 'XX';
}

export function computeSignature(input: SignatureInputs): Signature {
  const screenWidth = Math.round(input.screenWidth);
  const pixelRatio = input.pixelRatio;
  const language = (input.language || 'en').slice(0, 2).toLowerCase();
  const ip = input.ip;

  const coreFields = [
    PLATFORM,
    numStr(screenWidth),
    numStr(pixelRatio),
    language,
    ip,
  ];
  const coreRaw = coreFields.join('|');

  const physWidth = Math.round((screenWidth * pixelRatio) / 8) * 8;
  const region = regionFromTimezone(input.timezone);
  const extRaw = [...coreFields, numStr(physWidth), region].join('|');

  return {
    coreRaw,
    extRaw,
    coreHash: h32(coreRaw),
    extHash: h32(extRaw),
  };
}
