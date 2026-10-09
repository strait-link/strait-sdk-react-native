# Strait SDK for React Native

`@straitlink/react-native`

> **Availability:** Android: Live · iPhone install matching: **Beta** (not yet proven on a real iPhone) · SDK: Beta (installed from GitHub; not on npm yet).
> [Platform status](https://straitlink.in/platform-status/) · [Docs](https://straitlink.in/docs/)

Deferred deep linking for React Native: the user taps your link, installs the
app, and lands on the right screen. No clipboard by default; an opt-in iPhone
clipboard boost gives exact matches (contract B19).

Part of [Strait](https://straitlink.in). The match signature stays in lockstep with the server and
every other SDK via shared golden vectors (run in CI here).

## Install

Not on the npm registry yet. Install from GitHub (npm builds it on install):

```sh
npm install github:bazingga08/strait-sdk-react-native#v0.8.1
```

The package's name is `@straitlink/react-native` (from `package.json`), so imports read
`from '@straitlink/react-native'` either way. Once it is published to npm, the install line will be:

<!-- brand:install -->
```sh
npm install @straitlink/react-native
```
<!-- /brand:install -->

That registry command does not work yet (npm returns 404). Don't try other package names.

Android's exact deferred match also wants the Play Install Referrer native
module (optional but recommended) — see "Android" below.

## Use

Call once after first launch and route to the result:

```ts
import { resolveDeferredLink } from '@straitlink/react-native';

const result = await resolveDeferredLink({
  publishableKey: 'st_pub_live_…',    // Dashboard → Get started (safe in apps; never the secret key)
  endpoint: 'https://<your-handle>.strait.link', // your workspace's link domain
});

if (result.matched && result.longUrl) {
  navigationRef.navigate(result.longUrl);
}
```

`resolveDeferredLink` never throws — on any error it returns
`{ matched: false, matchMethod: 'none' }`.

## Full client: every link, every app state, analytics included

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlayInstallReferrer } from 'react-native-play-install-referrer';
import { createStrait, fromPlayInstallReferrer } from '@straitlink/react-native';

const strait = createStrait({
  publishableKey: 'st_pub_live_…',
  endpoint: 'https://<your-handle>.strait.link',
  storage: AsyncStorage,                                   // required for reliable analytics
  installReferrer: fromPlayInstallReferrer(PlayInstallReferrer),
});
strait.onLinkStart(() => showLoading());
strait.onLink((e) => e.matched && e.path && navigate(e.path, e.params));
strait.start();
```

### What Strait records automatically (no extra code)

Every time a link opens the app, the SDK reports it once (contract B14):

| How the app opened | Reported via | Joined to |
|---|---|---|
| Verified link tapped in WhatsApp, Gmail, Messages… | `/v1/resolve` (the lookup is the report) | the link; also counted as a tap |
| Browser handed off to the app (`yourapp://…`) | `/v1/open` | the exact tap (`strait_click`, removed before your app sees the URL) |
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

## How it matches

| Platform | Method | Precision |
|----------|--------|-----------|
| Android  | Play Install Referrer (`strait_link`) | deterministic (`install_referrer`) |
| Android (no referrer) / iOS | server-side device fingerprint | probabilistic (`exact_ext` → `exact_core`) |
| iOS, clipboard boost on (opt-in) | one-time handoff link copied by the tap page | exact (`clipboard`) |

The SDK collects only coarse, privacy-clean device fields (screen width, pixel
ratio, 2-char language, timezone). The **server** adds the IP it observes and
computes the signature — the client never sends an IP, and the signature is
never a cross-app identity.

How iPhone install matching works, what is kept (IP only as a keyed hash, for 1 hour)
and the App Store privacy label to use: https://straitlink.in/docs/iphone-install-matching/ .
A workspace can switch iPhone install matching off in Dashboard → Settings → "iPhone
install matching"; iPhone installs then open your app's home screen.

### iPhone: the clipboard boost (optional, contract B19)

Off by default: the SDK never touches the clipboard unless you set
`clipboardBoost: true` **and** pass a clipboard adapter. Also turn on Dashboard →
Settings → "Clipboard boost", so the tap page's "Get the app" button copies a
one-time link (`https://<your-handle>.strait.link/h/<token>`, single use, 24 h).

```ts
import * as Clipboard from 'expo-clipboard';
import { createStrait, fromExpoClipboard } from '@straitlink/react-native';

const strait = createStrait({
  publishableKey, endpoint,
  clipboardBoost: true,
  clipboard: fromExpoClipboard(Clipboard), // or { hasProbableWebUrl, readText } from @react-native-clipboard/clipboard
});
```

On the first launch only (iOS only), the SDK asks the adapter whether the clipboard
probably holds a URL (`hasUrlAsync`, iOS `hasURLs`: **no prompt**). Only if it does
does it read the text, and **iOS then shows its "Allow Paste" prompt**. If the text is
a Strait handoff link, the SDK sends just its token to `POST /v1/handoff/claim` for an
exact match (`route: 'clipboard'`); anything else never leaves the phone, and the SDK
falls back to normal matching. To avoid the prompt, show Apple's Paste button
(`UIPasteControl` / SwiftUI `PasteButton`, e.g. through a small native view) and pass
what it pastes to `strait.claimHandoff(text)`.

### Android: enabling the deterministic path

Provide a native module named `StraitInstallReferrer` exposing
`getInstallReferrer(): Promise<string>` (thin wrapper over Google's
`InstallReferrerClient`). When present, Android installs resolve exactly; without
it, Android falls back to the fingerprint path automatically.

## Store sheet (beta; iPhone is beta)

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
and is not billed during the beta. It works only where your app is the host: a
link tapped inside another company's app can't open a store sheet there.

## Testing in non-RN contexts

Inject a fake adapter and fetch:

```ts
await resolveDeferredLink({
  publishableKey, endpoint,
  adapter: { platform: () => 'ios', collectDevice: () => ({...}), getInstallReferrer: async () => null },
  fetch: myFetchStub,
});
```

## Support

Questions or a bug: support@straitlink.in (replies within 1 working day, IST) or open a
[GitHub issue](https://github.com/bazingga08/strait-sdk-react-native/issues). Security issues: see
[SECURITY.md](SECURITY.md).
