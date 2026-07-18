# WorkLog — Phase 2 Data Model (feeds Phase 3 migrations in `jobsight-backend`)

> Phase 2 deliverable, produced by the database track. Target repo for all SQL: `jobsight-backend/supabase/migrations/`. Everything below is **additive only** — no `ALTER`/`DROP` on anything PunchLog reads, per FABLE5 §4.2 rule 1. The one place an *existing* table is touched is additive nullable columns on `projects` (§A.0) — zero-risk to PunchLog reads since PunchLog never selects those columns. `ASSUMPTION:` markers flag anything not explicitly resolved in the PRD/spec. All SQL here is sketch-level design; full migrations are Phase 3 deliverables.

---

## A. Table designs

### A.0 Additive columns on the existing `projects` table (PRD §15 #9, #11)

Required because `report_date` (project-local day boundary) and weather/photo-guard geolocation both need data `projects` doesn't have today.

```sql
alter table public.projects
  add column if not exists timezone text,               -- IANA name, e.g. 'America/New_York'; null = fall back to device TZ
  add column if not exists lat numeric(9,6),
  add column if not exists lng numeric(9,6),
  add column if not exists geocode_source text,          -- 'manual_pin' | 'geocoded_address' | null
  add column if not exists geocoded_at timestamptz;
```

All nullable — every WorkLog feature that depends on them (weather auto-fetch, wrong-project photo guard) degrades gracefully to a no-op when null, exactly as the PRD requires. PunchLog's `projects` queries (which never reference these columns) are unaffected.

### A.1 `daily_reports` — the natural-key root

```sql
create type public.report_status as enum ('draft', 'submitted', 'locked');

create table public.daily_reports (
  id           uuid primary key,                 -- CLIENT-GENERATED on create; see A.9
  project_id   uuid not null references public.projects(id),
  report_date  date not null,                     -- computed in project-local TZ (§15 #9)
  status       report_status not null default 'draft',
  has_incident boolean not null default false,     -- denormalized from safety section, trigger-maintained (History filter)
  has_delay    boolean not null default false,     -- denormalized from report_delays, trigger-maintained (History filter)
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  locked_by    uuid references public.profiles(id),
  locked_at    timestamptz,
  updated_at   timestamptz not null default now(),
  constraint daily_reports_project_date_unique unique (project_id, report_date)
);

create index daily_reports_pull_cursor on public.daily_reports (updated_at, id);
create index daily_reports_project_status on public.daily_reports (project_id, status);
create index daily_reports_incident_partial on public.daily_reports (project_id, report_date) where has_incident;
create index daily_reports_delay_partial on public.daily_reports (project_id, report_date) where has_delay;

create trigger daily_reports_set_updated_at
  before update on public.daily_reports
  for each row execute function public.set_updated_at();
```

- `updated_at` maintained by a single shared `set_updated_at()` trigger function reused on every new table (`new.updated_at = now(); return new;`) — write it once in the first WorkLog migration.
- `daily_reports_project_date_unique` is *the* natural key. It is also the source of the one real sync strain (§C.1).
- `has_incident`/`has_delay` are denormalized booleans, not jsonb scans, because the History screen filters on them across potentially 1000+ rows per project (PRD §11 item 8 performance budget) — a partial index on a boolean beats a `jsonb @>` scan at that volume, and the filterable-list query never has to touch `report_sections` at all.

### A.2 `report_sections` — the sync/concurrency unit for the 10 non-weather sections

**Design argument:** the PRD's own reconciliation (spec §11 item 7) settles this: the report is *not* one big row and *not* eleven independent LWW rows — it is **one LWW row per section**, because:
- **Sync granularity:** a superintendent edits Crew, then Work Performed, then Notes across a day. If the whole report were one row, three edits queue three mutations that all overwrite the same `updated_at`, and the *last* queued write's LWW timestamp silently clobbers the other two sections if they raced with a pull. Per-section rows mean each section's mutation is independently conflict-checked.
- **LWW by server `updated_at`:** each `report_sections` row carries its own `updated_at`; `update_section` mutations are judged against *that row's* timestamp, not the report's. This is what makes "non-status fields are LWW by server updated_at" (spec §4.3 invariant 8) actually meaningful instead of report-wide and coarse.
- **Report customization:** admins toggle sections on/off and mark fields required per company (`report_customization`, A.7). A per-section row is the natural place to check "is this section enabled/required for this company" at write time.

