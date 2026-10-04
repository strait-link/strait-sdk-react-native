# @strait/sdk-react-native

Deferred deep linking for React Native — the user taps your link, installs the
app, and lands on the right screen. No clipboard paste banner.

Part of [Strait](../). The match signature stays in lockstep with the server and
every other SDK via [`shared-spec`](../shared-spec) golden vectors (run in CI here).

## Install

<!-- brand:install -->
```sh
npm install @strait/sdk-react-native
```
<!-- /brand:install -->

Not on the npm registry yet. Until it is, install from GitHub (npm builds it on install):

```sh
npm install github:bazingga08/strait-sdk-react-native#v0.7.2
```

Android's exact deferred match also wants the Play Install Referrer native
module (optional but recommended) — see "Android" below.

## Use

Call once after first launch and route to the result:

```ts
import { resolveDeferredLink } from '@strait/sdk-react-native';

const result = await resolveDeferredLink({
  publishableKey: 'st_pub_live_…',    // Dashboard → Get started (safe in apps; never the secret key)
  endpoint: 'https://go.yourbrand.com', // your Strait link host
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
import { createStrait, fromPlayInstallReferrer } from '@strait/sdk-react-native';

const strait = createStrait({
  publishableKey: 'st_pub_live_…',
  endpoint: 'https://go.yourbrand.com',
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
| Your own https links | `/v1/open` | host + path only (never the query) |

Reports that can't be sent (offline, server busy) are saved in `storage` and
retried on the next start and whenever the app returns to the foreground, for
up to 7 days (max 100). The engine de-duplicates by open id, so nothing is
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

## How it matches

| Platform | Method | Precision |
|----------|--------|-----------|
| Android  | Play Install Referrer (`strait_link`) | deterministic (`install_referrer`) |
| Android (no referrer) / iOS | server-side device fingerprint | probabilistic (`exact_ext` → `exact_core`) |

The SDK collects only coarse, privacy-clean device fields (screen width, pixel
ratio, 2-char language, timezone). The **server** adds the IP it observes and
computes the signature — the client never sends an IP, and the signature is
never a cross-app identity.

### Android: enabling the deterministic path

Provide a native module named `StraitInstallReferrer` exposing
`getInstallReferrer(): Promise<string>` (thin wrapper over Google's
`InstallReferrerClient`). When present, Android installs resolve exactly; without
it, Android falls back to the fingerprint path automatically.

## Testing in non-RN contexts

Inject a fake adapter and fetch:

```ts
await resolveDeferredLink({
  publishableKey, endpoint,
  adapter: { platform: () => 'ios', collectDevice: () => ({...}), getInstallReferrer: async () => null },
  fetch: myFetchStub,
});
```
