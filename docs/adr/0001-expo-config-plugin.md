# ADR 0001: Expo config plugin (`app.plugin.cjs`)

Date: 25 Oct 2026 · Status: accepted · Backlog: run-1024 H1 (plus H4, New Architecture)

## Problem
Expo apps need three native settings before a Strait link can open them: the iOS Associated Domains
entitlement (`applinks:<handle>.strait.link`), an Android App Links intent filter with
`android:autoVerify="true"` for `https://<handle>.strait.link`, and the custom URL scheme on both.
Today the README tells people to hand-write `ios.associatedDomains`, `android.intentFilters` and
`scheme` in app.json. The intent filter is easy to get wrong (missing `autoVerify`, `http`, missing
`DEFAULT`/`BROWSABLE`), and a wrong one fails silently: the link opens the browser.

## Who it serves
Expo (managed or CNG) teams adding Strait: one line in `plugins`, the link domain from
Dashboard → Get started, and `npx expo prebuild` writes the rest.

## Options
1. **Do nothing**: keep the hand-written app.json fields. Free, but it is the most common setup mistake.
2. **Our own mods** (`withEntitlementsPlist`, `withAndroidManifest`, `withInfoPlist`) editing the XML/plist.
   Needs `expo/config-plugins` at runtime and duplicates what Expo already writes.
3. **Fill Expo's own fields** (`ios.associatedDomains`, `android.intentFilters`, `scheme`) from plugin
   options and let Expo's built-in mods write the native files. **Chosen.**

## Prior art (don't reinvent the wheel)
`reverse-engineer-anything` teardown of the published `@config-plugins/react-native-branch@13.0.2`
(Expo's official Branch plugin; REA evidence `ev_d4b659d43af67ccf34e24121f3724eb204b6ac8bf1d29889853dd0ffdcdcc72e`,
static JavaScript analysis of the npm tarball): `app.plugin.js` → `withBranchAndroid` (`withAndroidManifest`,
keys as `<meta-data>`) + `withBranchIOS` (`withInfoPlist`, keys; bridging-header import). It writes **no**
domains: Branch's docs send people to `ios.associatedDomains` / `android.intentFilters`. AppsFlyer's
plugin (`react-native-appsflyer@7.0.2-v2`, `expo/withAppsFlyer*.js`) is the same shape and also leaves
links to those fields. Both use pure functions per field so they can be unit-tested. Strait needs no
native keys (the publishable key is passed in JS), so only the domain/scheme half applies, and the
existing Expo fields already do the writing.

## Design
- `["@straitlink/react-native", { "domains": ["acme.strait.link"], "scheme": "acme" }]`; either may be left
  out, not both. A domain may be given as `https://acme.strait.link/` (normalised to the host).
- iOS: appends `applinks:<host>` per domain. Android: one filter
  `{ action: VIEW, autoVerify: true, data: [{ scheme: https, host }…], category: [BROWSABLE, DEFAULT] }`.
  Scheme: added to `scheme` (string, or a list if the app already has another).
- Idempotent (prebuild may run it on an already-modified config) and never removes what app.json has.
- Plain CommonJS with no imports: the package is `"type": "module"`, Expo loads `app.plugin.cjs`, and it
  adds no dependency.

## Security lens
- Tampering/spoofing: only `https` hosts, validated (no paths, wildcards, `http`, bare names); schemes
  `http`/`https` are refused, so the plugin can't make the app claim web URLs it doesn't verify.
- Data exposure: none; no keys in native files. DoS/abuse: build-time only.

## Architecture lens
- No runtime coupling; if Expo renames a field, prebuild output changes, which `examples/expo/scripts/check-prebuild.mjs`
  catches in CI. Works with Expo's own verification (Android `autoVerify` against the workspace's
  assetlinks.json; Apple's CDN fetches the AASA).
- New Architecture (H4): React Native 0.86 has only the New Architecture (bridgeless, Fabric). The SDK's
  optional native hooks go through `NativeModules`, which bridgeless serves through the interop layer.
  `.github/workflows/native.yml` builds the example on both platforms on every PR.

## Cost
No dependency, ~80 lines + tests. CI: two native builds per PR (public repo, free minutes).
