-- RLS test suite for the ZenFinanceHub portal.
-- Runs against a database with 0001_init.sql applied (plain Postgres + supabase_stub.sql, or a local Supabase).
-- Every check raises an exception on failure, so the script stops at the first breach.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

-- ── Fixtures (as superuser) ─────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin.test@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 'owner.a@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'bookkeeper.a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner.b@example.com');
update public.profiles set is_staff = true, staff_role = 'admin' where email = 'admin.test@example.com';

insert into public.clients (id, name, entity_type) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alpha Ltd', 'limited_company'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Beta Ltd',  'limited_company');
insert into public.client_contacts values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'owner',       now()),
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'contributor', now()),
  ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b1', 'owner',       now());

insert into public.jobs (id, client_id, title, service) values
  ('aaaaaaaa-1111-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'Alpha year-end', 'year_end'),
  ('aaaaaaaa-2222-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'Alpha payroll',  'payroll'),
  ('bbbbbbbb-1111-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'Beta year-end',  'year_end');
-- contributor only on Alpha payroll
insert into public.job_contacts values ('aaaaaaaa-2222-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2');

insert into public.requests (id, job_id, kind, title, question_type, consent_type) values
  ('aaaaaaaa-1111-1111-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000', 'upload',   'Bank statements', null, null),
  ('aaaaaaaa-1111-2222-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000', 'question', 'Stock value', 'amount', null),
  ('aaaaaaaa-1111-3333-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000', 'consent',  'Lender sharing', null, 'lender_share'),
  ('aaaaaaaa-2222-1111-0000-000000000000', 'aaaaaaaa-2222-0000-0000-000000000000', 'approval', 'Approve payroll', null, null),
  ('bbbbbbbb-1111-1111-0000-000000000000', 'bbbbbbbb-1111-0000-0000-000000000000', 'upload',   'Bank statements', null, null);

insert into public.files (id, client_id, job_id, storage_path, original_name, uploaded_by, scan_status) values
  ('bbbbbbbb-f000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-1111-0000-0000-000000000000',
   'bbbbbbbb-0000-0000-0000-000000000000/bbbbbbbb-1111-0000-0000-000000000000/x-beta.pdf', 'beta.pdf',
   '00000000-0000-0000-0000-0000000000b1', 'clean');
insert into storage.objects (bucket_id, name) values
  ('client-files', 'bbbbbbbb-0000-0000-0000-000000000000/bbbbbbbb-1111-0000-0000-000000000000/x-beta.pdf');
insert into public.messages (job_id, author_id, body, internal) values
  ('aaaaaaaa-1111-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'Staff note', true);

-- Totals of everything that exists (fixtures + any real data), captured as superuser,
-- so staff checks can assert "sees every row" without assuming an empty database.
create temp table pg_temp.totals as
  select (select count(*) from public.clients) as clients;
grant select on pg_temp.totals to authenticated;

-- helper: assert
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'RLS TEST FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;
set client_min_messages = notice;

-- ── Owner of Alpha ──────────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

select pg_temp.check((select count(*) from public.clients) = 1,                       'owner A sees only own client');
select pg_temp.check((select count(*) from public.jobs) = 2,                          'owner A sees both Alpha jobs, no Beta job');
select pg_temp.check((select count(*) from public.requests where job_id::text like 'bbbbbbbb%') = 0, 'owner A cannot see Beta requests');
select pg_temp.check((select count(*) from public.files) = 0,                         'owner A cannot see Beta files');
select pg_temp.check((select count(*) from storage.objects) = 0,                      'owner A cannot see Beta storage objects');
select pg_temp.check((select count(*) from public.messages) = 0,                      'owner A cannot see internal staff notes');
select pg_temp.check((select count(*) from public.audit_log) = 0,                     'owner A cannot read audit log');
select pg_temp.check((select count(*) from public.profiles where id in
                        ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a')) = 2
                      and (select count(*) from public.profiles
                           where not is_staff and id <> '00000000-0000-0000-0000-0000000000a1') = 0,
                     'owner A sees own profile + staff profile only');

-- cannot write to another client's job
do $$ begin
  insert into public.files (client_id, job_id, storage_path, original_name)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-1111-0000-0000-000000000000',
          'bbbbbbbb-0000-0000-0000-000000000000/bbbbbbbb-1111-0000-0000-000000000000/evil.pdf', 'evil.pdf');
  raise exception 'RLS TEST FAILED: owner A inserted a file on Beta job';
exception when insufficient_privilege then raise notice 'ok  owner A blocked from uploading to Beta job';
end $$;

-- cannot mark own file clean / internal-bypass
do $$ begin
  insert into public.files (client_id, job_id, storage_path, original_name, scan_status)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000',
          'aaaaaaaa-0000-0000-0000-000000000000/aaaaaaaa-1111-0000-0000-000000000000/fake.pdf', 'fake.pdf', 'clean');
  raise exception 'RLS TEST FAILED: owner A self-marked a file clean';
exception when insufficient_privilege then raise notice 'ok  owner A cannot self-mark a file as scanned clean';
end $$;

-- cannot change request status directly
update public.requests set status = 'accepted' where id = 'aaaaaaaa-1111-1111-0000-000000000000';
reset role;
select pg_temp.check((select status from public.requests where id = 'aaaaaaaa-1111-1111-0000-000000000000') = 'open',
                     'owner A cannot change request status directly');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- cannot promote self to staff
do $$ begin
  update public.profiles set is_staff = true, staff_role = 'admin' where id = auth.uid();
  raise exception 'RLS TEST FAILED: owner A promoted themselves to staff';
exception when insufficient_privilege then raise notice 'ok  owner A cannot promote themselves to staff';
end $$;

-- legitimate flow: upload to own job, then submit
insert into public.files (client_id, job_id, request_id, storage_path, original_name)
values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000', 'aaaaaaaa-1111-1111-0000-000000000000',
        'aaaaaaaa-0000-0000-0000-000000000000/aaaaaaaa-1111-0000-0000-000000000000/f1-bank.pdf', 'bank.pdf');
insert into storage.objects (bucket_id, name)
values ('client-files', 'aaaaaaaa-0000-0000-0000-000000000000/aaaaaaaa-1111-0000-0000-000000000000/f1-bank.pdf');
select pg_temp.check((select count(*) from storage.objects) = 0, 'owner A cannot download own file before virus scan');
select public.submit_request('aaaaaaaa-1111-1111-0000-000000000000');
select pg_temp.check((select status from public.requests where id = 'aaaaaaaa-1111-1111-0000-000000000000') = 'submitted',
                     'owner A can upload and submit own request');

-- answer + submit question
insert into public.responses (request_id, answer) values ('aaaaaaaa-1111-2222-0000-000000000000', '{"amount": 12500}');
select public.submit_request('aaaaaaaa-1111-2222-0000-000000000000');
select pg_temp.check(true, 'owner A can answer and submit a question');

-- consent via RPC
select public.record_consent('aaaaaaaa-1111-3333-0000-000000000000', 'v1', 'I agree to share my information with lenders.', 'Lender panel');
select pg_temp.check((select count(*) from public.consents) = 1, 'owner A can record lender consent');

-- cannot submit Beta's request
do $$ begin
  perform public.submit_request('bbbbbbbb-1111-1111-0000-000000000000');
  raise exception 'RLS TEST FAILED: owner A submitted a Beta request';
exception when no_data_found then raise notice 'ok  owner A cannot submit a Beta request';
end $$;

-- ── Contributor on Alpha (payroll job only) ─────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.check((select count(*) from public.jobs) = 1,    'contributor sees only the job they are added to');
select pg_temp.check((select count(*) from public.files) = 0,   'contributor cannot see year-end files');
do $$ begin
  perform public.submit_request('aaaaaaaa-2222-1111-0000-000000000000');
  raise exception 'RLS TEST FAILED: contributor approved payroll';
exception when raise_exception then raise notice 'ok  contributor cannot approve';
end $$;

-- ── Owner of Beta ───────────────────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) from public.jobs) = 1,       'owner B sees only Beta job');
select pg_temp.check((select count(*) from public.consents) = 0,   'owner B cannot see Alpha consents');
select pg_temp.check((select count(*) from storage.objects) = 1,   'owner B can download own clean file');

