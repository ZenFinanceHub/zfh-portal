-- ZenFinanceHub Client Portal — base schema, RLS, RPCs, storage
-- Supabase project region: London (eu-west-2)
-- After applying: make yourself admin with
--   update public.profiles set is_staff = true, staff_role = 'admin' where email = 'craig@zen-finance.co.uk';

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  phone       text,
  is_staff    boolean not null default false,
  staff_role  text check (staff_role in ('admin', 'staff')),
  created_at  timestamptz not null default now(),
  constraint staff_role_matches check (
    (is_staff and staff_role is not null) or (not is_staff and staff_role is null)
  )
);

create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  entity_type     text not null check (entity_type in
                    ('limited_company', 'sole_trader', 'individual', 'partnership', 'llp', 'other')),
  company_number  text,
  utr             text,
  xero_contact_id text,
  year_end        date,
  assigned_to     uuid references public.profiles(id),
  status          text not null default 'active' check (status in ('prospect', 'active', 'former')),
  ended_at        date,              -- drives AML/retention dates
  created_at      timestamptz not null default now()
);

create table public.client_contacts (
  client_id  uuid not null references public.clients(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner', 'contributor')),
  created_at timestamptz not null default now(),
  primary key (client_id, profile_id)
);
create index client_contacts_profile_idx on public.client_contacts (profile_id);

create table public.templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  service     text not null check (service in
                ('year_end', 'self_assessment', 'bookkeeping', 'payroll', 'vat', 'property',
                 'onboarding', 'finance_application', 'regulated_referral', 'other')),
  description text,
  requests    jsonb not null default '[]'::jsonb,  -- array of request blueprints
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete restrict,
  template_id   uuid references public.templates(id) on delete set null,
  title         text not null,
  service       text not null check (service in
                  ('year_end', 'self_assessment', 'bookkeeping', 'payroll', 'vat', 'property',
                   'onboarding', 'finance_application', 'regulated_referral', 'other')),
  stage         text not null default 'waiting_on_client' check (stage in
                  ('waiting_on_client', 'in_progress', 'ready_to_review', 'completed', 'cancelled')),
  finance_stage text check (finance_stage in
                  ('gathering', 'submitted', 'credit_decision', 'offer', 'completed', 'declined')),
  period_end    date,
  due_date      date,
  assigned_to   uuid references public.profiles(id),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index jobs_client_idx on public.jobs (client_id);

create table public.job_contacts (
  job_id     uuid not null references public.jobs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (job_id, profile_id)
);
create index job_contacts_profile_idx on public.job_contacts (profile_id);

create table public.requests (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  kind          text not null check (kind in ('upload', 'question', 'approval', 'consent')),
  title         text not null,
  help_text     text,
  question_type text check (question_type in ('text', 'yes_no', 'choice', 'date', 'amount')),
  options       jsonb,
  consent_type  text check (consent_type in ('lender_share', 'regulated_referral', 'engagement_letter')),
  status        text not null default 'open' check (status in
                  ('open', 'submitted', 'accepted', 'returned', 'cancelled')),
  return_reason text,
  due_date      date,
  sort_order    int not null default 0,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  submitted_by  uuid references public.profiles(id),
  constraint question_needs_type check (kind <> 'question' or question_type is not null),
  constraint consent_needs_type  check (kind <> 'consent'  or consent_type  is not null)
);
create index requests_job_idx on public.requests (job_id);

create table public.responses (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) default auth.uid(),
  answer     jsonb not null,
  created_at timestamptz not null default now()
);
create index responses_request_idx on public.responses (request_id);

create table public.files (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete restrict,
  job_id        uuid references public.jobs(id) on delete restrict,
  request_id    uuid references public.requests(id) on delete set null,
  storage_path  text not null unique,
  original_name text not null,
  mime_type     text,
  size_bytes    bigint,
  sha256        text,
  uploaded_by   uuid not null references public.profiles(id) default auth.uid(),
  scan_status   text not null default 'pending' check (scan_status in ('pending', 'clean', 'infected', 'error')),
  visibility    text not null default 'client' check (visibility in ('client', 'internal')),
  retain_until  date,
  created_at    timestamptz not null default now(),
  constraint path_starts_with_client check (storage_path like client_id::text || '/%')
);
create index files_job_idx on public.files (job_id);
create index files_request_idx on public.files (request_id);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) default auth.uid(),
  body       text not null check (char_length(body) between 1 and 5000),
  internal   boolean not null default false,   -- staff-only notes
  created_at timestamptz not null default now()
);
create index messages_job_idx on public.messages (job_id, created_at);

