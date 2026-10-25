// Expo config plugin for @straitlink/react-native (ADR 0001).
//
//   "plugins": [["@straitlink/react-native", { "domains": ["acme.strait.link"], "scheme": "acme" }]]
//
// It fills Expo's own `ios.associatedDomains`, `android.intentFilters` and `scheme` fields, and
// `npx expo prebuild` writes them with Expo's built-in mods: the Associated Domains entitlement,
// an App Links intent filter with android:autoVerify="true", and the URL scheme on both platforms.
// Same approach as Expo's Branch plugin (@config-plugins/react-native-branch), which leaves link
// domains to these fields. Re-running it adds nothing twice; values already in app.json stay.
'use strict';

const HOST = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const SCHEME = /^[a-z][a-z0-9+.-]*$/i;

function fail(message) {
  throw new Error(`@straitlink/react-native plugin: ${message}`);
}

function hostOf(value) {
  const host = typeof value === 'string' ? value.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '') : '';
  if (!HOST.test(host)) {
    fail(`"${value}" is not a link domain. Use the host only, like "acme.strait.link" (Dashboard → Get started).`);
  }
  return host;
}

function withStrait(config, props) {
  const { domains, scheme } = props || {};
  if (domains !== undefined && !Array.isArray(domains)) fail('`domains` must be a list, like ["acme.strait.link"].');
  if ((!domains || domains.length === 0) && scheme === undefined) {
    fail('needs `domains` (your link domain, like ["acme.strait.link"]) and/or `scheme`.');
  }
  if (scheme !== undefined && (typeof scheme !== 'string' || !SCHEME.test(scheme) || /^https?$/i.test(scheme))) {
    fail(`"${scheme}" is not a custom scheme. Use letters, digits, "+", "-" or ".", like "acme".`);
  }
  const hosts = [...new Set((domains || []).map(hostOf))];
  const out = { ...config };

  if (hosts.length) {
    const ios = { ...out.ios };
    const associated = [...(ios.associatedDomains || [])];
    for (const host of hosts) if (!associated.includes(`applinks:${host}`)) associated.push(`applinks:${host}`);
    ios.associatedDomains = associated;
    out.ios = ios;

    const android = { ...out.android };
    const filters = [...(android.intentFilters || [])];
    const covered = new Set();
    for (const f of filters) {
      if (f && f.autoVerify === true && f.action === 'VIEW') {
        for (const d of [].concat(f.data || [])) if (d && d.scheme === 'https' && d.host && !d.pathPrefix && !d.path && !d.pathPattern) covered.add(d.host);
      }
    }
    const missing = hosts.filter((h) => !covered.has(h));
    if (missing.length) {
      filters.push({
        action: 'VIEW',
        autoVerify: true,
        data: missing.map((host) => ({ scheme: 'https', host })),
        category: ['BROWSABLE', 'DEFAULT'],
      });
    }
    android.intentFilters = filters;
    out.android = android;
  }

  if (scheme !== undefined) {
    const have = out.scheme === undefined ? [] : [].concat(out.scheme);
    if (!have.includes(scheme)) out.scheme = have.length ? [...have, scheme] : scheme;
  }
  return out;
}

module.exports = withStrait;
