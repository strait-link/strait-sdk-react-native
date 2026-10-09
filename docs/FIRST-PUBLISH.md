# First publish of @straitlink/react-native (one time, by hand)

npm only lets you link a trusted publisher to a package that already exists, so
the very first version goes up from your laptop. Every later version is published
by `.github/workflows/release.yml` when a `vX.Y.Z` tag is pushed, with no token.

## 0. Once for all three JS SDKs: create the npm org

npmjs.com, signed in, avatar menu, **Add Organization**, name: `straitlink`
(free plan, public packages). Make sure 2FA is on for your account.

## 1. Publish the first version

```sh
git clone https://github.com/bazingga08/strait-sdk-react-native.git
cd strait-sdk-react-native
git checkout main            # or the commit you want to ship
npm ci
npm run typecheck && npm test
npm login                    # opens the browser; finish 2FA
npm pack --dry-run           # expect only: dist/**, README.md, LICENSE, package.json
npm publish --access public --provenance=false
```

`npm publish` runs `prepublishOnly` (a clean build) first, so `dist/` is fresh.
`--provenance=false` is needed only here: package.json sets
`publishConfig.provenance: true`, and provenance can be generated only inside
CI. The automated releases keep provenance on.

Check: `npm view @straitlink/react-native` shows the version.

## 2. Link the trusted publisher

npmjs.com, package `@straitlink/react-native`, **Settings**, **Trusted Publisher**,
**GitHub Actions**, then enter exactly:

| Field | Value |
| --- | --- |
| Organization or user | `bazingga08` |
| Repository | `strait-sdk-react-native` |
| Workflow filename | `release.yml` |
| Environment name | (leave empty) |

Save. Then, on the same Settings page, **Publishing access**: choose
"Require two-factor authentication and disallow tokens" (trusted publishing still
works; stray tokens can no longer publish).

## 3. Every later release

1. Bump `"version"` in package.json, add a `## X.Y.Z` entry to CHANGELOG.md, merge to main.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. Watch GitHub, **Actions**, **Release**. The package page then shows a provenance badge.

If the publish step fails with 404 or ENEEDAUTH, the trusted-publisher fields do not
match: check the repo name, that the file is `release.yml`, and that the
environment field is empty. `repository.url` in package.json must stay
`git+https://github.com/bazingga08/strait-sdk-react-native.git` (provenance checks it).
