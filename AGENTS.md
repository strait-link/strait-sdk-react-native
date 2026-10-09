# AGENTS.md: Strait React Native SDK (@straitlink/react-native)

Instructions for AI coding agents (Claude Code, Cursor, Codex, Copilot…) that add this SDK to an app or work on
this repo. Humans: see README.md.

Deep links and deferred deep links for React Native and Expo (development builds; Expo Go cannot load the native module). One `onLink` callback for every way a link opens the app, with open reporting built in.

## Install

Not on the npm registry yet: install from GitHub with the two helper packages. Don't guess a registry name
(`npm install @straitlink/react-native` and look-alikes return 404 or someone else's package); use the line below.

```sh
npm install github:bazingga08/strait-sdk-react-native#v0.8.1 @react-native-async-storage/async-storage react-native-play-install-referrer
# Expo: install the two helpers with `npx expo install` so versions match the Expo SDK
```

Link settings: Android App Links intent filter (`autoVerify`) for `https://<handle>.strait.link` plus the custom
scheme; iPhone Associated Domains `applinks:<handle>.strait.link` plus the URL scheme. Expo: `scheme`,
`android.intentFilters`, `ios.associatedDomains` in `app.json`.

## Keys (the rule agents get wrong most)

- **Publishable key** `st_pub_live_…` (Dashboard → Get started): goes in the app. It is the only key this SDK takes (`publishableKey`).
- **Secret key** `st_live_…` (Dashboard → Settings → Secret keys): server only. Never put it in an app: anyone can extract it and change your links.
- Never commit either key's real value to this repo, tests or examples. Use placeholders like `st_pub_live_…`.

## Stop and ask the human

These steps need a person; there is no API for them yet. Ask, wait for the answer, and don't invent values:

1. **Workspace and keys:** sign up at https://app.straitlink.in, then send the publishable key (`st_pub_live_…`)
   and the workspace's link domain (`https://<handle>.strait.link`). Never ask for, or accept, the secret key in app code.
2. **App settings in the dashboard** (Dashboard → Settings): Android package name, every SHA-256 signing
   fingerprint (including the Play App Signing key from Play Console → App integrity), the custom scheme, and for
   iPhone the Apple Team ID + bundle id. The agent can't write these; it can only check them (below).
3. **Google Play upload:** an internal-testing build is needed to test deferred links on Android.
4. **A real phone tap**, if no device is connected to this machine.

## Receive links: the one pattern

```ts
// links.ts: create once, outside components; start once at launch
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlayInstallReferrer } from 'react-native-play-install-referrer';
import { createStrait, fromPlayInstallReferrer } from '@straitlink/react-native';

export const links = createStrait({
  publishableKey: 'st_pub_live_…',      // never the secret key
  endpoint: 'https://hilltop.strait.link',  // the workspace's link domain
  storage: AsyncStorage,
  installReferrer: fromPlayInstallReferrer(PlayInstallReferrer),
});
links.start();

// Wherever navigation is ready (onLink replays past events, so late subscribers miss nothing):
links.onLink((e) => { if (e.matched && e.path) navigate(e.path, e.params); });
```

- Expo Router: subscribe in `app/_layout.tsx` once `useRootNavigationState()?.key` is set, and add
  `app/+native-intent.tsx` whose `redirectSystemPath` returns `'/'` for link-domain URLs, so Expo Router doesn't
  route the raw link.
- React Navigation: subscribe in `NavigationContainer`'s `onReady`. Don't also list the link domain in `linking`
  (each link would be handled twice).
- Conversions: `links.trackEvent('purchase', { value: 499, currency: 'INR' })` attaches the tap id automatically.

## Verify

Run these; don't assume. Steps 1 and 2 need no phone, so run them after every config change (the verify loop).

```sh
# 1. The link domain serves the verification files with this app in them
curl https://<handle>.strait.link/.well-known/assetlinks.json              # Android: package + every SHA-256
curl https://<handle>.strait.link/.well-known/apple-app-site-association   # iPhone: TeamID.bundleId
#    Keyless checker for the same files (JSON): https://strait.link/v1/tools/app-links?domain=<handle>.strait.link
#    (or in a browser: https://straitlink.in/tools/)

# 2. Dry-run a tap: what the link would do on this device, without recording a tap or counting toward the plan
curl "https://strait.link/v1/simulate?url=https://<handle>.strait.link/<slug>&ua=android&publishableKey=st_pub_live_…"
#    want: "decision": "redirect" or "interstitial" with the app's intent / store as "location" (ua=iphone for iPhone)
```

If step 1 or 2 is wrong, fix the dashboard setting it points at (ask the human, see "Stop and ask"), then rerun 1 and 2.

```sh
# 3. Android verified the host (fresh install). Want: verified
adb shell pm get-app-links <package.name>
```

4. Tap a link from WhatsApp or Gmail on a real phone: the app opens on the right screen and `onLink` fires
   with `matched: true`. The tap and the open appear in Dashboard → Analytics.
5. Deferred (Android): install from a Google Play internal-testing build, tap the link before installing, open
   the app: `onLink` fires with `kind: deferred`, `route: install_referrer`. iPhone install matching is in beta.

If links open the browser: a missing SHA-256 (most often the Play App Signing key from Play Console → App
integrity), a typo in the host, or the app was installed before the files were right (reinstall). See
https://straitlink.in/docs/troubleshooting/.

## Working on this repo

- Test: `npm ci && npm run typecheck && npm test` (must pass before any commit; check the exit code).
- The match signature and the pure helpers are pinned by shared golden vectors
  (`test/*vectors*.json`): byte-identical copies live in every SDK and the engine. Never edit a vector file
  here alone; vectors change only through `shared-spec/` and land in every repo together.
- The package's public identity (name, scope, owner, domain) lives only in `brand.json`; change it with
  `shared-spec/scripts/rename-brand.sh` (all SDKs) or `node scripts/brand.mjs --write`.
- Wire names are part of the contract: query params `strait_click` / `strait_link`, storage keys `strait.*`,
  headers `X-Strait-*`. Don't rename them.
- Brand: Strait (never "Straight"). Don't write superlatives ("best", "cheapest") or speed / match-rate numbers in
  docs or comments. iPhone install matching is in beta.

## More

- Docs for this SDK: https://straitlink.in/docs/sdks/react-native/
- All docs: https://straitlink.in/docs/ · REST API: https://straitlink.in/docs/api/
- Strait from AI tools (MCP server: create links, check App Links files, trace taps): https://straitlink.in/ai/
