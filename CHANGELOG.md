# Changelog

## Unreleased

- Fix (react-native-web / Expo web): web opens are counted only for landings from a Strait tap. Until
  now every page load with a URL was reported as a direct link open (`/v1/open`, `matched: true`), so
  web "opens" were page views. Now a page URL that carries a valid `strait_click` (the tap id the
  engine adds when it sends a tap to the web; needs an engine with web tap ids) sends one `/v1/open`
  with `platform: 'web'`, the tap's `clickId` and `openId` `web-<tap id>`, so a reload or a shared
  landing URL is de-duplicated by the engine; the tap attributes later events. Any other page URL
  still reaches the link callback (`matched: true`, for routing) but sends no `/v1/open` and no
  `/v1/resolve`. Apps (`isWeb()` false or left out) are unchanged. Same rule in `@straitlink/web`
  and `strait_sdk` (Flutter web).

## 0.10.1

- Fix (react-native-web / Expo web): a website has no install, so `start()` no longer counts a first
  launch there. 0.10.0 and earlier reported the first page load of every new browser as the install's
  first open (`/v1/open` with `firstLaunch: true`, which the engine records as an install), and ran the
  deferred check (`/v1/match`) when the page URL was empty. Links in the page URL still open, are
  reported and attribute events. Same rule as `strait_sdk` 0.9.6 (Flutter web). New optional
  `StraitRuntime.isWeb()`; the built-in runtime sets it from `Platform.OS === 'web'`.
- `examples/expo` builds for the web too (`react-native-web` 0.21.2, `react-dom` 19.2.3), in CI.

## 0.10.0

- New: an Expo config plugin. `"plugins": [["@straitlink/react-native", { "domains": ["acme.strait.link"], "scheme": "acme" }]]`
  and `npx expo prebuild` writes the iOS Associated Domains entitlement, an Android App Links intent
  filter with `android:autoVerify="true"` (https, BROWSABLE + DEFAULT) and the URL scheme on both
  platforms. It fills Expo's own `ios.associatedDomains`, `android.intentFilters` and `scheme`, keeps
  what app.json already has, adds nothing twice and refuses bad values (paths, `http`, wildcards,
  `http`/`https` as a scheme) with a clear message. No new dependency (ADR 0001).
- New Architecture: checked on React Native 0.86 (bridgeless, Fabric) on Android and iOS with the
  example app, including `react-native-play-install-referrer` 2.0.1. Nothing needed changing; CI now
  builds the example natively on both platforms (`native.yml`).
- No change to the JS API.

## 0.9.3

- New: `strait.doctor({ androidPackage?, iosBundleId?, certSha256? })`, a setup check for debug builds
  (contract B23, shared-spec ADR 0002). One GET of your link domain's `/.well-known/assetlinks.json`
  (Android) or `/.well-known/apple-app-site-association` (iOS), then checks the key (secret key in the
  app?), the endpoint, whether the file lists your app and (Android, when you pass it) this build's
  signing certificate. Never throws; logs each finding with `[Strait doctor]` in `__DEV__` only; returns
  `{ ok, findings }`. The same finding ids and wording as every Strait SDK. Also exported: the pure
  `doctorFindings(...)` and the `DoctorFinding` / `DoctorReport` types. React Native can't read the
  package or bundle ID without a native module, so they are options (left out: `app.unknown`).
  No other behaviour change.

## 0.9.2

- `/v1/resolve`, `/v1/open` (queued retries too) and `/v1/store-sheet` now send `deviceClass`
  (`"phone"` | `"tablet"`, contract B14, engine ADR 0039): iOS by `Platform.isPad`, Android by the
  screen's shorter side (>= 600 dp = tablet). Left out when unknown; older engines ignore it.
  New: `deviceClassForSize(shortestSide)`, optional `StraitRuntime.deviceClass()`.
  Conformance vectors v9.
- Docs: iPhone links are live, iPhone install matching is opt-in (off until you choose it) and the
  store sheet is new, in the README and the `openStoreSheet` doc comment (no "beta" for iPhone).
  No behaviour change.

## 0.9.1

- Fix: a link that opens the app while the first-launch deferred check is still running is no
  longer followed by that check's *match* either (0.9.0 held back only its "no link" event). The
  app stayed on the screen the person just tapped instead of jumping to a stale pre-install
  destination. The engine still counts the install and records and attributes the match as before,
  the check is still marked done, and the match is not replayed to late `onLink` subscribers.
  `checkDeferred()` still returns (and delivers) its answer (contract B6).
