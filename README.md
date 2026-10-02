# @strait/sdk-react-native

Deferred deep linking for React Native — the user taps your link, installs the
app, and lands on the right screen. No clipboard paste banner.

Part of [Strait](../). The match signature stays in lockstep with the server and
every other SDK via [`shared-spec`](../shared-spec) golden vectors (run in CI here).

## Install

```sh
npm install @strait/sdk-react-native
# Android deterministic match also wants the Play Install Referrer native module
# (optional but recommended) — see "Android" below.
```

## Use

Call once after first launch and route to the result:

```ts
import { resolveDeferredLink } from '@strait/sdk-react-native';

const result = await resolveDeferredLink({
  publishableKey: 'bk_pub_live_…',    // Dashboard → Get started (safe in apps; never the secret key)
  endpoint: 'https://go.yourbrand.com', // your Strait link host
});

if (result.matched && result.longUrl) {
  navigationRef.navigate(result.longUrl);
}
```

`resolveDeferredLink` never throws — on any error it returns
`{ matched: false, matchMethod: 'none' }`.

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