```sql
create table public.report_sections (
  report_id     uuid not null references public.daily_reports(id),
  section       text not null check (section in (
                   'crew','work_performed','deliveries','equipment','inspections',
                   'safety','delays','visitors','rfis','general_notes'
                 )),                              -- weather excluded — own table, A.4
  payload       jsonb not null default '{}'::jsonb, -- authoritative for non-relational sections; for
                                                     -- relational sections holds the last-pushed array too,
                                                     -- so a replay/debug doesn't require reassembling child rows.
  is_complete   boolean not null default false,     -- "None today" affirmation state (safety) / skip state
  updated_at    timestamptz not null default now(),
  updated_by    uuid not null references public.profiles(id),
  primary key (report_id, section)
);

create index report_sections_pull_cursor on public.report_sections (updated_at, report_id, section);
```

Uses a composite PK `(report_id, section)` rather than a client uuid — no collision risk here (unlike `daily_reports`) because the tuple itself is the natural key and `update_section` is naturally upsert-shaped. *(Note: the modules track mints a client-side `sectionId` uuid PK instead — see `00-README.md` Reconciliation R2 for the open key-shape decision.)*

### A.3 Relational child tables — crew / equipment / delays / work performed / safety

Bound by PRD §11 item 6: rollups need these as relational rows, not jsonb, both in SQLite locally *and* in Postgres for parity. Exploded transactionally by `update_section` (delete-and-insert per section update — no independent `updated_at` on children; they inherit consistency from the parent `report_sections` row).

```sql
create table public.report_crew (
  id                  uuid primary key,
  report_id           uuid not null references public.daily_reports(id),
  trade               text not null,
  headcount           integer not null check (headcount >= 0),
  hours                numeric(4,1) not null check (hours >= 0),
  is_carried_forward  boolean not null default false
);
create index report_crew_report_id on public.report_crew (report_id);
create index report_crew_rollup on public.report_crew (report_id, trade);

create table public.report_equipment (
  id          uuid primary key,
  report_id   uuid not null references public.daily_reports(id),
  name        text not null,
  status      text not null check (status in ('active', 'idle')),
  on_site     boolean not null default true
);
create index report_equipment_report_id on public.report_equipment (report_id);

create table public.report_work_performed (
  id          uuid primary key,
  report_id   uuid not null references public.daily_reports(id),
  trade       text not null,
  area        text not null,
  note        text not null
);
create index report_work_performed_report_id on public.report_work_performed (report_id);
create index report_work_performed_rollup on public.report_work_performed (report_id, trade, area);

create table public.report_delays (
  id                   uuid primary key,
  report_id            uuid not null references public.daily_reports(id),
  cause                text not null,
  responsible_party    text,
  duration_hours       numeric(5,1),
  is_ongoing           boolean not null default false,
  note                 text
);
create index report_delays_report_id on public.report_delays (report_id);

create table public.report_safety_observations (
  id           uuid primary key,
  report_id    uuid not null references public.daily_reports(id),
  obs_type     text not null check (obs_type in ('near_miss','first_aid','recordable','observation')),
  description  text,
  is_incident  boolean not null default false
);
create index report_safety_observations_report_id on public.report_safety_observations (report_id);
```

Deliveries, inspections, visitors, RFIs stay inside `report_sections.payload` jsonb (no PRD-mandated filter/rollup need) — `ASSUMPTION:` if a future "has-delivery" filter appears, promote them the same way, additively.

Child-table maintenance trigger: on any `report_sections` update to `section='delays'`, a trigger recomputes `daily_reports.has_delay`; on `section='safety'`, recomputes `has_incident` from `report_safety_observations`. This runs inside the same `update_section` RPC transaction, not as a separate async job.

### A.4 `report_weather` — snapshot + manual override, both kept

