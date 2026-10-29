-- 0011: consent wording version 1.
--
--  * A regulated referral request names the partner firm (requests.partner_firm). It is required: a regulated
--    referral cannot exist without one, and the name cannot carry markup characters.
--  * Template blueprints cannot know the firm, so a regulated referral from a template waits in "Add later" until
--    staff add it with a firm name. The connector can add a regulated referral (and only that consent) with a firm.
--  * record_consent stores the firm as the recipient for a regulated referral, taken from the request itself.
--  * portal_settings holds the link to the privacy notice (admin only, audited). Every signed-in person can read it
--    through get_privacy_notice_url(), so it can be shown under each consent.
--  Consents already recorded are not touched.

-- ─────────────────────────────────────────────────────────────
-- The partner firm on a request
-- ─────────────────────────────────────────────────────────────
alter table public.requests add column partner_firm text;

alter table public.requests
  add constraint requests_partner_firm_format
    check (partner_firm is null or (partner_firm = btrim(partner_firm) and partner_firm ~ '^[^<>{}[:cntrl:]]{2,120}$')),
  add constraint requests_firm_only_for_referral
    check (partner_firm is null or (kind = 'consent' and consent_type = 'regulated_referral')),
  add constraint requests_referral_needs_firm
    check (kind <> 'consent' or consent_type is distinct from 'regulated_referral' or partner_firm is not null);

-- ─────────────────────────────────────────────────────────────
-- Creating requests
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
    (job_id, kind, title, help_text, question_type, options, consent_type, partner_firm, due_date, sort_order)
  values (
    p_job_id,
    b ->> 'kind',
    b ->> 'title',
    nullif(b ->> 'help_text', ''),
    nullif(b ->> 'question_type', ''),
    case when jsonb_typeof(b -> 'options') = 'array' then b -> 'options' end,
    nullif(b ->> 'consent_type', ''),
    nullif(btrim(coalesce(b ->> 'partner_firm', '')), ''),
    p_due_date,
    p_sort
  ) returning id into v_id;
  return v_id;
end $$;

-- A regulated referral in a template always waits in "Add later", because only staff know which firm it is for.
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
    if jsonb_typeof(b -> 'due_offset_days') = 'number'
       and not (b ->> 'kind' = 'consent' and b ->> 'consent_type' = 'regulated_referral') then
      perform public.insert_request_from_blueprint(v_job, b, v_today + (b ->> 'due_offset_days')::int, v_i);
    else
      v_pending := v_pending || jsonb_build_array(b);
    end if;
    v_i := v_i + 1;
  end loop;

  update public.jobs set pending_blueprints = v_pending where id = v_job;
  return v_job;
end $$;

