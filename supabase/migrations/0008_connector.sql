-- 0008: the Claude connector (MCP).
--
-- Claude signs in through Supabase's OAuth 2.1 server and gets a token for the staff member who approved it.
-- That token always says aal1 (a known Supabase limitation), so MFA cannot be read from it. Instead:
--   * a "grant" is created ONLY by connector_record_grant(), which refuses anything but a normal (non-connector)
--     session at aal2 for a staff member, and
--   * every connector_* function re-checks, in the database, that the caller is staff with a verified authenticator,
--     and holds a grant that is not revoked and is less than 7 days old. No grant, or an old one: nothing works.
--   * a connector token cannot read or write any table directly (restrictive policy below). It can only call the
--     connector_* functions, which return names, titles, statuses and due dates and nothing else.

-- ─────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────
create table public.connector_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  client_id   uuid not null,                       -- the Supabase OAuth client (Claude)
  approved_at timestamptz not null default now(),  -- the last time they approved, with an authenticator code
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles(id),
  unique (user_id, client_id)
);
alter table public.connector_grants enable row level security;
revoke all on public.connector_grants from anon, authenticated;
grant select on public.connector_grants to authenticated;
-- Staff see their own; the admin sees everyone's. Nobody writes directly: only the functions below do.
create policy connector_grants_select on public.connector_grants for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- How long an approval lasts before the authenticator is needed again.
create or replace function private.connector_grant_days() returns int
language sql immutable as $$ select 7 $$;

-- The OAuth client behind the token in this request, or null for an ordinary sign-in.
create or replace function private.token_client() returns uuid
language plpgsql stable as $$
declare v text := auth.jwt() ->> 'client_id';
begin
  return nullif(v, '')::uuid;
exception when others then
  return null;
end $$;

-- ok | not_connector | not_staff | no_authenticator | no_grant | revoked | expired
create or replace function private.connector_status() returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_client uuid := private.token_client();
  g        public.connector_grants;
begin
  if v_uid is null or v_client is null then return 'not_connector'; end if;
  if not public.is_staff() then return 'not_staff'; end if;
  if not exists (select 1 from auth.mfa_factors f
                  where f.user_id = v_uid and f.factor_type = 'totp' and f.status = 'verified') then
    return 'no_authenticator';
  end if;
  select * into g from public.connector_grants where user_id = v_uid and client_id = v_client;
  if not found then return 'no_grant'; end if;
  if g.revoked_at is not null then return 'revoked'; end if;
  if g.approved_at < now() - make_interval(days => private.connector_grant_days()) then return 'expired'; end if;
  return 'ok';
end $$;

-- Raises unless the connector is fully allowed; returns the staff member. Every connector function starts here.
create or replace function private.connector_guard() returns uuid
language plpgsql security definer set search_path = public as $$
declare s text := private.connector_status();
begin
  if s <> 'ok' then
    raise exception 'connector_%', s using errcode = '42501';
  end if;
  -- Everything written during this call is marked in the audit trail.
  perform set_config('app.audit_source', 'claude_connector', true);
  return auth.uid();
end $$;

-- Ends the Supabase side of a connection (consent and tokens). Best effort: the grant table is what blocks access.
create or replace function private.end_oauth_connection(p_user uuid, p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update auth.oauth_consents set revoked_at = now() where user_id = p_user and client_id = p_client and revoked_at is null;
  delete from auth.sessions where user_id = p_user and oauth_client_id = p_client;
exception when others then
  raise warning 'could not end the OAuth connection: %', sqlerrm;
end $$;

-- The one way a grant comes to exist: an ordinary staff session at aal2 approving it.
create or replace function public.connector_record_grant(p_client_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or private.token_client() is not null or not public.is_staff()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.oauth_clients c where c.id = p_client_id) then
    raise exception 'Unknown app' using errcode = 'P0002';
  end if;
  insert into public.connector_grants (user_id, client_id, approved_at)
  values (v_uid, p_client_id, now())
  on conflict (user_id, client_id)
  do update set approved_at = now(), revoked_at = null, revoked_by = null;
  insert into public.audit_log (actor_id, action, entity, entity_id, ip, meta)
  values (v_uid, 'connector_approved', 'connector_grants', null, public.request_ip(),
          jsonb_build_object('source', 'claude_connector'));
end $$;

-- Which app is asking? Lets the consent page record the approval for the right app, even when Supabase has already
-- remembered an earlier approval and skips straight to the code. Ordinary staff sessions only; returns nothing otherwise.
create or replace function public.connector_authorization_client(p_authorization_id text) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or private.token_client() is not null or not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return (select a.client_id from auth.oauth_authorizations a
           where a.authorization_id = p_authorization_id and a.expires_at > now() limit 1);
end $$;

-- The connector's own front door: says whether this token may be used, without raising.
create or replace function public.connector_check() returns text
language sql stable security definer set search_path = public as $$
  select private.connector_status()
$$;

-- Called with an expired token so the connection ends cleanly and the next attempt needs a fresh approval.
create or replace function public.connector_expire() returns void
language plpgsql security definer set search_path = public as $$
begin
  if private.connector_status() in ('expired', 'revoked') then
    perform private.end_oauth_connection(auth.uid(), private.token_client());
  end if;
end $$;

-- Admin only: cut a connection off now. The grant stops working at once; the Supabase side is ended best effort.
create or replace function public.connector_revoke_grant(p_grant_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.connector_grants;
begin
  if not public.is_admin() or private.token_client() is not null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.connector_grants set revoked_at = now(), revoked_by = auth.uid()
   where id = p_grant_id and revoked_at is null
  returning * into g;
  if not found then return; end if;
  perform private.end_oauth_connection(g.user_id, g.client_id);
  insert into public.audit_log (actor_id, action, entity, entity_id, ip, meta)
  values (auth.uid(), 'connector_revoked', 'connector_grants', g.id, public.request_ip(),
          jsonb_build_object('source', 'portal', 'user_id', g.user_id));
end $$;

-- ─────────────────────────────────────────────────────────────
-- Audit: say where a change came from when it came through the connector
-- ─────────────────────────────────────────────────────────────
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
      'visibility',    case when tg_table_name = 'files' then v_row ->> 'visibility' end,
      'source',        nullif(current_setting('app.audit_source', true), '')
    ))
  );
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────
-- What the connector can see and do. Names, titles, statuses and due dates only.
-- ─────────────────────────────────────────────────────────────
create or replace function public.connector_search_clients(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_query, ''));
begin
  perform private.connector_guard();
  if char_length(q) < 2 or char_length(q) > 100 then
    raise exception 'Search needs 2 to 100 characters';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('client_id', c.id, 'name', c.name) order by c.name)
      from (select id, name from public.clients
             where name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
               and public.staff_can_access_client(id)
             order by name limit 20) c
  ), '[]'::jsonb);
