# Publishing to npm

The package name, npm scope, repo URL, homepage and copyright holder all come from
`brand.json` (name = `<npmScope>/<package>`). Nothing else in this repo types them.

## One-time owner setup

1. **Pick the brand.** Run `shared-spec/scripts/rename-brand.sh … --final --apply`
   from the workspace root (the folder holding every SDK repo) (or edit `brand.json`, set `"final": true`, run
   `node scripts/brand.mjs --write`). Commit. The release workflow refuses to
   publish while `brand.json` still has placeholders or `"final": false`.
2. **Make the GitHub repo public** (npm provenance needs a public repo whose URL
   matches `repository.url` in package.json).
3. **npm org:** sign in at npmjs.com → *Add Organization* → name it exactly the
   scope without `@` (e.g. `godwit` for `@godwit`). Free for public packages.
   Turn on 2FA for your account.
4. **Token:** npmjs.com → *Access Tokens* → *Generate New Token* → *Granular
   Access Token*: packages and scopes = read and write, limited to the org;
   expiry as short as you're comfortable with.
5. **Secret:** GitHub repo → *Settings → Secrets and variables → Actions → New
   repository secret*: name `NPM_TOKEN`, value = the token.

## Every release

1. Bump `"version"` in package.json, add a `## X.Y.Z` entry to CHANGELOG.md, commit.
2. `npm pack --dry-run` — check only `dist/`, README, LICENSE, CHANGELOG are listed.
3. `git tag vX.Y.Z && git push origin main vX.Y.Z`.
4. Watch *Actions → Release*: tag/version check → typecheck → tests → brand check
   → `npm publish --provenance --access public`.

Without `NPM_TOKEN` the workflow still runs the tests and skips the publish with a
notice, so pushing a tag early is harmless.

Optional later: npm *trusted publishing* (OIDC, no token) — on the package's npm
settings page add this repo + `release.yml` as a trusted publisher, then drop the
`NPM_TOKEN` check and env line from release.yml and delete the secret.
