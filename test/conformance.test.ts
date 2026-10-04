import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AppStateTracker, browserScreenWidth, portraitScreenWidth, classifyUrl, normalizeLinkHosts, parseStraitClick, parseStraitLink,
  pruneOpenQueue, shouldRetryReport, splitUrl, takeClickId, eventClickId, replyClickId, reportUrl, staleTap,
  ATTRIBUTION_WINDOW_MS, OPEN_QUEUE_MAX, OPEN_QUEUE_MAX_AGE_MS, RESUME_WINDOW_MS, TRANSIENT_PAUSE_MS,
} from '../src/core.js';

/** Shared cross-SDK contract (shared-spec/conformance-vectors.json). */
const v = JSON.parse(readFileSync(new URL('./conformance-vectors.json', import.meta.url), 'utf8'));

describe('conformance vectors', () => {
  it('constants', () => {
    expect({ RESUME_WINDOW_MS, TRANSIENT_PAUSE_MS, OPEN_QUEUE_MAX, OPEN_QUEUE_MAX_AGE_MS, ATTRIBUTION_WINDOW_MS }).toEqual(v.constants);
  });
  it.each(v.eventClickId)('eventClickId: $name', ({ stored, now, explicit, expected }) => {
    expect(eventClickId(stored, now, explicit)).toBe(expected);
  });
  it.each(v.replyClickId)('replyClickId: $name', ({ reply, fallback, expected }) => {
    expect(replyClickId(reply, fallback)).toBe(expected);
  });
  it.each(v.reportUrl)('reportUrl($input)', ({ input, expected }) => {
    expect(reportUrl(input)).toBe(expected);
  });
  it.each(v.staleTap)('staleTap: $name', ({ stored, now, expected }) => {
    expect(staleTap(stored, now)).toBe(expected);
  });
  it.each(v.screenWidth)('browserScreenWidth($logical)', ({ logical, expected }) => {
    expect(browserScreenWidth(logical)).toBe(expected);
  });
  it.each(v.portraitScreenWidth)('portraitScreenWidth($width, $height)', ({ width, height, expected }) => {
    expect(portraitScreenWidth(width, height)).toBe(expected);
  });
  it.each(v.splitUrl)('splitUrl($input)', ({ input, expected }) => {
    expect(splitUrl(input)).toEqual(expected);
  });
  it.each(v.referrer)('parseStraitLink($input)', ({ input, expected }) => {
    expect(parseStraitLink(input)).toBe(expected);
  });
  it.each(v.referrerClick)('parseStraitClick($input)', ({ input, expected }) => {
    expect(parseStraitClick(input)).toBe(expected);
  });
  it.each(v.takeClickId)('takeClickId($input)', ({ input, expected }) => {
    expect(takeClickId(input)).toEqual(expected);
  });
  it.each(v.openQueue)('pruneOpenQueue: $name', ({ now, queue, expected }) => {
    expect(pruneOpenQueue(queue, now).map((r: { openId: string }) => r.openId)).toEqual(expected);
  });
  it.each(v.retry)('shouldRetryReport($status)', ({ status, expected }) => {
    expect(shouldRetryReport(status)).toBe(expected);
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
