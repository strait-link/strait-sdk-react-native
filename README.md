<!-- Header: the same in every Strait SDK README (design system v5). -->
<p align="center">
  <a href="https://straitlink.in">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/strait-lockup-dark.svg">
      <img src=".github/assets/strait-lockup.svg" alt="Strait" width="160" height="53">
    </picture>
  </a>
</p>

<h1 align="center">Strait SDK for React Native</h1>

<p align="center"><strong>Straight to the screen. On the record.</strong><br>
A tap opens the exact screen, and every link open and install is recorded in your Strait dashboard.</p>

<p align="center">
  <a href="https://github.com/strait-link/strait-sdk-react-native/tags"><img alt="Latest version" src="https://img.shields.io/github/v/tag/strait-link/strait-sdk-react-native?sort=semver&label=version&style=flat-square&labelColor=0F0D0A&color=423B33"></a>
  <a href="https://straitlink.in/platform-status/"><img alt="SDK: Beta" src="https://img.shields.io/badge/SDK-beta-423B33?style=flat-square&labelColor=0F0D0A"></a>
  <a href="https://straitlink.in/iphone-status/"><img alt="iPhone: Live" src="https://img.shields.io/badge/iPhone-live-423B33?style=flat-square&labelColor=0F0D0A"></a>
  <a href="https://github.com/strait-link/strait-sdk-react-native/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/strait-link/strait-sdk-react-native/ci.yml?branch=main&label=CI&style=flat-square&labelColor=0F0D0A"></a>
  <a href="LICENSE"><img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-423B33?style=flat-square&labelColor=0F0D0A"></a>
</p>

<p align="center">
  <a href="https://straitlink.in/docs/sdks/react-native/">Docs</a> ·
  <a href="https://straitlink.in/platform-status/">Platform status</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="#docs-and-support">Talk to the Strait team</a>
</p>

`@straitlink/react-native`

Deferred deep linking for React Native: the user taps your link, installs the
app, and lands on the right screen. On iPhone your workspace chooses the
deferred-link method in the dashboard (device matching, paste handoff, both, or
neither; device matching is off by default for new workspaces); the SDK reads
that choice from Strait at runtime (contract B19).