- iPhone paste handoff: once a link has opened the app in this launch, the first-launch check no
  longer reads the clipboard, so iOS shows no "Allow Paste" prompt for an answer that won't be
  delivered. Checked again right after the prompt-free URL detect; a clipboard already read is
  claimed as before (contract B6/B19).
- Known gap (no API change): if the check had already sent its `onLinkStart` when the link arrived,
  no `onLink` event with that start's `id` follows. The documented pattern (loading on at any
  `onLinkStart`, off at any `onLink`) stays correct because the link's own start and event come
  after it; an app that tracks loading per `id` should also clear pending deferred ids when a
  `direct` event arrives.

## 0.9.0

- Smaller public API (SDK-23, decision record: shared-spec `docs/adr/0001-sdk-public-api-surface.md`).
  No longer exported, because they were never in the docs: the contract helpers from `src/core.ts`
  (`AppStateTracker`, `classifyUrl`, `normalizeLinkHosts`, `browserScreenWidth`, `portraitScreenWidth`,
  `parseStraitClick`, `parseHandoffUrl`, `takeClickId`, `newOpenId`, `pruneOpenQueue`,
  `shouldRetryReport`, `eventClickId`, `rememberTap`, `replyClickId`, `replyReferralCode`, the queue
  and window constants, `ClassifiedUrl`), `parseStraitLink`, `pasteHandoffOn` and
  `createReactNativeRuntime`. `splitUrl` stays (the docs use it). Nothing to change if you use
  `createStrait`, `resolveDeferredLink`, `fromPlayInstallReferrer`, `fromExpoClipboard` or `openStoreSheet`.
- One phone runtime instead of three (P2-4): `createStrait` and the legacy `resolveDeferredLink` both
  use `nativeRuntime`. `resolveDeferredLink` used its own adapter, which took the language from iOS
  `SettingsManager.AppleLocale` (`en_IN`); it now sends BCP-47 from `Intl` (`en-IN`), like every
  other Strait SDK, so its device match uses the same language as the engine expects. Its Android
  referrer still comes from your `StraitInstallReferrer` native module. Under Metro (`index.native`)
  both get the runtime through a static import, with no dynamic `import()`.
- Fix: a link that opens the app while the first-launch deferred check is still running is no
  longer followed by that check's "no link" event (`matched:false`, `no_match` or `network`).
  Seen on Android (13 Oct quick-start run): the app started without a link and went to the
  background, where React Native pauses timers, so `/v1/match` waited; the tapped link was
  delivered (`true /product/42`) and the check's `false` came 4 ms later, so an app that routes
  home on `!matched` left the right screen. The check still runs and counts the install, and is
  marked done (or retried next launch) as before; only its no-link event is not delivered, and
  it sends no `onLinkStart` once a link is here (a loading state would never end).
  A deferred match is still delivered; `checkDeferred()` is unchanged (contract B6).
- Fix: `fromPlayInstallReferrer(PlayInstallReferrer)` typechecks against
  react-native-play-install-referrer 2.x, which types `installReferrer` as `string | null`
  (1.x keeps working). The quick-start `links.ts` showed a TypeScript error; the build still ran.

## 0.8.3

- `checkDeferred()` (the debug / settings re-check) now sends `"record": false` on `/v1/match` and `/v1/referrer`, so the
  engine answers the match without adding an install, an open or an `install.matched` webhook
  (contract B6: it never adds an install). The once-per-install check is unchanged. Takes effect
  once the engine with `record` support is live; an older engine ignores the field.
