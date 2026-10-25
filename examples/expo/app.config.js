// app.json holds the config. For a real link test, sign the build as an app your link domain lists
// (Dashboard → Settings → Apps), without editing app.json:
//   STRAIT_EXAMPLE_IOS_BUNDLE_ID=… APPLE_TEAM_ID=… STRAIT_EXAMPLE_ANDROID_PACKAGE=… npx expo prebuild
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    bundleIdentifier: process.env.STRAIT_EXAMPLE_IOS_BUNDLE_ID || config.ios.bundleIdentifier,
    ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
  },
  android: { ...config.android, package: process.env.STRAIT_EXAMPLE_ANDROID_PACKAGE || config.android.package },
});