Part of [Strait](https://straitlink.in). The match signature stays in lockstep with the server and
the other app SDKs via shared golden vectors (run in CI here).

## Quick start (60 seconds)

**1. Install.** ```sh
npm install @straitlink/react-native
```

**2. Check your key and a link.** In **Dashboard → Links**, make a link with the path `summer` and the destination `https://shop.example.com/product/42`. Then ask Strait about it the way this SDK will:

```sh
curl -s https://<your-handle>.strait.link/v1/resolve -H 'Content-Type: application/json' \
  -d '{"publishableKey":"st_pub_live_…","url":"https://<your-handle>.strait.link/summer","platform":"android"}'
```

**You should see:** `{"matched":true,"longUrl":"https://shop.example.com/product/42",…}`. The key comes from **Dashboard → Get started** and is safe in apps. `"reason":"not_found"` means the key is from another workspace or the path is wrong. The check counts as one tap in **Dashboard → Analytics**.

**3. Wire it.** Paste the `createStrait` block from [Use](#use) into your app's entry file, with your key and link address, and log every link: `strait.onLink((e) => console.log('Strait link:', e.matched, e.path, e.params));`. Rebuild, because the SDK adds native code.

**You should see:** on the first start, `Strait link: false undefined undefined`: the SDK checked once for a link and found none. To make a tap open the app, follow the [quickstart](https://straitlink.in/docs/quick-start/).

## Platform features

| Feature | Status | Notes |
|---|---|---|
| Android: direct links and deferred links | ● Live | Exact match through the Play Install Referrer native module. |
| iPhone links (Universal Links) | ● Live | The links themselves (Apple's Universal Links plus our association file) were proven on a real iPhone with the Swift reference app on 21 Oct 2026. This SDK's iOS glue is covered by unit tests and hasn't run on a real iPhone. |
| iPhone: install matching (deferred links) | Opt-in | Off until you choose it. Proven on iPhone simulators; the real-iPhone run waits on our App Store listing. Your choice in Dashboard → Settings → iPhone installs: device matching, paste handoff, both or neither, read from Strait at runtime. Device matching is off by default. iPhone matches are labelled Estimated until measured. |
| Store sheet: the store inside your app | New | Keeps the deep link through the install. On iPhone it needs your app's App Store ID. |
| Expo config plugin | New | Writes Associated Domains, the App Links filter (`autoVerify`) and the scheme from `app.json`. |
| New Architecture (bridgeless, Fabric) | ● Live | Built and run on Android and iOS in the example app. |
| Web (react-native-web, Expo web) | New | Links in the page URL open and are reported. A website has no install, so no deferred check runs and no visit counts as an install. The example app is built for the web in CI. |
| Published on npm | ● Live | `npm install @straitlink/react-native` |

● Live · ◐ Beta · ○ Planned · – Not yet · Opt-in: off until you switch it on · New: released, still young. The same words as the [platform status](https://straitlink.in/platform-status/) page.

## Install

<!-- brand:install -->
```sh
npm install @straitlink/react-native
```
<!-- /brand:install -->

Don't try other package names.

Android's exact deferred match also wants the Play Install Referrer
(optional but recommended): see "Android" below.

### Expo: the config plugin

Add the plugin with your link domain (Dashboard → Get started) and, if you use one, your custom scheme:

```json
{
  "expo": {
    "plugins": [["@straitlink/react-native", { "domains": ["<your-handle>.strait.link"], "scheme": "yourapp" }]]
  }
}
```

`npx expo prebuild` (or `npx expo run:android` / `run:ios`, or an EAS build) then writes the iOS Associated
Domains entitlement (`applinks:<your-handle>.strait.link`), an Android App Links intent filter with
`android:autoVerify="true"` and the URL scheme on both platforms. It fills Expo's own `ios.associatedDomains`,
`android.intentFilters` and `scheme` fields, keeps what you already have there and adds nothing twice.
Several domains (a custom domain too) go in the same list. Expo Go can't open your links: use a development build.

**You should see:** after `npx expo prebuild`, `android/app/src/main/AndroidManifest.xml` has
`<intent-filter android:autoVerify="true">` with `android:host="<your-handle>.strait.link"`, and
`ios/<App>/<App>.entitlements` lists `applinks:<your-handle>.strait.link`.

### New Architecture

Works on React Native's New Architecture (TurboModules, Fabric, bridgeless) and on the old one. React Native
0.82 and later only have the New Architecture; the example app (React Native 0.86, Expo 57) is built for
Android and iOS on every change and opens Strait links on the Android emulator and the iOS Simulator.

## Use

Create one client when the app starts. `start()` runs the deferred check once per install
(the first launch after an install) and then handles every link that opens the app, in every
app state, with open reporting included:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlayInstallReferrer } from 'react-native-play-install-referrer';
import { createStrait, fromPlayInstallReferrer } from '@straitlink/react-native';

const strait = createStrait({
  publishableKey: 'st_pub_live_…',                         // Dashboard → Get started (safe in apps; never the secret key)
  endpoint: 'https://<your-handle>.strait.link',           // your workspace's link domain
  storage: AsyncStorage,                                   // required for reliable analytics
  installReferrer: fromPlayInstallReferrer(PlayInstallReferrer),
});
strait.onLinkStart(() => showLoading());
strait.onLink((e) => e.matched && e.path && navigate(e.path, e.params));
strait.start();
```

For a settings or debug screen, `strait.checkDeferred()` asks again without touching the
once-per-install flag, and the engine adds no install for it.

> **Legacy:** `resolveDeferredLink({ publishableKey, endpoint })` is the older one-call API.
> It has no once-per-install guard and no open reporting, so every call counts as a first
> launch (an install row and an `install.matched` webhook). Use `createStrait` in new code.

### Old Firebase page.link links (contract B22)

Moving off Firebase Dynamic Links? People who already have your app can keep opening it from old
`<x>.page.link` links, as long as Google keeps serving page.link's app-link files (it still does today;
nobody but Google controls page.link):

1. Keep `applinks:<x>.page.link` (iOS) and the page.link intent filter (Android) in your next app build.
2. Add the host: `createStrait({ …, linkHosts: ['<x>.page.link'] })`.
3. Import your old links in the dashboard (Import → Firebase); each keeps its old host and code.

A page.link short link (`https://<x>.page.link/aBcD`) is then looked up like any Strait short link; a long link
(`https://<x>.page.link/?link=https://…`) opens its `link=` destination on the device, with no network call.
People without your app still land on whatever Google serves. Tested in unit tests only, not yet on a real
iPhone.

### What Strait records automatically (no extra code)

Every time a link opens the app, the SDK reports it once (contract B14):

| How the app opened | Reported via | Joined to |
|---|---|---|
| Verified link tapped in WhatsApp, Gmail, Messages… | `/v1/resolve` (the lookup is the report) | the link; also counted as a tap |
| Browser handed off to the app (`yourapp://…`) | `/v1/open` | the exact tap (`strait_click`, removed from the event's `url`, `path` and `params`; `rawUrl` is the URL as the OS gave it) |
| First open after a Play install | `/v1/referrer` | the exact tap that sent the user to the store |
| First open after an App Store install | `/v1/match` | the matched tap |
| Your own https links | `/v1/open` | the URL's host + path (and `utm_source`, for the channel) |

Reports that can't be sent (offline, server busy) are saved in `storage` and
retried on the next start and whenever the app returns to the foreground, for
up to 7 days (max 100). Reports and the saved queue never contain the query string
or fragment of the opened URL, only host + path and `utm_source` (contract B18). The engine de-duplicates by open id, so nothing is
counted twice. Navigation never waits for a report. The first launch of an
install is marked as such, so dashboards can tell **new users** (installed and
opened) from **existing users** (already had the app). The deferred check is
only marked done once the server answered, so an offline first launch is
retried on the next launch.

Open reports and the store sheet also say whether the app runs on a phone or a
tablet (`deviceClass`, contract B14): on iOS from `Platform.isPad`, on Android
from the screen's shorter side (600 dp or more = tablet). iPad Safari sends a Mac
user agent, so this is the only way Strait can count iPad opens. A custom
`runtime` can supply `deviceClass()` itself (`deviceClassForSize` is exported).

### Conversion events (revenue on the exact tap)

```ts
await strait.trackEvent('purchase', { value: 49.99, currency: 'USD' });
```

The event carries the tap id of the last attributed link open for 7 days, so
the dashboard can place the revenue on that tap's channel and A/B variant
(contracts B15/B16). Every attributed open supplies one: a browser hand-off,
a Play install, or (B16) the engine's reply to a verified short link or a
deferred match. A newer open replaces the older tap. Pass `clickId` to set it
yourself.

### Referral codes (preview, contract B21)

When a deferred link's tap carried a referral code (the link's `referralCode`, or
`?strait_ref=` on the tap), the deferred `LinkEvent` has it as `referralCode`:

```ts
strait.onLink((e) => {
  if (e.kind === 'deferred' && e.referralCode) saveInviter(e.referralCode);
});
```

It is absent when there is no code, no match, or the engine doesn't send one.
Referrals are a preview and are not switched on yet; grant rewards from your server
(the `referral.converted` webhook), not in the app.

## Check your setup (doctor)

Most "the link opens the browser, not the app" reports are setup: the app isn't listed for your link
domain, or a secret key is in the app. `doctor()` checks the key, the endpoint and your link domain's
`assetlinks.json` (Android) / `apple-app-site-association` (iOS) in one request (contract B23). Call it
in debug builds; it never throws. React Native can't read your package or bundle ID without a native
module, so pass them (left out, doctor lists what your domain has instead):

```ts
if (__DEV__) {
  links.doctor({ androidPackage: 'com.example.app', iosBundleId: 'com.example.app' });
}
```

**You should see** (Metro log, Android):

```
[Strait doctor] ok key.ok: Publishable key is set
[Strait doctor] ok app.listed: hilltop.strait.link lists com.example.app
```

An `error` line ends with what to do, e.g. `error app.missing: hilltop.strait.link doesn't list
com.example.app. Fix: Add com.example.app in Dashboard → Apps & stores (listed now: …)`. It returns
`{ ok, findings: [{ id, severity, title, fix }] }`; `ok` is false when any finding is an `error`. On
Android, pass `certSha256: ['AB:CD:…']` (from `./gradlew signingReport`) to also check this build's
signing certificate. The free web checker and the docs cover what the app can't see (intent filters,
Associated Domains).

## How it matches

| Platform | Method | Precision |
|----------|--------|-----------|
| Android  | Play Install Referrer (`strait_link`) | deterministic (`install_referrer`) |
| Android (no referrer) / iOS with Device matching on | server-side device fingerprint | probabilistic (`exact_ext` → `exact_core`; on iOS also `scored` when the workspace uses scored matching) |
| iOS with Paste handoff on | one-time handoff link copied by the tap page | exact (`clipboard`) |

The SDK collects only coarse device fields (screen width, pixel ratio, the
device's language tag such as `en-US`, timezone); the server uses only the first
two letters of the language. The **server** adds the IP it observes and
computes the signature — the client never sends an IP, and the signature is
never a cross-app identity.

How iPhone install matching works, what is kept (IP only as a keyed hash, for 1 hour)
and the App Store privacy label to use: https://straitlink.in/docs/iphone-install-matching/ .

### iPhone: you choose the deferred-link method (contract B19)

You make the choice in **Dashboard → Settings → iPhone installs**, with two switches.
It applies at runtime: the SDK reads both switches from Strait's `/v1/match` reply
(`ios: {deviceMatching, pasteHandoff}`) on the first launch of each install. Nothing
is built into your app, so changing it needs **no app release**, and the SDK never
stores it.

- **Device matching**: the link page records a few coarse device signals when
  "Get the app" is tapped, and the first launch matches on them. Apple's guidelines
  forbid fingerprinting whatever the user's tracking choice, so decide whether this
  fits your app's App Store review. **Off by default for new workspaces**
  (existing workspaces keep their setting).
- **Paste handoff**: "Get the app" copies a one-time link
  (`https://<your-handle>.strait.link/h/<token>`, single use, 24 h). On the first
  launch the SDK checks the clipboard and claims it for an exact match. Reading the
  clipboard shows iOS's "Allow Paste" prompt. Off by default.

| Device matching | Paste handoff | What happens on the first launch |
|---|---|---|
| off | off | No deferred link on iPhone: the app opens its home screen (the install is still counted). |
| on | off | Device matching only; the clipboard is never touched. |
| off | on | Paste handoff only: the SDK reads the clipboard and claims the link. |
| on | on | Device matching first; the clipboard is read only when it finds no match. |

For Paste handoff, pass a clipboard adapter (without one the SDK skips that step):

```ts
import * as Clipboard from 'expo-clipboard';
import { createStrait, fromExpoClipboard } from '@straitlink/react-native';

const strait = createStrait({
  publishableKey, endpoint,
  clipboard: fromExpoClipboard(Clipboard), // or { hasProbableWebUrl, readText } from @react-native-clipboard/clipboard
});
```

On the first launch only (iOS only), the SDK always calls `/v1/match` first (that
counts the install, and the reply carries your choice). If it matched, the clipboard
is never touched and no prompt shows. The SDK goes on to the clipboard only when
the reply arrived, found no match and says `pasteHandoff: true`. If `/v1/match` gets
no answer (or 429 / 5xx), the choice is unknown, so the clipboard is not touched
and the check runs again next launch (`reason: 'network'`). For the clipboard, the SDK first asks the adapter whether the clipboard
probably holds a URL (`hasUrlAsync`, iOS `hasURLs`: **no prompt**). Only if it does
does it read the text, and **iOS then shows its "Allow Paste" prompt**. If the text is
a Strait handoff link, the SDK sends just its token to `POST /v1/handoff/claim` for an
exact match (`route: 'clipboard'`); anything else never leaves the phone, and the SDK
keeps the device match result. Both attempts share one `openId` (one install, one event). To avoid the prompt, show Apple's Paste button
(`UIPasteControl` / SwiftUI `PasteButton`, e.g. through a small native view) and pass
what it pastes to `strait.claimHandoff(text)`.

`clipboardBoost` is **deprecated and ignored**: the dashboard decides. You can leave it
in your code; it does nothing.

### Android: enabling the deterministic path

With `createStrait`, pass `installReferrer: fromPlayInstallReferrer(PlayInstallReferrer)`
(from `react-native-play-install-referrer`), as in "Use" above. The
standalone `resolveDeferredLink` doesn't take that option: it looks for a native
module named `StraitInstallReferrer` exposing `getInstallReferrer(): Promise<string>`
(a thin wrapper over Google's `InstallReferrerClient`) that you provide. With either,
Android installs resolve exactly; without one, Android falls back to the fingerprint
path automatically.

## Store sheet (new)

When a user taps **Install** for one of your other apps (a sibling, partner or
"lite" app), show the app store *inside your app* and keep the deep link for the
app being installed.

```ts
const result = await strait.openStoreSheet('https://<handle>.strait.link/promo', {
  callerId: 'com.yourcompany.app', // Android: your own package, needed for the inline sheet
  style: 'product_page',           // iPhone: or 'overlay'
});
// result.method: inline_install | market | web | product_page | overlay | app_store | none
```

- **Android:** Google Play inline install (a half-sheet over your app; Google
  labels it a test feature), then the Play app, then the Play web page. Each
  carries `referrer=strait_link=<id>&strait_click=<tap>`, which the installed
  app's Play Install Referrer match reads exactly.
- **iPhone:** saves this device's match fields for the tap (unless the workspace
  turned iPhone install matching off), copies the clipboard-boost handoff link
  when you pass `copyHandoffLink: true`, then shows the App Store with the link's
  campaign as the `ct` token.

The in-app sheet needs a small native module named `StraitStoreSheet` in your app:

| Method | Platform | Does |
|---|---|---|
| `openIntent(intent)` → `Promise<boolean>` | Android | `Intent(intent.action, Uri.parse(intent.data))`, `setPackage(intent.packageName)` when set, put `intent.extras`, `startActivity`; resolve false on `ActivityNotFoundException`. sdk-android's README section 5 has the Kotlin. |
| `presentProduct(product, style)` → `Promise<boolean>` | iPhone | Show `SKStoreProductViewController` or `SKOverlay` (sdk-swift's `SystemStoreSheetPresenter` does this). |

Without the module the SDK uses `Linking.openURL`: the Play app (`market://`,
deep link still kept) or the App Store app (`itms-apps://`, match still saved),
so the user leaves your app. The tap is recorded with `sent_to = store_sheet`
and is not billed while the store sheet is new. It works only where your app is the host: a
link tapped inside another company's app can't open a store sheet there.

## Testing in non-RN contexts

Inject a fake runtime, storage and fetch (`StraitRuntime` and `KeyValueStore` are exported types):

```ts
const strait = createStrait({
  publishableKey, endpoint,
  runtime: {
    platform: () => 'ios', collectDevice: () => ({...}), getInstallReferrer: async () => null,
    getInitialURL: async () => null, onURL: () => () => {}, onAppState: () => () => {}, now: () => Date.now(),
  },
  storage: myMemoryStore,
  fetch: myFetchStub,
});
```

## Size and speed

Measured 25 Oct 2026 on 0.9.3. 0.10.0 adds the Expo config plugin (3.1 KB, `app.plugin.cjs`): it runs at prebuild and is not in your JS bundle.

| What | Size or time | How it was measured |
|---|---|---|
| npm package | 36.5 KB download, 115 KB unpacked, no dependencies (`react-native` is a peer) | `npm pack --dry-run` |
| In your JS bundle | 23.3 KB minified, 8.7 KB gzip | esbuild 0.25 `--bundle --minify` of the whole entry (Metro doesn't tree-shake) |
| Start-up | 2.1 ms to load the module + 0.26 ms for `createStrait(...)` | fresh Node 26 process on an M-series Mac with an injected runtime, median of 25. No network: the first-launch check runs after `start()` |

## Example app

[`examples/expo`](examples/expo) opens a deep link on the right screen, shows the deferred link and logs a `purchase` event, built against this repo's source with the config plugin. CI type-checks it, runs `expo export`, checks the plugin's prebuild output and builds it for Android and iOS on every PR.

1. `npm ci` here, then `cd examples/expo && npm ci`; `cp .env.example .env` and set your publishable key (`st_pub_…`).
2. `npx expo run:android` (or `run:ios`).
3. `npx uri-scheme open "straitexample://product/42" --android` and watch the log on screen.

## Docs and support

- **Docs:** [straitlink.in/docs/sdks/react-native/](https://straitlink.in/docs/sdks/react-native/) · [platform status](https://straitlink.in/platform-status/) · [troubleshooting](https://straitlink.in/docs/troubleshooting/)
- **Talk to the Strait team:** [support@straitlink.in](mailto:support@straitlink.in) (replies within 1 working day, IST) or call +91 81218 61890.
- **Bugs and feature requests:** [open an issue](https://github.com/strait-link/strait-sdk-react-native/issues) on this repo.
- **Security:** never in a public issue. Write to security@straitlink.in (see [SECURITY.md](SECURITY.md)).
