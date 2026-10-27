-- Prompt 7: notifications.
--
-- * Things that happen (a request is created, a client submits, approves, consents or writes, staff write to
--   a client) are recorded in notifications_queue BY DATABASE TRIGGERS, so nothing is missed if the app is
--   bypassed. A queue row holds ids and a kind, never content: no titles, file names, answers or message text.
-- * The send-notifications edge function reads the queue (service role), applies the rules in
--   notification_settings and uk_bank_holidays, sends through Resend, and records every send in
--   notifications_log with a unique dedupe key so nothing is ever sent twice. The log never stores email bodies.
-- * pg_cron calls the function every 5 minutes, and again at 08:00 and 17:00 Europe/London. Urgent items also
--   call it straight away from the trigger.
-- * Clients cannot read the queue, the log, the settings or the bank holidays. Only the admin edits settings
--   and bank holidays.

-- ─────────────────────────────────────────────────────────────
-- Reminder preference (clients can switch their own off; service emails cannot be switched off)
-- ─────────────────────────────────────────────────────────────
alter table public.profiles add column email_reminders boolean not null default true;
grant update (email_reminders) on public.profiles to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Settings (one row, edited by the admin at /admin/settings → Notifications)
-- ─────────────────────────────────────────────────────────────
create table public.notification_settings (
  id                       boolean primary key default true check (id),
  staff_batch_minutes      int  not null default 15 check (staff_batch_minutes between 1 and 240),
  client_bundle_minutes    int  not null default 10 check (client_bundle_minutes between 1 and 240),
  -- Quiet hours run overnight (start in the evening, end the next morning); weekends and bank holidays are quiet all day.
  quiet_start              time not null default '18:00',
  quiet_end                time not null default '08:00',
  urgent_approvals         boolean not null default true,
  urgent_lender_consents   boolean not null default true,
  urgent_finance_activity  boolean not null default true,
  digest_enabled           boolean not null default true,
  digest_time              time not null default '17:00',
  fallback_email           text not null default 'craig@zen-finance.co.uk'
                             check (fallback_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(fallback_email) <= 254),
  reminders_enabled        boolean not null default true,
  reminder_days            int[] not null default '{7,3,1}'
                             check (cardinality(reminder_days) between 1 and 6 and 1 <= all (reminder_days) and 60 >= all (reminder_days)),
  bank_holiday_region      text not null default 'scotland' check (bank_holiday_region in ('scotland', 'england_wales')),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.profiles(id) on delete set null,
  constraint quiet_hours_overnight check (quiet_start > quiet_end)
);
insert into public.notification_settings default values;

-- ─────────────────────────────────────────────────────────────
-- Bank holidays (editable). The region in notification_settings says which list counts.
-- ─────────────────────────────────────────────────────────────
create table public.uk_bank_holidays (
  region       text not null check (region in ('scotland', 'england_wales')),
  holiday_date date not null,
  name         text not null check (char_length(name) between 1 and 80),
  primary key (region, holiday_date)
);

