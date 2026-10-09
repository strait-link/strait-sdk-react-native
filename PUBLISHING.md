# Publishing to npm

The package name, npm scope, repo URL, homepage and copyright holder all come from
`brand.json` (name = `<npmScope>/<npmPackage>`). Nothing else in this repo types them.

Publishing uses npm **Trusted Publishing** (OIDC): `.github/workflows/release.yml`
publishes on a `v*` tag with `id-token: write` and no `NPM_TOKEN` secret. Provenance
is attached automatically.

- **First version and linking the trusted publisher (one time):** see
  [docs/FIRST-PUBLISH.md](docs/FIRST-PUBLISH.md).
- **Every release:** bump `"version"`, add a CHANGELOG entry, merge, then
  `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow checks tag = version,
  then typecheck, tests, `brand.mjs --release`, `npm publish --access public`.
- **Before tagging:** `npm pack --dry-run` should list only `dist/**`, `README.md`,
  `LICENSE` and `package.json`.