```sql
create table public.report_weather (
  report_id         uuid primary key references public.daily_reports(id),
  weather_source    text not null default 'none' check (weather_source in ('none','auto','manual')),
  auto_condition    text,
  auto_temp_f       numeric(4,1),
  auto_fetched_at   timestamptz,
  auto_raw_response jsonb,                 -- raw Open-Meteo payload, for audit/debug
  override_condition text,
  override_temp_f    numeric(4,1),
  override_at        timestamptz,
  override_by        uuid references public.profiles(id),
  updated_at         timestamptz not null default now()
);
```

1:1 with `daily_reports`, rides along in the same pull response as the report row (join, not a separate cursor scope) — no independent keyset needed. The fill-on-sync edge function only ever writes `auto_*` columns and only `where weather_source in ('none','auto')` — it can never race a manual override (spec §4.2, §15 #5).

### A.5 `report_photos` — provenance-first

```sql
create table public.report_photos (
  id             uuid primary key,               -- client UUID = final server id = storage filename stem
  report_id      uuid not null references public.daily_reports(id),
  project_id     uuid not null references public.projects(id),  -- denormalized: storage RLS + query without a join
  storage_path   text not null unique,            -- '<projectId>/<reportId>/<photoId>.jpg'
  trade          text,
  location_tag   text,
  caption        text,
  source         text not null check (source in ('camera','library')),
  captured_at    timestamptz,                     -- device clock at shutter / EXIF DateTimeOriginal for library
  added_at       timestamptz not null default now(), -- distinguishes "taken" vs "added" (PRD assumption 8)
  gps_lat        numeric(9,6),
  gps_lng        numeric(9,6),
  gps_accuracy   numeric(6,1),                    -- meters; null = location denied, PDF prints "location not recorded"
  created_by     uuid not null references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),  -- tag/caption edits bump this
  deleted_at     timestamptz                      -- soft delete for remove_photo (draft-only, see §D)
);

create index report_photos_report_id on public.report_photos (report_id);
create index report_photos_project_id on public.report_photos (project_id);
create index report_photos_pull_cursor on public.report_photos (updated_at, id);

create trigger report_photos_set_updated_at
  before update on public.report_photos
  for each row execute function public.set_updated_at();
```

`gps_lat`/`gps_lng`/`gps_accuracy` are captured client-side at shutter time via `expo-location`, **not** from EXIF (PRD §11 item 2). Nullable throughout — a denied-location photo is still a valid photo.

### A.6 Amendments & audit trail

Two separate concerns, two tables: the **lifecycle audit log** (every RPC-driven state change, who/when/what) and the **content-correction trail** (amendments specifically, with full before/after snapshots).

```sql
create table public.daily_report_audit_log (
  id          bigint generated always as identity primary key,  -- append-only log; no client idempotency needed
  report_id   uuid not null references public.daily_reports(id),
  event       text not null check (event in (
                'created','submitted','locked','amended','photo_added','photo_removed'
              )),
  actor_id    uuid not null references public.profiles(id),
  occurred_at timestamptz not null default now(),
  detail      jsonb not null default '{}'::jsonb
);
create index daily_report_audit_log_report_id on public.daily_report_audit_log (report_id, occurred_at);
```

```sql
create table public.report_amendments (
  id                uuid primary key,              -- client UUID — idempotency key for the amend_report RPC
  report_id         uuid not null references public.daily_reports(id),
  amendment_number  integer not null,               -- assigned by the RPC, sequential per report
  reason            text not null,
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  signature_id      uuid references public.report_signatures(id),
  constraint report_amendments_number_unique unique (report_id, amendment_number)
);

create table public.report_amendment_changes (
  id             uuid primary key,
  amendment_id   uuid not null references public.report_amendments(id),
  section        text not null,
  before_payload jsonb not null,   -- explicit snapshot — required because the child tables (report_crew etc.)
  after_payload  jsonb not null    -- get overwritten by delete-and-insert; without this, "original preserved"
);                                 -- would be lost the moment amend_report runs
create index report_amendment_changes_amendment_id on public.report_amendment_changes (amendment_id);
create index report_amendments_pull_cursor on public.report_amendments (created_at, id); -- append-only
```

`report_amendment_changes.before_payload`/`after_payload` snapshot the *full section content* (including, for relational sections, a serialized array of the child rows as they stood) at amendment time — this is the mechanism that satisfies "original preserved" even though child tables are mutated in place by delete-and-insert inside `amend_report`.

`ASSUMPTION:` per PRD §15 #10, amendments are atomic — one `amend_report` call, one header row, locked on save; a further correction is a further amendment (never edits a prior amendment row).

### A.7 Company branding & report customization

```sql
create table public.company_branding (
  company_id    uuid primary key references public.companies(id),
  logo_storage_path text,
  primary_color     text,
  secondary_color   text,
  header_text       text,
  footer_text       text,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id)
);

create table public.report_customization (
  company_id       uuid primary key references public.companies(id),
  required_fields  jsonb not null default '{}'::jsonb,  -- { "safety": ["description"], "delays": ["responsible_party"] }
  section_toggles  jsonb not null default '{}'::jsonb,  -- { "visitors": false } — disabled sections
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id)
);

create table public.report_distribution_lists (
  id          uuid primary key,
  project_id  uuid not null references public.projects(id),  -- ASSUMPTION: project-scoped, not company-scoped —
                                                                -- recipients (owner, architect) are typically
                                                                -- per-project; flag if product intent differs
  email       text not null,
  label       text,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index report_distribution_lists_project_id on public.report_distribution_lists (project_id);
```

`report_customization` is a **company**-level singleton. `report_distribution_lists` is **project**-scoped — `ASSUMPTION:` flagged; confirm product intent before Phase 3 migration authoring; either way additive.

### A.8 `report_signatures`

```sql
create table public.report_signatures (
  id            uuid primary key,
  report_id     uuid not null references public.daily_reports(id),
  kind          text not null check (kind in ('submit','amendment')),
  signer_user_id uuid not null references public.profiles(id),
  signer_name   text not null,
  signer_title  text,                     -- PM/super display title (report_member_prefs, A.10)
  png_bytes     bytea not null,
  signed_at     timestamptz not null default now()
);
create index report_signatures_report_id on public.report_signatures (report_id);
```

**Storage choice — `bytea` column, not a storage-bucket object** (resolves PRD §15 #13). Signatures are small (~5–20 KB PNG), must be persisted atomically with `submit_report`/`amend_report` in the same transaction (a storage upload is a separate HTTP call outside the SQL transaction — a crash between the two would leave a submitted report with no signature), and are never served publicly (only read server-side by the PDF renderers). If signature volume ever becomes a bloat concern, migrating to a storage object is a later additive change.

### A.9 Why `uuid` client-generated PKs, not `bigint`

Every new table's PK is a **client-generated uuid**: the sync engine's core invariant is "client UUID = final server id" (spec §4.3 invariant 1) — this is what makes push retries idempotent and lets photos know their full storage path before reaching the server. `bigint identity` PKs are incompatible with offline-first client-side row creation. Recommend **UUIDv7** (time-ordered) rather than v4 for better btree index locality on insert-heavy tables — `ASSUMPTION:` confirm the RN UUID library used by PunchLog; if it's v4, this is a Should-tier, non-blocking optimization.

`daily_report_audit_log.id` is the one exception — `bigint generated always as identity` — a pure append-only server-side log with no client-side idempotency requirement (always inserted by an RPC as a side effect).

### A.10 `report_member_prefs` — PM/superintendent display title

```sql
create table public.report_member_prefs (
  project_id  uuid not null references public.projects(id),
  user_id     uuid not null references public.profiles(id),
  title       text,   -- e.g. 'Project Manager', 'Superintendent' — display only, not an authorization boundary
  primary key (project_id, user_id)
);
```

Per PRD §10 — the WorkLog-side artifact of the PM-role decision (§B): PM has no DB authorization distinction from `super`, only a display label that prints in the PDF signature block.

### Keyset pull cursors — summary

| Table | Cursor index | Scope key example |
|---|---|---|
| `daily_reports` | `(updated_at, id)` | `reports:<projectId>` |
| `report_sections` | `(updated_at, report_id, section)` | `report_sections:<projectId>` |
| `report_photos` | `(updated_at, id)` | `report_photos_v1:<projectId>` |
| `report_amendments` | `(created_at, id)` (append-only) | `report_amendments:<projectId>` |

Child tables and `report_weather` are **not** independently cursor-paginated — they ride along with their parent pull: when the client pulls a changed section row past the cursor, the pull handler also fetches the current full child-row set for that `report_id` (a plain indexed lookup, no pagination needed) and replaces it locally in the same SQLite transaction.

---

## B. RLS design

### B.1 Helper functions — replicate the existing pattern exactly

No new helper functions are needed for the project-membership boundary — `is_member`/`is_super` already exist and are already "widened" so company admins pass `is_super` on every company project (spec §4.2). WorkLog's report tables reuse them unchanged.

One new helper is needed for company-scoped settings tables:

```sql
-- ASSUMPTION: a company-admin helper does not yet exist under this exact name in the live schema;
-- verify against jobsight-backend before authoring the real migration — if an equivalent helper
-- exists, reuse it instead.
create or replace function public.is_company_admin(c uuid) returns boolean
  language sql security definer stable set search_path = public as $FN$
  select exists (select 1 from public.company_members
                 where company_id = c and user_id = auth.uid() and role = 'admin');
$FN$;

revoke execute on function public.is_company_admin(uuid) from anon, authenticated;
```

### B.2 PM-role mapping — recommendation

**Recommend Option A: PM maps onto the existing `project_members.role = 'super'`.** No `alter type project_role add value 'pm'`.

Tradeoff, stated explicitly:
- **Option A (recommended):** zero migration, zero risk to PunchLog's `is_super` semantics, zero RLS-policy rewrite. Cost: PM and superintendent get *identical* write authority at the DB layer — no server-enforced distinction until a real requirement appears. That gap is explicitly deferred, not silently lost.
- **Option B (declined):** `alter type project_role add value 'pm'` forces auditing every existing RLS helper/policy that branches on `role` on a **shared production database mid-PunchLog-store-submission**. Enum additions are additive in the strict SQL sense, but the *behavioral* blast radius is high for zero current benefit.
- **Trigger to revisit:** the first concrete PM-only permission rule (e.g. PM can `lock_report` but not `submit_report`). At that point, do a deliberate, audited split.

The distinction that *is* real (PM vs superintendent as a title) lives entirely in `report_member_prefs.title` (A.10) — display-only, never read by any RLS policy.

### B.3 Representative RLS policy set — `daily_reports`

The pattern every new WorkLog table follows: enable RLS, gate SELECT on `is_super` (not `is_member` — subs get no report access at all, per PRD §10), and **deny direct client writes entirely** — all mutation goes through SECURITY DEFINER RPCs (justified in §C).

```sql
alter table public.daily_reports enable row level security;

create policy daily_reports_select on public.daily_reports
  for select using (is_super(project_id));

-- No insert/update/delete policies for `authenticated` on this table.
-- Writes happen exclusively inside SECURITY DEFINER RPCs (create_report, submit_report,
-- lock_report, amend_report), which perform their own is_super(project_id) check
-- internally before writing (§C).

revoke insert, update, delete on public.daily_reports from authenticated;
grant select on public.daily_reports to authenticated;
```

The same shape applies to `report_sections`, child tables, `report_weather`, `report_amendments`, `report_amendment_changes`, `daily_report_audit_log` (SELECT-only, pure audit log), and `report_signatures` (SELECT gated on `is_super`, no client writes — only the RPCs insert).

`report_photos` differs: photo rows are inserted directly by the client (not via an RPC — see §D), so it gets a real INSERT policy:

```sql
alter table public.report_photos enable row level security;

create policy report_photos_select on public.report_photos
  for select using (is_super(project_id));

create policy report_photos_insert on public.report_photos
  for insert with check (is_super(project_id));

-- Tag/caption edits only, never provenance columns — enforced by a trigger, not RLS
-- (RLS restricts rows, not columns; a BEFORE UPDATE trigger rejects any attempt to
-- change captured_at/gps_*/storage_path/source/created_by).
create policy report_photos_update on public.report_photos
  for update using (is_super(project_id)) with check (is_super(project_id));

revoke delete on public.report_photos from authenticated;   -- remove_photo is soft-delete (deleted_at)
```

*(Note: whether clients get this UPDATE policy at all depends on the photo-tag-edit decision — see `00-README.md` Reconciliation R1.)*

`company_branding`/`report_customization` use `is_company_admin` for write, company membership for read:

```sql
alter table public.report_customization enable row level security;

create policy report_customization_select on public.report_customization
  for select using (exists (
    select 1 from public.company_members
    where company_id = report_customization.company_id and user_id = auth.uid()
  ));

create policy report_customization_write on public.report_customization
  for all using (is_company_admin(company_id)) with check (is_company_admin(company_id));
```

---

## C. Lifecycle RPCs

**Writes are RPC-only, not trigger-mediated, as the primary enforcement mechanism** — chosen over "allow direct UPDATE + trigger rejects illegal transitions" because:
1. `create_report`'s get-or-create semantics (return the existing row's id on a natural-key collision) cannot be expressed as a trigger reaction to a client INSERT.
2. Legal-transition enforcement needs to *read* current status, decide, and write atomically — a `plpgsql` function with `select ... for update` does this cleanly.
3. Every RPC also writes an audit-log row in the same transaction — natural inside a function.

A narrow **defense-in-depth trigger** is still added on `report_sections`/child tables to reject any UPDATE when the parent report is `locked`, as a backstop against a future grants misconfiguration:

```sql
create or replace function public.reject_edit_if_locked() returns trigger
  language plpgsql security definer set search_path = public as $FN$
declare
  v_status public.report_status;
begin
  select status into v_status from public.daily_reports where id = coalesce(new.report_id, old.report_id);
  if v_status = 'locked' and auth.role() <> 'service_role' then
    raise exception 'report % is locked', coalesce(new.report_id, old.report_id) using errcode = 'P0001';
  end if;
  return new;
end;
$FN$;
```

The `auth.role() <> 'service_role'` escape hatch is the explicit, narrow bypass the `delete-account` anonymization path needs (PRD §15 #16) — the edge function runs with the service-role key, so it is the *only* caller that can touch a locked row, and only for the anonymization write (nulling author-identifying fields), never for content.

**Enforcement stated explicitly: grants, not the trigger, are what stop the client; the trigger is pure defense-in-depth.** The RPCs are the only paths with effective write access.

### C.1 `create_report` — get-or-create, idempotent on the natural key

```sql
create or replace function public.create_report(
  p_project_id uuid,
  p_report_date date,
  p_client_id uuid
) returns table (report_id uuid, was_created boolean)
language plpgsql security definer set search_path = public as $FN$
declare
  v_existing_id uuid;
begin
  if not is_super(p_project_id) then
    raise exception 'not authorized on project %', p_project_id using errcode = '42501';
  end if;

  -- Idempotent on p_client_id: a retry of a prior successful call just returns it.
  select id into v_existing_id from public.daily_reports where id = p_client_id;
  if v_existing_id is not null then
    return query select v_existing_id, false;
    return;
  end if;

  begin
    insert into public.daily_reports (id, project_id, report_date, status, created_by)
    values (p_client_id, p_project_id, p_report_date, 'draft', auth.uid());

    insert into public.daily_report_audit_log (report_id, event, actor_id, detail)
    values (p_client_id, 'created', auth.uid(), jsonb_build_object('report_date', p_report_date));

    return query select p_client_id, true;
  exception when unique_violation then
    -- (project_id, report_date) collision: a report for this project/day already exists
    -- under a *different* id. Return the existing id; the client re-parents any local
    -- sections/photos queued under p_client_id onto it.
    select id into v_existing_id
    from public.daily_reports
    where project_id = p_project_id and report_date = p_report_date;

    return query select v_existing_id, false;
  end;
end;
$FN$;

revoke execute on function public.create_report(uuid, date, uuid) from anon;
grant execute on function public.create_report(uuid, date, uuid) to authenticated;
```

This is the RPC that "dissolves the collision at push time" per PRD §11 item 7 — the client always gets *a* valid report id back, and every downstream mutation targets that returned id, so nothing FK-fails against a never-landed report.

### C.2 `submit_report` / `lock_report` / `amend_report`

```sql
-- submit_report: draft -> submitted. Persists the signature atomically (A.8), writes audit row.
create or replace function public.submit_report(
  p_report_id uuid,
  p_signer_title text,
  p_signature_png bytea
) returns void
language plpgsql security definer set search_path = public as $FN$
declare
  v_project_id uuid;
  v_status public.report_status;
begin
  select project_id, status into v_project_id, v_status
  from public.daily_reports where id = p_report_id for update;

  if v_project_id is null then
    raise exception 'report % not found' using errcode = 'P0002';
  end if;
  if not is_super(v_project_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'report % is % — only draft reports can be submitted', p_report_id, v_status
      using errcode = 'P0001';
  end if;

  update public.daily_reports
    set status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
    where id = p_report_id;

  insert into public.report_signatures (id, report_id, kind, signer_user_id, signer_name, signer_title, png_bytes)
  select gen_random_uuid(), p_report_id, 'submit', auth.uid(), full_name, p_signer_title, p_signature_png
  from public.profiles where id = auth.uid();

  insert into public.daily_report_audit_log (report_id, event, actor_id)
  values (p_report_id, 'submitted', auth.uid());
  -- Distribution email + PDF render happen out-of-band: a trigger on this UPDATE inserts a row
  -- into a report_distribution_queue (outbox pattern), processed by a scheduled worker calling
  -- send-email — kept OUT of this transaction deliberately (no external HTTP inside a transaction).
end;
$FN$;
```

- **`lock_report(p_report_id uuid)`** — `submitted → locked`. Callable by `is_super` or `is_company_admin`. `ASSUMPTION:` per PRD §15 #2 the grace-window/auto-lock timing is unresolved product policy — this design supports both an explicit `lock_report` call *and* a scheduled `lock_stale_submitted_reports()` internal function (pg_cron) calling the same core logic once a configurable grace window elapses past `submitted_at`.
- **`amend_report(p_report_id uuid, p_amendment_client_id uuid, p_reason text, p_changes jsonb)`** — allowed when `status in ('submitted', 'locked')` (PRD assumption #24). Idempotent on `p_amendment_client_id` (returns early if the id exists). Body snapshots each changed section's current state (including serialized child rows) into `before_payload`, applies the new payload (upserting `report_sections` + re-exploding child tables), writes `after_payload`, assigns `amendment_number`, inserts the header row, writes the `amended` audit-log row.

### C.3 Idempotency for sync retries

Every RPC's write path is idempotent on a client-supplied UUID (`create_report`'s `p_client_id`, `amend_report`'s `p_amendment_client_id`) or naturally idempotent by status-check (`submit_report`/`lock_report` re-invoked on an already-transitioned report raise `P0001` → classified `permanent` and parked — correct: a retry of an already-successful submit should never double-submit, and no data is lost since the report *is* submitted).

---

## D. Storage — `worklog-photos`

Path shape: `<projectId>/<reportId>/<photoId>.jpg`, mirroring PunchLog's `punch-photos` `split_part` pattern exactly.

```sql
insert into storage.buckets (id, name, public) values ('worklog-photos', 'worklog-photos', false)
  on conflict (id) do nothing;

create policy worklog_photos_select on storage.objects
  for select using (
    bucket_id = 'worklog-photos'
    and is_super(split_part(name, '/', 1)::uuid)
  );

create policy worklog_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'worklog-photos'
    and is_super(split_part(name, '/', 1)::uuid)
  );

-- Deliberately NO update policy: with upsert unavailable, a 409 "Duplicate" on the client-UUID
-- path can only mean a previous attempt's bytes already landed — the client treats 409 as success.

create policy worklog_photos_delete on storage.objects
  for delete using (
    bucket_id = 'worklog-photos'
    and is_super(split_part(name, '/', 1)::uuid)
    and exists (
      select 1 from public.daily_reports r
      where r.id = split_part(name, '/', 2)::uuid
        and r.status = 'draft'
    )
  );
```

The DELETE policy is the "owner-scoped, draft-window only" grant `remove_photo` needs — deletion is only possible while the parent report is still `draft`; once submitted, a photo can only be superseded via an amendment, never removed. The row itself is soft-deleted (`deleted_at`) so other devices pull the tombstone.

A second private bucket **`worklog-pdfs`** (server-rendered PDF cache, written only by the `render-report-pdf` edge function) uses the same path-encoding SELECT pattern; clients never insert into it. See `03-photo-voice-pdf.md` §C.5.

---

## E. Weather edge function

New function: `jobsight-backend/supabase/functions/weather-fetch/` (working name; final name aligned in Phase 3).

**Contract:**
- **Input:** `{ project_id: uuid, report_date: date }` (POST, authenticated caller — verifies `is_super(project_id)` first).
- **Preconditions:** looks up `projects.lat`/`lng` (A.0). If null, returns `{ status: 'no_geolocation' }` — no fetch attempted, no error (the "degrades gracefully" contract from PRD §15 #11).
- **Call:** Open-Meteo forecast/archive endpoint by `lat`/`lng` for `report_date` — keyless, no secret to manage.
- **Output written to `report_weather`:** only `where weather_source in ('none', 'auto')` — never overwrites a `manual` override — sets `auto_condition`, `auto_temp_f`, `auto_fetched_at = now()`, `auto_raw_response`, and flips `weather_source` to `'auto'` only if it was `'none'`.
- **Fill-on-sync for offline mornings:** invoked (a) synchronously right after `create_report` succeeds while online, and (b) as a retry sweep — a scheduled job (pg_cron + pg_net, or a lightweight call from the client on next successful pull) that finds rows with `weather_source = 'none'` for reports created in the last N days and retries. Weather fetch is explicitly **not** a sync mutation kind.
- **Idempotency:** safe to call repeatedly — always a no-op once `weather_source = 'manual'`; a plain refresh once `'auto'`.

`ASSUMPTION:` geocoding `projects.lat`/`lng` from `projects.address` (Open-Meteo keyless geocoding endpoint, per PRD §15 #11) is a second small function or an inline call inside the project-create path — noted as the population mechanism for the columns this function depends on.

---

## F. Account deletion extension

The existing `delete-account` edge function must be extended — behind a WorkLog-scoped code path that leaves PunchLog's existing path untouched (PRD §13 risk #13) — to cover, per the **two-tier policy in PRD §12.1**:

**Tier 1 — "Delete my WorkLog data" (scoped, courtesy):**
- Hard-delete: `daily_reports` (and cascading section/child/photo/weather rows) still `status = 'draft'` **and** where the user is the sole project member.
- For everything else the user authored inside multi-member projects: **anonymize, not delete** — set `created_by`/`updated_by`/`submitted_by`/`locked_by`/`report_photos.created_by` to a tombstone (mirror whatever PunchLog's existing function does; `ASSUMPTION:` **verify against the live `delete-account` implementation before authoring** — do not invent a divergent policy), and null personal display fields.
- Never touches locked reports' content — only author-identifying columns, via the service-role bypass in §C.

**Tier 2 — "Delete my account" (full JobSight deletion, store-compliance flow):**
- Runs Tier 1's logic against **every** WorkLog table, then proceeds to the existing full `auth.users` deletion.
- Additionally deletes/anonymizes `report_member_prefs` rows for the user. `ASSUMPTION:` amendment snapshots' text content is the legal record's content, not the user's personal data — `created_by` anonymization suffices.
- Storage: removes the user's objects under `worklog-photos/*` where the corresponding row is hard-deleted (draft, sole-member case); anonymized rows keep their storage object (the project's photo — only attribution is nulled).

**Verification requirement (PRD §12.1 AC):** a seeded-account test proves the extended function cascades every WorkLog table + the storage path. Checklist of tables: `daily_reports`, `report_sections`, `report_crew`, `report_equipment`, `report_delays`, `report_work_performed`, `report_safety_observations`, `report_weather`, `report_photos` (+ storage), `report_signatures`, `report_amendments`, `report_amendment_changes`, `daily_report_audit_log`, `report_member_prefs`.

---

## Open items carried forward to Phase 3 migration authoring

1. Verify whether a company-admin RLS helper already exists under a different name (B.1) before adding `is_company_admin`.
2. Confirm `report_distribution_lists` is project-scoped vs company-scoped (A.7).
3. Grace-window/auto-lock timing for `lock_report` (C.2) — needs a number before the pg_cron job is written.
4. Confirm PunchLog's actual `delete-account` anonymization mechanics (tombstone profile vs nulled fields) before writing the WorkLog extension (§F).
5. `report_amendment_changes` snapshot format for relational sections needs an exact jsonb shape spec — finalize alongside the PDF amendment-appendix renderer (PRD §15 #15).
6. `report_sections` key shape (composite PK vs client-minted uuid) — see `00-README.md` Reconciliation R2.