insert into public.uk_bank_holidays (region, holiday_date, name) values
  -- England & Wales
  ('england_wales', '2026-01-01', 'New Year''s Day'),
  ('england_wales', '2026-04-03', 'Good Friday'),
  ('england_wales', '2026-04-06', 'Easter Monday'),
  ('england_wales', '2026-05-04', 'Early May bank holiday'),
  ('england_wales', '2026-05-25', 'Spring bank holiday'),
  ('england_wales', '2026-08-31', 'Summer bank holiday'),
  ('england_wales', '2026-12-25', 'Christmas Day'),
  ('england_wales', '2026-12-28', 'Boxing Day (substitute day)'),
  ('england_wales', '2027-01-01', 'New Year''s Day'),
  ('england_wales', '2027-03-26', 'Good Friday'),
  ('england_wales', '2027-03-29', 'Easter Monday'),
  ('england_wales', '2027-05-03', 'Early May bank holiday'),
  ('england_wales', '2027-05-31', 'Spring bank holiday'),
  ('england_wales', '2027-08-30', 'Summer bank holiday'),
  ('england_wales', '2027-12-27', 'Christmas Day (substitute day)'),
  ('england_wales', '2027-12-28', 'Boxing Day (substitute day)'),
  ('england_wales', '2028-01-03', 'New Year''s Day (substitute day)'),
  ('england_wales', '2028-04-14', 'Good Friday'),
  ('england_wales', '2028-04-17', 'Easter Monday'),
  ('england_wales', '2028-05-01', 'Early May bank holiday'),
  ('england_wales', '2028-05-29', 'Spring bank holiday'),
  ('england_wales', '2028-08-28', 'Summer bank holiday'),
  ('england_wales', '2028-12-25', 'Christmas Day'),
  ('england_wales', '2028-12-26', 'Boxing Day'),
  -- Scotland
  ('scotland', '2026-01-01', 'New Year''s Day'),
  ('scotland', '2026-01-02', '2nd January'),
  ('scotland', '2026-04-03', 'Good Friday'),
  ('scotland', '2026-05-04', 'Early May bank holiday'),
  ('scotland', '2026-05-25', 'Spring bank holiday'),
  ('scotland', '2026-08-03', 'Summer bank holiday'),
  ('scotland', '2026-11-30', 'St Andrew''s Day'),
  ('scotland', '2026-12-25', 'Christmas Day'),
  ('scotland', '2026-12-28', 'Boxing Day (substitute day)'),
  ('scotland', '2027-01-01', 'New Year''s Day'),
  ('scotland', '2027-01-04', '2nd January (substitute day)'),
  ('scotland', '2027-03-26', 'Good Friday'),
  ('scotland', '2027-05-03', 'Early May bank holiday'),
  ('scotland', '2027-05-31', 'Spring bank holiday'),
  ('scotland', '2027-08-02', 'Summer bank holiday'),
  ('scotland', '2027-11-30', 'St Andrew''s Day'),
  ('scotland', '2027-12-27', 'Christmas Day (substitute day)'),
  ('scotland', '2027-12-28', 'Boxing Day (substitute day)'),
  ('scotland', '2028-01-03', 'New Year''s Day (substitute day)'),
  ('scotland', '2028-01-04', '2nd January (substitute day)'),
  ('scotland', '2028-04-14', 'Good Friday'),
  ('scotland', '2028-05-01', 'Early May bank holiday'),
  ('scotland', '2028-05-29', 'Spring bank holiday'),
  ('scotland', '2028-08-07', 'Summer bank holiday'),
  ('scotland', '2028-11-30', 'St Andrew''s Day'),
  ('scotland', '2028-12-25', 'Christmas Day'),
  ('scotland', '2028-12-26', 'Boxing Day');

-- ─────────────────────────────────────────────────────────────
-- Queue: one row per thing that happened. Ids and kinds only.
-- ─────────────────────────────────────────────────────────────
create table public.notifications_queue (
  id            bigint generated always as identity primary key,
  audience      text not null check (audience in ('client', 'staff')),
  event         text not null check (event in
                  ('request_created', 'item_submitted', 'approval', 'consent', 'client_message', 'staff_message')),
  client_id     uuid not null references public.clients(id) on delete cascade,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  request_id    uuid references public.requests(id) on delete set null,
  request_kind  text,
  -- Why this could be urgent (the settings say whether each reason is switched on).
  urgent_reason text check (urgent_reason in ('approval', 'lender_share', 'finance')),
  occurred_at   timestamptz not null default now(),
  state         text not null default 'pending' check (state in ('pending', 'sent', 'skipped', 'failed')),
  processed_at  timestamptz
);
create index notifications_queue_pending_idx on public.notifications_queue (audience, occurred_at) where state = 'pending';
create index notifications_queue_occurred_idx on public.notifications_queue (occurred_at);

