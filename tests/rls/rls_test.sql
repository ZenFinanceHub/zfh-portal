-- RLS test suite for the ZenFinanceHub portal.
-- Runs against a database with 0001_init.sql applied (plain Postgres + supabase_stub.sql, or a local Supabase).
-- Every check raises an exception on failure, so the script stops at the first breach.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

-- ── Fixtures (as superuser) ─────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'craig@zen-finance.co.uk'),
  ('00000000-0000-0000-0000-0000000000a1', 'owner.a@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'bookkeeper.a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner.b@example.com');
update public.profiles set is_staff = true, staff_role = 'admin' where email = 'craig@zen-finance.co.uk';

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
select pg_temp.check((select count(*) from public.profiles) = 2,                      'owner A sees own profile + staff profile only');

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
select pg_temp.check((select count(*) from public.clients) = 2,   'admin sees all clients');
select pg_temp.check((select count(*) from public.messages) = 1,  'admin sees internal notes');
select pg_temp.check((select count(*) from public.audit_log) > 0, 'audit log recorded client actions');
select pg_temp.check((select count(*) from public.audit_log where meta::text like '%12500%') = 0,
                     'audit log holds no answer content');

reset role;
\o
\echo ALL RLS TESTS PASSED
