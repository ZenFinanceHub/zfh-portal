-- 0009: audit viewer, rate limits.
--
-- Rate limits are counters in a table (Vercel is serverless, so memory would not survive). Keys are hashed with a
-- private salt, so the table never holds an email address or an IP address. Nobody can read or write it directly;
-- only the small functions below touch it.

create table public.rate_limits (
  scope        text        not null,
  key_hash     text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (scope, key_hash, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
create policy no_connector_tokens on public.rate_limits as restrictive for all to authenticated
  using (private.token_client() is null) with check (private.token_client() is null);

insert into private.config (key, value)
values ('rate_limit_salt', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Adds one hit to a counter and says whether it is still within the limit.
create or replace function private.count_hit(p_scope text, p_subject text, p_limit int, p_window_seconds int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_salt  text := (select value from private.config where key = 'rate_limit_salt');
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits  int;
begin
  insert into public.rate_limits (scope, key_hash, window_start, hits)
  values (p_scope, encode(sha256(convert_to(v_salt || ':' || p_scope || ':' || p_subject, 'utf8')), 'hex'), v_start, 1)
  on conflict (scope, key_hash, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  return jsonb_build_object(
    'allowed', v_hits <= p_limit,
    'retry_after', greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))::int));
end $$;

-- Sign-in link requests: 5 every 15 minutes for one email address (so spamming someone's address cannot lock them out for
-- long), 20 an hour from one IP address. Callable before signing in
-- (it has to be). It says the same thing whether or not the email belongs to an account.
create or replace function public.rate_limit_magic_link(p_email text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email jsonb;
  v_ip    jsonb;
begin
  if char_length(coalesce(p_email, '')) not between 3 and 254 or char_length(coalesce(p_ip, '')) > 64 then
    return jsonb_build_object('allowed', false, 'retry_after', 3600);
  end if;
  v_email := private.count_hit('magic_link_email', lower(trim(p_email)), 5, 900);
  v_ip    := private.count_hit('magic_link_ip', coalesce(nullif(trim(p_ip), ''), 'unknown'), 20, 3600);
  -- The wait given is for the limit that actually refused, so a busy IP address cannot make someone wait longer than
  -- their own email's 15 minutes, and the reverse.
  return jsonb_build_object(
    'allowed', (v_email ->> 'allowed')::boolean and (v_ip ->> 'allowed')::boolean,
    'retry_after', greatest(
      case when (v_email ->> 'allowed')::boolean then 1 else (v_email ->> 'retry_after')::int end,
      case when (v_ip ->> 'allowed')::boolean then 1 else (v_ip ->> 'retry_after')::int end));
end $$;

-- Authenticator code attempts through the portal: 10 in 15 minutes per person.
create or replace function public.rate_limit_mfa() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or private.token_client() is not null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return private.count_hit('mfa_verify', auth.uid()::text, 10, 900);
end $$;

-- The Claude connector: 120 calls a minute per person and app.
create or replace function public.connector_rate_limit() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_client uuid := private.token_client();
begin
  if auth.uid() is null or v_client is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return private.count_hit('connector', auth.uid()::text || ':' || v_client::text, 120, 60);
end $$;

select cron.schedule('rate-limit-purge', '17 3 * * *',
  $$delete from public.rate_limits where window_start < now() - interval '2 days'$$);

-- ─────────────────────────────────────────────────────────────
-- Audit viewer (admin only)
-- ─────────────────────────────────────────────────────────────
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

-- One page of the audit log with names and the area worked out, filtered. The log holds ids, actions and counts only,
-- never answers, file names or message text, so there is nothing of that kind to show. Dates are London days.
create or replace function public.admin_audit(
  p_client uuid default null, p_actor uuid default null, p_action text default null, p_area text default null,
  p_from date default null, p_to date default null, p_limit int default 100, p_offset int default 0
) returns table (
  id bigint, created_at timestamptz, actor_id uuid, actor_name text, action text, entity text, entity_id uuid,
  client_id uuid, client_name text, area text, meta jsonb, ip text, total bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() or private.token_client() is not null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_area is not null and p_area not in ('accounting', 'finance') then
    raise exception 'Unknown area';
  end if;
  return query
  with rows as (
    select a.id, a.created_at, a.actor_id, coalesce(p.full_name, p.email) as actor_name, a.action, a.entity, a.entity_id,
           a.client_id, c.name as client_name, j.area, a.meta, a.ip
      from public.audit_log a
      left join public.profiles p on p.id = a.actor_id
      left join public.clients c on c.id = a.client_id
      left join public.jobs j on j.id = coalesce(
        case when a.entity = 'jobs' then a.entity_id end,
        nullif(a.meta ->> 'job_id', '')::uuid)
     where (p_client is null or a.client_id = p_client)
       and (p_actor  is null or a.actor_id = p_actor)
       and (p_action is null or a.action = p_action)
       and (p_from   is null or a.created_at >= (p_from::timestamp at time zone 'Europe/London'))
       and (p_to     is null or a.created_at <  ((p_to + 1)::timestamp at time zone 'Europe/London'))
  )
  select r.id, r.created_at, r.actor_id, r.actor_name, r.action, r.entity, r.entity_id, r.client_id, r.client_name,
         r.area, r.meta, r.ip, count(*) over () as total
    from rows r
   where p_area is null or r.area = p_area
   order by r.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Everything the audit log holds about one client, including entries that only carry the id of one of their jobs,
-- requests, messages or files, and the sign-ins of their contacts. For subject access exports (admin only).
create or replace function public.admin_client_audit(p_client uuid) returns setof public.audit_log
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() or private.token_client() is not null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select a.* from public.audit_log a
   where a.client_id = p_client
      or (a.entity = 'jobs' and a.entity_id in (select j.id from public.jobs j where j.client_id = p_client))
      or (a.meta ->> 'job_id') in (select j.id::text from public.jobs j where j.client_id = p_client)
      or (a.entity = 'requests' and a.entity_id in (select r.id from public.requests r join public.jobs j on j.id = r.job_id where j.client_id = p_client))
      or (a.entity = 'responses' and a.entity_id in (select x.id from public.responses x join public.requests r on r.id = x.request_id
                                                      join public.jobs j on j.id = r.job_id where j.client_id = p_client))
      or (a.entity = 'messages' and a.entity_id in (select m.id from public.messages m join public.jobs j on j.id = m.job_id where j.client_id = p_client))
      or (a.entity = 'profiles' and a.entity_id in (select cc.profile_id from public.client_contacts cc where cc.client_id = p_client))
   order by a.id;
end $$;

-- Every CSV export is itself recorded (who, how many rows, which filters; never the rows).
create or replace function public.log_audit_export(p_rows int, p_filters jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() or private.token_client() is not null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, action, entity, ip, meta)
  values (auth.uid(), 'audit_export', 'audit_log', public.request_ip(),
          jsonb_build_object('rows', p_rows, 'filters', coalesce(p_filters, '{}'::jsonb)));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'rate_limit_magic_link(text, text)', 'rate_limit_mfa()', 'connector_rate_limit()',
    'admin_audit(uuid, uuid, text, text, date, date, int, int)', 'admin_client_audit(uuid)', 'log_audit_export(int, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- Signing in has not happened yet when a link is requested, so the visitor is anonymous.
grant execute on function public.rate_limit_magic_link(text, text) to anon;
revoke execute on function private.count_hit(text, text, int, int) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Security review fix: attached_documents_ready() answered for any request id, to any signed-in person. It now says
-- nothing (false) about a request the caller cannot see. (Same wording as before for people who can.)
-- ─────────────────────────────────────────────────────────────
create or replace function public.attached_documents_ready(p_request_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.requests r where r.id = p_request_id and public.can_access_job(r.job_id))
     and (
       not exists (
         select 1 from public.files f
          where f.request_id = p_request_id and f.visibility = 'client' and f.deleted_at is null)
       or exists (
         select 1 from public.files f
          where f.request_id = p_request_id and f.visibility = 'client' and f.deleted_at is null
            and f.scan_status = 'clean'))
$$;
