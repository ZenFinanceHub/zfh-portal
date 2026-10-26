-- Prompt 6: two areas, Accounting and Finance ("Business Finance" to clients).
--
-- * jobs.area / templates.area are GENERATED from service, so they can never drift.
-- * profiles.staff_areas says which areas a staff member may work in. Admin always has both.
--   New staff start with none and see nothing until the admin grants an area (set_staff_areas()).
-- * Every staff policy and RPC now also requires access to the job's area. Files, messages, responses,
--   consents and storage objects get their area through their job.
-- * Staff see a client only if they can access an area the client has a job in, or the client has no jobs
--   yet (so new clients can be set up). Admin sees all.
--
-- Decision recorded for review: a staff member with NO areas sees no clients at all, including job-less
-- ones (the brief says new staff "see nothing until I grant an area").

-- ─────────────────────────────────────────────────────────────
-- Area is derived from service, in one place
-- ─────────────────────────────────────────────────────────────

create or replace function public.area_of_service(p_service text) returns text
language sql immutable parallel safe as $$
  select case when p_service in ('finance_application', 'regulated_referral') then 'finance' else 'accounting' end
$$;

alter table public.jobs
  add column area text not null generated always as (public.area_of_service(service)) stored
  check (area in ('accounting', 'finance'));
create index jobs_area_idx on public.jobs (area);

alter table public.templates
  add column area text not null generated always as (public.area_of_service(service)) stored
  check (area in ('accounting', 'finance'));

alter table public.profiles
  add column staff_areas text[] not null default '{}'
  check (staff_areas <@ array['accounting', 'finance']::text[]);
-- (Users cannot update this column: only full_name and phone are granted. Admin uses set_staff_areas().)

-- ─────────────────────────────────────────────────────────────
-- Helpers (security definer so policies don't recurse)
-- ─────────────────────────────────────────────────────────────

-- Admin, or staff whose staff_areas contains the area.
create or replace function public.staff_can_access_area(p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.is_staff and (p.staff_role = 'admin' or p_area = any (p.staff_areas))
    from public.profiles p where p.id = auth.uid()
  ), false)
$$;

-- Admin, or staff with at least one area.
create or replace function public.staff_has_any_area() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.is_staff and (p.staff_role = 'admin' or cardinality(p.staff_areas) > 0)
    from public.profiles p where p.id = auth.uid()
  ), false)
$$;

create or replace function public.staff_can_access_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.staff_can_access_area(j.area) from public.jobs j where j.id = p_job_id), false)
$$;

-- Things that may or may not belong to a job (files, consents): job-less ones need any area.
create or replace function public.staff_can_access_optional_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_job_id is null then public.staff_has_any_area() else public.staff_can_access_job(p_job_id) end
$$;

-- Admin; or staff with an area, when the client has no jobs yet or has a job in an area they can access.
create or replace function public.staff_can_access_client(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    public.staff_has_any_area() and (
      not exists (select 1 from public.jobs j where j.client_id = p_client_id)
      or exists (select 1 from public.jobs j
                 where j.client_id = p_client_id and public.staff_can_access_area(j.area))
    )
  )
$$;

