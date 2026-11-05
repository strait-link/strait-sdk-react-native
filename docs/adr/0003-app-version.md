# ADR 0003: send the app version and SDK version with recorded opens

Date: 5 Nov 2026 · Status: accepted · Backlog: td2-23 · Engine side: redirect-engine ADR 0086

## Problem
When a customer says "links stopped working", support's first question is "which app version?". The engine
now keeps `appVersion` and `sdkVersion` on every recorded open/install (optional body fields; 1-64 printable
ASCII, anything else dropped, never a 400). This SDK has to send them.

## Where the app version comes from
React Native core has no API for the host app's version (`Platform.constants` holds the OS and React Native
versions only), and this package has no dependencies. Options:
1. **Add react-native-device-info or expo-application as a dependency.** Rejected: a native module (and its
   install/linking cost) for one string; neither is a dependency today.
2. **Read it optionally at runtime if one of them happens to be installed.** Rejected: a hidden, bundler-dependent
   import for one string, and silently absent in bare apps.
3. **An `appVersion?: string` config option (chosen).** Same pattern as `installTime`: the app passes what it
   already has (Expo `Application.nativeApplicationVersion`, device-info `getVersion()`). Left out = only
   `sdkVersion` is sent. A plain string because both sources are synchronous constants.

`sdkVersion` is the `SDK_VERSION` constant in `src/core.ts`; a test pins it equal to package.json.

## Design
- `versionFields()` cleans once at `createStrait` (trim, cut to 64, printable ASCII or not sent) and the result is
  spread into the five recording bodies: /v1/open, /v1/resolve, /v1/referrer, /v1/match, /v1/handoff/claim.
- Saved open reports carry the versions they were built with, so a retry after an app update still names the
  build that opened the link. Reports saved by an older SDK are sent as they are (no version guessed).
- Not on /v1/lookup (the opt-out path records nothing) or /v1/event; nothing is sent while `setEnabled(false)`.

## Security lens
An app version is not personal data and decides nothing on the engine (no matching, billing or routing);
anyone with the public key could already send any string in `platform`. Bounded to 64 characters.
