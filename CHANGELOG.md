# Changelog

## Unreleased

## 0.8.2

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
- API: `createStrait`, `Strait`, `StraitRuntime`, `CreateStraitConfig`, `StraitConfig`, `parseStraitLink`, `parseStraitClick`.
- Wire params: only `strait_click` (tap id) and `strait_link` (Play referrer) are read.
- Storage keys: `strait.deferredChecked`, `strait.pendingOpens` (old values are ignored,
  so the deferred check runs once more after upgrading).
- Android native module is now `StraitInstallReferrer`.

## 0.4.0

- Every link open is reported exactly once (shared-spec/SDK-CONTRACT.md B14):
  `LinkEvent.id` is the open id; failed reports are kept under
  `strait.pendingOpens` and retried (≤7 days, ≤100). New
  `pendingOpenReports()` and `flushOpenReports()`.
- A `strait_click` tap id is removed from the destination and returned as
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

- `createStrait` + `onLink`: one event for every way a link opens the app.
- Breaking: `appId` → `publishableKey`.

## 0.1.0

- Deferred match: Android Play Install Referrer + iOS fingerprint.
