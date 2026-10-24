import { describe, expect, it, vi } from 'vitest';
import { createStrait, doctorFindings, type DoctorFinding, type StraitRuntime } from '../src/index.js';

// Every row of shared-spec ADR 0002 (contract B23), word for word.
const PK = 'st_pub_live_abc123';
const EP = 'https://acme.strait.link';
const FP = 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';
const OTHER_FP = '6B:A3:E4:40:DF:12:16:87:B1:C6:98:7F:E1:9A:4E:28:CF:96:A6:61:38:40:28:00:03:90:56:EA:42:6F:7C:18';

const assetlinks = (apps: Array<[string, string[]]>) =>
  JSON.stringify(
    apps.map(([pkg, fps]) => ({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fps },
    })),
  );
const aasa = (appIDs: string[]) =>
  JSON.stringify({ applinks: { apps: [], details: appIDs.length ? [{ appIDs, components: [{ '/': '/*' }] }] : [] } });

const ok200 = (body: string) => ({ status: 200, body });
const ids = (f: DoctorFinding[]) => f.map((x) => x.id);
const byId = (f: DoctorFinding[], id: string) => f.find((x) => x.id === id);

describe('doctorFindings: key', () => {
  const run = (publishableKey: string) => doctorFindings({ publishableKey, endpoint: 'not a url', platform: 'android' }).findings[0];

  it('key.ok for st_pub_', () => {
    expect(run(PK)).toEqual({ id: 'key.ok', severity: 'ok', title: 'Publishable key is set', fix: '' });
  });
  it.each(['st_live_x', 'st_test_x'])('key.secret for %s', (k) => {
    expect(run(k)).toEqual({
      id: 'key.secret',
      severity: 'error',
      title: 'This is a secret key, not the publishable key',
      fix: 'Use the publishable key (st_pub_…) from Dashboard → Get started, and revoke this secret key in Dashboard → Settings → Secret keys: it has been inside your app.',
    });
  });
  it.each(['', 'bk_pub_x', 'pub_live_x'])('key.invalid for %j', (k) => {
    expect(run(k)).toEqual({
      id: 'key.invalid',
      severity: 'error',
      title: 'Not a publishable key',
      fix: 'Copy the publishable key (st_pub_…) from Dashboard → Get started.',
    });
  });
});

