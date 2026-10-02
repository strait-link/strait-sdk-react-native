import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AppStateTracker, browserScreenWidth, classifyUrl, normalizeLinkHosts, parseStraitLink, splitUrl,
  RESUME_WINDOW_MS, TRANSIENT_PAUSE_MS,
} from '../src/core.js';

/** Shared cross-SDK contract (shared-spec/conformance-vectors.json). */
const v = JSON.parse(readFileSync(new URL('./conformance-vectors.json', import.meta.url), 'utf8'));

describe('conformance vectors', () => {
  it('constants', () => {
    expect({ RESUME_WINDOW_MS, TRANSIENT_PAUSE_MS }).toEqual(v.constants);
  });
  it.each(v.screenWidth)('browserScreenWidth($logical)', ({ logical, expected }) => {
    expect(browserScreenWidth(logical)).toBe(expected);
  });
  it.each(v.splitUrl)('splitUrl($input)', ({ input, expected }) => {
    expect(splitUrl(input)).toEqual(expected);
  });
  it.each(v.referrer)('parseStraitLink($input)', ({ input, expected }) => {
    expect(parseStraitLink(input)).toBe(expected);
  });
  it.each(v.classify)('classifyUrl($raw)', ({ raw, linkHosts, expected }) => {
    expect(classifyUrl(raw, linkHosts)).toEqual(expected);
  });
  it.each(v.linkHosts)('normalizeLinkHosts($endpoint, $linkHosts)', ({ endpoint, linkHosts, expected }) => {
    expect(normalizeLinkHosts(endpoint, linkHosts)).toEqual(expected);
  });
  it.each(v.appState)('AppStateTracker: $name', ({ steps, expected }) => {
    const t = new AppStateTracker();
    const labels: string[] = [];
    for (const [kind, a, b] of steps as Array<[string, string | number, number?]>) {
      if (kind === 'state') t.onState(a as 'active' | 'background' | 'inactive', b as number);
      else labels.push(t.classify(a as number));
    }
    expect(labels).toEqual(expected);
  });
});
