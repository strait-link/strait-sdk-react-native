import { describe, expect, it, vi } from 'vitest';
import { parseStraitLink, resolveDeferredLink } from '../src/index.js';
import type { NativeAdapter } from '../src/adapter.js';

const device = {
  screenWidth: 393,
  pixelRatio: 3,
  language: 'en-IN',
  timezone: 'Asia/Kolkata',
};

function adapterFor(
  platform: 'ios' | 'android' | 'other',
  referrer: string | null = null,
): NativeAdapter {
  return {
    platform: () => platform,
    collectDevice: () => device,
    getInstallReferrer: async () => referrer,
  };
}

function jsonFetch(payload: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => payload })) as unknown as typeof fetch;
}

describe('parseStraitLink', () => {
  it('extracts strait_link from a Play referrer', () => {
    expect(parseStraitLink('utm_source=x&strait_link=lnk_42&y=1')).toBe('lnk_42');
  });
  it('returns null when absent or empty', () => {
    expect(parseStraitLink('utm_source=x')).toBeNull();
    expect(parseStraitLink(null)).toBeNull();
  });
});

describe('resolveDeferredLink — Android deterministic path', () => {
  it('uses /v1/referrer when the install referrer carries a strait_link', async () => {
    const fetchMock = jsonFetch({
      matched: true,
      longUrl: 'https://app/x',
      matchMethod: 'install_referrer',
    });
    const res = await resolveDeferredLink({
      publishableKey: 'bk_pub_test_ten1key01',
      endpoint: 'https://go.example.com/',
      adapter: adapterFor('android', 'strait_link=lnk_42'),
      fetch: fetchMock,
    });
    expect(res.matchMethod).toBe('install_referrer');
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://go.example.com/v1/referrer');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      publishableKey: 'bk_pub_test_ten1key01',
      linkId: 'lnk_42',
      platform: 'android',
    });
  });

  it('falls back to /v1/match when the referrer has no strait_link', async () => {
    const fetchMock = jsonFetch({ matched: false, matchMethod: 'none' });
    await resolveDeferredLink({
      publishableKey: 'bk_pub_test_ten1key01',
      endpoint: 'https://go.example.com',
      adapter: adapterFor('android', 'utm_source=organic'),
      fetch: fetchMock,
    });
    const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://go.example.com/v1/match');
  });

  it('falls back to /v1/match when the referrer lookup misses', async () => {
    // referrer call returns no match → SDK retries via fingerprint
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ matched: false, matchMethod: 'none' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ matched: true, longUrl: 'https://app/y', matchMethod: 'exact_ext' }) }) as unknown as typeof fetch;
    const res = await resolveDeferredLink({
      publishableKey: 'bk_pub_test_ten1key01',
      endpoint: 'https://go.example.com',
      adapter: adapterFor('android', 'strait_link=lnk_x'),
      fetch: fetchMock,
    });
    expect(res.matchMethod).toBe('exact_ext');
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

describe('resolveDeferredLink — iOS probabilistic path', () => {
  it('posts device fields + publishableKey to /v1/match', async () => {
    const fetchMock = jsonFetch({ matched: true, longUrl: 'https://app/z', matchMethod: 'exact_ext' });
    const res = await resolveDeferredLink({
      publishableKey: 'bk_pub_test_ten1key01',
      endpoint: 'https://go.example.com',
      adapter: adapterFor('ios'),
      fetch: fetchMock,
    });
    expect(res.longUrl).toBe('https://app/z');
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://go.example.com/v1/match');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      publishableKey: 'bk_pub_test_ten1key01',
      platform: 'ios',
      ...device,
    });
  });

  it('never throws on network failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const res = await resolveDeferredLink({
      publishableKey: 'bk_pub_test_ten1key01',
      endpoint: 'https://go.example.com',
      adapter: adapterFor('ios'),
      fetch: fetchMock,
    });
    expect(res).toEqual({ matched: false, matchMethod: 'none' });
  });
});