-- ── Anonymous ───────────────────────────────────────────────
reset request.jwt.claim.sub;
reset role;
set role anon;
do $$ begin
  perform count(*) from public.clients;
  raise exception 'RLS TEST FAILED: anon can query clients';
exception when insufficient_privilege then raise notice 'ok  anonymous users have no table access';
end $$;

-- ── Staff ───────────────────────────────────────────────────
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) from public.clients
                      where id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000')) = 2
                     and (select count(*) from public.clients) = (select clients from pg_temp.totals),
                     'admin sees all clients');
select pg_temp.check((select count(*) from public.messages
                      where job_id = 'aaaaaaaa-1111-0000-0000-000000000000' and internal) = 1,
                     'admin sees internal notes');
select pg_temp.check((select count(*) from public.audit_log) > 0, 'audit log recorded client actions');
select pg_temp.check((select count(*) from public.audit_log where meta::text like '%12500%') = 0,
                     'audit log holds no answer content');

-- ── clients / client_contacts writes are staff-only ─────────
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'invitee@example.com');

-- A client owner cannot create clients, edit clients, or add / change / remove contacts.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  insert into public.clients (name, entity_type) values ('Owner-made client', 'other');
  raise exception 'RLS TEST FAILED: client owner created a client';
exception when insufficient_privilege then raise notice 'ok  client owner cannot create a client';
end $$;
do $$ declare n int; begin
  update public.clients set name = 'Hacked' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS TEST FAILED: client owner edited their client'; end if;
  raise notice 'ok  client owner cannot edit a client';
end $$;
do $$ begin
  insert into public.client_contacts (client_id, profile_id, role)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'owner');
  raise exception 'RLS TEST FAILED: client owner added a contact (invite)';
exception when insufficient_privilege then raise notice 'ok  client owner cannot add a contact to their own client';
end $$;
do $$ begin
  insert into public.client_contacts (client_id, profile_id, role)
  values ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'owner');
  raise exception 'RLS TEST FAILED: client owner added themselves to another client';
exception when insufficient_privilege then raise notice 'ok  client owner cannot add themselves to another client';
end $$;
do $$ declare n int; begin
  update public.client_contacts set role = 'owner'
   where client_id = 'aaaaaaaa-0000-0000-0000-000000000000' and profile_id = '00000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS TEST FAILED: client owner promoted a contributor'; end if;
  delete from public.client_contacts
   where client_id = 'aaaaaaaa-0000-0000-0000-000000000000' and profile_id = '00000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS TEST FAILED: client owner removed a contact'; end if;
  raise notice 'ok  client owner cannot change or remove contacts';
end $$;

-- A contributor cannot add contacts or clients either.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$ begin
  insert into public.client_contacts (client_id, profile_id, role)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'contributor');
  raise exception 'RLS TEST FAILED: contributor added a contact';
exception when insufficient_privilege then raise notice 'ok  contributor cannot add a contact';
end $$;
do $$ begin
  insert into public.clients (name, entity_type) values ('Contributor-made client', 'other');
  raise exception 'RLS TEST FAILED: contributor created a client';
exception when insufficient_privilege then raise notice 'ok  contributor cannot create a client';
end $$;

-- Anonymous users cannot write either.
reset role;
set role anon;
do $$ begin
  insert into public.client_contacts (client_id, profile_id, role)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'owner');
  raise exception 'RLS TEST FAILED: anon added a contact';
exception when insufficient_privilege then raise notice 'ok  anonymous users cannot add contacts';
end $$;

-- Staff can create / edit clients and add contacts.
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.clients (id, name, entity_type) values ('cccccccc-0000-0000-0000-000000000000', 'Staff-made client', 'sole_trader');
update public.clients set status = 'prospect' where id = 'cccccccc-0000-0000-0000-000000000000';
insert into public.client_contacts (client_id, profile_id, role)
values ('cccccccc-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'owner');
select pg_temp.check((select count(*) from public.clients where id = 'cccccccc-0000-0000-0000-000000000000' and status = 'prospect') = 1,
                     'staff can create and edit a client');
select pg_temp.check((select count(*) from public.client_contacts where client_id = 'cccccccc-0000-0000-0000-000000000000') = 1,
                     'staff can add a contact');

-- A newly added owner sees only their own client.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.check((select count(*) from public.clients) = 1, 'newly added contact sees only their client');

-- ── Jobs from templates (migration 0002) ────────────────────
reset role;
insert into public.templates (id, name, service, requests) values
  ('dddddddd-0000-0000-0000-000000000000', 'RLS fixture template', 'year_end', '[
    {"kind":"upload","title":"Bank statements","due_offset_days":21},
    {"kind":"question","title":"Stock value","question_type":"amount","help_text":"Year-end stock","due_offset_days":7},
    {"kind":"approval","title":"Approve accounts"}
  ]'::jsonb);

-- Clients (owner, contributor) and anonymous users cannot create jobs or requests, by RPC or directly.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  perform public.create_job_from_template('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000',
    'Client-made job', 'year_end', null, null, null, '{}');
  raise exception 'RLS TEST FAILED: client owner created a job from a template';
exception when insufficient_privilege then raise notice 'ok  client owner cannot create a job from a template';
end $$;
do $$ begin
  insert into public.jobs (client_id, title, service)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'Direct job', 'other');
  raise exception 'RLS TEST FAILED: client owner inserted a job directly';
exception when insufficient_privilege then raise notice 'ok  client owner cannot insert a job directly';
end $$;
do $$ begin
  insert into public.requests (job_id, kind, title)
  values ('aaaaaaaa-1111-0000-0000-000000000000', 'upload', 'Direct request');
  raise exception 'RLS TEST FAILED: client owner inserted a request directly';
exception when insufficient_privilege then raise notice 'ok  client owner cannot insert a request directly';
end $$;
do $$ begin
  perform public.add_pending_request('aaaaaaaa-1111-0000-0000-000000000000', 0, null);
  raise exception 'RLS TEST FAILED: client owner added a pending request';
exception when insufficient_privilege then raise notice 'ok  client owner cannot add a pending request';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$ begin
  perform public.create_job_from_template('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000',
    'Contributor-made job', 'year_end', null, null, null, '{}');
  raise exception 'RLS TEST FAILED: contributor created a job from a template';