create table public.consents (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete restrict,
  job_id          uuid references public.jobs(id) on delete restrict,
  request_id      uuid references public.requests(id) on delete set null,
  profile_id      uuid not null references public.profiles(id),
  consent_type    text not null check (consent_type in ('lender_share', 'regulated_referral', 'engagement_letter')),
  wording_version text not null,
  wording_text    text not null,     -- exact text the client agreed to
  recipient       text,              -- e.g. lender panel, named partner firm
  ip              text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  client_id  uuid,
  ip         text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_client_idx on public.audit_log (client_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- Helper functions (security definer so policies don't recurse)
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_staff from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.staff_role = 'admin' from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function public.can_access_client(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from public.client_contacts cc
    where cc.client_id = p_client_id and cc.profile_id = auth.uid()
  )
$$;

create or replace function public.is_client_owner(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_contacts cc
    where cc.client_id = p_client_id and cc.profile_id = auth.uid() and cc.role = 'owner'
  )
$$;

create or replace function public.can_access_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1
    from public.jobs j
    join public.client_contacts cc
      on cc.client_id = j.client_id and cc.profile_id = auth.uid()
    where j.id = p_job_id
      and (cc.role = 'owner'
           or exists (select 1 from public.job_contacts jc
                      where jc.job_id = j.id and jc.profile_id = auth.uid()))
  )
$$;

create or replace function public.request_ip() returns text
language sql stable as $$
  select nullif(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1), '')
$$;

create or replace function public.request_user_agent() returns text
language sql stable as $$
  select nullif(current_setting('request.headers', true), '')::json ->> 'user-agent'
$$;

-- ─────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

-- Generic audit trigger: records who did what, never the content itself
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
      'request_id',    v_row ->> 'request_id'
    ))
  );
  return new;
end $$;

create trigger audit_requests  after insert or update of status on public.requests
  for each row execute function public.audit_row();
create trigger audit_responses after insert on public.responses
  for each row execute function public.audit_row();
create trigger audit_files     after insert or update of scan_status, visibility on public.files
  for each row execute function public.audit_row();
create trigger audit_consents  after insert on public.consents
  for each row execute function public.audit_row();
create trigger audit_jobs      after insert or update of stage, finance_stage on public.jobs
  for each row execute function public.audit_row();
create trigger audit_messages  after insert on public.messages
  for each row execute function public.audit_row();

-- ─────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────

alter table public.profiles        enable row level security;
alter table public.clients         enable row level security;
alter table public.client_contacts enable row level security;
alter table public.templates       enable row level security;
alter table public.jobs            enable row level security;
alter table public.job_contacts    enable row level security;
alter table public.requests        enable row level security;
alter table public.responses       enable row level security;
alter table public.files           enable row level security;
alter table public.messages        enable row level security;
alter table public.consents        enable row level security;
alter table public.audit_log       enable row level security;

-- profiles: own row, staff see all, everyone can see staff names (for message authors)
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff() or is_staff);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- clients may only edit these columns; staff flags are changed via SQL / service role
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- clients
create policy clients_select on public.clients for select to authenticated
  using (public.can_access_client(id));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_staff());
create policy clients_update on public.clients for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy clients_delete on public.clients for delete to authenticated
  using (public.is_admin());

-- client_contacts
create policy client_contacts_select on public.client_contacts for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());
create policy client_contacts_staff on public.client_contacts for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- templates: staff only
create policy templates_staff on public.templates for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- jobs
create policy jobs_select on public.jobs for select to authenticated
  using (public.can_access_job(id));
create policy jobs_staff on public.jobs for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- job_contacts
create policy job_contacts_select on public.job_contacts for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());
create policy job_contacts_staff on public.job_contacts for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- requests: clients read; state changes only via RPC
create policy requests_select on public.requests for select to authenticated
  using (public.can_access_job(job_id));
create policy requests_staff on public.requests for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- responses: clients add answers to open requests on their jobs; no edits/deletes
create policy responses_select on public.responses for select to authenticated
  using (exists (select 1 from public.requests r
                 where r.id = responses.request_id and public.can_access_job(r.job_id)));
create policy responses_insert on public.responses for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.requests r
                where r.id = responses.request_id
                  and r.kind = 'question'
                  and r.status in ('open', 'returned')
                  and public.can_access_job(r.job_id))
  );
