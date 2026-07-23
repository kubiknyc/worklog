# WorkLog

Offline-first Expo app for daily construction reports. Local SQLite is the read
path; every write goes through the sync queue in `src/sync/`.

## Sibling repo dependency

The Supabase backend is **a separate clone at `../jobsight-backend`** — not a
subdirectory here, and not optional:

- `npm run gen:server-columns` reads `../jobsight-backend/supabase/migrations`
  and rewrites `src/db/serverColumns.generated.json`. Without the sibling clone
  it fails.
- Local Supabase runs from there (`supabase start`), and `.env.example` expects
  the URL/anon key from that stack's `supabase status`.

## Architecture docs

`docs/architecture/00-README.md` is the index — read it before changing sync,
the data model, or the photo/PDF pipelines. It records which cross-track design
conflicts are settled and which are still open decisions, so check its status
before implementing anything it lists as unresolved.

## Rules that bite

**After any backend schema change, run `npm run gen:server-columns`.** The
snapshot is checked in, and `src/db/schemaParity.test.ts` fails in both
directions when it drifts. Deliberate app-only or server-only columns get
declared in that test's `LOCAL_ONLY` / `SERVER_ONLY` maps — never by loosening
the assertion.

**Adding a native-only dependency requires editing
`src/platformSplit.test.ts`.** Metro resolves static imports regardless of
`Platform.OS` branches, so one static import of a native module from a file in
the web graph breaks `expo export --platform web`. Add the module to
`NATIVE_ONLY_MODULES` and keep its usage in `*.native.ts(x)` files.

**`src/sync/mutationQueue.ts` is pinned at 100% branch/function/line coverage**
in `package.json`. This is deliberate — it is the quality spine of the sync
engine. Add tests to meet it; do not lower the threshold.

**Report tables are SELECT-only to clients.** All lifecycle writes go through
`SECURITY DEFINER` RPCs on the server. Never add a direct client `INSERT`/
`UPDATE` against a report table to work around a missing RPC.

`src/sync/` and most of `src/db/` are pure and IO-free by design — persistence
lives in `store.native.ts`. Keep new policy logic pure so it stays testable
without a device.
