-- Prompt 6: files — scanning, staff documents, retention.
--
--  * Allowed upload types: legacy .doc / .xls removed (macro-capable, hard to check without a scanner).
--  * files: scan bookkeeping (attempts, retry flag), retention tombstones (deleted_at), retain_until set by trigger.
--  * Staff can add documents (shared or internal) and switch visibility; they cannot change scan results,
--    retention dates or delete rows. Clients can never add internal files or change visibility.
--  * Approvals / consents with attached documents cannot be completed until one attached document is clean.
--  * A database trigger on storage.objects calls the scan-file edge function (URL kept in private.config).
--  * A cron job asks scan-file to retry stuck scans every 5 minutes.

-- ─────────────────────────────────────────────────────────────
-- Allowed file types
-- ─────────────────────────────────────────────────────────────
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
     'text/csv',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
   ]
 where id = 'client-files';

-- Temporary zips for staff downloads. Private, no policies: only edge functions (service role) touch it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-zips', 'job-zips', false, 524288000, array['application/zip'])
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- files: new columns
-- ─────────────────────────────────────────────────────────────
alter table public.files
  add column scan_attempts smallint    not null default 0,
  add column scan_retry    boolean     not null default false,   -- an error that is worth trying again
  add column scanned_at    timestamptz,
  add column deleted_at    timestamptz,                          -- tombstone: object removed, row kept
  add column deleted_by    uuid references public.profiles(id);

create index files_retain_idx on public.files (retain_until) where deleted_at is null;

-- The audit trail also records what a file's visibility / scan status changed to (never names or content).
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(new);
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, client_id, ip, meta)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    (v_row ->> 'client_id')::uuid,
    public.request_ip(),
    jsonb_strip_nulls(jsonb_build_object(
      'status',        v_row ->> 'status',
      'stage',         v_row ->> 'stage',
      'finance_stage', v_row ->> 'finance_stage',
      'kind',          v_row ->> 'kind',
      'job_id',        v_row ->> 'job_id',
      'request_id',    v_row ->> 'request_id',
      'scan_status',   case when tg_table_name = 'files' then v_row ->> 'scan_status' end,
      'visibility',    case when tg_table_name = 'files' then v_row ->> 'visibility' end
    ))
  );
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Retention
--   Ordinary files:      6 years after the job's period_end (or the upload date if the job has none).
--   Onboarding files:    5 years after the client's ended_at (empty until the client ends).
-- ─────────────────────────────────────────────────────────────
create or replace function public.compute_file_retention(p_job_id uuid, p_client_id uuid, p_created timestamptz)
returns date
language plpgsql stable security definer set search_path = public as $$
declare
  j public.jobs;
  v_ended date;
begin
  if p_job_id is not null then
    select * into j from public.jobs where id = p_job_id;
  end if;

  if j.service = 'onboarding' then
    select c.ended_at into v_ended from public.clients c where c.id = p_client_id;
    return case when v_ended is null then null else (v_ended + interval '5 years')::date end;
  end if;
  return (coalesce(j.period_end, (p_created at time zone 'Europe/London')::date) + interval '6 years')::date;
end $$;

create or replace function public.set_file_retention() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.retain_until := public.compute_file_retention(new.job_id, new.client_id, new.created_at);
  return new;
end $$;

create trigger files_set_retention before insert on public.files
  for each row execute function public.set_file_retention();

-- Marking a client "former" stamps the end date; that starts the clock on their onboarding documents.
create or replace function public.client_end_dates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = 'former' and old.status is distinct from 'former' and new.ended_at is null then
    new.ended_at := (now() at time zone 'Europe/London')::date;
  elsif tg_op = 'UPDATE' and new.status <> 'former' and old.status = 'former' then
    new.ended_at := null;
  end if;
  return new;
end $$;

create trigger clients_end_dates before update of status on public.clients
  for each row execute function public.client_end_dates();

create or replace function public.client_retention_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.files f
     set retain_until = case when new.ended_at is null then null else (new.ended_at + interval '5 years')::date end
    from public.jobs j
   where f.job_id = j.id and j.client_id = new.id and j.service = 'onboarding' and f.deleted_at is null;
  return new;
end $$;

create trigger clients_retention_follow after update of status, ended_at on public.clients
  for each row when (old.ended_at is distinct from new.ended_at)
  execute function public.client_retention_follow();

revoke execute on function public.compute_file_retention(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_file_retention()      from public, anon, authenticated;

-- Files that already exist get their retention date now (the insert trigger only covers new files).
update public.files
   set retain_until = public.compute_file_retention(job_id, client_id, created_at)
 where deleted_at is null;
revoke execute on function public.client_end_dates()        from public, anon, authenticated;
revoke execute on function public.client_retention_follow() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Who can change what on files
--   Columns: staff may only change visibility. Scan results, retention and tombstones are set by
--   database functions and edge functions. Nobody deletes rows through the API.
-- ─────────────────────────────────────────────────────────────
revoke update, delete on public.files from authenticated;
grant  update (visibility) on public.files to authenticated;

drop policy if exists files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    deleted_at is null and (
      public.staff_can_access_optional_job(job_id)
      or (visibility = 'client' and (
            (job_id is null and public.is_client_owner(client_id))
            or (job_id is not null and public.can_access_job(job_id))
         ))
    )
  );

drop policy if exists files_staff on public.files;

-- Staff add documents to a job they can access. They always start as "pending"; only the scanner changes that.
-- Staff documents can be attached to approvals and consents (the draft accounts, the engagement letter).
create policy files_staff_insert on public.files for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and scan_status = 'pending'
    and job_id is not null
    and public.staff_can_access_job(job_id)
    and exists (select 1 from public.jobs j where j.id = files.job_id and j.client_id = files.client_id)
    and storage_path like files.client_id::text || '/' || files.job_id::text || '/%'
    and (request_id is null or exists (
          select 1 from public.requests r
          where r.id = files.request_id and r.job_id = files.job_id and r.kind in ('approval', 'consent')))
  );