describe('doctorFindings: endpoint', () => {
  it.each(['http://acme.strait.link', 'acme.strait.link', 'https://', 'https:///x', ''])('endpoint.invalid for %j, no host checks', (endpoint) => {
    const r = doctorFindings({ publishableKey: PK, endpoint, platform: 'ios' });
    expect(r.findings).toEqual([
      { id: 'key.ok', severity: 'ok', title: 'Publishable key is set', fix: '' },
      {
        id: 'endpoint.invalid',
        severity: 'error',
        title: "The endpoint isn't an https link domain",
        fix: 'Set endpoint to your link domain from Dashboard → Get started, e.g. https://<handle>.strait.link.',
      },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe.each(['android', 'ios'] as const)('doctorFindings: host checks (%s)', (platform) => {
  const file = platform === 'android' ? 'assetlinks.json' : 'apple-app-site-association';
  const run = (f?: { status?: number; body?: string }) => doctorFindings({ publishableKey: PK, endpoint: EP + '/', platform, file: f });

  it('host.unreachable when the GET failed', () => {
    const r = run({});
    expect(ids(r.findings)).toEqual(['key.ok', 'host.unreachable']);
    expect(r.findings[1]).toEqual({
      id: 'host.unreachable',
      severity: 'error',
      title: "Can't reach acme.strait.link",
      fix: 'Check that endpoint is your link domain (Dashboard → Get started) and that this device is online.',
    });
    expect(r.ok).toBe(false);
  });

  it.each([
    { status: 404, body: '' },
    { status: 200, body: '<html>hi</html>' },
    { status: 200, body: platform === 'android' ? '{}' : '[]' },
  ])('host.file_missing for %j', (f) => {
    const r = run(f);
    expect(ids(r.findings)).toEqual(['key.ok', 'host.file_missing']);
    expect(r.findings[1]).toEqual({
      id: 'host.file_missing',
      severity: 'error',
      title: `acme.strait.link doesn't serve ${file}`,
      fix: 'Use your Strait link domain as endpoint (Dashboard → Get started); Strait serves this file there.',
    });
  });

  it('app.none when the file lists no app', () => {
    const r = run(ok200(platform === 'android' ? '[]' : aasa([])));
    expect(r.findings[1]).toEqual({
      id: 'app.none',
      severity: 'error',
      title: `No ${platform === 'android' ? 'Android' : 'iOS'} app is set up for acme.strait.link`,
      fix: 'Add your app in Dashboard → Apps & stores.',
    });
    expect(r.ok).toBe(false);
  });
});

describe('doctorFindings: Android app and certificate', () => {
  const body = assetlinks([['com.acme.app', [FP]], ['com.acme.other', [OTHER_FP]]]);
  const run = (appId?: string, certSha256?: string[]) =>
    doctorFindings({ publishableKey: PK, endpoint: EP, platform: 'android', appId, certSha256, file: ok200(body) });

  it('app.listed + cert.listed, ok', () => {
    const r = run('com.acme.app', [FP.toLowerCase().replace(/:/g, '')]);
    expect(r.findings).toEqual([
      { id: 'key.ok', severity: 'ok', title: 'Publishable key is set', fix: '' },
      { id: 'app.listed', severity: 'ok', title: 'acme.strait.link lists com.acme.app', fix: '' },
      { id: 'cert.listed', severity: 'ok', title: "This build's signing certificate is listed", fix: '' },
    ]);
    expect(r.ok).toBe(true);
  });

  it('cert.missing when this build is signed with another app’s fingerprint', () => {
    const r = run('com.acme.app', [OTHER_FP]);
    expect(byId(r.findings, 'cert.missing')).toEqual({
      id: 'cert.missing',
      severity: 'error',
      title: "This build's signing certificate isn't listed for com.acme.app",
      fix: `Add ${OTHER_FP} in Dashboard → Apps & stores. Debug, release and Play App Signing keys each have their own fingerprint.`,
    });
    expect(r.ok).toBe(false);
  });

  it('no certificate check when the certificate is unknown', () => {
    expect(ids(run('com.acme.app').findings)).toEqual(['key.ok', 'app.listed']);
    expect(ids(run('com.acme.app', []).findings)).toEqual(['key.ok', 'app.listed']);
  });

  it('app.missing lists what is there, no certificate check', () => {
    const r = run('com.acme.nope', [FP]);
    expect(r.findings.slice(1)).toEqual([
      {
        id: 'app.missing',
        severity: 'error',
        title: "acme.strait.link doesn't list com.acme.nope",
        fix: 'Add com.acme.nope in Dashboard → Apps & stores (listed now: com.acme.app, com.acme.other).',
      },
    ]);
  });

  it('app.unknown (warn) when the package is unknown; ok stays true', () => {
    const r = run(undefined, [FP]);
    expect(r.findings.slice(1)).toEqual([
      { id: 'app.unknown', severity: 'warn', title: 'acme.strait.link lists com.acme.app, com.acme.other', fix: 'Make sure your app is one of these.' },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('doctorFindings: iOS app', () => {
  const body = aasa(['TEAM123456.com.acme.app', 'TEAM123456.com.acme.clip']);
  const run = (appId?: string, certSha256?: string[]) =>
    doctorFindings({ publishableKey: PK, endpoint: EP, platform: 'ios', appId, certSha256, file: ok200(body) });

  it('app.listed matches the bundle ID suffix and shows the full appID; no certificate check on iOS', () => {
    const r = run('com.acme.app', [FP]);
    expect(r.findings.slice(1)).toEqual([{ id: 'app.listed', severity: 'ok', title: 'acme.strait.link lists TEAM123456.com.acme.app', fix: '' }]);
    expect(r.ok).toBe(true);
  });

  it('a bundle ID that is only a partial suffix is not listed', () => {
    expect(byId(run('acme.app').findings, 'app.missing')).toBeUndefined(); // ".acme.app" is a real dot suffix
    expect(byId(run('me.app').findings, 'app.missing')?.title).toBe("acme.strait.link doesn't list me.app");
  });

  it('app.missing', () => {
    expect(byId(run('in.other.app').findings, 'app.missing')).toEqual({
      id: 'app.missing',
      severity: 'error',
      title: "acme.strait.link doesn't list in.other.app",
      fix: 'Add in.other.app in Dashboard → Apps & stores (listed now: TEAM123456.com.acme.app, TEAM123456.com.acme.clip).',
    });
  });

  it('app.unknown', () => {
    expect(run().findings.slice(1)).toEqual([
      { id: 'app.unknown', severity: 'warn', title: 'acme.strait.link lists TEAM123456.com.acme.app, TEAM123456.com.acme.clip', fix: 'Make sure your app is one of these.' },
    ]);
  });

  it('reads the older `paths` style (appID string) too', () => {
    const old = JSON.stringify({ applinks: { apps: [], details: [{ appID: 'TEAM123456.com.acme.app', paths: ['*'] }] } });
    const r = doctorFindings({ publishableKey: PK, endpoint: EP, platform: 'ios', appId: 'com.acme.app', file: ok200(old) });
    expect(ids(r.findings)).toEqual(['key.ok', 'app.listed']);
  });
});

describe('strait.doctor()', () => {
  const runtime = (platform: 'android' | 'ios'): StraitRuntime => ({
    platform: () => platform,
    collectDevice: () => ({ screenWidth: 1, pixelRatio: 1, language: 'en', timezone: 'UTC' }),
    getInstallReferrer: async () => null,
    getInitialURL: async () => null,
    onURL: () => () => undefined,
    onAppState: () => () => undefined,
    now: () => 0,
  });
  const make = (platform: 'android' | 'ios', fetch: typeof globalThis.fetch, endpoint = EP) =>
    createStrait({ publishableKey: PK, endpoint, runtime: runtime(platform), fetch });
  const respond = (status: number, body: string) =>
    vi.fn(async () => ({ ok: status === 200, status, text: async () => body }) as Response) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  it('Android: one GET of assetlinks.json, returns the report', async () => {
    const fetch = respond(200, assetlinks([['com.acme.app', [FP]]]));
    const r = await make('android', fetch).doctor({ androidPackage: 'com.acme.app', certSha256: [FP] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe('https://acme.strait.link/.well-known/assetlinks.json');
    expect(r).toEqual({ ok: true, findings: expect.any(Array) });
    expect(ids(r.findings)).toEqual(['key.ok', 'app.listed', 'cert.listed']);
  });

  it('iOS: GET apple-app-site-association, iosBundleId is the app', async () => {
    const fetch = respond(200, aasa(['TEAM123456.com.acme.app']));
    const r = await make('ios', fetch).doctor({ androidPackage: 'com.wrong', iosBundleId: 'com.acme.app' });
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe('https://acme.strait.link/.well-known/apple-app-site-association');
    expect(ids(r.findings)).toEqual(['key.ok', 'app.listed']);
  });

  it('no options: app.unknown', async () => {
    const r = await make('ios', respond(200, aasa(['TEAM123456.com.acme.app']))).doctor();
    expect(ids(r.findings)).toEqual(['key.ok', 'app.unknown']);
  });

  it('never throws: a failing fetch is host.unreachable', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof globalThis.fetch;
    const r = await make('android', fetch).doctor({ androidPackage: 'com.acme.app' });
    expect(ids(r.findings)).toEqual(['key.ok', 'host.unreachable']);
    expect(r.ok).toBe(false);
  });

  it('an invalid endpoint makes no request', async () => {
    const fetch = respond(200, '[]');
    const r = await make('android', fetch, 'http://acme.strait.link').doctor();
    expect(fetch).not.toHaveBeenCalled();
    expect(ids(r.findings)).toEqual(['key.ok', 'endpoint.invalid']);
  });

  it('logs each finding with the [Strait doctor] prefix in __DEV__ only', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const g = globalThis as { __DEV__?: boolean };
    try {
      g.__DEV__ = false;
      await make('android', respond(404, '')).doctor();
      expect(log).not.toHaveBeenCalled();
      g.__DEV__ = true;
      await make('android', respond(404, '')).doctor();
      expect(log).toHaveBeenCalledTimes(2);
      expect(log.mock.calls.map((c) => c[0])).toEqual([
        '[Strait doctor] ok key.ok: Publishable key is set',
        "[Strait doctor] error host.file_missing: acme.strait.link doesn't serve assetlinks.json. Fix: Use your Strait link domain as endpoint (Dashboard → Get started); Strait serves this file there.",
      ]);
    } finally {
      delete g.__DEV__;
      log.mockRestore();
    }
  });
});