create policy responses_staff on public.responses for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- files
create policy files_select on public.files for select to authenticated
  using (
    public.is_staff()
    or (visibility = 'client' and (
          (job_id is null and public.is_client_owner(client_id))
          or (job_id is not null and public.can_access_job(job_id))
       ))
  );
create policy files_client_insert on public.files for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and scan_status = 'pending'
    and visibility = 'client'
    and job_id is not null
    and public.can_access_job(job_id)
    and exists (select 1 from public.jobs j where j.id = files.job_id and j.client_id = files.client_id)
    and storage_path like files.client_id::text || '/' || files.job_id::text || '/%'
    and (request_id is null or exists (
          select 1 from public.requests r
          where r.id = files.request_id and r.job_id = files.job_id
            and r.kind = 'upload' and r.status in ('open', 'returned')))
  );
create policy files_staff on public.files for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- messages
create policy messages_select on public.messages for select to authenticated
  using (public.can_access_job(job_id) and (not internal or public.is_staff()));
create policy messages_insert on public.messages for insert to authenticated
  with check (author_id = auth.uid() and public.can_access_job(job_id)
              and (not internal or public.is_staff()));

-- consents: read own or staff; written only via record_consent()
create policy consents_select on public.consents for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());

-- audit_log: admin read only; written only by triggers / log_event()
create policy audit_admin_select on public.audit_log for select to authenticated
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- RPCs for client actions
-- ─────────────────────────────────────────────────────────────

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
  if r.kind = 'upload' and not exists (select 1 from public.files f where f.request_id = r.id) then
    raise exception 'Please upload at least one file';
  end if;
  if r.kind = 'question' and not exists (select 1 from public.responses x where x.request_id = r.id) then
    raise exception 'Please answer the question first';
  end if;
  if r.kind = 'consent' then
    raise exception 'Use record_consent for consent requests';
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

create or replace function public.log_event(
  p_action    text,
  p_entity    text,
  p_entity_id uuid,
  p_client_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_action not in ('file_download', 'job_zip_download', 'login', 'client_export', 'lender_pack_download') then
    raise exception 'Unknown action';
  end if;
  if p_client_id is not null and not public.can_access_client(p_client_id) then
    raise exception 'Not allowed';
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, client_id, ip)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_client_id, public.request_ip());
end $$;

-- Function privileges: nothing for anonymous users
revoke execute on function public.is_staff()                         from public, anon;
revoke execute on function public.is_admin()                         from public, anon;
revoke execute on function public.can_access_client(uuid)            from public, anon;
revoke execute on function public.is_client_owner(uuid)              from public, anon;
revoke execute on function public.can_access_job(uuid)               from public, anon;
revoke execute on function public.submit_request(uuid)               from public, anon;
revoke execute on function public.record_consent(uuid, text, text, text) from public, anon;
revoke execute on function public.log_event(text, text, uuid, uuid)  from public, anon;
revoke execute on function public.handle_new_user()                  from public, anon, authenticated;
revoke execute on function public.audit_row()                        from public, anon, authenticated;

grant execute on function public.is_staff()                          to authenticated;
grant execute on function public.is_admin()                          to authenticated;
grant execute on function public.can_access_client(uuid)             to authenticated;
grant execute on function public.is_client_owner(uuid)               to authenticated;
grant execute on function public.can_access_job(uuid)                to authenticated;
grant execute on function public.submit_request(uuid)                to authenticated;
grant execute on function public.record_consent(uuid, text, text, text) to authenticated;
grant execute on function public.log_event(text, text, uuid, uuid)   to authenticated;

-- Nothing for the anon role on any table
revoke all on all tables in schema public from anon;

-- ─────────────────────────────────────────────────────────────
-- Storage: private bucket, access mirrors the files table
-- ─────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-files', 'client-files', false, 26214400,  -- 25 MB
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

-- Read: only objects that have a visible files row; clients only once scanned clean
create policy client_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'client-files'
    and exists (
      select 1 from public.files f
      where f.storage_path = name
        and (
          (public.is_staff() and f.scan_status <> 'infected')
          or f.scan_status = 'clean'
        )
    )
  );

-- Upload: only to a path already registered by this user in public.files
create policy client_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-files'
    and exists (
      select 1 from public.files f
      where f.storage_path = name and f.uploaded_by = auth.uid()
    )
  );

-- No update/delete policies: uploaded objects are immutable for users.
-- Deletion (retention expiry, infected files) runs in edge functions with the service role.