-- The two existing helpers keep their names and meaning for clients, but staff are now area-aware.
create or replace function public.can_access_client(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.staff_can_access_client(p_client_id) or exists (
    select 1 from public.client_contacts cc
    where cc.client_id = p_client_id and cc.profile_id = auth.uid()
  )
$$;

create or replace function public.can_access_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.staff_can_access_job(p_job_id) or exists (
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

revoke execute on function public.area_of_service(text)                from public, anon;
revoke execute on function public.staff_can_access_area(text)          from public, anon;
revoke execute on function public.staff_has_any_area()                 from public, anon;
revoke execute on function public.staff_can_access_job(uuid)           from public, anon;
revoke execute on function public.staff_can_access_optional_job(uuid)  from public, anon;
revoke execute on function public.staff_can_access_client(uuid)        from public, anon;
grant  execute on function public.area_of_service(text)                to authenticated;
grant  execute on function public.staff_can_access_area(text)          to authenticated;
grant  execute on function public.staff_has_any_area()                 to authenticated;
grant  execute on function public.staff_can_access_job(uuid)           to authenticated;
grant  execute on function public.staff_can_access_optional_job(uuid)  to authenticated;
grant  execute on function public.staff_can_access_client(uuid)        to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Policies: every staff path now goes through the helpers above
-- ─────────────────────────────────────────────────────────────

-- profiles: your own; everyone sees staff (message authors, assignee pickers); staff and admin see the
-- contacts of clients they can access (not clients from areas they cannot).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or is_staff
    or public.is_admin()
    or exists (select 1 from public.client_contacts cc
               where cc.profile_id = profiles.id and public.staff_can_access_client(cc.client_id))
  );

-- clients
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert to authenticated
  with check (public.staff_has_any_area());
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update to authenticated
  using (public.staff_can_access_client(id)) with check (public.staff_can_access_client(id));

-- client_contacts
drop policy if exists client_contacts_select on public.client_contacts;
create policy client_contacts_select on public.client_contacts for select to authenticated
  using (profile_id = auth.uid() or public.staff_can_access_client(client_id));
drop policy if exists client_contacts_staff on public.client_contacts;
create policy client_contacts_staff on public.client_contacts for all to authenticated
  using (public.staff_can_access_client(client_id)) with check (public.staff_can_access_client(client_id));

-- jobs
drop policy if exists jobs_staff on public.jobs;
create policy jobs_staff on public.jobs for all to authenticated
  using (public.staff_can_access_area(area)) with check (public.staff_can_access_area(area));

-- job_contacts
drop policy if exists job_contacts_select on public.job_contacts;
create policy job_contacts_select on public.job_contacts for select to authenticated
  using (profile_id = auth.uid() or public.staff_can_access_job(job_id));
drop policy if exists job_contacts_staff on public.job_contacts;
create policy job_contacts_staff on public.job_contacts for all to authenticated
  using (public.staff_can_access_job(job_id)) with check (public.staff_can_access_job(job_id));

-- requests
drop policy if exists requests_staff on public.requests;
create policy requests_staff on public.requests for all to authenticated
  using (public.staff_can_access_job(job_id)) with check (public.staff_can_access_job(job_id));

-- responses
drop policy if exists responses_staff on public.responses;
create policy responses_staff on public.responses for all to authenticated
  using (exists (select 1 from public.requests r
                 where r.id = responses.request_id and public.staff_can_access_job(r.job_id)))
  with check (exists (select 1 from public.requests r
                      where r.id = responses.request_id and public.staff_can_access_job(r.job_id)));

-- files
drop policy if exists files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    public.staff_can_access_optional_job(job_id)
    or (visibility = 'client' and (
          (job_id is null and public.is_client_owner(client_id))
          or (job_id is not null and public.can_access_job(job_id))
       ))
  );
drop policy if exists files_staff on public.files;
create policy files_staff on public.files for all to authenticated
  using (public.staff_can_access_optional_job(job_id)) with check (public.staff_can_access_optional_job(job_id));

-- messages: internal notes only for staff who can access the job's area
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.can_access_job(job_id) and (not internal or public.staff_can_access_job(job_id)));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (author_id = auth.uid() and public.can_access_job(job_id)
              and (not internal or public.staff_can_access_job(job_id)));

-- consents
drop policy if exists consents_select on public.consents;
create policy consents_select on public.consents for select to authenticated
  using (profile_id = auth.uid() or public.staff_can_access_optional_job(job_id));

-- storage objects: the files table (and its policies) decide what is visible; staff still never get infected files
drop policy if exists client_files_read on storage.objects;
create policy client_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'client-files'
    and exists (
      select 1 from public.files f
      where f.storage_path = name
        and (
          (public.staff_can_access_optional_job(f.job_id) and f.scan_status <> 'infected')
          or f.scan_status = 'clean'
        )
    )
  );

-- ─────────────────────────────────────────────────────────────
-- RPCs
-- ─────────────────────────────────────────────────────────────

