# Sentry setup — WorkLog

Fills the dangling `see docs/` reference in `.env.example`.

## What exists in Sentry

| | |
|---|---|
| Org | `site-superhero` (Developer / free plan) |
| Project | `worklog` — created 2026-08-17, platform `react-native`, team `#site-superhero` |
| Sibling projects | `punchlog`, `daily-jobsight` — **do not** point WorkLog at these |
| Alert rule | default, "high priority issues" |

The project slug `worklog` and org slug `site-superhero` are what the
`@sentry/react-native` config plugin in `app.json` already expects. Renaming
either in Sentry breaks the build-time source-map upload silently.

## DSN

```
https://b910b8bc2a42a9fd8a63d48163d1b443@o4510477741785088.ingest.us.sentry.io/4511924553842688
```

This is a public identifier — it can submit events and nothing else. It is safe
in a shipped bundle. It is scoped out of dev for noise, not for secrecy.

## Auth token

`worklog-eas-sourcemaps`, created in **Settings → Organization Tokens**.

Org tokens now carry exactly one scope, `org:ci` (Source Map Upload, Release
Creation, Code Mappings) — there is nothing to configure. That is precisely what
`sentry-cli` needs at build time and nothing more; it cannot read issues.

Sentry masks the value permanently after creation. If it is lost, revoke and
make a new one — there is no reveal.

## Wiring it into EAS

Two variables, both in the **production** environment. `eas.json` maps the
`production` build profile to `"environment": "production"`, so anything set
there is injected at build time.

```bash
eas env:create --scope project --environment production \
  --name EXPO_PUBLIC_SENTRY_DSN \
  --value "https://b910b8bc2a42a9fd8a63d48163d1b443@o4510477741785088.ingest.us.sentry.io/4511924553842688" \
  --visibility plaintext

eas env:create --scope project --environment production \
  --name SENTRY_AUTH_TOKEN \
  --value "<paste the token>" \
  --visibility secret
```

Verify:

```bash
eas env:list --environment production
```

`SENTRY_AUTH_TOKEN` should read as `*****` — if it prints in the clear, it was
created with the wrong visibility. Delete and recreate it.

### Leave local alone

Do **not** put `EXPO_PUBLIC_SENTRY_DSN` in `.env`. `src/lib/observability.native.ts`
is a no-op without it, which is what dev, jest and the web export all want.
Setting it locally sends your own sync failures into the shared project.

### Preview builds (optional)

The `preview` profile maps to `"environment": "preview"` and inherits
`SENTRY_DISABLE_AUTO_UPLOAD: "true"` from `base`, so it needs no auth token. If
you want crash reports off internal-distribution builds, add the DSN alone:

```bash
eas env:create --scope project --environment preview \
  --name EXPO_PUBLIC_SENTRY_DSN --value "<same DSN>" --visibility plaintext
```

Note this spends the same free-plan error quota as production. On the Developer
plan, preview noise is the usual reason production events get dropped.

The `development` profile has no `environment` key at all, so no EAS variables
reach it. That is deliberate — dev builds stay DSN-less.

## Verifying it actually works

1. `npm run verify` — the observability seam and its scrub layer are both
   covered; `src/platformSplit.test.ts` asserts `@sentry/react-native` stays in
   `NATIVE_ONLY_MODULES`.
2. `npm run check:web` — the web export must still build. `observability.web.ts`
   is inert; if the native module leaks into the web bundle this fails.
3. Build production. Watch the build log for `Uploading source maps` — with
   `SENTRY_DISABLE_AUTO_UPLOAD: "false"` on the production profile it should
   run. A 401 there means the auth token did not reach the build.
4. Confirm the release landed: Sentry → **Releases** should show an entry
   matching the build's version/fingerprint.
5. Trigger a real event from a device build and check it appears deminified in
   Issues. A minified stack trace means source maps uploaded but the release
   name did not match.

## Standing guardrails

- **No production OTA while an App Review is open.** iOS 1.1 was rejected under
  Guideline 5.6 for exactly this. Sentry releases follow the same channel, so a
  mid-review OTA also splits the release history.
- **No user content in report bodies.** `reportSyncIncident` takes primitives,
  not a `Mutation`, on purpose — identifiers and error classes only, never note
  text, photo bytes, or crew names. `observabilityScrub.ts` is the second line
  of defence. Any new reporting call must hold that line.
- **Android breadcrumb gap is known and open.** `enableNetworkBreadcrumbs` and
  `enableAutoBreadcrumbTracking` are inert on Android; sentry-android keeps its
  auto-breadcrumbs. No Supabase URLs are captured there (OkHttp is not
  auto-instrumented), but closing it properly needs `io.sentry.breadcrumbs.*`
  manifest meta-data via a config plugin.
- **Free plan.** Session Replay, Tracing, Profiling and Application Metrics are
  all off. `tracesSampleRate: 0` in the init keeps it that way from the client
  side too.
