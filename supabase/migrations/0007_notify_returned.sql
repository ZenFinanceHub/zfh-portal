-- 0007: tell the client when staff return a request.
-- Same event as a new request, so it is bundled the same way (per job, client_bundle_minutes) and the email says
-- the same thing ("You have something to do"). The return reason is never copied anywhere: the queue holds ids only.

create or replace function private.notify_request_returned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications_queue (audience, event, client_id, job_id, request_id, request_kind)
  select 'client', 'request_created', j.client_id, new.job_id, new.id, new.kind
    from public.jobs j where j.id = new.job_id;
  return new;
end $$;

create trigger notify_request_returned after update of status on public.requests
  for each row when (old.status is distinct from new.status and new.status = 'returned')
  execute function private.notify_request_returned();

revoke execute on function private.notify_request_returned() from public, anon, authenticated;