-- ─────────────────────────────────────────────────────────────
-- Log: every send, once. The unique key is what stops a second send. No email bodies, no addresses.
-- ─────────────────────────────────────────────────────────────
create table public.notifications_log (
  id          bigint generated always as identity primary key,
  dedupe_key  text not null unique,
  kind        text not null check (kind in
                ('staff_urgent', 'staff_batch', 'staff_held', 'staff_digest',
                 'client_new_request', 'client_message', 'client_reminder', 'marker')),
  status      text not null check (status in ('sending', 'sent', 'failed', 'skipped')),
  attempts    int  not null default 0,
  client_id   uuid references public.clients(id) on delete set null,
  job_id      uuid references public.jobs(id) on delete set null,
  event_count int  not null default 0,
  window_end  timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index notifications_log_kind_idx on public.notifications_log (kind, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- RLS: settings and holidays and the log are for the admin; the queue is for nobody (the function uses the service role)
-- ─────────────────────────────────────────────────────────────
alter table public.notification_settings enable row level security;
alter table public.uk_bank_holidays      enable row level security;
alter table public.notifications_queue   enable row level security;
alter table public.notifications_log     enable row level security;

revoke all on public.notification_settings from anon, authenticated;
revoke all on public.uk_bank_holidays      from anon, authenticated;
revoke all on public.notifications_queue   from anon, authenticated;
revoke all on public.notifications_log     from anon, authenticated;

grant select on public.notification_settings to authenticated;
grant update (staff_batch_minutes, client_bundle_minutes, quiet_start, quiet_end, urgent_approvals,
              urgent_lender_consents, urgent_finance_activity, digest_enabled, digest_time, fallback_email,
              reminders_enabled, reminder_days, bank_holiday_region)
  on public.notification_settings to authenticated;
grant select, insert, update, delete on public.uk_bank_holidays to authenticated;
grant select on public.notifications_log to authenticated;

create policy notification_settings_select on public.notification_settings for select to authenticated
  using (public.is_admin());
create policy notification_settings_update on public.notification_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy uk_bank_holidays_admin on public.uk_bank_holidays for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy notifications_log_select on public.notifications_log for select to authenticated
  using (public.is_admin());
-- notifications_queue: RLS on, no policies, no grants.

-- ─────────────────────────────────────────────────────────────
-- Who changed the rules (names of the settings only, never anything else)
-- ─────────────────────────────────────────────────────────────
create or replace function private.stamp_notification_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  insert into public.audit_log (actor_id, action, entity, ip, meta)
  values (
    auth.uid(), 'notification_settings_changed', 'notification_settings', public.request_ip(),
    jsonb_build_object('changed', coalesce((
      select jsonb_agg(n.key order by n.key)
        from jsonb_each(to_jsonb(new)) n
        join jsonb_each(to_jsonb(old)) o on o.key = n.key
       where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by')
    ), '[]'::jsonb))
  );
  return new;
end $$;
create trigger notification_settings_stamp before update on public.notification_settings
  for each row execute function private.stamp_notification_settings();

create or replace function private.audit_bank_holiday() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.uk_bank_holidays := case when tg_op = 'DELETE' then old else new end;
begin
  insert into public.audit_log (actor_id, action, entity, ip, meta)
  values (auth.uid(),
          case tg_op when 'INSERT' then 'bank_holiday_added' when 'DELETE' then 'bank_holiday_removed' else 'bank_holiday_changed' end,
          'uk_bank_holidays', public.request_ip(),
          jsonb_build_object('region', r.region, 'date', r.holiday_date));
  return r;
end $$;
create trigger uk_bank_holidays_audit after insert or update or delete on public.uk_bank_holidays
  for each row execute function private.audit_bank_holiday();

-- ─────────────────────────────────────────────────────────────
-- Calling the edge function from the database (same pattern as the file scanner)
--   private.config keys: notify_url, notify_webhook_secret. Until both are set nothing is called; the cron job
--   and the urgent trigger then simply do nothing. The secret is sent as x-webhook-secret and checked by the function.
-- ─────────────────────────────────────────────────────────────
create or replace function private.call_notify_function(p_body jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from private.config where key = 'notify_url';
  select value into v_secret from private.config where key = 'notify_webhook_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url     := v_url,
    body    := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000
  );
exception when others then
  -- Never block what the person was doing because the notifier could not be reached; the 5-minute run catches up.
  null;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Triggers that record what happened
-- ─────────────────────────────────────────────────────────────

-- A request exists → tell the client's contacts (bundled by the function).
create or replace function private.notify_request_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications_queue (audience, event, client_id, job_id, request_id, request_kind)
  select 'client', 'request_created', j.client_id, new.job_id, new.id, new.kind
    from public.jobs j where j.id = new.job_id;
  return new;
end $$;
create trigger notify_request_created after insert on public.requests
  for each row execute function private.notify_request_created();

-- A client submits an upload, an answer or an approval → tell staff. (Consents are recorded below.)
create or replace function private.notify_request_submitted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j        public.jobs;
  v_urgent text;
begin
  if new.kind = 'consent' then return new; end if;
  -- Staff submitting on a client's behalf is not something to alert staff about.
  if coalesce((select p.is_staff from public.profiles p where p.id = new.submitted_by), false) then return new; end if;

  select * into j from public.jobs where id = new.job_id;
  if not found then return new; end if;

  v_urgent := case
    when new.kind = 'approval' then 'approval'
    when j.service = 'finance_application' then 'finance'
  end;

  insert into public.notifications_queue (audience, event, client_id, job_id, request_id, request_kind, urgent_reason)
  values ('staff', case when new.kind = 'approval' then 'approval' else 'item_submitted' end,
          j.client_id, new.job_id, new.id, new.kind, v_urgent);

  if v_urgent is not null then
    perform private.call_notify_function('{"mode":"urgent"}'::jsonb);
  end if;
  return new;
end $$;
create trigger notify_request_submitted after update of status on public.requests
  for each row when (old.status is distinct from new.status and new.status = 'submitted')
  execute function private.notify_request_submitted();

-- A consent is recorded → tell staff. lender_share is urgent, and so is anything on a finance application.
create or replace function private.notify_consent_recorded() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j        public.jobs;
  v_urgent text;
begin
  if new.job_id is null then return new; end if;
  if coalesce((select p.is_staff from public.profiles p where p.id = new.profile_id), false) then return new; end if;

  select * into j from public.jobs where id = new.job_id;
  if not found then return new; end if;

  v_urgent := case
    when new.consent_type = 'lender_share' then 'lender_share'
    when j.service = 'finance_application' then 'finance'
  end;

  insert into public.notifications_queue (audience, event, client_id, job_id, request_id, request_kind, urgent_reason)
  values ('staff', 'consent', j.client_id, new.job_id, new.request_id, 'consent', v_urgent);

  if v_urgent is not null then
    perform private.call_notify_function('{"mode":"urgent"}'::jsonb);
  end if;
  return new;
end $$;
create trigger notify_consent_recorded after insert on public.consents
  for each row execute function private.notify_consent_recorded();

-- A message → staff hear about a client's message; the client hears about staff's. Internal notes tell nobody.
create or replace function private.notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
  v_staff  boolean;
begin
  if new.internal then return new; end if;
  select client_id into v_client from public.jobs where id = new.job_id;
  if v_client is null then return new; end if;
  v_staff := coalesce((select p.is_staff from public.profiles p where p.id = new.author_id), false);

  insert into public.notifications_queue (audience, event, client_id, job_id)
  values (case when v_staff then 'client' else 'staff' end,
          case when v_staff then 'staff_message' else 'client_message' end,
          v_client, new.job_id);
  return new;
end $$;
create trigger notify_message after insert on public.messages
  for each row execute function private.notify_message();

revoke execute on function private.stamp_notification_settings()  from public, anon, authenticated;
revoke execute on function private.audit_bank_holiday()           from public, anon, authenticated;
revoke execute on function private.call_notify_function(jsonb)    from public, anon, authenticated;
revoke execute on function private.notify_request_created()       from public, anon, authenticated;
revoke execute on function private.notify_request_submitted()     from public, anon, authenticated;
revoke execute on function private.notify_consent_recorded()      from public, anon, authenticated;
revoke execute on function private.notify_message()               from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Schedules. pg_cron runs in UTC, so each London time is scheduled at both of its UTC hours (BST and GMT);
-- the function works out London time itself, so the one that is off by an hour simply finds nothing due.
-- ─────────────────────────────────────────────────────────────
select cron.schedule('notify-sweep', '*/5 * * * *',
  $$select private.call_notify_function('{"mode":"sweep"}'::jsonb)$$);
select cron.schedule('notify-morning-bst', '0 7 * * *',
  $$select private.call_notify_function('{"mode":"morning"}'::jsonb)$$);
select cron.schedule('notify-morning-gmt', '0 8 * * *',
  $$select private.call_notify_function('{"mode":"morning"}'::jsonb)$$);
select cron.schedule('notify-digest-bst', '0 16 * * *',
  $$select private.call_notify_function('{"mode":"digest"}'::jsonb)$$);
select cron.schedule('notify-digest-gmt', '0 17 * * *',
  $$select private.call_notify_function('{"mode":"digest"}'::jsonb)$$);
