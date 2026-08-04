/**
 * Sentry's Metro wrapper.
 *
 * WorkLog had no Metro config at all, which meant the release bundle shipped
 * minified with no source map uploaded — every frame in Sentry would read as
 * `index.android.bundle:1:284517`. That is technically a crash report and
 * practically useless: the sync incidents this app reports on are exactly the
 * ones you cannot reproduce on a desk.
 *
 * `getSentryExpoConfig` is a drop-in for `getDefaultConfig`. It stamps a debug
 * ID into the bundle and the map so the upload step can pair them, and returns
 * the stock Expo config otherwise. Adding it changes nothing about how the app
 * bundles.
 *
 * Do not swap this back to `getDefaultConfig` without also removing the
 * `@sentry/react-native` plugin options in app.json — the upload would then run
 * against bundles carrying no debug ID and fail the build.
 */
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