create policy files_staff_update on public.files for update to authenticated
  using (deleted_at is null and public.staff_can_access_optional_job(job_id))
  with check (public.staff_can_access_optional_job(job_id));

-- Storage: reading goes through the files table (and its policies), so a client can only ever fetch a
-- clean file that they can see, never an internal one. Staff can fetch anything not infected in their areas.
drop policy if exists client_files_read on storage.objects;
create policy client_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'client-files'
    and exists (
      select 1 from public.files f
      where f.storage_path = name
        and f.deleted_at is null
        and (
          f.scan_status = 'clean'
          or (public.staff_can_access_optional_job(f.job_id) and f.scan_status <> 'infected')
        )
    )
  );

-- ─────────────────────────────────────────────────────────────
-- RPCs: submitting needs a usable file; approvals/consents need a clean attached document
-- ─────────────────────────────────────────────────────────────
create or replace function public.attached_documents_ready(p_request_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
           select 1 from public.files f
           where f.request_id = p_request_id and f.visibility = 'client' and f.deleted_at is null)
         or exists (
           select 1 from public.files f
           where f.request_id = p_request_id and f.visibility = 'client' and f.deleted_at is null
             and f.scan_status = 'clean');
$$;
revoke execute on function public.attached_documents_ready(uuid) from public, anon;
grant  execute on function public.attached_documents_ready(uuid) to authenticated;

create or replace function public.submit_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r        public.requests;
  v_client uuid;
begin
  select * into r from public.requests where id = p_request_id for update;
  if not found or not public.can_access_job(r.job_id) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if r.status not in ('open', 'returned') then
    raise exception 'This request is no longer open';
  end if;

  select j.client_id into v_client from public.jobs j where j.id = r.job_id;

  if r.kind in ('approval', 'consent') and not (public.is_staff() or public.is_client_owner(v_client)) then
    raise exception 'Only the account owner can approve this';
  end if;
  if r.kind = 'upload' and not exists (
       select 1 from public.files f
       where f.request_id = r.id and f.deleted_at is null and f.scan_status in ('pending', 'clean')) then
    raise exception 'Please upload at least one file';
  end if;
  if r.kind = 'question' and not exists (select 1 from public.responses x where x.request_id = r.id) then
    raise exception 'Please answer the question first';
  end if;
  if r.kind = 'consent' then
    raise exception 'Use record_consent for consent requests';
  end if;
  if r.kind = 'approval' and not public.attached_documents_ready(r.id) then
    raise exception 'The documents are still being checked';
  end if;

  update public.requests
     set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(), return_reason = null
   where id = r.id;
end $$;

create or replace function public.record_consent(
  p_request_id      uuid,
  p_wording_version text,
  p_wording_text    text,
  p_recipient       text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r        public.requests;
  v_client uuid;
  v_id     uuid;
begin
  select * into r from public.requests where id = p_request_id for update;
  if not found or r.kind <> 'consent' or not public.can_access_job(r.job_id) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if r.status not in ('open', 'returned') then
    raise exception 'This request is no longer open';
  end if;

  select j.client_id into v_client from public.jobs j where j.id = r.job_id;
  if not public.is_client_owner(v_client) then
    raise exception 'Only the account owner can give this consent';
  end if;
  if not public.attached_documents_ready(r.id) then
    raise exception 'The documents are still being checked';
  end if;

  insert into public.consents
    (client_id, job_id, request_id, profile_id, consent_type, wording_version, wording_text,
     recipient, ip, user_agent)
  values
    (v_client, r.job_id, r.id, auth.uid(), r.consent_type, p_wording_version, p_wording_text,
     p_recipient, public.request_ip(), public.request_user_agent())
  returning id into v_id;

  update public.requests
     set status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
   where id = r.id;

  return v_id;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Scanning: storage trigger + retry sweep
--   private.config holds environment settings (the scan-file URL). It is not reachable through the API.
--   Until scan_file_url and scan_webhook_secret are set, nothing is called (so a fresh database never calls
--   anywhere by accident). The secret is sent as the x-webhook-secret header; scan-file checks it.
-- ─────────────────────────────────────────────────────────────
create extension if not exists pg_net  with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.config (
  key   text primary key,
  value text not null
);
alter table private.config enable row level security;
revoke all on private.config from public, anon, authenticated;

create or replace function private.call_scan_function(p_body jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from private.config where key = 'scan_file_url';
  select value into v_secret from private.config where key = 'scan_webhook_secret';
  -- Both must be set: the function refuses calls without the shared secret.
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url     := v_url,
    body    := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000
  );
exception when others then
  -- Never block an upload because the scanner could not be reached; the sweep will pick the file up.
  null;
end $$;

create or replace function private.on_client_file_object() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.bucket_id = 'client-files' then
    perform private.call_scan_function(jsonb_build_object(
      'type', 'INSERT',
      'record', jsonb_build_object('bucket_id', new.bucket_id, 'name', new.name)));
  end if;
  return new;
end $$;

create trigger scan_new_client_file after insert on storage.objects
  for each row execute function private.on_client_file_object();

revoke execute on function private.call_scan_function(jsonb)  from public, anon, authenticated;
revoke execute on function private.on_client_file_object()    from public, anon, authenticated;

-- Every 5 minutes: rescan files stuck as pending, and retry errors that are worth another go.
select cron.schedule('scan-file-sweep', '*/5 * * * *',
  $$select private.call_scan_function('{"type":"SWEEP"}'::jsonb)$$);