end $$;

create or replace function public.connector_list_jobs(p_client_id uuid, p_open_only boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.connector_guard();
  if not public.staff_can_access_client(p_client_id) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'job_id', j.id, 'title', j.title, 'service', j.service, 'area', j.area,
             'stage', j.stage, 'finance_stage', j.finance_stage, 'due_date', j.due_date) order by j.created_at desc)
      from public.jobs j
     where j.client_id = p_client_id
       and public.staff_can_access_job(j.id)
       and (not coalesce(p_open_only, true) or j.stage not in ('completed', 'cancelled'))
  ), '[]'::jsonb);
end $$;

-- Things the client still has to do, for one client or one job.
create or replace function public.connector_outstanding(p_client_id uuid default null, p_job_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Europe/London')::date;
begin
  perform private.connector_guard();
  if (p_client_id is null) = (p_job_id is null) then
    raise exception 'Give either a client or a job';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'request_id', r.id, 'client', c.name, 'job_id', j.id, 'job', j.title, 'area', j.area,
             'kind', r.kind, 'title', r.title, 'status', r.status, 'due_date', r.due_date,
             'overdue', r.due_date is not null and r.due_date < v_today)
           order by r.due_date nulls last, r.created_at)
      from public.requests r
      join public.jobs j on j.id = r.job_id
      join public.clients c on c.id = j.client_id
     where r.status in ('open', 'returned')
       and j.stage not in ('completed', 'cancelled')
       and public.staff_can_access_job(j.id)
       and (j.client_id = p_client_id or j.id = p_job_id)
  ), '[]'::jsonb);
end $$;

-- Write tools take p_confirm. Without it they check everything and say what they WOULD do; nothing is changed.
create or replace function public.connector_create_job(
  p_client_id uuid, p_template text, p_service text, p_title text, p_confirm boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t      public.templates;
  v_name text;
  v_title text := trim(coalesce(p_title, ''));
  v_job  uuid;
begin
  perform private.connector_guard();
  if char_length(v_title) not between 1 and 200 then raise exception 'The job title needs 1 to 200 characters'; end if;
  select name into v_name from public.clients where id = p_client_id and public.staff_can_access_client(id);
  if v_name is null then raise exception 'Client not found' using errcode = 'P0002'; end if;

  if nullif(trim(p_template), '') is not null then
    select * into t from public.templates where active and lower(name) = lower(trim(p_template));
  elsif nullif(trim(p_service), '') is not null then
    select * into t from public.templates where active and service = trim(p_service) order by name limit 1;
  else
    raise exception 'Give a template or a service';
  end if;
  if not found then raise exception 'Template not found' using errcode = 'P0002'; end if;
  if not public.staff_can_access_area(t.area) then raise exception 'Not allowed' using errcode = '42501'; end if;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object('preview', true, 'changes_nothing', true,
      'would_create', jsonb_build_object('client', v_name, 'title', v_title, 'service', t.service, 'area', t.area,
                                         'template', t.name, 'requests_from_template', jsonb_array_length(t.requests)));
  end if;

  v_job := public.create_job_from_template(p_client_id, t.id, v_title, t.service, null, null, null, '{}');
  insert into public.audit_log (actor_id, action, entity, entity_id, client_id, ip, meta)
  values (auth.uid(), 'connector_job_created', 'jobs', v_job, p_client_id, public.request_ip(),
          jsonb_build_object('source', 'claude_connector'));
  return jsonb_build_object('created', true, 'job_id', v_job, 'title', v_title);
end $$;

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

    if v_kind not in ('upload', 'question', 'approval') then
      raise exception 'Each request must be an upload, a question or an approval';
    end if;
    if char_length(v_title) not between 1 and 200 then raise exception 'Each request needs a title of 1 to 200 characters'; end if;
    if v_help is not null and char_length(v_help) > 1000 then raise exception 'Help text can be 1,000 characters at most'; end if;
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
      'kind', v_kind, 'title', v_title, 'help_text', v_help, 'question_type', v_qt, 'options', v_opts, 'due_date', v_due)));
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

