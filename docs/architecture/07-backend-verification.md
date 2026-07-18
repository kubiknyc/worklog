# WorkLog — Phase 3 Backend Verification Notes

Produced 2026-07-17 while authoring the Phase 3 migrations/functions into
`jobsight-backend` (files only — nothing was applied to the live database).
Records what was verified against the real repo, and every place the approved
Phase 2 design (`04-data-model.md` + `00-README.md` reconciliations) had to
bend to fit reality.

## Files delivered

| Artifact | Path (under `jobsight-backend/`) |
|---|---|
| Projects geo/timezone columns | `supabase/migrations/20260717000002_worklog_projects_geo.sql` |
| Report core (enum, daily_reports, sections, children, weather, locked guard) | `supabase/migrations/20260717000003_worklog_reports_core.sql` |
| Photos (+ provenance/lifecycle guard, column-scoped grants) | `supabase/migrations/20260717000004_worklog_photos.sql` |
| Audit log, signatures, amendments (+ photo audit trigger) | `supabase/migrations/20260717000005_worklog_amendments_audit.sql` |
| Branding, customization, distribution lists, member prefs, worklog_config | `supabase/migrations/20260717000006_worklog_company_settings.sql` |
| RPCs (create/update_section/submit/lock/sweeper/amend) | `supabase/migrations/20260717000007_worklog_rpcs.sql` |
| Storage buckets + policies (worklog-photos, worklog-pdfs) | `supabase/migrations/20260717000008_worklog_storage.sql` |
| Weather edge function | `supabase/functions/worklog-weather/index.ts` |
| Deletion cascade module | `supabase/functions/delete-account/worklog-cascade.ts` (+ minimal call-site diff in `index.ts`) |
| Demo seed section | appended to `supabase/seed.sql` (inherits the existing gate) |

Migration numbering starts at `20260717000002` because
`20260717000001_hot_path_indexes.sql` already exists for today.

## A. What the real repo actually has (verified)

1. **Helper functions live in the `private` schema, not `public`.**
   `is_member` / `is_super` / `can_see_item` / `shares_project` were moved by
   `20260706000005_private_schema_helpers.sql`; `private.is_company_member` /
   **`private.is_company_admin`** were created by `20260712000001_companies.sql`.
   04 §B.1's "verify whether a company-admin helper already exists" resolves to
   **yes — `private.is_company_admin(uuid)` exists and is reused**; no new
   helper was authored. `20260713000002` grants `authenticated` EXECUTE on all
   five (required for policy evaluation), so new policies can call them.
   Consequences honored throughout: policies call helpers **schema-qualified**
   (`private.is_super(...)`), and every new SECURITY DEFINER function pins
   `set search_path = public, private` (the `next_item_code` /
   `20260706000005` convention) so unqualified calls resolve.

2. **`is_super` is already "widened": company admin ⊇ project super**
   (`20260712000001`). 04 §B's assumption holds — WorkLog needed zero new
   membership helpers, and `lock_report`'s "super or company admin" caller set
   is just `is_super`.

3. **A shared touch-trigger function already exists: `touch_updated_at()`**
   (init migration; EXECUTE revoked from clients by `20260703000001`). Reused
   on every new table — no `set_updated_at()` was created (the deliverable
   anticipated exactly this check).

4. **`advance_status` is the RPC house pattern** (`20260628000001` +
   `20260702000001`): `select … for update`, internal auth re-check because
   SECURITY DEFINER bypasses RLS, idempotent same-state no-op, errcodes
   42501 / P0002 / P0001, `revoke … from public, anon` + explicit
   `grant … to authenticated`, and the `20260703000001` lesson that **every
   CREATE OR REPLACE must re-assert grants in the same migration**. All six
   WorkLog RPCs follow it.

5. **Photos house pattern** (`20260629000001`, `20260630000001`,
   `20260702000003`): purpose-specific policies (never `for all`),
   self-attribution pinned on INSERT, column-level grants for the exact
   columns the client pushes, `deleted_at` soft-delete + touch trigger for the
   `(updated_at, id)` pull cursor, storage policies keyed on
   `split_part(name,'/',1)::uuid` with the INSERT policy cross-validating the
   second path segment (`20260702000001`). All mirrored.

