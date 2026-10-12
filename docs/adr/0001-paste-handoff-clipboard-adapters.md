# 0001: Paste handoff clipboard adapters ask for a probable web URL (B-SDK-06)

Date: 12 Oct 2026. Status: accepted (branch `fix/registry-1012`).

## Problem

Paste handoff (contract B19) first asks the clipboard, without the iOS paste prompt,
whether it probably holds a URL, and reads it only if so. The only shipped adapter,
`fromExpoClipboard`, asked `hasUrlAsync`, which is iOS `UIPasteboard.hasURLs`. The tap
page copies the handoff link with `navigator.clipboard.writeText`: plain text. An iOS
26.5 simulator (`test/ios-paste-probe/run.sh`) answers for that clipboard:

| Clipboard | hasURLs | hasStrings | detectPatterns(.probableWebURL) |
|---|---|---|---|
| handoff link as plain text | **false** | true | **true** |
| `hello world` | false | true | false |
| URL item (`UIPasteboard.url`) | true | true | true |

So an Expo app with Paste handoff on never read the clipboard and got `no_match`: the
customer's chosen iPhone method silently did nothing. Swift and the Flutter README's
channel already use `detectPatterns(.probableWebURL)`.

## Who it serves

App teams on React Native that turned Paste handoff on (Dashboard, Settings, iPhone
installs). Their users get the exact match the tap page set up.

## Options

1. Do nothing: Paste handoff on RN keeps failing quietly. Rejected.
2. Ship native iOS code in `@straitlink/react-native`: the package is pure JS today
   (no pods, works in Expo Go for the rest). A native module for one call is a large
   coupling cost. Rejected.
3. Extend what exists (chosen): add `fromRNClipboard` for
   `@react-native-clipboard/clipboard`, whose `hasWebURL` is
   `detectPatterns(.probableWebURL)` (checked in its 1.16.3 `ios/RNCClipboard.mm`), and
   make it the README's recommendation. Fix `fromExpoClipboard` to fall back to
   `hasStringAsync` (hasStrings, no prompt) when `hasUrlAsync` says no, because
   expo-clipboard 57 has no probable-URL check.

## Security and privacy lens

- Data exposure: unchanged. Only a Strait handoff token parsed from the text leaves
  the phone; other text never does (`parseHandoffUrl`).
- Prompt surface: `fromRNClipboard` prompts only when iOS thinks a URL is present.
  The Expo fallback prompts whenever any text is present, once per install, only when
  the workspace turned Paste handoff on and device matching found nothing. Documented
  in the README so teams can pick `fromRNClipboard` instead.
- Spoofing / tampering: a pasted token is claimed by the engine (single use, 24 h);
  no change.

## Architecture lens

No new dependency in the SDK: adapters take the library object the app already
imports, typed structurally (checked against the real typings of
@react-native-clipboard/clipboard 1.16.3 and expo-clipboard 57.0.2). No change to the
engine, the wire format or storage.

## Cost

Two small functions, tests in `test/clipboard.test.ts`. The real-iPhone check is in
B-IOS-05.
