-- Prompt 4: create jobs from templates (staff only).
--
-- * jobs.pending_blueprints holds the template requests that are NOT created up front
--   (blueprints without due_offset_days, e.g. approvals). Staff add them later with one click.
-- * create_job_from_template(): job + job_contacts + one request per dated blueprint, in one transaction.
-- * add_pending_request(): turns one pending blueprint into a real request.
-- Both are security definer with a staff check inside, and are not callable by anon.

alter table public.jobs
  add column pending_blueprints jsonb not null default '[]'::jsonb
  check (jsonb_typeof(pending_blueprints) = 'array');

-- Builds a request row from a template blueprint.
create or replace function public.insert_request_from_blueprint(
  p_job_id uuid, b jsonb, p_due_date date, p_sort int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- Internal helper (not callable by clients); still checks, as defence in depth.
  if not public.is_staff() then
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
  if not exists (select 1 from public.clients where id = p_client_id) then
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
  if not public.is_staff() then
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

-- Only signed-in users can call the public RPCs (and they check is_staff() themselves);
-- the helper is internal.
revoke execute on function public.create_job_from_template(uuid, uuid, text, text, date, date, uuid, uuid[]) from public, anon;
revoke execute on function public.add_pending_request(uuid, int, date)                                     from public, anon;
revoke execute on function public.insert_request_from_blueprint(uuid, jsonb, date, int)                    from public, anon, authenticated;
grant  execute on function public.create_job_from_template(uuid, uuid, text, text, date, date, uuid, uuid[]) to authenticated;
grant  execute on function public.add_pending_request(uuid, int, date)                                     to authenticated;
