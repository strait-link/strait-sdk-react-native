// Generates doctor-vectors.json (contract B23, shared-spec ADR 0002) from the React Native SDK's
// doctorFindings, the reference that shipped in RN 0.9.3. Every ADR row has at least one case.
//   node scripts/doctor-vectors.mjs > test/doctor-vectors.json, then copy it byte for byte into
// strait-sdk-android (src/test/resources), strait-sdk-flutter (test), strait-sdk-swift
// (Tests/StraitSDKTests) and strait-sdk-unity (test).
// Inputs: platform, publishableKey, endpoint, appId (null = unknown), certSha256, file
// (null = not fetched, used only with an invalid endpoint; status null = the GET failed). Output: ok + findings.
import { doctorFindings } from '../src/doctor.ts';

const E = 'https://acme.strait.link';
const PKG = 'com.acme.app';
const FP = 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';
const FP2 = 'B1:8F:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:17:AE';
const al = (...t) => JSON.stringify(t.map(([pkg, fps, ns = 'android_app']) => ({ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: ns, package_name: pkg, sha256_cert_fingerprints: fps } })));
const aasa = (...details) => JSON.stringify({ applinks: { details } });
const ok200 = (body) => ({ status: 200, body });
const A = { platform: 'android', publishableKey: 'st_pub_live_x', endpoint: E, appId: PKG, certSha256: [] };
const I = { platform: 'ios', publishableKey: 'st_pub_live_x', endpoint: E, appId: 'com.acme.app', certSha256: [] };
const ALIST = ok200(al([PKG, [FP]]));
const ILIST = ok200(aasa({ appIDs: ['TEAM123.com.acme.app'], components: [{ '/': '/*' }] }));

const cases = [
  ['key.ok', { ...A, file: ALIST }],
  ['key.secret st_live_', { ...A, publishableKey: 'st_live_abc', file: ALIST }],
  ['key.secret st_test_', { ...A, publishableKey: 'st_test_abc', file: ALIST }],
  ['key.invalid empty', { ...A, publishableKey: '', file: ALIST }],
  ['key.invalid other', { ...A, publishableKey: 'pk_live_abc', file: ALIST }],
  ['endpoint.invalid http', { ...A, endpoint: 'http://acme.strait.link', file: ALIST }],
  ['endpoint.invalid empty', { ...A, endpoint: '', file: null }],
  ['endpoint.invalid no host', { ...A, endpoint: 'https://', file: null }],
  ['endpoint.invalid not a url', { ...A, endpoint: 'acme.strait.link', file: null }],
  ['key.invalid and endpoint.invalid', { ...A, publishableKey: 'x', endpoint: 'ftp://acme.strait.link', file: null }],
  ['endpoint with a path still uses the host', { ...A, endpoint: 'https://acme.strait.link/', file: ALIST }],
  ['host.unreachable', { ...A, file: { status: null, body: null } }],
  ['host.file_missing android 404', { ...A, file: { status: 404, body: 'Not found' } }],
  ['host.file_missing ios 404', { ...I, file: { status: 404, body: 'Not found' } }],
  ['host.file_missing android 200 not JSON', { ...A, file: ok200('<html></html>') }],
  ['host.file_missing android 200 an object, not an array', { ...A, file: ok200('{"applinks":{"details":[]}}') }],
  ['host.file_missing ios 200 an array', { ...I, file: ok200('[]') }],
  ['host.file_missing ios 200 no applinks.details', { ...I, file: ok200('{"webcredentials":{"apps":[]}}') }],
  ['host.file_missing android 500 with a valid body', { ...A, file: { status: 500, body: al([PKG, [FP]]) } }],
  ['app.none android empty array', { ...A, file: ok200('[]') }],
  ['app.none android only web targets', { ...A, file: ok200(JSON.stringify([{ target: { namespace: 'web', site: E } }])) }],
  ['app.none ios no details', { ...I, file: ok200(aasa()) }],
  ['app.unknown android null', { ...A, appId: null, file: ok200(al([PKG, [FP]], ['com.acme.other', []])) }],
  ['app.unknown android empty', { ...A, appId: '', file: ALIST }],
  ['app.unknown android blank', { ...A, appId: '   ', file: ALIST }],
  ['app.unknown ios null', { ...I, appId: null, file: ILIST }],
  ['app.missing android', { ...A, appId: 'com.example.notlisted', file: ok200(al([PKG, [FP]], ['com.acme.other', []])) }],
  ['app.missing ios', { ...I, appId: 'com.example.notlisted', file: ILIST }],
  ['app.missing ios needs the dot before the bundle ID', { ...I, appId: 'acme.app', file: ok200(aasa({ appIDs: ['TEAM123.comacme.app'] })) }],
  ['app.listed android, no certificate given', { ...A, file: ALIST }],
  ['app.listed android, appId trimmed', { ...A, appId: ' com.acme.app ', file: ALIST }],
  ['app.listed ios appIDs', { ...I, file: ILIST }],
  ['app.listed ios legacy appID', { ...I, file: ok200(aasa({ appID: 'TEAM123.com.acme.app', paths: ['*'] })) }],
  ['app.missing ios lists appIDs before appID, once each', { ...I, appId: 'com.example.notlisted', file: ok200(aasa({ appID: 'T1.com.a', appIDs: ['T2.com.b', 'T1.com.a'] }, { appIDs: ['T2.com.b'] })) }],
  ['ios ignores certificates', { ...I, certSha256: [FP], file: ILIST }],
  ['cert.listed', { ...A, certSha256: [FP], file: ALIST }],
  ['cert.listed lower case, no colons', { ...A, certSha256: [FP.replace(/:/g, '').toLowerCase()], file: ALIST }],
  ['cert.listed one of two certificates', { ...A, certSha256: [FP2, FP], file: ALIST }],
  ['cert.listed fingerprints merged across statements', { ...A, certSha256: [FP2], file: ok200(al([PKG, [FP]], [PKG, [FP2.toLowerCase()]])) }],
  ['cert.missing', { ...A, certSha256: [FP2], file: ALIST }],
  ['cert.missing names every certificate', { ...A, certSha256: [FP2, FP2.replace(/^B1/, 'C2')], file: ALIST }],
  ['cert.missing package listed without fingerprints', { ...A, certSha256: [FP], file: ok200(al([PKG, []])) }],
  ['blank certificate is ignored', { ...A, certSha256: [''], file: ALIST }],
];

const vectors = cases.map(([name, input]) => {
  const { file, ...rest } = input;
  const report = doctorFindings({ ...rest, appId: rest.appId ?? undefined, file: file === null ? undefined : { status: file.status ?? undefined, body: file.body ?? undefined } });
  return { name, input, ok: report.ok, findings: report.findings };
});
// Every ADR 0002 id must be exercised.
const ids = ['key.ok', 'key.secret', 'key.invalid', 'endpoint.invalid', 'host.unreachable', 'host.file_missing', 'app.none', 'app.missing', 'app.listed', 'app.unknown', 'cert.missing', 'cert.listed'];
const seen = new Set(vectors.flatMap((v) => v.findings.map((f) => f.id)));
const missing = ids.filter((i) => !seen.has(i));
if (missing.length) throw new Error('no vector for ' + missing.join(', '));
process.stdout.write(JSON.stringify({ contract: 'B23', adr: 'shared-spec docs/adr/0002-sdk-doctor.md', reference: 'strait-sdk-react-native 0.9.3 src/doctor.ts', vectors }, null, 2) + '\n');
