# Strait example: React Native (Expo)

Built against this repo's own source (`"@straitlink/react-native": "file:../.."`; `.npmrc` sets `install-links=true`, so npm installs a packed copy instead of a symlink Metro would loop on). CI type-checks it and runs `expo export`, so it fails here when the public API changes.
Shows a deep link (`straitexample://…`), the deferred link (`start()`, once per install) and an event (`trackEvent`).

1. `npm ci` in the repo root, then `npm ci` here; `cp .env.example .env` and set your publishable key (`st_pub_…`, Dashboard → Get started).
2. `npx expo run:android` or `npx expo run:ios` (a development build; the scheme is set in `app.json`).
3. Try a deep link: `npx uri-scheme open "straitexample://product/42" --android` (or `--ios`). Events show on screen.

After changing the SDK source, run `npm ci` here again to pick up a fresh packed copy.
