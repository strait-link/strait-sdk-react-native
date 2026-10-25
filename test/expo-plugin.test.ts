import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The Expo config plugin is plain CommonJS (Expo loads app.plugin.* with require).
const withStrait = createRequire(import.meta.url)('../app.plugin.cjs') as (
  config: Record<string, any>,
  props?: unknown,
) => Record<string, any>;

const base = () => ({ name: 'Acme', slug: 'acme' });
const appLinksFilter = (hosts: string[]) => ({
  action: 'VIEW',
  autoVerify: true,
  data: hosts.map((host) => ({ scheme: 'https', host })),
  category: ['BROWSABLE', 'DEFAULT'],
});

describe('Expo config plugin (app.plugin.cjs)', () => {
  it('writes Associated Domains, an autoVerify App Links filter and the scheme', () => {
    const out = withStrait(base(), { domains: ['acme.strait.link'], scheme: 'acme' });
    expect(out.ios.associatedDomains).toEqual(['applinks:acme.strait.link']);
    expect(out.android.intentFilters).toEqual([appLinksFilter(['acme.strait.link'])]);
    expect(out.scheme).toBe('acme');
  });

  it('takes several domains (custom domain + handle) in one filter', () => {
    const out = withStrait(base(), { domains: ['acme.strait.link', 'go.acme.com'] });
    expect(out.ios.associatedDomains).toEqual(['applinks:acme.strait.link', 'applinks:go.acme.com']);
    expect(out.android.intentFilters).toEqual([appLinksFilter(['acme.strait.link', 'go.acme.com'])]);
    expect(out.scheme).toBeUndefined();
  });

  it('accepts a full link address and lowercases it', () => {
    const out = withStrait(base(), { domains: ['https://Acme.Strait.Link/'] });
    expect(out.ios.associatedDomains).toEqual(['applinks:acme.strait.link']);
  });

  it('keeps what app.json already has and adds nothing twice (prebuild runs it again)', () => {
    const config = {
      ...base(),
      scheme: ['myapp'],
      ios: { bundleIdentifier: 'com.acme', associatedDomains: ['webcredentials:acme.com', 'applinks:acme.strait.link'] },
      android: { package: 'com.acme', intentFilters: [{ action: 'VIEW', data: [{ scheme: 'https', host: 'acme.com' }] }] },
    };
    const props = { domains: ['acme.strait.link'], scheme: 'acme' };
    const once = withStrait(config, props);
    const twice = withStrait(once, props);
    expect(twice.ios.bundleIdentifier).toBe('com.acme');
    expect(twice.ios.associatedDomains).toEqual(['webcredentials:acme.com', 'applinks:acme.strait.link']);
    expect(twice.android.package).toBe('com.acme');
    expect(twice.android.intentFilters).toEqual([
      { action: 'VIEW', data: [{ scheme: 'https', host: 'acme.com' }] },
      appLinksFilter(['acme.strait.link']),
    ]);
    expect(twice.scheme).toEqual(['myapp', 'acme']);
  });

  it('leaves an existing scheme string alone when it is the same', () => {
    expect(withStrait({ ...base(), scheme: 'acme' }, { scheme: 'acme' }).scheme).toBe('acme');
    expect(withStrait({ ...base(), scheme: 'old' }, { scheme: 'acme' }).scheme).toEqual(['old', 'acme']);
  });

  it('does not change the config object it was given', () => {
    const config = { ...base(), ios: { associatedDomains: [] as string[] } };
    withStrait(config, { domains: ['acme.strait.link'] });
    expect(config.ios.associatedDomains).toEqual([]);
  });

  it.each([
    [undefined, 'needs `domains`'],
    [{}, 'needs `domains`'],
    [{ domains: [] }, 'needs `domains`'],
    [{ domains: 'acme.strait.link' }, '`domains` must be a list'],
    [{ domains: ['acme.strait.link/path'] }, 'not a link domain'],
    [{ domains: ['http://acme.strait.link'] }, 'not a link domain'],
    [{ domains: ['*.strait.link'] }, 'not a link domain'],
    [{ domains: ['localhost'] }, 'not a link domain'],
    [{ scheme: 'https' }, 'not a custom scheme'],
    [{ scheme: 'my app' }, 'not a custom scheme'],
    [{ domains: ['acme.strait.link'], scheme: 42 }, 'not a custom scheme'],
  ])('refuses bad options %j with a clear message', (props, message) => {
    expect(() => withStrait(base(), props)).toThrow(message);
  });

  it('works with only a scheme (no link domain yet)', () => {
    const out = withStrait(base(), { scheme: 'acme' });
    expect(out.scheme).toBe('acme');
    expect(out.ios).toBeUndefined();
    expect(out.android).toBeUndefined();
  });
});