exception when insufficient_privilege then raise notice 'ok  contributor cannot create a job from a template';
end $$;
reset role;
set role anon;
do $$ begin
  perform public.create_job_from_template('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000',
    'Anon job', 'year_end', null, null, null, '{}');
  raise exception 'RLS TEST FAILED: anon created a job from a template';
exception when insufficient_privilege then raise notice 'ok  anonymous users cannot create a job from a template';
end $$;

-- Staff create a job from a template.
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare j uuid; begin
  j := public.create_job_from_template('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000',
    'RLS fixture job', 'year_end', null, null, '00000000-0000-0000-0000-00000000000a',
    array['00000000-0000-0000-0000-0000000000a2']::uuid[]);
  if j is null then raise exception 'RLS TEST FAILED: no job id returned'; end if;
  raise notice 'ok  staff can create a job from a template';
end $$;

select pg_temp.check((select count(*) from public.requests r join public.jobs j on j.id = r.job_id
                      where j.title = 'RLS fixture job') = 2,
                     'only blueprints with a due offset become requests');
select pg_temp.check((select count(*) from public.requests r join public.jobs j on j.id = r.job_id
                      where j.title = 'RLS fixture job' and r.kind = 'upload'
                        and r.due_date = (now() at time zone 'Europe/London')::date + 21) = 1
                     and (select count(*) from public.requests r join public.jobs j on j.id = r.job_id
                          where j.title = 'RLS fixture job' and r.kind = 'question' and r.help_text = 'Year-end stock'
                            and r.question_type = 'amount'
                            and r.due_date = (now() at time zone 'Europe/London')::date + 7) = 1,
                     'request due dates are today plus the blueprint offset');
select pg_temp.check((select jsonb_array_length(pending_blueprints) from public.jobs where title = 'RLS fixture job') = 1
                     and (select pending_blueprints -> 0 ->> 'kind' from public.jobs where title = 'RLS fixture job') = 'approval',
                     'blueprints without a due offset are kept as "add later"');
select pg_temp.check((select count(*) from public.job_contacts jc join public.jobs j on j.id = jc.job_id
                      where j.title = 'RLS fixture job'
                        and jc.profile_id = '00000000-0000-0000-0000-0000000000a2') = 1,
                     'chosen contributors are added to the job');
do $$ begin
  perform public.create_job_from_template('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000',
    'Bad contributor job', 'year_end', null, null, null, array['00000000-0000-0000-0000-0000000000b1']::uuid[]);
  raise exception 'RLS TEST FAILED: a non-contact was added as contributor';
exception when raise_exception then
  if sqlerrm like 'RLS TEST FAILED%' then raise; end if;
  raise notice 'ok  contributors must be contacts of the client';
end $$;
do $$ begin
  perform public.create_job_from_template('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000',
    'Bad assignee job', 'year_end', null, null, '00000000-0000-0000-0000-0000000000a1', '{}');
  raise exception 'RLS TEST FAILED: a client was assigned to a job';
exception when raise_exception then
  if sqlerrm like 'RLS TEST FAILED%' then raise; end if;
  raise notice 'ok  jobs can only be assigned to staff';
end $$;
select pg_temp.check((select count(*) from public.jobs where title in ('Bad contributor job', 'Bad assignee job')) = 0,
                     'a rejected job leaves nothing behind');

-- One-click add of a pending request.
select public.add_pending_request((select id from public.jobs where title = 'RLS fixture job'), 0, null);
select pg_temp.check((select count(*) from public.requests r join public.jobs j on j.id = r.job_id
                      where j.title = 'RLS fixture job' and r.kind = 'approval') = 1
                     and (select jsonb_array_length(pending_blueprints) from public.jobs where title = 'RLS fixture job') = 0,
                     'staff can add a pending request with one call');
do $$ begin
  perform public.add_pending_request((select id from public.jobs where title = 'RLS fixture job'), 0, null);
  raise exception 'RLS TEST FAILED: pending request added twice';
exception when sqlstate 'P0002' then raise notice 'ok  a pending request can only be added once';
end $$;

-- Return and accept: a returned request is open to the client again.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select count(*) from public.jobs where title = 'RLS fixture job') = 1
                     and (select count(*) from public.requests r join public.jobs j on j.id = r.job_id
                          where j.title = 'RLS fixture job') = 3,
                     'client owner sees the new job and its requests');
do $$ declare r uuid; begin
  select q.id into r from public.requests q join public.jobs j on j.id = q.job_id
   where j.title = 'RLS fixture job' and q.kind = 'approval';
  perform public.submit_request(r);
  raise notice 'ok  client owner can approve a request';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.requests set status = 'returned', return_reason = 'Please check the totals'
 where status = 'submitted' and kind = 'approval'
   and job_id = (select id from public.jobs where title = 'RLS fixture job');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select count(*) from public.requests q join public.jobs j on j.id = q.job_id
                      where j.title = 'RLS fixture job' and q.status = 'returned'
                        and q.return_reason = 'Please check the totals') = 1,
                     'client sees why a request was returned');
do $$ declare r uuid; begin
  select q.id into r from public.requests q join public.jobs j on j.id = q.job_id
   where j.title = 'RLS fixture job' and q.kind = 'approval';
  perform public.submit_request(r);
  raise notice 'ok  a returned request can be submitted again';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.requests set status = 'accepted'
 where status = 'submitted' and kind = 'approval'
   and job_id = (select id from public.jobs where title = 'RLS fixture job');
select pg_temp.check((select count(*) from public.requests q join public.jobs j on j.id = q.job_id
                      where j.title = 'RLS fixture job' and q.status = 'accepted') = 1,
                     'staff can accept a submitted request');

-- Staff state changes are audited, with the staff member as actor.
select pg_temp.check(
  (select count(*) from public.audit_log a join public.jobs j on j.id = a.entity_id
   where j.title = 'RLS fixture job' and a.entity = 'jobs' and a.action = 'insert'
     and a.actor_id = '00000000-0000-0000-0000-00000000000a') = 1
  and (select count(*) from public.audit_log a join public.requests q on q.id = a.entity_id
       join public.jobs j on j.id = q.job_id
       where j.title = 'RLS fixture job' and a.entity = 'requests' and a.action = 'insert'
         and a.actor_id = '00000000-0000-0000-0000-00000000000a') = 3
  and (select count(*) from public.audit_log a join public.requests q on q.id = a.entity_id
       join public.jobs j on j.id = q.job_id
       where j.title = 'RLS fixture job' and a.action = 'update'
         and a.meta ->> 'status' = 'returned'
         and a.actor_id = '00000000-0000-0000-0000-00000000000a') = 1
  and (select count(*) from public.audit_log a join public.requests q on q.id = a.entity_id
       join public.jobs j on j.id = q.job_id
       where j.title = 'RLS fixture job' and a.action = 'update'
         and a.meta ->> 'status' = 'accepted'
         and a.actor_id = '00000000-0000-0000-0000-00000000000a') = 1,
  'job creation, returning and accepting are audited with the staff actor');

-- A stage change by staff is audited too.
update public.jobs set stage = 'in_progress' where title = 'RLS fixture job';
select pg_temp.check((select count(*) from public.audit_log a join public.jobs j on j.id = a.entity_id
                      where j.title = 'RLS fixture job' and a.entity = 'jobs' and a.action = 'update'
                        and a.meta ->> 'stage' = 'in_progress') = 1,
                     'job stage changes are audited');