-- A fourth argument now carries the firm, so the old three-argument version is replaced.
drop function public.add_pending_request(uuid, int, date);
create or replace function public.add_pending_request(
  p_job_id       uuid,
  p_index        int,
  p_due_date     date default null,
  p_partner_firm text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pending jsonb;
  v_bp      jsonb;
  v_firm    text := nullif(btrim(coalesce(p_partner_firm, '')), '');
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

  v_bp := v_pending -> p_index;
  if v_bp ->> 'kind' = 'consent' and v_bp ->> 'consent_type' = 'regulated_referral' then
    if v_firm is null then
      raise exception 'Enter the name of the partner firm';
    end if;
    v_bp := v_bp || jsonb_build_object('partner_firm', v_firm);
  end if;

  select coalesce(max(sort_order) + 1, 0) into v_sort from public.requests where job_id = p_job_id;
  v_id := public.insert_request_from_blueprint(p_job_id, v_bp, p_due_date, v_sort);
  update public.jobs set pending_blueprints = pending_blueprints - p_index where id = p_job_id;
  return v_id;
end $$;

revoke execute on function public.add_pending_request(uuid, int, date, text) from public, anon;
grant  execute on function public.add_pending_request(uuid, int, date, text) to authenticated;

-- The connector may add a regulated referral (a consent) but no other consent, and always with the firm's name.
create or replace function public.connector_add_requests(
  p_job_id uuid, p_requests jsonb, p_lender_text text default null, p_confirm boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  j       public.jobs;
  e       jsonb;
  v_norm  jsonb := '[]'::jsonb;
  v_kind  text;
  v_title text;
  v_help  text;
  v_qt    text;
  v_opts  jsonb;
  v_due   date;
  v_ctype text;
  v_firm  text;
  v_sort  int;
  v_ids   uuid[] := '{}';
  v_lender text := nullif(trim(coalesce(p_lender_text, '')), '');
  v_pos   int := 1;
  v_first boolean := true;
  v_chunk text;
begin
  perform private.connector_guard();
  select * into j from public.jobs where id = p_job_id and public.staff_can_access_job(id);
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.stage in ('completed', 'cancelled') then raise exception 'That job is finished'; end if;
  if jsonb_typeof(p_requests) <> 'array' or jsonb_array_length(p_requests) not between 1 and 25 then
    raise exception 'Give 1 to 25 requests';
  end if;
  if v_lender is not null and char_length(v_lender) > 30000 then raise exception 'The pasted text is too long (30,000 characters at most)'; end if;

  for e in select value from jsonb_array_elements(p_requests) loop
    v_kind  := e ->> 'kind';
    v_title := trim(coalesce(e ->> 'title', ''));
    v_help  := nullif(trim(coalesce(e ->> 'help_text', '')), '');
    v_qt    := nullif(e ->> 'question_type', '');
    v_opts  := case when jsonb_typeof(e -> 'options') = 'array' then e -> 'options' end;
    v_due   := nullif(e ->> 'due_date', '')::date;
    v_ctype := nullif(e ->> 'consent_type', '');
    v_firm  := nullif(btrim(coalesce(e ->> 'partner_firm', '')), '');

    if v_kind not in ('upload', 'question', 'approval', 'consent') then
      raise exception 'Each request must be an upload, a question, an approval or a regulated referral';
    end if;
    if char_length(v_title) not between 1 and 200 then raise exception 'Each request needs a title of 1 to 200 characters'; end if;
    if v_help is not null and char_length(v_help) > 1000 then raise exception 'Help text can be 1,000 characters at most'; end if;
    if v_kind = 'consent' then
      if v_ctype is distinct from 'regulated_referral' then
        raise exception 'Only a regulated_referral consent can be added here; other consents are added in the portal';
      end if;
      if v_firm is null then
        raise exception 'A regulated referral needs partner_firm: the name of the firm';
      end if;
      if v_firm !~ '^[^<>{}[:cntrl:]]{2,120}$' then
        raise exception 'partner_firm must be 2 to 120 characters and cannot contain < > { }';
      end if;
    else
      v_ctype := null; v_firm := null;
    end if;
    if v_kind = 'question' then
      if v_qt is null or v_qt not in ('text', 'yes_no', 'choice', 'date', 'amount') then
        raise exception 'A question needs a question_type: text, yes_no, choice, date or amount';
      end if;
      if v_qt = 'choice' and (v_opts is null or jsonb_array_length(v_opts) < 2
                              or exists (select 1 from jsonb_array_elements(v_opts) o where jsonb_typeof(o) <> 'string')) then
        raise exception 'A choice question needs at least two options';
      end if;
    else
      v_qt := null; v_opts := null;
    end if;
    if v_qt is distinct from 'choice' then v_opts := null; end if;

    v_norm := v_norm || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'kind', v_kind, 'title', v_title, 'help_text', v_help, 'question_type', v_qt, 'options', v_opts, 'due_date', v_due,
      'consent_type', v_ctype, 'partner_firm', v_firm)));
  end loop;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object('preview', true, 'changes_nothing', true,
      'job', j.title, 'client', (select name from public.clients where id = j.client_id),
      'would_add', v_norm,
      'would_save_internal_note', v_lender is not null,
      'client_will_be_emailed', 'You have something to do (no details)');
  end if;

  select coalesce(max(sort_order) + 1, 0) into v_sort from public.requests where job_id = p_job_id;
  for e in select value from jsonb_array_elements(v_norm) loop
    v_ids := v_ids || public.insert_request_from_blueprint(p_job_id, e, nullif(e ->> 'due_date', '')::date, v_sort);
    v_sort := v_sort + 1;
  end loop;

  -- The lender's own words, verbatim, for staff only (messages are limited to 5,000 characters, so long text is split).
  if v_lender is not null then
    while v_pos <= char_length(v_lender) loop
      v_chunk := substr(v_lender, v_pos, 4800);
      insert into public.messages (job_id, author_id, body, internal)
      values (p_job_id, auth.uid(), case when v_first then E'Lender request list, as received:\n\n' else '' end || v_chunk, true);
      v_first := false;
      v_pos := v_pos + 4800;
    end loop;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, client_id, ip, meta)
  values (auth.uid(), 'connector_requests_added', 'jobs', p_job_id, j.client_id, public.request_ip(),
          jsonb_build_object('source', 'claude_connector', 'count', coalesce(array_length(v_ids, 1), 0),
                             'internal_note', v_lender is not null));
  return jsonb_build_object('added', true, 'count', coalesce(array_length(v_ids, 1), 0), 'request_ids', to_jsonb(v_ids));
