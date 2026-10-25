// After `npx expo prebuild --no-install`: checks the native files the Strait config plugin should have
// written (app.json → plugins). Exits 1 with the missing piece named.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const host = 'strait-dev.strait.link';
const scheme = 'straitexample';
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

if (existsSync('android')) {
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  const filters = manifest.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? [];
  const appLinks = filters.find((f) => f.includes(`android:host="${host}"`));
  check(!!appLinks, `Android: an intent filter for https://${host}`);
  check(!!appLinks?.includes('android:autoVerify="true"'), 'Android: it has android:autoVerify="true"');
  check(!!appLinks?.includes('android:scheme="https"'), 'Android: it is https only');
  check(!!appLinks && ['BROWSABLE', 'DEFAULT'].every((c) => appLinks.includes(`android.intent.category.${c}`)), 'Android: BROWSABLE + DEFAULT');
  check(filters.some((f) => f.includes(`android:scheme="${scheme}"`)), `Android: the ${scheme}:// scheme`);
}

if (existsSync('ios')) {
  const dir = readdirSync('ios').find((d) => existsSync(`ios/${d}/Info.plist`));
  const ent = dir && readdirSync(`ios/${dir}`).find((f) => f.endsWith('.entitlements'));
  const entitlements = ent ? readFileSync(`ios/${dir}/${ent}`, 'utf8') : '';
  check(/com\.apple\.developer\.associated-domains<\/key>\s*<array>[\s\S]*?<string>applinks:strait-dev\.strait\.link<\/string>/.test(entitlements), `iOS: Associated Domains applinks:${host}`);
  const plist = dir ? readFileSync(`ios/${dir}/Info.plist`, 'utf8') : '';
  check(/CFBundleURLSchemes<\/key>\s*<array>[\s\S]*?<string>straitexample<\/string>/.test(plist), `iOS: the ${scheme}:// URL scheme`);
}

if (!existsSync('android') && !existsSync('ios')) check(false, 'no android/ or ios/ folder: run npx expo prebuild first');
process.exit(failed ? 1 : 0);