-- ── Failed uploads can be discarded (migration 0003) ────────
reset role;
insert into public.files (id, client_id, job_id, storage_path, original_name, uploaded_by, scan_status) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-000000000000/aaaaaaaa-1111-0000-0000-000000000000/eeeeeeee-1-failed.pdf', 'failed.pdf',
   '00000000-0000-0000-0000-0000000000a1', 'pending'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-000000000000/aaaaaaaa-1111-0000-0000-000000000000/eeeeeeee-2-stored.pdf', 'stored.pdf',
   '00000000-0000-0000-0000-0000000000a1', 'pending'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-000000000000/aaaaaaaa-1111-0000-0000-000000000000/eeeeeeee-3-clean.pdf', 'clean.pdf',
   '00000000-0000-0000-0000-0000000000a1', 'clean');
insert into storage.objects (bucket_id, name) values
  ('client-files', 'aaaaaaaa-0000-0000-0000-000000000000/aaaaaaaa-1111-0000-0000-000000000000/eeeeeeee-2-stored.pdf');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$ begin
  perform public.discard_failed_upload('eeeeeeee-0000-0000-0000-000000000001');
  raise exception 'RLS TEST FAILED: a colleague discarded someone else''s upload';
exception when sqlstate 'P0002' then raise notice 'ok  nobody else can discard your upload';
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  perform public.discard_failed_upload('eeeeeeee-0000-0000-0000-000000000001');
  raise exception 'RLS TEST FAILED: another client discarded an upload';
exception when sqlstate 'P0002' then raise notice 'ok  another client cannot discard your upload';
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  perform public.discard_failed_upload('eeeeeeee-0000-0000-0000-000000000002');
  raise exception 'RLS TEST FAILED: discarded a file whose object was stored';
exception when raise_exception then
  if sqlerrm like 'RLS TEST FAILED%' then raise; end if;
  raise notice 'ok  a file that was stored cannot be discarded';
end $$;
do $$ begin
  perform public.discard_failed_upload('eeeeeeee-0000-0000-0000-000000000003');
  raise exception 'RLS TEST FAILED: discarded a scanned file';
exception when raise_exception then
  if sqlerrm like 'RLS TEST FAILED%' then raise; end if;
  raise notice 'ok  a scanned file cannot be discarded';
end $$;
select public.discard_failed_upload('eeeeeeee-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from public.files where id = 'eeeeeeee-0000-0000-0000-000000000001') = 0
                     and (select count(*) from public.files where id in
                          ('eeeeeeee-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000003')) = 2,
                     'owner can discard their own failed upload, and only that one');

reset role;
select pg_temp.check((select count(*) from public.audit_log
                      where action = 'upload_discarded' and entity_id = 'eeeeeeee-0000-0000-0000-000000000001'
                        and actor_id = '00000000-0000-0000-0000-0000000000a1') = 1,
                     'a discarded upload is audited');

set role anon;
do $$ begin
  perform public.discard_failed_upload('eeeeeeee-0000-0000-0000-000000000002');
  raise exception 'RLS TEST FAILED: anon discarded an upload';
exception when insufficient_privilege then raise notice 'ok  anonymous users cannot discard uploads';
end $$;

-- ── Areas: Accounting and Finance (migration 0004) ──────────
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'staff.acc@example.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'staff.fin@example.com'),
  ('00000000-0000-0000-0000-0000000000d3', 'staff.none@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'mixed.owner@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'finonly.owner@example.com');
update public.profiles set is_staff = true, staff_role = 'staff', staff_areas = array['accounting']
 where email = 'staff.acc@example.com';
update public.profiles set is_staff = true, staff_role = 'staff', staff_areas = array['finance']
 where email = 'staff.fin@example.com';
update public.profiles set is_staff = true, staff_role = 'staff'
 where email = 'staff.none@example.com';

insert into public.clients (id, name, entity_type) values
  ('a3a3a3a3-0000-0000-0000-000000000000', 'Mixed Ltd',   'limited_company'),
  ('f3f3f3f3-0000-0000-0000-000000000000', 'FinOnly Ltd', 'limited_company'),
  ('a4a4a4a4-0000-0000-0000-000000000000', 'Jobless Ltd', 'limited_company');
