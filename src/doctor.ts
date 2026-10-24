/**
 * `doctor()` setup check (contract B23, shared-spec ADR 0002): the same finding ids and wording in
 * every Strait SDK. `doctorFindings` is pure; `strait.doctor()` (strait.ts) does the one GET.
 */

/** One setup check. `fix` is empty for `ok`. */
export interface DoctorFinding {
  id: string;
  severity: 'ok' | 'warn' | 'error';
  title: string;
  fix: string;
}

/** `ok` = no `error` finding. */
export interface DoctorReport {
  ok: boolean;
  findings: DoctorFinding[];
}

export interface DoctorInput {
  publishableKey: string;
  endpoint: string;
  platform: 'android' | 'ios';
  /** Android package / iOS bundle ID; undefined = the SDK can't read it (`app.unknown`). */
  appId?: string;
  /** Android: this build's signing certificate SHA-256 fingerprint(s), any format. */
  certSha256?: string[];
  /** The fetched file. No `status` = the GET failed (network). Undefined = not fetched. */
  file?: { status?: number; body?: string };
}

/** The endpoint's host when it is an `https://` URL with a host, else null. */
export function doctorHost(endpoint: string): string | null {
  const m = /^https:\/\/([^/?#\s@]+)(?:[/?#]|$)/i.exec(endpoint.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/** Upper-case, colon-separated, as assetlinks.json writes it. */
const normFp = (s: string) => (s.replace(/[^0-9a-f]/gi, '').toUpperCase().match(/../g) ?? []).join(':');

const ok = (id: string, title: string): DoctorFinding => ({ id, severity: 'ok', title, fix: '' });
const err = (id: string, title: string, fix: string): DoctorFinding => ({ id, severity: 'error', title, fix });

/** Android: package → fingerprints; iOS: full appIDs (value unused). Null = not the JSON expected. */
function listedApps(platform: 'android' | 'ios', body: string): Map<string, string[]> | null {
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const apps = new Map<string, string[]>();
  if (platform === 'android') {
    if (!Array.isArray(json)) return null;
    for (const s of json) {
      const t = s?.target;
      if (t?.namespace !== 'android_app' || typeof t.package_name !== 'string') continue;
      const fps = Array.isArray(t.sha256_cert_fingerprints) ? t.sha256_cert_fingerprints.filter((f: unknown) => typeof f === 'string') : [];
      apps.set(t.package_name, [...(apps.get(t.package_name) ?? []), ...fps.map(normFp)]);
    }
    return apps;
  }
  const details = json?.applinks?.details;
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    for (const id of [...(Array.isArray(d?.appIDs) ? d.appIDs : []), d?.appID]) if (typeof id === 'string') apps.set(id, []);
  }
  return apps;
}

export function doctorFindings(input: DoctorInput): DoctorReport {
  const findings: DoctorFinding[] = [];
  const key = input.publishableKey ?? '';
  if (key.startsWith('st_pub_')) findings.push(ok('key.ok', 'Publishable key is set'));
  else if (key.startsWith('st_live_') || key.startsWith('st_test_'))
    findings.push(err('key.secret', 'This is a secret key, not the publishable key', 'Use the publishable key (st_pub_…) from Dashboard → Get started, and revoke this secret key in Dashboard → Settings → Secret keys: it has been inside your app.'));
  else findings.push(err('key.invalid', 'Not a publishable key', 'Copy the publishable key (st_pub_…) from Dashboard → Get started.'));

  const host = doctorHost(input.endpoint ?? '');
  if (!host) {
    findings.push(err('endpoint.invalid', "The endpoint isn't an https link domain", 'Set endpoint to your link domain from Dashboard → Get started, e.g. https://<handle>.strait.link.'));
  } else if (input.file) findings.push(...hostFindings(input, host, input.file));
  return { ok: !findings.some((f) => f.severity === 'error'), findings };
}

function hostFindings(input: DoctorInput, host: string, file: { status?: number; body?: string }): DoctorFinding[] {
  const android = input.platform === 'android';
  if (file.status === undefined)
    return [err('host.unreachable', `Can't reach ${host}`, 'Check that endpoint is your link domain (Dashboard → Get started) and that this device is online.')];
  const apps = file.status === 200 ? listedApps(input.platform, file.body ?? '') : null;
  if (!apps)
    return [err('host.file_missing', `${host} doesn't serve ${android ? 'assetlinks.json' : 'apple-app-site-association'}`, 'Use your Strait link domain as endpoint (Dashboard → Get started); Strait serves this file there.')];
  if (!apps.size) return [err('app.none', `No ${android ? 'Android' : 'iOS'} app is set up for ${host}`, 'Add your app in Dashboard → Apps & stores.')];

  const listed = [...apps.keys()].join(', ');
  const app = input.appId?.trim();
  if (!app) return [{ id: 'app.unknown', severity: 'warn', title: `${host} lists ${listed}`, fix: 'Make sure your app is one of these.' }];
  const match = android ? (apps.has(app) ? app : undefined) : [...apps.keys()].find((id) => id.endsWith(`.${app}`));
  if (!match) return [err('app.missing', `${host} doesn't list ${app}`, `Add ${app} in Dashboard → Apps & stores (listed now: ${listed}).`)];

  const out = [ok('app.listed', `${host} lists ${match}`)];
  const certs = android ? (input.certSha256 ?? []).map(normFp).filter(Boolean) : [];
  if (certs.length) {
    const fps = apps.get(match)!;
    out.push(
      certs.some((c) => fps.includes(c))
        ? ok('cert.listed', "This build's signing certificate is listed")
        : err('cert.missing', `This build's signing certificate isn't listed for ${app}`, `Add ${certs.join(', ')} in Dashboard → Apps & stores. Debug, release and Play App Signing keys each have their own fingerprint.`),
    );
  }
  return out;
}