end $$;

-- ─────────────────────────────────────────────────────────────
-- Recording a consent: for a regulated referral the recipient is the firm named on the request
-- ─────────────────────────────────────────────────────────────
create or replace function public.record_consent(
  p_request_id      uuid,
  p_wording_version text,
  p_wording_text    text,
  p_recipient       text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r           public.requests;
  v_client    uuid;
  v_id        uuid;
  v_recipient text;
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

  -- The firm comes from the request, never from the caller, and the text the client saw must name it.
  v_recipient := p_recipient;
  if r.consent_type = 'regulated_referral' then
    if r.partner_firm is null or position(r.partner_firm in coalesce(p_wording_text, '')) = 0 then
      raise exception 'The wording must name the partner firm';
    end if;
    v_recipient := r.partner_firm;
  end if;

  insert into public.consents
    (client_id, job_id, request_id, profile_id, consent_type, wording_version, wording_text,
     recipient, ip, user_agent)
  values
    (v_client, r.job_id, r.id, auth.uid(), r.consent_type, p_wording_version, p_wording_text,
     v_recipient, public.request_ip(), public.request_user_agent())
  returning id into v_id;

  update public.requests
     set status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
   where id = r.id;

  return v_id;
end $$;

-- ─────────────────────────────────────────────────────────────
-- The link to the privacy notice
-- ─────────────────────────────────────────────────────────────
create table public.portal_settings (
  id                 boolean     primary key default true check (id),
  privacy_notice_url text        check (privacy_notice_url is null
                                        or (char_length(privacy_notice_url) <= 500
                                            and privacy_notice_url ~ '^https://[A-Za-z0-9][^[:space:]<>"'']*$')),
  updated_at         timestamptz not null default now(),
  updated_by         uuid        references public.profiles (id) on delete set null
);
insert into public.portal_settings default values;

-- No policies and no grants: nothing reads or writes this table directly. The two functions below are the only way in.
alter table public.portal_settings enable row level security;
revoke all on public.portal_settings from anon, authenticated;
create policy no_connector_tokens on public.portal_settings as restrictive for all to authenticated
  using (private.token_client() is null) with check (private.token_client() is null);

create or replace function public.get_privacy_notice_url() returns text
language sql stable security definer set search_path = public as $$
  select privacy_notice_url from public.portal_settings where id
$$;

create or replace function public.set_privacy_notice_url(p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url  text := nullif(btrim(coalesce(p_url, '')), '');
  v_prev text;
begin
  if not public.is_admin() or private.token_client() is not null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select privacy_notice_url into v_prev from public.portal_settings where id for update;
  update public.portal_settings set privacy_notice_url = v_url, updated_at = now(), updated_by = auth.uid() where id;

  -- The address itself is not copied into the log.
  insert into public.audit_log (actor_id, action, entity, ip, meta)
  values (auth.uid(), 'privacy_notice_url_changed', 'portal_settings', public.request_ip(),
          jsonb_build_object('set', v_url is not null, 'was_set', v_prev is not null));
end $$;

revoke execute on function public.get_privacy_notice_url()      from public, anon;
revoke execute on function public.set_privacy_notice_url(text)  from public, anon;
grant  execute on function public.get_privacy_notice_url()      to authenticated;
grant  execute on function public.set_privacy_notice_url(text)  to authenticated;