insert into public.client_contacts (client_id, profile_id, role) values
  ('a3a3a3a3-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('f3f3f3f3-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e2', 'owner');
insert into public.jobs (id, client_id, title, service) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000000', 'Mixed bookkeeping', 'bookkeeping'),
  ('f2f2f2f2-0000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000000', 'Mixed finance application', 'finance_application'),
  ('f2f2f2f2-0000-0000-0000-000000000002', 'f3f3f3f3-0000-0000-0000-000000000000', 'FinOnly referral', 'regulated_referral');
insert into public.requests (id, job_id, kind, title, question_type) values
  ('a1a1a1a1-1111-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 'question', 'Accounting question', 'text'),
  ('f2f2f2f2-1111-0000-0000-000000000001', 'f2f2f2f2-0000-0000-0000-000000000001', 'question', 'Finance question', 'text'),
  ('f2f2f2f2-1111-0000-0000-000000000002', 'f2f2f2f2-0000-0000-0000-000000000002', 'question', 'Referral question', 'text');
insert into public.responses (request_id, author_id, answer) values
  ('a1a1a1a1-1111-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', '{"value":"acc"}'),
  ('f2f2f2f2-1111-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', '{"value":"fin"}');
insert into public.files (id, client_id, job_id, storage_path, original_name, uploaded_by, scan_status) values
  ('a1a1a1a1-f000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001',
   'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/a1-acc.pdf', 'acc.pdf',
   '00000000-0000-0000-0000-0000000000e1', 'clean'),
  ('f2f2f2f2-f000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000000', 'f2f2f2f2-0000-0000-0000-000000000001',
   'a3a3a3a3-0000-0000-0000-000000000000/f2f2f2f2-0000-0000-0000-000000000001/f2-fin.pdf', 'fin.pdf',
   '00000000-0000-0000-0000-0000000000e1', 'clean');
insert into storage.objects (bucket_id, name) values
  ('client-files', 'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/a1-acc.pdf'),
  ('client-files', 'a3a3a3a3-0000-0000-0000-000000000000/f2f2f2f2-0000-0000-0000-000000000001/f2-fin.pdf');
insert into public.messages (job_id, author_id, body, internal) values
  ('a1a1a1a1-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Accounting note', true),
  ('a1a1a1a1-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Accounting hello', false),
  ('f2f2f2f2-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Finance note', true),
  ('f2f2f2f2-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Finance hello', false);
insert into public.consents (client_id, job_id, request_id, profile_id, consent_type, wording_version, wording_text) values
  ('a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001', 'a1a1a1a1-1111-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000e1', 'engagement_letter', 'test', 'accounting consent'),
  ('a3a3a3a3-0000-0000-0000-000000000000', 'f2f2f2f2-0000-0000-0000-000000000001', 'f2f2f2f2-1111-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000e1', 'lender_share', 'test', 'finance consent');
insert into public.templates (id, name, service, requests) values
  ('dddddddd-0000-0000-0000-000000000001', 'RLS finance fixture template', 'finance_application',
   '[{"kind":"upload","title":"Bank statements","due_offset_days":7}]'::jsonb);

-- Everything that exists right now, so "admin sees everything" does not assume an empty database.
create temp table pg_temp.areatotals as
  select (select count(*) from public.clients)        as clients,
         (select count(*) from public.jobs)           as jobs,
         (select count(*) from public.requests)       as requests,
         (select count(*) from public.responses)      as responses,
         (select count(*) from public.files)          as files,
         (select count(*) from public.messages)       as messages,
         (select count(*) from public.consents)       as consents,
         (select count(*) from storage.objects)       as objects;
grant select on pg_temp.areatotals to authenticated;

-- helpers: run a statement as the current role and report what happened
create or replace function pg_temp.changed(sql text) returns int language plpgsql as $$
declare n int;
begin execute sql; get diagnostics n = row_count; return n; end $$;
create or replace function pg_temp.denied(sql text) returns boolean language plpgsql as $$
begin execute sql; return false;
exception when insufficient_privilege then return true; end $$;

-- What the current person can see of one job: jobs, requests, responses, files, messages, consents, storage objects.
create or replace function pg_temp.seen(job uuid) returns text language sql as $$
  select concat_ws(',',
    (select count(*) from public.jobs where id = job),
    (select count(*) from public.requests where job_id = job),
    (select count(*) from public.responses r join public.requests q on q.id = r.request_id where q.job_id = job),
    (select count(*) from public.files where job_id = job),
    (select count(*) from public.messages where job_id = job),
    (select count(*) from public.consents where job_id = job),
    (select count(*) from storage.objects o join public.files f on f.storage_path = o.name where f.job_id = job)
  )
$$;

set role authenticated;

-- Admin sees everything, in both areas.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check(
  (select count(*) from public.jobs)      = (select jobs      from pg_temp.areatotals)
  and (select count(*) from public.clients)   = (select clients   from pg_temp.areatotals)
  and (select count(*) from public.requests)  = (select requests  from pg_temp.areatotals)
  and (select count(*) from public.responses) = (select responses from pg_temp.areatotals)
  and (select count(*) from public.files)     = (select files     from pg_temp.areatotals)
  and (select count(*) from public.messages)  = (select messages  from pg_temp.areatotals)
  and (select count(*) from public.consents)  = (select consents  from pg_temp.areatotals)
  and (select count(*) from storage.objects)  = (select objects   from pg_temp.areatotals),
  'admin sees everything, in both areas');
select pg_temp.check(pg_temp.seen('f2f2f2f2-0000-0000-0000-000000000001') = '1,1,1,1,2,1,1'
                     and pg_temp.seen('a1a1a1a1-0000-0000-0000-000000000001') = '1,1,1,1,2,1,1',
                     'admin sees every part of both a finance job and an accounting job');

-- ── Accounting-only staff ───────────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.check(pg_temp.seen('a1a1a1a1-0000-0000-0000-000000000001') = '1,1,1,1,2,1,1',
                     'accounting staff see every part of an accounting job');
select pg_temp.check(pg_temp.seen('f2f2f2f2-0000-0000-0000-000000000001') = '0,0,0,0,0,0,0',
                     'accounting staff see nothing of a finance job (job, requests, responses, files, messages, consents, storage), even with its ID');
select pg_temp.check(pg_temp.changed($q$update public.jobs set title = 'Hacked' where id = 'f2f2f2f2-0000-0000-0000-000000000001'$q$) = 0
                     and pg_temp.changed($q$update public.requests set title = 'Hacked' where job_id = 'f2f2f2f2-0000-0000-0000-000000000001'$q$) = 0
                     and pg_temp.changed($q$update public.files set visibility = 'internal' where job_id = 'f2f2f2f2-0000-0000-0000-000000000001'$q$) = 0
                     and pg_temp.denied($q$delete from public.files where job_id = 'f2f2f2f2-0000-0000-0000-000000000001'$q$)
                     and pg_temp.changed($q$delete from public.messages where job_id = 'f2f2f2f2-0000-0000-0000-000000000001'$q$) = 0,
                     'accounting staff cannot edit or delete anything on a finance job');
select pg_temp.check(
  pg_temp.denied($q$insert into public.requests (job_id, kind, title) values ('f2f2f2f2-0000-0000-0000-000000000001', 'upload', 'x')$q$)
  and pg_temp.denied($q$insert into public.messages (job_id, body, internal) values ('f2f2f2f2-0000-0000-0000-000000000001', 'x', true)$q$)
  and pg_temp.denied($q$insert into public.responses (request_id, answer) values ('f2f2f2f2-1111-0000-0000-000000000001', '{"value":"x"}')$q$)
  and pg_temp.denied($q$insert into public.job_contacts (job_id, profile_id) values ('f2f2f2f2-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1')$q$)
  and pg_temp.denied($q$insert into public.files (client_id, job_id, storage_path, original_name)
        values ('a3a3a3a3-0000-0000-0000-000000000000', 'f2f2f2f2-0000-0000-0000-000000000001',
                'a3a3a3a3-0000-0000-0000-000000000000/f2f2f2f2-0000-0000-0000-000000000001/x.pdf', 'x.pdf')$q$),
  'accounting staff cannot add requests, messages, answers, contacts or files to a finance job');
select pg_temp.check(
  pg_temp.denied($q$select public.create_job_from_template('a3a3a3a3-0000-0000-0000-000000000000',
        'dddddddd-0000-0000-0000-000000000001', 'Sneaky finance job', 'finance_application', null, null, null, '{}')$q$)
  and pg_temp.denied($q$select public.create_job_from_template('a3a3a3a3-0000-0000-0000-000000000000',
        'dddddddd-0000-0000-0000-000000000000', 'Accounting template, finance service', 'finance_application', null, null, null, '{}')$q$)
  and pg_temp.denied($q$select public.add_pending_request('f2f2f2f2-0000-0000-0000-000000000001', 0, null)$q$),
  'accounting staff cannot create a finance job (from a finance template, or by choosing a finance service) or add to one');
select pg_temp.check((select public.create_job_from_template('a3a3a3a3-0000-0000-0000-000000000000',
        'dddddddd-0000-0000-0000-000000000000', 'Allowed accounting job', 'bookkeeping', null, null, null, '{}')) is not null,
                     'accounting staff can create an accounting job from an accounting template');
select pg_temp.check((select area from public.jobs where title = 'Allowed accounting job') = 'accounting',
                     'a job''s area follows its service');
select pg_temp.check(
  (select count(*) from public.clients where id = 'a3a3a3a3-0000-0000-0000-000000000000') = 1       -- has an accounting job
  and (select count(*) from public.clients where id = 'f3f3f3f3-0000-0000-0000-000000000000') = 0    -- finance-only client
  and (select count(*) from public.clients where id = 'a4a4a4a4-0000-0000-0000-000000000000') = 1,   -- no jobs yet
  'accounting staff see a client if it has an accounting job or no jobs, but not a finance-only client');
select pg_temp.check(
  (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000e1') = 1
  and (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000e2') = 0,
  'accounting staff see contacts of clients they can access, not contacts of finance-only clients');
select pg_temp.check(
  pg_temp.denied($q$update public.profiles set staff_areas = array['accounting','finance'] where id = '00000000-0000-0000-0000-0000000000d1'$q$)
  and pg_temp.denied($q$select public.set_staff_areas('00000000-0000-0000-0000-0000000000d1', array['accounting','finance'])$q$),
  'staff cannot change their own areas (directly or through the function)');
select pg_temp.check(pg_temp.denied($q$select public.set_staff_areas('00000000-0000-0000-0000-0000000000d3', array['accounting'])$q$),
                     'staff cannot change anyone else''s areas either');

-- ── Finance-only staff: the reverse ─────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d2';
select pg_temp.check(pg_temp.seen('f2f2f2f2-0000-0000-0000-000000000001') = '1,1,1,1,2,1,1',
                     'finance staff see every part of a finance job');
select pg_temp.check(pg_temp.seen('a1a1a1a1-0000-0000-0000-000000000001') = '0,0,0,0,0,0,0',
                     'finance staff see nothing of an accounting job (job, requests, responses, files, messages, consents, storage), even with its ID');
select pg_temp.check(pg_temp.changed($q$update public.jobs set title = 'Hacked' where id = 'a1a1a1a1-0000-0000-0000-000000000001'$q$) = 0
                     and pg_temp.changed($q$update public.requests set title = 'Hacked' where job_id = 'a1a1a1a1-0000-0000-0000-000000000001'$q$) = 0
                     and pg_temp.denied($q$delete from public.files where job_id = 'a1a1a1a1-0000-0000-0000-000000000001'$q$)
                     and pg_temp.changed($q$delete from public.messages where job_id = 'a1a1a1a1-0000-0000-0000-000000000001'$q$) = 0,
                     'finance staff cannot edit or delete anything on an accounting job');
select pg_temp.check(
  pg_temp.denied($q$insert into public.requests (job_id, kind, title) values ('a1a1a1a1-0000-0000-0000-000000000001', 'upload', 'x')$q$)
  and pg_temp.denied($q$select public.create_job_from_template('a3a3a3a3-0000-0000-0000-000000000000',
        'dddddddd-0000-0000-0000-000000000000', 'Sneaky accounting job', 'bookkeeping', null, null, null, '{}')$q$),
  'finance staff cannot add to an accounting job or create one');
select pg_temp.check(
  (select count(*) from public.clients where id = 'f3f3f3f3-0000-0000-0000-000000000000') = 1
  and (select count(*) from public.clients where id = 'a3a3a3a3-0000-0000-0000-000000000000') = 1
  and (select count(*) from public.clients where id = 'aaaaaaaa-0000-0000-0000-000000000000') = 0,  -- accounting-only (Alpha)
  'finance staff see finance clients and mixed clients, but not an accounting-only client');

-- ── Staff with no areas see nothing ─────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d3';
select pg_temp.check((select count(*) from public.jobs) = 0 and (select count(*) from public.requests) = 0
                     and (select count(*) from public.responses) = 0 and (select count(*) from public.files) = 0
                     and (select count(*) from public.messages) = 0 and (select count(*) from public.consents) = 0
                     and (select count(*) from storage.objects) = 0 and (select count(*) from public.clients) = 0,
                     'staff with no areas see no jobs, requests, answers, files, messages, consents or clients');
select pg_temp.check(
  pg_temp.denied($q$insert into public.clients (name, entity_type) values ('No-area client', 'other')$q$)
  and pg_temp.denied($q$select public.create_job_from_template('a3a3a3a3-0000-0000-0000-000000000000',
        'dddddddd-0000-0000-0000-000000000000', 'No-area job', 'bookkeeping', null, null, null, '{}')$q$),
  'staff with no areas cannot create clients or jobs');

-- ── Only the admin grants areas, and it is audited ──────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.set_staff_areas('00000000-0000-0000-0000-0000000000d3', array['accounting', 'accounting']);
select pg_temp.check((select staff_areas from public.profiles where id = '00000000-0000-0000-0000-0000000000d3') = array['accounting'],
                     'admin can grant an area');
select pg_temp.check((select count(*) from public.audit_log
                      where action = 'staff_areas_changed' and entity_id = '00000000-0000-0000-0000-0000000000d3'
                        and actor_id = '00000000-0000-0000-0000-00000000000a'
                        and meta -> 'areas' = '["accounting"]'::jsonb and meta -> 'previous' = '[]'::jsonb) = 1,
                     'granting an area is audited');
do $$ begin
  perform public.set_staff_areas('00000000-0000-0000-0000-0000000000d3', array['sales']);
  raise exception 'RLS TEST FAILED: an unknown area was accepted';
exception when raise_exception then
  if sqlerrm like 'RLS TEST FAILED%' then raise; end if;
  raise notice 'ok  unknown areas are refused';
end $$;
do $$ begin
  perform public.set_staff_areas('00000000-0000-0000-0000-0000000000e1', array['accounting']);
  raise exception 'RLS TEST FAILED: areas were set on a client';
exception when sqlstate 'P0002' then raise notice 'ok  areas can only be set on staff';
end $$;
-- The grant takes effect straight away.
select public.set_staff_areas('00000000-0000-0000-0000-0000000000d3', array['finance']);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d3';
select pg_temp.check(pg_temp.seen('f2f2f2f2-0000-0000-0000-000000000001') = '1,1,1,1,2,1,1'
                     and pg_temp.seen('a1a1a1a1-0000-0000-0000-000000000001') = '0,0,0,0,0,0,0',
                     'a newly granted area takes effect immediately, and only that area');

-- ── Clients: both areas, or one ─────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.check(pg_temp.seen('a1a1a1a1-0000-0000-0000-000000000001') = '1,1,1,1,1,1,1'
                     and pg_temp.seen('f2f2f2f2-0000-0000-0000-000000000001') = '1,1,1,1,1,1,1'
                     and (select count(distinct area) from public.jobs) = 2,
                     'a client with jobs in both areas sees both (without internal notes)');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e2';
select pg_temp.check((select count(*) from public.jobs) = 1
                     and (select count(*) from public.jobs where area = 'accounting') = 0
                     and pg_temp.seen('a1a1a1a1-0000-0000-0000-000000000001') = '0,0,0,0,0,0,0'
                     and pg_temp.seen('f2f2f2f2-0000-0000-0000-000000000001') = '0,0,0,0,0,0,0'
                     and (select count(*) from public.clients) = 1,
                     'a finance-only client sees no accounting data, nor another client''s finance job');

reset role;
-- ── Files: staff documents, scanning, visibility, retention (migration 0005) ──
reset role;
create or replace function pg_temp.raises(sql text, pattern text) returns boolean language plpgsql as $$
begin execute sql; return false;
exception when others then return sqlerrm like pattern; end $$;
grant execute on function pg_temp.raises(text, text) to authenticated;

insert into public.requests (id, job_id, kind, title, consent_type) values
  ('a5a5a5a5-1111-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 'approval', 'Approve accounts', null),
  ('a5a5a5a5-1111-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000001', 'approval', 'Approve other', null),
  ('a5a5a5a5-1111-0000-0000-000000000003', 'a1a1a1a1-0000-0000-0000-000000000001', 'consent',  'Engagement letter', 'engagement_letter');
-- Staff documents: a shared draft (still being checked), an internal working paper (clean), a shared letter (checking).
insert into public.files (id, client_id, job_id, request_id, storage_path, original_name, uploaded_by, visibility, scan_status) values
  ('a5a5a5a5-f000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001',
   'a5a5a5a5-1111-0000-0000-000000000001',
   'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/a5-draft.pdf', 'draft.pdf',
   '00000000-0000-0000-0000-0000000000d1', 'client', 'pending'),
  ('a5a5a5a5-f000-0000-0000-000000000002', 'a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001',
   null,
   'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/a5-working.pdf', 'working.pdf',
   '00000000-0000-0000-0000-0000000000d1', 'internal', 'clean'),
  ('a5a5a5a5-f000-0000-0000-000000000003', 'a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001',
   'a5a5a5a5-1111-0000-0000-000000000003',
   'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/a5-letter.pdf', 'letter.pdf',
   '00000000-0000-0000-0000-0000000000d1', 'client', 'pending');
insert into storage.objects (bucket_id, name) values
  ('client-files', 'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/a5-draft.pdf'),
  ('client-files', 'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/a5-working.pdf'),
  ('client-files', 'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/a5-letter.pdf');
set role authenticated;

-- The client: sees shared documents (even while being checked) but never internal ones, nor their stored objects.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.check((select count(*) from public.files where id in
                        ('a5a5a5a5-f000-0000-0000-000000000001', 'a5a5a5a5-f000-0000-0000-000000000003')) = 2
                     and (select count(*) from public.files where id = 'a5a5a5a5-f000-0000-0000-000000000002') = 0,
                     'a client sees shared staff documents but never internal ones');
select pg_temp.check((select count(*) from storage.objects where name like '%/a5-%') = 0,
                     'a client cannot fetch a staff document until it is clean, nor an internal one even when clean');
select pg_temp.check(
  pg_temp.denied($q$insert into public.files (client_id, job_id, storage_path, original_name, visibility)
        values ('a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001',
                'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/c1-internal.pdf', 'c1.pdf', 'internal')$q$)
  and pg_temp.denied($q$insert into public.files (client_id, job_id, request_id, storage_path, original_name)
        values ('a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001', 'a5a5a5a5-1111-0000-0000-000000000001',
                'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/c2-approval.pdf', 'c2.pdf')$q$)
  and pg_temp.denied($q$insert into public.files (client_id, job_id, storage_path, original_name, scan_status)
        values ('a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001',
                'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/c3-clean.pdf', 'c3.pdf', 'clean')$q$),
  'a client cannot add internal files, attach files to approvals, or mark their own file clean');
select pg_temp.check(
  pg_temp.changed($q$update public.files set visibility = 'internal' where id = 'a5a5a5a5-f000-0000-0000-000000000001'$q$) = 0
  and pg_temp.denied($q$update public.files set scan_status = 'clean' where id = 'a5a5a5a5-f000-0000-0000-000000000001'$q$)
  and pg_temp.denied($q$delete from public.files where id = 'a5a5a5a5-f000-0000-0000-000000000001'$q$),
  'a client cannot change visibility or scan result, or delete a file');

-- Approvals and consents with attached documents wait for a clean one.
select pg_temp.check(
  pg_temp.raises($q$select public.submit_request('a5a5a5a5-1111-0000-0000-000000000001')$q$, '%still being checked%')
  and pg_temp.raises($q$select public.record_consent('a5a5a5a5-1111-0000-0000-000000000003', 'v1', 'wording')$q$, '%still being checked%'),
  'a client cannot approve or consent while the attached document is still being checked');
reset role;
update public.files set scan_status = 'error' where id in
  ('a5a5a5a5-f000-0000-0000-000000000001', 'a5a5a5a5-f000-0000-0000-000000000003');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.check(
  pg_temp.raises($q$select public.submit_request('a5a5a5a5-1111-0000-0000-000000000001')$q$, '%still being checked%'),
  'a document that failed its check does not unlock the approval');
reset role;
update public.files set scan_status = 'clean' where id in
  ('a5a5a5a5-f000-0000-0000-000000000001', 'a5a5a5a5-f000-0000-0000-000000000003');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.check((select count(*) from storage.objects where name like '%/a5-draft.pdf' or name like '%/a5-letter.pdf') = 2
                     and (select count(*) from storage.objects where name like '%/a5-working.pdf') = 0,
                     'once clean, the client can fetch shared documents but still not the internal one');
select public.submit_request('a5a5a5a5-1111-0000-0000-000000000001');
select public.record_consent('a5a5a5a5-1111-0000-0000-000000000003', 'v1', 'wording');
select pg_temp.check((select count(*) from public.requests where status = 'submitted'
                        and id in ('a5a5a5a5-1111-0000-0000-000000000001', 'a5a5a5a5-1111-0000-0000-000000000003')) = 2,
                     'with a clean document the client can approve and consent');
-- An approval with no documents attached still works as before.
select public.submit_request('a5a5a5a5-1111-0000-0000-000000000002');

-- Accounting staff: add and switch documents in their area only, and cannot touch scan results or retention.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.check(
  pg_temp.changed($q$insert into public.files (client_id, job_id, request_id, storage_path, original_name, visibility)
        values ('a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001', 'a5a5a5a5-1111-0000-0000-000000000002',
                'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/s1-shared.pdf', 's1.pdf', 'client')$q$) = 1
  and pg_temp.changed($q$insert into public.files (client_id, job_id, storage_path, original_name, visibility)
        values ('a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001',
                'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/s2-internal.pdf', 's2.pdf', 'internal')$q$) = 1,
  'accounting staff can add shared and internal documents to an accounting job');
select pg_temp.check((select scan_status from public.files where storage_path like '%/s1-shared.pdf') = 'pending',
                     'staff documents always start as pending');
select pg_temp.check(
  pg_temp.denied($q$insert into public.files (client_id, job_id, storage_path, original_name, scan_status)
        values ('a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001',
                'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/s3-clean.pdf', 's3.pdf', 'clean')$q$)
  and pg_temp.denied($q$insert into public.files (client_id, job_id, request_id, storage_path, original_name)
        values ('a3a3a3a3-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000001', 'a1a1a1a1-1111-0000-0000-000000000001',
                'a3a3a3a3-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000001/s4-question.pdf', 's4.pdf')$q$)
  and pg_temp.denied($q$insert into public.files (client_id, job_id, storage_path, original_name)
        values ('a3a3a3a3-0000-0000-0000-000000000000', 'f2f2f2f2-0000-0000-0000-000000000001',
                'a3a3a3a3-0000-0000-0000-000000000000/f2f2f2f2-0000-0000-0000-000000000001/s5-fin.pdf', 's5.pdf')$q$),
  'staff cannot insert a pre-cleaned file, attach to a question, or add to a job outside their area');
select pg_temp.check(
  pg_temp.denied($q$update public.files set scan_status = 'clean' where id = 'a5a5a5a5-f000-0000-0000-000000000001'$q$)
  and pg_temp.denied($q$update public.files set retain_until = '1990-01-01' where id = 'a5a5a5a5-f000-0000-0000-000000000001'$q$)
  and pg_temp.denied($q$update public.files set deleted_at = now() where id = 'a5a5a5a5-f000-0000-0000-000000000001'$q$)
  and pg_temp.denied($q$delete from public.files where id = 'a5a5a5a5-f000-0000-0000-000000000001'$q$),
  'staff cannot change scan results, retention dates or tombstones, or delete file records');
select pg_temp.check(
  pg_temp.changed($q$update public.files set visibility = 'internal' where id = 'a5a5a5a5-f000-0000-0000-000000000001'$q$) = 1
  and pg_temp.changed($q$update public.files set visibility = 'internal' where job_id = 'f2f2f2f2-0000-0000-0000-000000000001'$q$) = 0,
  'staff can switch visibility in their own area only');
reset role;
select pg_temp.check(exists (select 1 from public.audit_log
                              where entity = 'files' and entity_id = 'a5a5a5a5-f000-0000-0000-000000000001'
                                and meta ->> 'visibility' = 'internal' and actor_id = '00000000-0000-0000-0000-0000000000d1'),
                     'a visibility change is audited with who did it');
select pg_temp.check(not exists (select 1 from public.audit_log where meta::text ilike '%draft.pdf%'),
                     'the audit trail holds no file names');

-- Finance-only staff cannot see or switch the accounting documents.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d2';
select pg_temp.check((select count(*) from public.files where job_id = 'a1a1a1a1-0000-0000-0000-000000000001') = 0
                     and (select count(*) from storage.objects where name like '%/a5-%') = 0
                     and pg_temp.changed($q$update public.files set visibility = 'client' where id = 'a5a5a5a5-f000-0000-0000-000000000002'$q$) = 0,
                     'finance staff cannot see or switch accounting documents');

-- Tombstones disappear from every list and the stored object is unreachable.
reset role;
update public.files set deleted_at = now(), deleted_by = '00000000-0000-0000-0000-00000000000a'
 where id = 'a5a5a5a5-f000-0000-0000-000000000003';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.check((select count(*) from public.files where id = 'a5a5a5a5-f000-0000-0000-000000000003') = 0
                     and (select count(*) from storage.objects where name like '%/a5-letter.pdf') = 0,
                     'a deleted (tombstoned) file is gone for clients');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.check((select count(*) from public.files where id = 'a5a5a5a5-f000-0000-0000-000000000003') = 0
                     and (select count(*) from storage.objects where name like '%/a5-letter.pdf') = 0,
                     'a deleted (tombstoned) file is gone for staff');

-- Retention dates: 6 years after the period end, or after upload; onboarding follows the client's end date.
reset role;
insert into public.jobs (id, client_id, title, service, period_end) values
  ('a6a6a6a6-0000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000000', 'Retention year-end', 'year_end', '2024-03-31'),
  ('a6a6a6a6-0000-0000-0000-000000000002', 'a3a3a3a3-0000-0000-0000-000000000000', 'Retention ad hoc',   'other',    null),
  ('a6a6a6a6-0000-0000-0000-000000000003', 'a3a3a3a3-0000-0000-0000-000000000000', 'Retention onboarding', 'onboarding', null);
insert into public.files (id, client_id, job_id, storage_path, original_name, uploaded_by, retain_until) values
  ('a6a6a6a6-f000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000001',
   'a3a3a3a3-0000-0000-0000-000000000000/a6a6a6a6-0000-0000-0000-000000000001/r1.pdf', 'r1.pdf', '00000000-0000-0000-0000-0000000000e1', '1990-01-01'),
  ('a6a6a6a6-f000-0000-0000-000000000002', 'a3a3a3a3-0000-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000002',
   'a3a3a3a3-0000-0000-0000-000000000000/a6a6a6a6-0000-0000-0000-000000000002/r2.pdf', 'r2.pdf', '00000000-0000-0000-0000-0000000000e1', null),
  ('a6a6a6a6-f000-0000-0000-000000000003', 'a3a3a3a3-0000-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000003',
   'a3a3a3a3-0000-0000-0000-000000000000/a6a6a6a6-0000-0000-0000-000000000003/r3.pdf', 'r3.pdf', '00000000-0000-0000-0000-0000000000e1', null);
select pg_temp.check((select retain_until from public.files where id = 'a6a6a6a6-f000-0000-0000-000000000001') = date '2030-03-31',
                     'retention is 6 years after the job period end (a supplied date is ignored)');
select pg_temp.check((select retain_until from public.files where id = 'a6a6a6a6-f000-0000-0000-000000000002')
                       = ((now() at time zone 'Europe/London')::date + interval '6 years')::date,
                     'with no period end, retention is 6 years after upload');
select pg_temp.check((select retain_until from public.files where id = 'a6a6a6a6-f000-0000-0000-000000000003') is null,
                     'onboarding documents have no retention date while the client is active');
update public.clients set status = 'former' where id = 'a3a3a3a3-0000-0000-0000-000000000000';
select pg_temp.check((select ended_at from public.clients where id = 'a3a3a3a3-0000-0000-0000-000000000000')
                       = (now() at time zone 'Europe/London')::date
                     and (select retain_until from public.files where id = 'a6a6a6a6-f000-0000-0000-000000000003')
                       = ((now() at time zone 'Europe/London')::date + interval '5 years')::date
                     and (select retain_until from public.files where id = 'a6a6a6a6-f000-0000-0000-000000000001') = date '2030-03-31',
                     'marking a client former stamps the end date and sets onboarding retention to 5 years after it');
update public.clients set status = 'active' where id = 'a3a3a3a3-0000-0000-0000-000000000000';
select pg_temp.check((select ended_at from public.clients where id = 'a3a3a3a3-0000-0000-0000-000000000000') is null
                     and (select retain_until from public.files where id = 'a6a6a6a6-f000-0000-0000-000000000003') is null,
                     'reinstating a client clears the end date and the onboarding retention dates');

-- The migration backfills existing files with the same rule (clear the dates, recompute, same answers).
update public.files set retain_until = null
 where id in ('a6a6a6a6-f000-0000-0000-000000000001', 'a6a6a6a6-f000-0000-0000-000000000002');
update public.files set retain_until = public.compute_file_retention(job_id, client_id, created_at)
 where id in ('a6a6a6a6-f000-0000-0000-000000000001', 'a6a6a6a6-f000-0000-0000-000000000002');
select pg_temp.check((select retain_until from public.files where id = 'a6a6a6a6-f000-0000-0000-000000000001') = date '2030-03-31'
                     and (select retain_until from public.files where id = 'a6a6a6a6-f000-0000-0000-000000000002')
                       = ((now() at time zone 'Europe/London')::date + interval '6 years')::date,
                     'the retention backfill gives the same dates as the insert trigger');

-- The bucket accepts only the agreed types, and the working folders are private.
select pg_temp.check((select allowed_mime_types from storage.buckets where id = 'client-files')
                       @> array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'text/csv',
                                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
                     and not ((select allowed_mime_types from storage.buckets where id = 'client-files')
                              && array['application/msword', 'application/vnd.ms-excel']),
                     'the upload bucket allows PDF, photos, CSV, DOCX and XLSX and no longer .doc or .xls');
select pg_temp.check((select not public from storage.buckets where id = 'job-zips')
                     and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                                      and (qual ilike '%job-zips%' or with_check ilike '%job-zips%')),
                     'the temporary zip bucket is private and has no user policies');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.check(pg_temp.denied($q$select * from private.config$q$) and not has_schema_privilege('authenticated', 'private', 'usage')
                     and pg_temp.denied($q$select public.compute_file_retention(null, null, now())$q$),
                     'environment settings (including the webhook secret) are not reachable by signed-in users');
reset role;

reset role;
\o
\echo ALL RLS TESTS PASSED