- Every request to the engine now gives up after 10 s (like the Android SDK's timeouts) and takes
  the existing `network` path: the deferred check is retried next launch and open reports stay
  queued. Before, a reply that never came hung `start()` and the open-report queue.
- README: install from npm (`@straitlink/react-native` is published); "Use" leads with
  `createStrait`, and the older `resolveDeferredLink` is a legacy note.

## 0.8.2

- README: the common Strait SDK header (logo, the promise "Straight to the screen. On the record.",
  badges, links to docs, platform status and the changelog), a platform features table in the
  availability words (Live / Beta / Planned / Not yet) with the iPhone beta truth (the method is
  the customer's choice, device matching off by default), and a "Docs and support" section
  (Talk to the Strait team). The same structure in all seven SDK READMEs (design system v5).
- iPhone deferred-link method is the workspace's choice, read at runtime (founder decision
  10 Oct 2026, B19). The first-launch check reads the clipboard only when the `/v1/match`
  reply arrived, found no match and carries `ios.pasteHandoff: true` (Dashboard → Settings
  → iPhone installs). An older engine without the field = off; no answer / 429 / 5xx = the
  clipboard is untouched (`reason: 'network'`, retried next launch). The choice is never
  stored, so a dashboard change applies without an app release. `clipboardBoost` is
  deprecated and ignored. New export `pasteHandoffOn(reply)`. Tests cover all four
  combinations (off/off, device only, paste only, both).
- Clipboard boost order (B19): the first-launch iPhone check now runs device matching
  (`/v1/match`) first and reads the clipboard / claims the handoff only when it returns no
  match or fails. A device match no longer shows iOS's "Allow Paste" prompt. Same `openId`
  across both attempts; one event. `claimHandoff` is unchanged.
- Store sheet (beta): `strait.openStoreSheet(url, options)` calls `POST /v1/store-sheet`, then on
  Android tries Google Play inline install, `market://` and the Play web page (referrer carries
  `strait_link` + `strait_click`); on iPhone saves the device match (`/v1/match-save`), optionally
  copies the handoff link, and shows the App Store. Uses an optional `StraitStoreSheet` native
  module, else `Linking.openURL`. `ClipboardAccess.writeText` (optional) and `fromExpoClipboard`
  maps `setStringAsync`. New exports in `src/store-sheet.ts`.
- Docs and tests only, no code change. Demo names: the placeholder company is now "Hilltop Shoes" on reserved
  hosts (`hilltop.links.test`, `go.hilltop.example`, `hilltop.strait.link`); conformance vectors synced from
  shared-spec (same cases, renamed hosts). README: GitHub install first, a Support section. AGENTS.md: a
  "Stop and ask the human" list and a phone-free verify loop (`/v1/tools/app-links`, `/v1/simulate`).
- Old Firebase Dynamic Links (shared-spec/SDK-CONTRACT.md B22, conformance vectors v8). Add your
  `<x>.page.link` host to `linkHosts` (and keep `applinks:<x>.page.link` / the page.link intent filter in
  your app build): a page.link **short** link is looked up through `/v1/resolve` like any short link (the
  engine matches the old host + code of links you imported), and a page.link **long** link
  (`https://<x>.page.link/?link=<url>&…`) opens its `link=` destination straight away, on the device, with no
  lookup. Only `*.page.link` hosts at the root path, only an http(s) `link`. Not yet tested on a real iPhone.

## 0.8.1

- **Package renamed** to `@straitlink/react-native` (npm scope `@straitlink`; it was `@strait/sdk-react-native`, never
  published to npm). Update imports: `from '@straitlink/react-native'`. The GitHub repo name is unchanged.
  The code is otherwise identical to 0.8.0. Tag v0.8.0 (cut before the rename) still carries the old
  name `@strait/sdk-react-native` in its package.json, so install v0.8.1 or later for the new import path.

## 0.8.0

- Referral codes (preview; shared-spec/proposals/referral-code.md, B21): a matched
  deferred `LinkEvent` (Play referrer, iPhone match, clipboard claim, `claimHandoff`)
  carries `referralCode` when the engine's reply has a valid one. `resolveDeferredLink`'s
  `MatchResult` type documents the same field. New core export `replyReferralCode`.
- Optional iPhone clipboard boost (shared-spec/SDK-CONTRACT.md B19). New config
  `clipboardBoost` (default **false**) and `clipboard` (an adapter; `fromExpoClipboard`
  wraps expo-clipboard). With it on, the first iPhone launch checks without a prompt
  whether the clipboard probably holds a URL, reads it only then (iOS shows its paste
  prompt), and claims a Strait handoff token via `POST /v1/handoff/claim` for an exact
  match (`LinkEvent.route: 'clipboard'`); otherwise it falls back to normal matching
  with the same open id. The clipboard is never touched when the option is off, on
  Android, after the first launch, or by the debug `checkDeferred()`.
- New `strait.claimHandoff(text)` for apps that use Apple's Paste button.
- New core export: `parseHandoffUrl(text, linkHosts)` (conformance vectors v7).

## 0.7.3

- Privacy hardening (shared-spec/SDK-CONTRACT.md B18): the URL sent with open reports
  (`/v1/open`, `/v1/resolve`) and saved in the offline queue (`strait.pendingOpens`)
  no longer carries the query string or fragment. Only the first `utm_source` pair is
  kept, because the engine uses it for channel attribution; the engine already stored
  host + path only, so analytics are unchanged. Reports queued by an older version are
  stripped the next time the queue is read. Your app's `LinkEvent` (`rawUrl`, `url`,
  `params`) is unchanged.