-- p_internal = true: a note for staff only. false: a message the client will see (and be emailed about, without its text).
create or replace function private.connector_post(p_job_id uuid, p_body text, p_internal boolean, p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  j      public.jobs;
  v_body text := trim(coalesce(p_body, ''));
begin
  perform private.connector_guard();
  select * into j from public.jobs where id = p_job_id and public.staff_can_access_job(id);
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if char_length(v_body) not between 1 and 5000 then raise exception 'The text needs 1 to 5,000 characters'; end if;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object('preview', true, 'changes_nothing', true,
      'job', j.title, 'client', (select name from public.clients where id = j.client_id),
      'visible_to_client', not p_internal, 'would_post', v_body);
  end if;

  insert into public.messages (job_id, author_id, body, internal) values (p_job_id, auth.uid(), v_body, p_internal);
  insert into public.audit_log (actor_id, action, entity, entity_id, client_id, ip, meta)
  values (auth.uid(), case when p_internal then 'connector_note_added' else 'connector_message_sent' end,
          'jobs', p_job_id, j.client_id, public.request_ip(), jsonb_build_object('source', 'claude_connector'));
  return jsonb_build_object('posted', true, 'visible_to_client', not p_internal);
end $$;

create or replace function public.connector_send_message(p_job_id uuid, p_body text, p_confirm boolean default false) returns jsonb
language sql security definer set search_path = public as $$
  select private.connector_post(p_job_id, p_body, false, p_confirm)
$$;
create or replace function public.connector_add_note(p_job_id uuid, p_body text, p_confirm boolean default false) returns jsonb
language sql security definer set search_path = public as $$
  select private.connector_post(p_job_id, p_body, true, p_confirm)
$$;

-- ─────────────────────────────────────────────────────────────
-- Function privileges
-- ─────────────────────────────────────────────────────────────
revoke execute on function private.connector_grant_days()   from public, anon, authenticated;
revoke execute on function private.token_client()           from public, anon;
revoke execute on function private.connector_status()       from public, anon;
revoke execute on function private.connector_guard()        from public, anon, authenticated;
revoke execute on function private.end_oauth_connection(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.connector_post(uuid, text, boolean, boolean) from public, anon, authenticated;
-- Policies and definer functions call these as the signed-in user, so authenticated needs to reach the two helpers.
grant execute on function private.token_client()      to authenticated;
grant execute on function private.connector_status()  to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'connector_record_grant(uuid)', 'connector_authorization_client(text)', 'connector_check()', 'connector_expire()', 'connector_revoke_grant(uuid)',
    'connector_search_clients(text)', 'connector_list_jobs(uuid, boolean)', 'connector_outstanding(uuid, uuid)',
    'connector_create_job(uuid, text, text, text, boolean)', 'connector_add_requests(uuid, jsonb, text, boolean)',
    'connector_send_message(uuid, text, boolean)', 'connector_add_note(uuid, text, boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- A connector token cannot touch any table or stored file directly.
-- Every table in public, and stored files, refuse a token that carries an OAuth client. (Ordinary sign-ins have none.)
-- The connector_* functions above run with their own rights and are the only way in.
-- ─────────────────────────────────────────────────────────────
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists no_connector_tokens on public.%I', t.tablename);
    execute format($p$create policy no_connector_tokens on public.%I as restrictive for all to authenticated
                      using (private.token_client() is null) with check (private.token_client() is null)$p$, t.tablename);
  end loop;
end $$;
drop policy if exists no_connector_tokens on storage.objects;
create policy no_connector_tokens on storage.objects as restrictive for all to authenticated
  using (private.token_client() is null) with check (private.token_client() is null);

-- ─────────────────────────────────────────────────────────────
-- The API gate: before every API request, a token that carries an OAuth client may only call connector_* functions.
-- (This also covers the portal's other functions, which are written for signed-in people, not for a connector.)
-- PostgREST runs it through pgrst.db_pre_request. To switch it off in an emergency:
--   alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
-- ─────────────────────────────────────────────────────────────
create or replace function public.connector_gate() returns void
language plpgsql security definer set search_path = public as $$
begin
  if private.token_client() is not null
     and coalesce(current_setting('request.path', true), '') !~ '^/rpc/connector_[a-z_]+$' then
    raise sqlstate 'PT403' using message = 'Connector tokens can only use the connector tools';
  end if;
end $$;
revoke execute on function public.connector_gate() from public;
grant execute on function public.connector_gate() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.connector_gate';
notify pgrst, 'reload config';

