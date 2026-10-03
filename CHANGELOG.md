# Changelog

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