- An expired remembered tap id (`strait.lastTap`, older than 7 days) is now deleted at
  `start()` and by `trackEvent`, instead of only being ignored.
- New core exports: `reportUrl`, `staleTap` (conformance vectors v6).

## 0.7.2

- Installable straight from GitHub: `npm install github:bazingga08/strait-sdk-react-native#v0.7.2`.
  The build now runs as a `prepare` script (was `prepack`), so npm compiles `dist/`
  when it installs from a git URL. No code changes.

## 0.7.1

- Report the portrait screen width so a first launch in landscape still matches the tap
  (shared-spec/SDK-CONTRACT.md B17): `screenWidth` is now the shorter side of
  `Dimensions.get('screen')`, like Safari's `screen.width` at the tap.
- New core export: `portraitScreenWidth(width, height)` (conformance vectors v5).

## 0.7.0

- Every attributed open now supplies the tap id (shared-spec/SDK-CONTRACT.md B16):
  when `/v1/resolve` (verified short link), `/v1/match` (fingerprint) or
  `/v1/referrer` (Play install) returns `clickId`, it is remembered as
  `strait.lastTap` and sent with conversion events. A reply without one (older
  engine) keeps the 0.6.0 behaviour (short link / fingerprint forget the tap; the
  referrer keeps its parsed tap id).
- New core export: `replyClickId` (conformance vectors v4).

## 0.6.0

- Conversion events carry the tap id (shared-spec/SDK-CONTRACT.md B15): the tap id
  of the last attributed link open (browser hand-off `strait_click`, or the Play
  referrer on a deferred install) is remembered under `strait.lastTap` and sent as
  `clickId` with `trackEvent` for 7 days. A newer short-link or fingerprint open
  forgets it. `trackEvent(name, { clickId })` overrides it.
- New core exports: `eventClickId`, `rememberTap`, `ATTRIBUTION_WINDOW_MS`
  (conformance vectors v3).

## 0.5.0

Renamed to Strait (breaking; clean break, no aliases).

- Package is now `@strait/sdk-react-native`; repo `bazingga08/strait-sdk-react-native`,
  homepage https://usestrait.com.
- API: `createBridge` → `createStrait`, `Bridge` → `Strait`, `BridgeRuntime` →
  `StraitRuntime`, `CreateBridgeConfig` → `CreateStraitConfig`, `BridgeConfig` →
  `StraitConfig`, `parseBridgeLink` → `parseStraitLink`, `parseBridgeClick` →
  `parseStraitClick`.
- Wire params: only `strait_click` (tap id) and `strait_link` (Play referrer) are read.
- Storage keys: `strait.deferredChecked`, `strait.pendingOpens` (old values are ignored,
  so the deferred check runs once more after upgrading).
- Android native module is now `StraitInstallReferrer`.

## 0.4.0

- Every link open is reported exactly once (shared-spec/SDK-CONTRACT.md B14):
  `LinkEvent.id` is the open id; failed reports are kept under
  `bridge.pendingOpens` and retried (≤7 days, ≤100). New
  `pendingOpenReports()` and `flushOpenReports()`.
- A `bridge_click` tap id is removed from the destination and returned as
  `clickId`.
- The deferred check is marked done only once the engine answered; unreadable
  storage counts as "already checked" and flag write failures never throw.

### Packaging

- Publish-ready: complete package metadata (repository, homepage, bugs, keywords),
  `exports` map with types, `sideEffects: false`, MIT `LICENSE`. Only `dist/`,
  README, LICENSE and this changelog ship (no tests, fixtures or source maps).
- The package name, npm scope and URLs come from `brand.json` (applied by
  `scripts/brand.mjs`), so the brand switch is one command.
- Tag `vX.Y.Z` → GitHub Actions runs the tests and publishes to npm with
  provenance (see PUBLISHING.md). Nothing publishes until `NPM_TOKEN` is set and
  the brand is marked final.

## 0.3.0

- Pure core shared with every SDK (the SDK contract), `onLinkStart` loading
  signal, `normalizeLinkHosts`; app-link listeners isolated per client.

## 0.2.0

- `createBridge` + `onLink`: one event for every way a link opens the app.
- Breaking: `appId` → `publishableKey`.

## 0.1.0

- Deferred match: Android Play Install Referrer + iOS fingerprint.
