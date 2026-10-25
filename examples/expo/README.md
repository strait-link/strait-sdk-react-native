# Strait example: React Native (Expo)

Built against this repo's own source (`"@straitlink/react-native": "file:../.."`; `.npmrc` sets `install-links=true`, so npm installs a packed copy instead of a symlink Metro would loop on). CI type-checks it and runs `expo export`, so it fails here when the public API changes.
Shows a deep link (`straitexample://…`), the deferred link (`start()`, once per install) and an event (`trackEvent`).

1. `npm ci` in the repo root, then `npm ci` here; `cp .env.example .env` and set your publishable key (`st_pub_…`, Dashboard → Get started).
2. `npx expo run:android` or `npx expo run:ios` (a development build). The Strait config plugin in `app.json`
   (`"plugins": [["@straitlink/react-native", { "domains": ["strait-dev.strait.link"], "scheme": "straitexample" }]]`)
   writes the Associated Domains entitlement, the App Links filter (`autoVerify`) and the scheme at prebuild;
   `node scripts/check-prebuild.mjs` after `npx expo prebuild` checks them.
3. Try a link: `npx uri-scheme open "straitexample://product/42" --android` (or `--ios`). Events show on screen,
   and a link to `/p/<id>` switches the screen to "Product <id>".

Real Strait links (App Links / Universal Links) open the app only when the link domain lists the build's
app: point `domains` at your workspace and sign as an app listed in Dashboard → Settings → Apps.
`app.config.js` takes `STRAIT_EXAMPLE_IOS_BUNDLE_ID`, `APPLE_TEAM_ID` and `STRAIT_EXAMPLE_ANDROID_PACKAGE` for that,
without editing `app.json`.
The screen shows `Architecture: Fabric, bridgeless`: React Native 0.86 runs only the New Architecture.

After changing the SDK source, run `npm ci` here again to pick up a fresh packed copy.