6. **`delete-account` anonymization mechanics** (function `index.ts` +
   `20260706000004`): the model is **anonymize-and-detach** — the `profiles`
   row is **tombstoned in place** (`full_name = 'Deleted user'`,
   `email = deleted-<uid>@punchlist.invalid`, personal fields nulled), the
   `profiles → auth.users` FK was dropped so the profile outlives the auth
   user, authored content **keeps its FKs to the tombstoned profile** (no
   column nulling), memberships (`project_members` + `company_members`) are
   deleted, avatars wiped best-effort, and there is a pre-mutation last-admin
   guard (409). 04 §F's "set created_by to a tombstone" therefore means
   **do nothing to the content columns** — the tombstone is the profile row
   itself. The WorkLog cascade was written to match, not to null columns.

7. **`invite-user` contract**: caller resolved via `auth.getUser()` on the
   request's Authorization header (bare anon key must fail — the
   "ai-describe [R2-15]" pattern); authorization is service-role queries
   against `project_members`/`company_members` (roles `sub`/`super`/`admin`,
   admin invitation is company-admin-only); new users via
   `admin.generateLink(type 'invite')` (profile row from `handle_new_user`),
   existing users get a `magiclink` that is emailed but never returned;
   redirect is the `punchlist://set-password` deep link; delivery through the
   `send-email` function gated on `EMAIL_SHARED_SECRET`, with a manual-share
   `inviteUrl` fallback for new users only. The `worklog-weather` function
   reuses this exact auth/authz/CORS scaffold. (No WorkLog change to
   invite-user was needed — roles and membership are app-agnostic.)

8. **Seed gate**: `seed.sql` refuses to run without
   `set punchlist.allow_demo_seed = 'on'`, and `config.toml` has
   `[db.seed] enabled = false`. The WorkLog demo section is appended **below**
   the gate, so it inherits it; no second gate was added.

9. **Edge function style**: `@ts-nocheck` header, `npm:@supabase/supabase-js@2`,
   allowlisted-origin CORS echo (never `*`), `Deno.serve`, 401 unless the JWT
   resolves to a real user, plain-language 4xx bodies, `console.error` +
   generic 500. Followed verbatim in `worklog-weather` and `worklog-cascade`.

## B. Where the approved design bent to fit reality (each explicit)

1. **`public.is_company_admin` was NOT created** — 04 §B.1's sketch is
   superseded by the existing `private.is_company_admin` (see A.1). Policies
   for `company_branding`/`report_customization` also use
   `private.is_company_member` for SELECT instead of 04's inline
   `company_members` EXISTS — same semantics, one implementation.

2. **`set_updated_at()` was NOT created** — reused `touch_updated_at()` (A.3).

3. **`report_photos` columns**: tag column is **`trade_tag`** (app SQLite
   schema is final; 04 §A.5 wrote `trade`), and **`width`, `height`,
   `exif_datetime_original`** were added — the `add_photo` mutation payload
   (02 §C) pushes all three and 04's sketch omitted them. Provenance guard and
   grants cover them accordingly.