create or replace function public.insert_request_from_blueprint(
  p_job_id uuid, b jsonb, p_due_date date, p_sort int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- Internal helper (not callable by clients); still checks, as defence in depth.
  if not public.staff_can_access_job(p_job_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  insert into public.requests
    (job_id, kind, title, help_text, question_type, options, consent_type, due_date, sort_order)
  values (
    p_job_id,
    b ->> 'kind',
    b ->> 'title',
    nullif(b ->> 'help_text', ''),
    nullif(b ->> 'question_type', ''),
    case when jsonb_typeof(b -> 'options') = 'array' then b -> 'options' end,
    nullif(b ->> 'consent_type', ''),
    p_due_date,
    p_sort
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function public.create_job_from_template(
  p_client_id    uuid,
  p_template_id  uuid,
  p_title        text,
  p_service      text,
  p_period_end   date,
  p_due_date     date,
  p_assigned_to  uuid,
  p_contributors uuid[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tpl     public.templates;
  v_job     uuid;
  v_today   date := (now() at time zone 'Europe/London')::date;
  v_pending jsonb := '[]'::jsonb;
  v_i       int := 0;
  b         jsonb;
  c         uuid;
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into v_tpl from public.templates where id = p_template_id;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  -- Both the template's area and the new job's area (from the chosen service) must be ones this person works in.
  if not (public.staff_can_access_area(v_tpl.area) and public.staff_can_access_area(public.area_of_service(p_service))) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) or not public.staff_can_access_client(p_client_id) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  if p_assigned_to is not null
     and not exists (select 1 from public.profiles where id = p_assigned_to and is_staff) then
    raise exception 'Assignee must be a staff member';
  end if;
  foreach c in array coalesce(p_contributors, '{}'::uuid[]) loop
    if not exists (select 1 from public.client_contacts where client_id = p_client_id and profile_id = c) then
      raise exception 'Contributors must be contacts of this client';
    end if;
  end loop;

  insert into public.jobs
    (client_id, template_id, title, service, finance_stage, period_end, due_date, assigned_to)
  values
    (p_client_id, p_template_id, p_title, p_service,
     case when p_service = 'finance_application' then 'gathering' end,
     p_period_end, p_due_date, p_assigned_to)
  returning id into v_job;

  insert into public.job_contacts (job_id, profile_id)
  select v_job, x from (select distinct unnest(coalesce(p_contributors, '{}'::uuid[])) as x) s;

  for b in select value from jsonb_array_elements(v_tpl.requests) loop
    if jsonb_typeof(b -> 'due_offset_days') = 'number' then
      perform public.insert_request_from_blueprint(v_job, b, v_today + (b ->> 'due_offset_days')::int, v_i);
    else
      v_pending := v_pending || jsonb_build_array(b);
    end if;
    v_i := v_i + 1;
  end loop;

  update public.jobs set pending_blueprints = v_pending where id = v_job;
  return v_job;
end $$;

create or replace function public.add_pending_request(
  p_job_id   uuid,
  p_index    int,
  p_due_date date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pending jsonb;
  v_sort    int;
  v_id      uuid;
begin
  if not public.staff_can_access_job(p_job_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select pending_blueprints into v_pending from public.jobs where id = p_job_id for update;
  if not found or p_index < 0 or p_index >= jsonb_array_length(v_pending) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  select coalesce(max(sort_order) + 1, 0) into v_sort from public.requests where job_id = p_job_id;
  v_id := public.insert_request_from_blueprint(p_job_id, v_pending -> p_index, p_due_date, v_sort);
  update public.jobs set pending_blueprints = pending_blueprints - p_index where id = p_job_id;
  return v_id;
end $$;

-- Admin only: choose which areas a staff member can work in. Audited.
create or replace function public.set_staff_areas(p_profile_id uuid, p_areas text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.profiles;
  v text[];
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into t from public.profiles where id = p_profile_id for update;
  if not found or not t.is_staff then
    raise exception 'Staff member not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct a order by a), '{}') into v from unnest(coalesce(p_areas, '{}')) as a;
  if not (v <@ array['accounting', 'finance']::text[]) then
    raise exception 'Unknown area';
  end if;

  update public.profiles set staff_areas = v where id = p_profile_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, ip, meta)
  values (auth.uid(), 'staff_areas_changed', 'profiles', p_profile_id, public.request_ip(),
          jsonb_build_object('areas', to_jsonb(v), 'previous', to_jsonb(t.staff_areas)));
end $$;

-- Grants: unchanged for the two job RPCs (re-stated because CREATE OR REPLACE keeps them, but be explicit).
revoke execute on function public.set_staff_areas(uuid, text[]) from public, anon;
grant  execute on function public.set_staff_areas(uuid, text[]) to authenticated;
