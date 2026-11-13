-- WorkLog QA seed — LOCAL Supabase stack only.
--
-- Run through qa/seed/seed-local.mjs, which pipes this file into the local
-- Postgres container (`docker exec … psql`) and passes :qa_password and
-- :sig_hex (qa/seed/assets/signature.png as hex, set on stdin). It never connects to a
-- hosted project.
--
-- Re-runnable: wipes every row owned by the qa-wl-*@worklog.test accounts and
-- the fixed 0b000000-… ids below, then rebuilds them. PunchLog's QA seed
-- (qa-*@punchlog.test, ids 0a000000-…) shares this database and is never
-- touched: the wipe refuses to run if its target set contains a 0a id or a
-- non-@worklog.test account, and the end of the file fails if the number of
-- 0a rows changed.
--
-- Accounts (password from seed-local.mjs, ids 0b000000-0000-4000-8000-0000000000NN):
--   01 qa-wl-admin    company admin, QA-WL Granite Builders (A); creator → super on Riverside + Depot
--   02 qa-wl-super    company member (A); super on Riverside; title 'Superintendent'
--   03 qa-wl-pm       company member (A); super on Riverside + Depot; title 'Project Manager'
--   04 qa-wl-sub      no company; sub on Riverside — must see ZERO reports
--   05 qa-wl-b-admin  company admin, QA-WL Harbor Works (B); creator → super on Pier 9 (cross-tenant)
--   06 qa-wl-member   company member (A); no projects
--   07 qa-wl-new      brand-new user: no company, no projects
--   08 qa-wl-solo     no company; creator of the company-less Solo Garage (one locked + signed report)
--   10 qa-wl-owner    no company; project OWNER on Riverside (PunchLog Client/Owner) — must see ZERO reports (PRD §10)
--   11 qa-wl-architect no company; project OWNER on Riverside (PunchLog Design Team) — must see ZERO reports
--   09 qa-wl-soloco   sole admin AND sole member of QA-WL Solo Co (C); one project with a locked report
--                     (the PR #44 "deleting your account deletes the company" warning)
--
-- Deletion cases: qa-wl-admin is the only admin of A, which has other members,
-- so delete-account must REFUSE (last_admin). qa-wl-solo / qa-wl-soloco are the
-- warning cases: their projects and locked reports are deleted with them.
--
-- Report lifecycle is driven through the REAL SECURITY DEFINER RPCs as the
-- seeded user (create_report → update_section → report_photos insert →
-- submit_report → lock_report → amend_report), never raw inserts: report
-- tables are SELECT-only to clients and that is what this seed exercises.

\set ON_ERROR_STOP on

-- ── preflight: the grants the app (and this seed) depend on ─────────────────
do $$
declare
  t text;
  f text;
begin
  foreach f in array array[
    'public.create_report(uuid,date,uuid)',
    'public.update_section(uuid,text,jsonb,boolean)',
    'public.submit_report(uuid,text,bytea)',
    'public.lock_report(uuid)',
    'public.amend_report(uuid,uuid,text,jsonb,text,bytea)',
    'private.is_super(uuid)'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'authenticated lacks EXECUTE on %', f
        using hint = 'Replay the backend migrations: supabase db reset --local (20261109000001_explicit_role_grants).';
    end if;
  end loop;
  foreach t in array array[
    'daily_reports','report_sections','report_crew','report_equipment','report_work_performed',
    'report_delays','report_safety_observations','report_weather','report_photos',
    'report_signatures','report_amendments','report_amendment_changes',
    'daily_report_audit_log','report_member_prefs','projects','company_members'] loop
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception 'authenticated lacks SELECT on public.%', t;
    end if;
  end loop;
  -- Immutability is enforced by grants: no direct client writes on report tables.
  foreach t in array array['daily_reports','report_sections','report_signatures','report_amendments'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE') then
      raise exception 'authenticated can write public.% directly — report tables must be SELECT-only', t;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.report_photos', 'gps_lat', 'INSERT') then
    raise exception 'authenticated lacks the report_photos column INSERT grant';
  end if;
end $$;

-- ── PunchLog QA canary: count 0a rows now, compare at the end ───────────────
create temp table qa_pl_before as
  select (select count(*) from auth.users where id::text like '0a000000-%') as users,
         (select count(*) from public.companies where id::text like '0a000000-%') as companies,
         (select count(*) from public.projects where id::text like '0a000000-%') as projects,
         (select count(*) from public.project_members where project_id::text like '0a000000-%') as members;

-- ── ids ─────────────────────────────────────────────────────────────────────
create temp table qa_wl_users (id uuid primary key, email text, full_name text, phone text, company text);
insert into qa_wl_users values
 ('0b000000-0000-4000-8000-000000000001','qa-wl-admin@worklog.test',  'Ada Admin',     '+1 555 020 0001','QA-WL Granite Builders'),
 ('0b000000-0000-4000-8000-000000000002','qa-wl-super@worklog.test',  'Sam Super',     '+1 555 020 0002','QA-WL Granite Builders'),
 ('0b000000-0000-4000-8000-000000000003','qa-wl-pm@worklog.test',     'Priya Manager', '+1 555 020 0003','QA-WL Granite Builders'),
 ('0b000000-0000-4000-8000-000000000004','qa-wl-sub@worklog.test',    'Sully Sub',     '+1 555 020 0004','QA-WL Steel Erectors'),
 ('0b000000-0000-4000-8000-000000000005','qa-wl-b-admin@worklog.test','Bo Harbor',     '+1 555 020 0005','QA-WL Harbor Works'),
 ('0b000000-0000-4000-8000-000000000006','qa-wl-member@worklog.test', 'Mo Member',     '+1 555 020 0006','QA-WL Granite Builders'),
 ('0b000000-0000-4000-8000-000000000007','qa-wl-new@worklog.test',    'Nell New',      null,             null),
 ('0b000000-0000-4000-8000-000000000008','qa-wl-solo@worklog.test',   'Sol Solo',      '+1 555 020 0008','Sol Solo Remodeling'),
 ('0b000000-0000-4000-8000-000000000009','qa-wl-soloco@worklog.test', 'Cora Solo',     '+1 555 020 0009','QA-WL Solo Co'),
 ('0b000000-0000-4000-8000-000000000010','qa-wl-owner@worklog.test',  'Owen Owner',    '+1 555 020 0010','QA-WL Owner Holdings'),
 ('0b000000-0000-4000-8000-000000000011','qa-wl-architect@worklog.test','Ari Architect','+1 555 020 0011','QA-WL Studio Architects');

-- ── wipe ────────────────────────────────────────────────────────────────────
-- Locked reports have signed, append-only children guarded by
-- worklog_reject_if_locked. The sanctioned bypass — the one delete-account /
-- prepare_account_deletion (20261108000002) rely on — is a writer with no JWT
-- subject (auth.uid() IS NULL: service_role / direct SQL). This transaction
-- runs as postgres BEFORE any request.jwt.claims is set, so deleting the
-- projects cascades through every report table exactly as delete-account
-- does. No session_replication_role, no disabled triggers.
begin;

do $$
begin
  if auth.uid() is not null then
    raise exception 'wipe must run without a JWT subject (auth.uid() = %)', auth.uid();
  end if;
end $$;

create temp table qa_wipe_users on commit drop as
  select id, email from auth.users
   where email like 'qa-wl-%@worklog.test' or id in (select id from qa_wl_users);
create temp table qa_wipe_companies on commit drop as
  select id, company_id_guard from (
    select c.id, c.id as company_id_guard from public.companies c
     where c.id in ('0b000000-0000-4000-8000-00000000c001','0b000000-0000-4000-8000-00000000c002',
                    '0b000000-0000-4000-8000-00000000c003')
        or c.created_by in (select id from qa_wipe_users)) s;
create temp table qa_wipe_projects on commit drop as
  select id, company_id from public.projects
   where id in ('0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-00000000a002',
                '0b000000-0000-4000-8000-00000000b001','0b000000-0000-4000-8000-000000005001',
                '0b000000-0000-4000-8000-000000006001')
      or company_id in (select id from qa_wipe_companies)
      or created_by in (select id from qa_wipe_users);

-- Isolation guard: never touch PunchLog QA (0a…) or any non-WorkLog-QA account.
do $$
begin
  if exists (select 1 from qa_wipe_users where id::text like '0a000000-%' or email not like '%@worklog.test')
     or exists (select 1 from qa_wipe_companies where id::text like '0a000000-%')
     or exists (select 1 from qa_wipe_projects
                 where id::text like '0a000000-%' or company_id::text like '0a000000-%') then
    raise exception 'QA wipe target set includes a row outside the WorkLog QA namespace — refusing';
  end if;
end $$;

delete from public.projects       where id in (select id from qa_wipe_projects);   -- cascades every report table
delete from public.deleted_rows   where project_id in (select id from qa_wipe_projects);
delete from public.trade_partners where company_id in (select id from qa_wipe_companies);
delete from public.companies      where id in (select id from qa_wipe_companies);
delete from auth.users            where id in (select id from qa_wipe_users);
-- delete-account (testable locally) leaves an orphan profile and a deletion
-- marker keyed by user id; the fixed ids below would trip over both.
delete from public.profiles p
 where p.email like 'qa-wl-%@worklog.test'
   and not exists (select 1 from auth.users u where u.id = p.id);
delete from private.account_deletions where user_id in (select id from qa_wl_users);

commit;

-- ── accounts, companies, projects, memberships (fixtures, as postgres) ──────
begin;

-- Raw insert keeps fixed ids; empty token strings avoid GoTrue NULL scans.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated','authenticated', u.email,
       crypt(:'qa_password', gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name), '','','',''
  from qa_wl_users u;

insert into auth.identities (id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
  from qa_wl_users u;

-- handle_new_user created the profile rows; signer_name on every signature
-- comes from profiles.full_name, so it must be set before any submit.
update public.profiles p set email = u.email, full_name = u.full_name, phone = u.phone, company = u.company, avatar_url = null
  from qa_wl_users u where p.id = u.id;

insert into public.companies (id,name,created_by) values
 ('0b000000-0000-4000-8000-00000000c001','QA-WL Granite Builders','0b000000-0000-4000-8000-000000000001'),
 ('0b000000-0000-4000-8000-00000000c002','QA-WL Harbor Works',    '0b000000-0000-4000-8000-000000000005'),
 ('0b000000-0000-4000-8000-00000000c003','QA-WL Solo Co',         '0b000000-0000-4000-8000-000000000009');

insert into public.company_members (company_id,user_id,role) values
 ('0b000000-0000-4000-8000-00000000c001','0b000000-0000-4000-8000-000000000001','admin'),
 ('0b000000-0000-4000-8000-00000000c001','0b000000-0000-4000-8000-000000000002','member'),
 ('0b000000-0000-4000-8000-00000000c001','0b000000-0000-4000-8000-000000000003','member'),
 ('0b000000-0000-4000-8000-00000000c001','0b000000-0000-4000-8000-000000000006','member'),
 ('0b000000-0000-4000-8000-00000000c002','0b000000-0000-4000-8000-000000000005','admin'),
 ('0b000000-0000-4000-8000-00000000c003','0b000000-0000-4000-8000-000000000009','admin')
on conflict (company_id,user_id) do update set role = excluded.role;

-- Riverside (a001) has the lowest id, so resolveActiveProject opens it by
-- default for everyone on it; it carries timezone + site coordinates
-- (20260717000002). Depot (a002) leaves timezone/geo null (device-TZ fallback).
-- Solo Garage (5001) has company_id NULL, like every project WorkLog's
-- createProject creates.
insert into public.projects (id,name,address,created_by,company_id,timezone,lat,lng,geocode_source,geocoded_at) values
 ('0b000000-0000-4000-8000-00000000a001','QA-WL Riverside Tower', '10 River Rd, New York, NY',   '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000c001','America/New_York',   40.712800,-74.006000,'manual_pin',now()),
 ('0b000000-0000-4000-8000-00000000a002','QA-WL Depot Warehouse', '20 Depot St, Newark, NJ',     '0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000c001',null,null,null,null,null),
 ('0b000000-0000-4000-8000-00000000b001','QA-WL Pier 9 Lofts',    '9 Pier Ave, Oakland, CA',     '0b000000-0000-4000-8000-000000000005','0b000000-0000-4000-8000-00000000c002','America/Los_Angeles',37.804400,-122.271100,'manual_pin',now()),
 ('0b000000-0000-4000-8000-000000005001','QA-WL Solo Garage',     '5 Elm Ct, Evanston, IL',      '0b000000-0000-4000-8000-000000000008',null,                                  'America/Chicago',    42.045100,-87.687700,'manual_pin',now()),
 ('0b000000-0000-4000-8000-000000006001','QA-WL Solo Co Duplex',  '61 Oak St, Brooklyn, NY',     '0b000000-0000-4000-8000-000000000009','0b000000-0000-4000-8000-00000000c003','America/New_York',   40.678200,-73.944200,'manual_pin',now());

-- bootstrap_project_creator already made each creator super.
insert into public.project_members (project_id,user_id,role) values
 ('0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-000000000002','super'),
 ('0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-000000000003','super'),
 ('0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-000000000004','sub'),
 ('0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-000000000010','owner'),
 ('0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-000000000011','owner'),
 ('0b000000-0000-4000-8000-00000000a002','0b000000-0000-4000-8000-000000000003','super')
on conflict (project_id,user_id) do update set role = excluded.role;

-- PM = DB role 'super' + this WorkLog-side display title (PRD §10, 04 §A.10).
insert into public.report_member_prefs (project_id,user_id,title) values
 ('0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-000000000002','Superintendent'),
 ('0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-000000000003','Project Manager'),
 ('0b000000-0000-4000-8000-00000000a002','0b000000-0000-4000-8000-000000000003','Project Manager');

commit;

-- ── report lifecycle through the real RPCs ──────────────────────────────────
-- report_date is the PROJECT's calendar day (PRD §15 #9); the container clock
-- is UTC, so never current_date.
select (now() at time zone 'America/New_York')::date    as ny,
       (now() at time zone 'America/Los_Angeles')::date as la,
       (now() at time zone 'America/Chicago')::date     as chi \gset

-- Act as a seeded user for the rest of the current transaction.
\set as_admin 'set local role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"0b000000-0000-4000-8000-000000000001","role":"authenticated"}'', true);'
\set as_super 'set local role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"0b000000-0000-4000-8000-000000000002","role":"authenticated"}'', true);'
\set as_pm 'set local role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"0b000000-0000-4000-8000-000000000003","role":"authenticated"}'', true);'
\set as_badmin 'set local role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"0b000000-0000-4000-8000-000000000005","role":"authenticated"}'', true);'
\set as_soloco 'set local role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"0b000000-0000-4000-8000-000000000009","role":"authenticated"}'', true);'
\set as_solo 'set local role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"0b000000-0000-4000-8000-000000000008","role":"authenticated"}'', true);'

-- Section payload shapes follow src/data/sectionContent.ts (relational
-- sections: {"rows":[…]} exploded by worklog_apply_section; JSON sections:
-- {"entries":[…]} / {"text":…}; weather RPC keys are condition/temp_f).
-- is_complete = the "None today" affirmation, so false for filled sections.
-- Child-row ids are global PKs: 0b…-e<report><section><row>.
-- Photos: rows inserted by the user while the report is draft (the client's
-- direct-insert path, report_photos_insert policy + guard + audit trigger);
-- bytes uploaded by seed-local.mjs to worklog-photos/<project>/<report>/<photo>.jpg.
-- Each chain is its own transaction: claims and amend_report's
-- worklog.allow_locked_write are transaction-local.
\o /dev/null

-- Riverside, today-3 (America/New_York): super submits, PM locks, PM amends (signed).
begin;
:as_super
select * from create_report('0b000000-0000-4000-8000-00000000a001', :'ny'::date - 3, '0b000000-0000-4000-8000-00000000d103');
select update_section('0b000000-0000-4000-8000-00000000d103','weather','{"condition":"cloudy","temp_f":51}',false);
select update_section('0b000000-0000-4000-8000-00000000d103','crew','{"rows":[{"id":"0b000000-0000-4000-8000-ed1030100001","trade":"Concrete","headcount":6,"hours":8,"is_carried_forward":false},{"id":"0b000000-0000-4000-8000-ed1030100002","trade":"Ironworkers","headcount":4,"hours":8,"is_carried_forward":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d103','work_performed','{"rows":[{"id":"0b000000-0000-4000-8000-ed1030200001","trade":"Concrete","area":"Level 2 deck","note":"Placed and finished slab pour 2B."}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d103','equipment','{"rows":[{"id":"0b000000-0000-4000-8000-ed1030300001","name":"Concrete pump","status":"active","on_site":true}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d103','deliveries','{"entries":[{"id":"0b000000-0000-4000-8000-ed1030600001","supplier":"QA Ready-Mix","material":"4000 psi concrete","quantity":9,"unit":"loads"}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d103','general_notes','{"text":"Pour 2B complete. Cylinders taken."}',false);
insert into report_photos (id,report_id,project_id,storage_path,width,height,trade_tag,location_tag,caption,source,captured_at,exif_datetime_original,gps_lat,gps_lng,gps_accuracy,created_by) values
 ('0b000000-0000-4000-8000-00000000f104','0b000000-0000-4000-8000-00000000d103','0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-00000000a001/0b000000-0000-4000-8000-00000000d103/0b000000-0000-4000-8000-00000000f104.jpg',800,600,'Concrete','Level 2','Slab pour 2B finished','camera',now() - interval '3 days',null,40.712900,-74.005900,6.0,'0b000000-0000-4000-8000-000000000002');
select submit_report('0b000000-0000-4000-8000-00000000d103','Superintendent',decode(:'sig_hex','hex'));
:as_pm
select lock_report('0b000000-0000-4000-8000-00000000d103');
select amend_report('0b000000-0000-4000-8000-00000000d103','0b000000-0000-4000-8000-00000000ad31',
  'Ironworker count corrected after foreman timesheet review',
  '{"crew":{"payload":{"rows":[{"id":"0b000000-0000-4000-8000-ed1031100001","trade":"Concrete","headcount":6,"hours":8,"is_carried_forward":false},{"id":"0b000000-0000-4000-8000-ed1031100002","trade":"Ironworkers","headcount":5,"hours":8,"is_carried_forward":false}]},"is_complete":false},"general_notes":{"payload":{"text":"Pour 2B complete. Cylinders taken. (Amended: ironworker headcount 4 to 5.)"},"is_complete":false}}',
  'Project Manager', decode(:'sig_hex','hex'));
commit;

-- Riverside, today-2: incident + closed delay (History filters), submitted and locked by super.
begin;
:as_super
select * from create_report('0b000000-0000-4000-8000-00000000a001', :'ny'::date - 2, '0b000000-0000-4000-8000-00000000d104');
select update_section('0b000000-0000-4000-8000-00000000d104','weather','{"condition":"rain","temp_f":48}',false);
select update_section('0b000000-0000-4000-8000-00000000d104','crew','{"rows":[{"id":"0b000000-0000-4000-8000-ed1040100001","trade":"Framing","headcount":5,"hours":6,"is_carried_forward":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d104','work_performed','{"rows":[{"id":"0b000000-0000-4000-8000-ed1040200001","trade":"Framing","area":"Level 3","note":"Wall layout; stopped early for rain."}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d104','equipment','{"rows":[{"id":"0b000000-0000-4000-8000-ed1040300001","name":"Tower crane","status":"idle","on_site":true}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d104','safety','{"rows":[{"id":"0b000000-0000-4000-8000-ed1040500001","obs_type":"first_aid","description":"Laceration to left hand; cleaned and bandaged on site.","is_incident":true}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d104','delays','{"rows":[{"id":"0b000000-0000-4000-8000-ed1040400001","cause":"weather","responsible_party":null,"duration_hours":2,"is_ongoing":false,"note":"Heavy rain after 1 pm."}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d104','general_notes','{"text":"Short day for rain."}',false);
select submit_report('0b000000-0000-4000-8000-00000000d104','Superintendent',decode(:'sig_hex','hex'));
select lock_report('0b000000-0000-4000-8000-00000000d104');
commit;

-- Riverside, yesterday: submitted by super, NOT locked (carry-forward source).
begin;
:as_super
select * from create_report('0b000000-0000-4000-8000-00000000a001', :'ny'::date - 1, '0b000000-0000-4000-8000-00000000d102');
select update_section('0b000000-0000-4000-8000-00000000d102','weather','{"condition":"clear","temp_f":55}',false);
select update_section('0b000000-0000-4000-8000-00000000d102','crew','{"rows":[{"id":"0b000000-0000-4000-8000-ed1020100001","trade":"Framing","headcount":6,"hours":8,"is_carried_forward":false},{"id":"0b000000-0000-4000-8000-ed1020100002","trade":"Electrical","headcount":3,"hours":8,"is_carried_forward":false},{"id":"0b000000-0000-4000-8000-ed1020100003","trade":"Plumbing","headcount":2,"hours":6,"is_carried_forward":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d102','work_performed','{"rows":[{"id":"0b000000-0000-4000-8000-ed1020200001","trade":"Framing","area":"Level 3","note":"Exterior walls framed on grid lines A-D."},{"id":"0b000000-0000-4000-8000-ed1020200002","trade":"Electrical","area":"Level 2","note":"Rough-in at units 201-204."}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d102','equipment','{"rows":[{"id":"0b000000-0000-4000-8000-ed1020300001","name":"Tower crane","status":"active","on_site":true},{"id":"0b000000-0000-4000-8000-ed1020300002","name":"Scissor lift","status":"idle","on_site":true}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d102','safety','{"rows":[{"id":"0b000000-0000-4000-8000-ed1020500001","obs_type":"observation","description":"Toolbox talk: ladder safety.","is_incident":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d102','visitors','{"entries":[{"id":"0b000000-0000-4000-8000-ed1020700001","name":"QA Owner Rep","role":"owner","time":"10:30"}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d102','general_notes','{"text":"Good production day."}',false);
insert into report_photos (id,report_id,project_id,storage_path,width,height,trade_tag,location_tag,caption,source,captured_at,exif_datetime_original,gps_lat,gps_lng,gps_accuracy,created_by) values
 ('0b000000-0000-4000-8000-00000000f103','0b000000-0000-4000-8000-00000000d102','0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-00000000a001/0b000000-0000-4000-8000-00000000d102/0b000000-0000-4000-8000-00000000f103.jpg',800,600,'Framing','Level 3','Exterior walls A-D','camera',now() - interval '1 day',null,40.712750,-74.006100,5.0,'0b000000-0000-4000-8000-000000000002');
select submit_report('0b000000-0000-4000-8000-00000000d102','Superintendent',decode(:'sig_hex','hex'));
commit;

-- Riverside, TODAY: draft by super — every section kind filled, open delay, two photos (one without GPS).
begin;
:as_super
select * from create_report('0b000000-0000-4000-8000-00000000a001', :'ny'::date, '0b000000-0000-4000-8000-00000000d101');
select update_section('0b000000-0000-4000-8000-00000000d101','weather','{"condition":"windy","temp_f":49}',false);
select update_section('0b000000-0000-4000-8000-00000000d101','crew','{"rows":[{"id":"0b000000-0000-4000-8000-ed1010100001","trade":"Framing","headcount":6,"hours":8,"is_carried_forward":true},{"id":"0b000000-0000-4000-8000-ed1010100002","trade":"Electrical","headcount":3,"hours":8,"is_carried_forward":true},{"id":"0b000000-0000-4000-8000-ed1010100003","trade":"Drywall","headcount":4,"hours":8,"is_carried_forward":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d101','work_performed','{"rows":[{"id":"0b000000-0000-4000-8000-ed1010200001","trade":"Framing","area":"Level 4","note":"Started exterior walls."},{"id":"0b000000-0000-4000-8000-ed1010200002","trade":"Drywall","area":"Level 2","note":"Hanging board in units 201-202."}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d101','equipment','{"rows":[{"id":"0b000000-0000-4000-8000-ed1010300001","name":"Tower crane","status":"active","on_site":true},{"id":"0b000000-0000-4000-8000-ed1010300002","name":"Telehandler","status":"idle","on_site":true}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d101','deliveries','{"entries":[{"id":"0b000000-0000-4000-8000-ed1010600001","supplier":"QA Lumber Supply","material":"2x6 studs","quantity":4,"unit":"pallets"},{"id":"0b000000-0000-4000-8000-ed1010600002","supplier":"QA Gypsum","material":"5/8 Type X board","quantity":120,"unit":"pcs"}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d101','delays','{"rows":[{"id":"0b000000-0000-4000-8000-ed1010400001","cause":"material_delivery","responsible_party":"QA Window Co.","duration_hours":null,"is_ongoing":true,"note":"Level 4 windows not delivered; framing crew re-sequenced."}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d101','visitors','{"entries":[{"id":"0b000000-0000-4000-8000-ed1010700001","name":"QA Architect","role":"architect","time":"09:15"},{"id":"0b000000-0000-4000-8000-ed1010700002","name":"QA Building Inspector","role":"inspector","time":"13:45"}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d101','inspections','{"entries":[{"id":"0b000000-0000-4000-8000-ed1010800001","agency":"DOB","inspector":"QA Inspector","result":"partial","note":"Level 2 framing passed; Level 3 re-inspect."}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d101','rfis','{"entries":[{"id":"0b000000-0000-4000-8000-ed1010900001","title":"Header size at grid C4","trade":"Framing","needs_answer_from":"Architect"}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d101','safety','{"rows":[]}',true);
select update_section('0b000000-0000-4000-8000-00000000d101','general_notes','{"text":"Wind gusts slowed crane picks after 2 pm."}',false);
insert into report_photos (id,report_id,project_id,storage_path,width,height,trade_tag,location_tag,caption,source,captured_at,exif_datetime_original,gps_lat,gps_lng,gps_accuracy,created_by) values
 ('0b000000-0000-4000-8000-00000000f101','0b000000-0000-4000-8000-00000000d101','0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-00000000a001/0b000000-0000-4000-8000-00000000d101/0b000000-0000-4000-8000-00000000f101.jpg',800,600,'Framing','Level 4','Exterior wall start','camera',now() - interval '2 hours',null,40.712800,-74.006000,8.0,'0b000000-0000-4000-8000-000000000002'),
 ('0b000000-0000-4000-8000-00000000f102','0b000000-0000-4000-8000-00000000d101','0b000000-0000-4000-8000-00000000a001','0b000000-0000-4000-8000-00000000a001/0b000000-0000-4000-8000-00000000d101/0b000000-0000-4000-8000-00000000f102.jpg',800,600,'Drywall','Level 2','Board delivery staged (no location)','library',now() - interval '3 hours',to_char(now() - interval '3 hours','YYYY:MM:DD HH24:MI:SS'),null,null,null,'0b000000-0000-4000-8000-000000000002');
commit;

-- Depot (no timezone), today-4: PM submits and locks.
begin;
:as_pm
select * from create_report('0b000000-0000-4000-8000-00000000a002', :'ny'::date - 4, '0b000000-0000-4000-8000-00000000d202');
select update_section('0b000000-0000-4000-8000-00000000d202','weather','{"condition":"fog","temp_f":45}',false);
select update_section('0b000000-0000-4000-8000-00000000d202','crew','{"rows":[{"id":"0b000000-0000-4000-8000-ed2020100001","trade":"Roofing","headcount":4,"hours":8,"is_carried_forward":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d202','work_performed','{"rows":[{"id":"0b000000-0000-4000-8000-ed2020200001","trade":"Roofing","area":"Roof","note":"Membrane at bays 1-3."}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d202','general_notes','{"text":"Roof membrane progressing."}',false);
select submit_report('0b000000-0000-4000-8000-00000000d202','Project Manager',decode(:'sig_hex','hex'));
select lock_report('0b000000-0000-4000-8000-00000000d202');
commit;

-- Depot, yesterday: PM submits (not locked). No draft today: free to create one in the app.
begin;
:as_pm
select * from create_report('0b000000-0000-4000-8000-00000000a002', :'ny'::date - 1, '0b000000-0000-4000-8000-00000000d201');
select update_section('0b000000-0000-4000-8000-00000000d201','crew','{"rows":[{"id":"0b000000-0000-4000-8000-ed2010100001","trade":"Roofing","headcount":4,"hours":8,"is_carried_forward":false},{"id":"0b000000-0000-4000-8000-ed2010100002","trade":"HVAC","headcount":2,"hours":8,"is_carried_forward":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d201','equipment','{"rows":[{"id":"0b000000-0000-4000-8000-ed2010300001","name":"Boom lift","status":"active","on_site":true}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d201','general_notes','{"text":"RTU curbs set."}',false);
insert into report_photos (id,report_id,project_id,storage_path,width,height,trade_tag,location_tag,caption,source,captured_at,exif_datetime_original,gps_lat,gps_lng,gps_accuracy,created_by) values
 ('0b000000-0000-4000-8000-00000000f105','0b000000-0000-4000-8000-00000000d201','0b000000-0000-4000-8000-00000000a002','0b000000-0000-4000-8000-00000000a002/0b000000-0000-4000-8000-00000000d201/0b000000-0000-4000-8000-00000000f105.jpg',800,600,'HVAC','Roof','RTU curb at bay 2','library',now() - interval '1 day',to_char(now() - interval '1 day','YYYY:MM:DD HH24:MI:SS'),null,null,null,'0b000000-0000-4000-8000-000000000003');
select submit_report('0b000000-0000-4000-8000-00000000d201','Project Manager',decode(:'sig_hex','hex'));
commit;

-- Pier 9 (company B), yesterday in America/Los_Angeles: B admin submits (cross-tenant canary).
begin;
:as_badmin
select * from create_report('0b000000-0000-4000-8000-00000000b001', :'la'::date - 1, '0b000000-0000-4000-8000-00000000d301');
select update_section('0b000000-0000-4000-8000-00000000d301','crew','{"rows":[{"id":"0b000000-0000-4000-8000-ed3010100001","trade":"Masonry","headcount":3,"hours":8,"is_carried_forward":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d301','general_notes','{"text":"Company B canary: company A accounts must never see this."}',false);
insert into report_photos (id,report_id,project_id,storage_path,width,height,trade_tag,location_tag,caption,source,captured_at,exif_datetime_original,gps_lat,gps_lng,gps_accuracy,created_by) values
 ('0b000000-0000-4000-8000-00000000f106','0b000000-0000-4000-8000-00000000d301','0b000000-0000-4000-8000-00000000b001','0b000000-0000-4000-8000-00000000b001/0b000000-0000-4000-8000-00000000d301/0b000000-0000-4000-8000-00000000f106.jpg',800,600,'Masonry','Lobby','Company B canary photo','camera',now() - interval '1 day',null,37.804500,-122.271000,12.0,'0b000000-0000-4000-8000-000000000005');
select submit_report('0b000000-0000-4000-8000-00000000d301',null,decode(:'sig_hex','hex'));
commit;

-- Solo Garage (no company), today-2 in America/Chicago: locked + signed — the
-- delete-account warning (PR #44) must count it.
begin;
:as_solo
select * from create_report('0b000000-0000-4000-8000-000000005001', :'chi'::date - 2, '0b000000-0000-4000-8000-00000000d401');
select update_section('0b000000-0000-4000-8000-00000000d401','weather','{"condition":"clear","temp_f":40}',false);
select update_section('0b000000-0000-4000-8000-00000000d401','crew','{"rows":[{"id":"0b000000-0000-4000-8000-ed4010100001","trade":"Carpentry","headcount":1,"hours":7,"is_carried_forward":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d401','work_performed','{"rows":[{"id":"0b000000-0000-4000-8000-ed4010200001","trade":"Carpentry","area":"Garage","note":"Installed new header over door."}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d401','general_notes','{"text":"Header inspection passed."}',false);
insert into report_photos (id,report_id,project_id,storage_path,width,height,trade_tag,location_tag,caption,source,captured_at,exif_datetime_original,gps_lat,gps_lng,gps_accuracy,created_by) values
 ('0b000000-0000-4000-8000-00000000f107','0b000000-0000-4000-8000-00000000d401','0b000000-0000-4000-8000-000000005001','0b000000-0000-4000-8000-000000005001/0b000000-0000-4000-8000-00000000d401/0b000000-0000-4000-8000-00000000f107.jpg',800,600,'Carpentry','Garage','New door header','camera',now() - interval '2 days',null,42.045200,-87.687600,10.0,'0b000000-0000-4000-8000-000000000008');
select submit_report('0b000000-0000-4000-8000-00000000d401',null,decode(:'sig_hex','hex'));
select lock_report('0b000000-0000-4000-8000-00000000d401');
commit;

-- Solo Garage, TODAY (America/Chicago): draft.
begin;
:as_solo
select * from create_report('0b000000-0000-4000-8000-000000005001', :'chi'::date, '0b000000-0000-4000-8000-00000000d402');
select update_section('0b000000-0000-4000-8000-00000000d402','general_notes','{"text":"Trim out today."}',false);
commit;

-- Solo Co Duplex (company C, sole member), today-2: locked + signed.
begin;
:as_soloco
select * from create_report('0b000000-0000-4000-8000-000000006001', :'ny'::date - 2, '0b000000-0000-4000-8000-00000000d501');
select update_section('0b000000-0000-4000-8000-00000000d501','weather','{"condition":"cloudy","temp_f":50}',false);
select update_section('0b000000-0000-4000-8000-00000000d501','crew','{"rows":[{"id":"0b000000-0000-4000-8000-ed5010100001","trade":"Demolition","headcount":2,"hours":8,"is_carried_forward":false}]}',false);
select update_section('0b000000-0000-4000-8000-00000000d501','general_notes','{"text":"Kitchen demo complete."}',false);
insert into report_photos (id,report_id,project_id,storage_path,width,height,trade_tag,location_tag,caption,source,captured_at,exif_datetime_original,gps_lat,gps_lng,gps_accuracy,created_by) values
 ('0b000000-0000-4000-8000-00000000f108','0b000000-0000-4000-8000-00000000d501','0b000000-0000-4000-8000-000000006001','0b000000-0000-4000-8000-000000006001/0b000000-0000-4000-8000-00000000d501/0b000000-0000-4000-8000-00000000f108.jpg',800,600,'Demolition','Kitchen','Kitchen stripped to studs','camera',now() - interval '2 days',null,40.678300,-73.944100,7.0,'0b000000-0000-4000-8000-000000000009');
select submit_report('0b000000-0000-4000-8000-00000000d501','Owner',decode(:'sig_hex','hex'));
select lock_report('0b000000-0000-4000-8000-00000000d501');
commit;

\o

-- ── PunchLog QA canary: nothing in the 0a namespace changed ─────────────────
do $$
declare
  b record;
begin
  select * into b from qa_pl_before;
  if (select count(*) from auth.users where id::text like '0a000000-%') <> b.users
     or (select count(*) from public.companies where id::text like '0a000000-%') <> b.companies
     or (select count(*) from public.projects where id::text like '0a000000-%') <> b.projects
     or (select count(*) from public.project_members where project_id::text like '0a000000-%') <> b.members then
    raise exception 'PunchLog QA (0a…) row counts changed during the WorkLog seed';
  end if;
end $$;
select 'punchlog_qa_0a_rows_untouched' as check, users, companies, projects, members from qa_pl_before;

-- ── summary ─────────────────────────────────────────────────────────────────
select p.name as project, r.report_date, r.status,
       (select count(*) from report_photos ph where ph.report_id = r.id and ph.deleted_at is null) as photos,
       (select count(*) from report_signatures s where s.report_id = r.id) as signatures,
       (select count(*) from report_amendments a where a.report_id = r.id) as amendments,
       r.has_delay, r.has_incident
  from daily_reports r join projects p on p.id = r.project_id
 where r.id::text like '0b000000-%'
 order by p.name, r.report_date;