4. **`worklog_reject_if_locked` gained a second, transaction-local bypass**
   (`worklog.allow_locked_write` GUC, settable only inside `amend_report`).
   04 §C's sketch exempted only `service_role`, which would have made the
   trigger reject `amend_report`'s own section rewrites on locked reports
   (the RPC runs with the caller's JWT, not service role). Grants remain the
   primary enforcement; clients cannot set GUCs through PostgREST.

5. **`update_section` rejects only `locked` (P0001), not `submitted`** —
   matching the approved decision's literal wording and 02 §C ("rejected
   server-side once status = 'locked'"): queued section edits drain before
   `submit_report` in `orderForDrain`, but a straggler landing during the
   submitted grace window is the same race the photo cutoff (R6) already
   accepts. Post-submit *user-initiated* corrections are amendments — a UI
   rule, enforced at the app layer.

6. **`daily_report_audit_log.actor_id` is nullable** (04: `not null`) — the
   auto-lock sweeper has no acting user; it logs `actor_id = null` with
   `detail {"auto": true, "grace_hours": N}` rather than a sentinel profile.

7. **`report_weather` bumps `daily_reports.updated_at` via a DB trigger**
   (`report_weather_touch_parent`) — mid-flight correction: the weather row
   has no pull cursor of its own, so every write (RPC override AND edge
   auto-fill) must move the parent report into the pull window. Guaranteed at
   the DB layer, not left to callers.

8. **`create_report` also seeds the 1:1 `report_weather` row**
   (`weather_source = 'none'`) so the edge function and the override path
   always have a row to guard-update; the edge function still upserts
   defensively for pre-existing reports.

9. **No `report_deliveries` table** — confirmed: deliveries stay in the
   section jsonb payload (04 §A.3); 02's passing mention of a deliveries
   child table is superseded.

10. **Relational-section snapshot shape fixed** (04 open item #5): the
    canonical serialization is `payload || {"rows": [...]}` where `rows` is
    produced by `worklog_section_rows()` (`20260717000007`) — the same shape
    the client pushes in `update_section` payloads and the amendment
    before/after snapshots store. Per-section row objects:
    crew `{id,trade,headcount,hours,is_carried_forward}`, equipment
    `{id,name,status,on_site}`, work_performed `{id,trade,area,note}`, delays
    `{id,cause,responsible_party,duration_hours,is_ongoing,note}`, safety
    `{id,obs_type,description,is_incident}`.

11. **`amend_report` p_changes contract fixed**:
    `{"<section>": {"payload": {...}, "is_complete": bool?}}`, sections from
    the 11-kind list (weather included, R3); `amendment_number` is
    RPC-assigned, serialized by the report-row `FOR UPDATE` lock.

12. **pg_cron scheduling is guarded**: `lock_stale_submitted_reports()` is
    plain SQL-callable; the migration schedules an hourly job
    (`worklog-lock-stale-reports`, `17 * * * *`) **only if** the `pg_cron`
    extension is installed, so a bare local replay stays green. Grace window
    read from `worklog_config` key `lock_grace_hours` (default **24**,
    approved) — clearly marked TUNABLE, ops-changeable with a plain UPDATE.

13. **No `report_distribution_queue` outbox table** — 04 §C.2 mentions it
    only inside a comment as the M11 email mechanism; it is out of this
    phase's deliverable list and was deliberately not authored. `submit_report`
    carries the comment pointing at M11.

14. **Deletion cascade specifics** (`worklog-cascade.ts`):
    - Called from `index.ts` between the avatar wipe and the profile
      tombstone (it needs `project_members` intact to compute
      sole-membership — memberships are deleted two steps later). The
      `index.ts` diff is two hunks: one import, one commented call.
    - **Deploy-order safety**: the module probes `daily_reports` and no-ops
      (`{skipped: true}`) on 42P01/PGRST2xx — deploying the extended function
      before the WorkLog migrations cannot break PunchLog's live deletion.
    - Hard-deletes **sole-member draft** reports (children via
      `ON DELETE CASCADE`; `worklog-photos` objects removed by exact
      `storage_path`, `worklog-pdfs` by prefix listing, both best-effort like
      the avatar wipe); deletes the user's `report_member_prefs`.
    - Everything else keeps its FKs to the tombstoned profile (see A.6).
    - **Judgment call, documented**: signatures on submitted/locked reports
      are retained — the signature block is part of the legal daily-report
      record, same philosophy as punch-list content surviving. If product
      wants signature PNGs wiped on deletion, that is a one-line addition to
      the cascade (delete `report_signatures` where `signer_user_id` and the
      parent is not locked — flagged for review, not implemented).

15. **Storage INSERT policy is stricter than 04 §D's sketch**: it also
    requires path segment 2 to be a report of segment-1's project with
    `status IN ('draft','submitted')` — mirroring both the punch-photos
    INSERT tightening (`20260702000001`) and R6's row-side window, so the
    object write window can never outlive the row write window.

## C. Cross-repo test gates this hands to the app track

- **Locked-row rejection** (05-test-architecture gate): exercised via
  `update_section` → P0001 on a locked report, direct `report_photos` UPDATE
  → P0001, storage INSERT → RLS failure once locked.
- **Deletion cascade** (05 gate): seed Sam Keystone (`seed.sql` WorkLog
  section), run `delete-account`, assert: sole-member draft reports gone
  (all 14 tables per 04 §F checklist), submitted/locked reports intact and
  attributed to "Deleted user", `report_member_prefs` empty for the user.
- **Schema parity**: `report_photos` columns are final as
  `trade_tag`/`location_tag`/`caption` + `width`/`height`/
  `exif_datetime_original` + provenance set — the app SQLite schema must
  match column-for-column (mid-flight correction honored).
