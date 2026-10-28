-- 0010: record failed exports, and only record an export as done once the file really exists.
--
-- "client_export" now means the zip was built and the download link issued. If anything fails after the person has
-- been checked, "client_export_failed" is recorded instead (who, which client, never any content).

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
  if p_action not in ('file_download', 'job_zip_download', 'login', 'client_export', 'client_export_failed', 'lender_pack_download') then
    raise exception 'Unknown action';
  end if;
  -- Exports are the admin's alone.
  if p_action in ('client_export', 'client_export_failed') and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_client_id is not null and not public.can_access_client(p_client_id) then
    raise exception 'Not allowed';
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, client_id, ip)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_client_id, public.request_ip());
end $$;

-- The audit log CSV could not be produced.
create or replace function public.log_audit_export_failed(p_filters jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() or private.token_client() is not null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, action, entity, ip, meta)
  values (auth.uid(), 'audit_export_failed', 'audit_log', public.request_ip(),
          jsonb_build_object('filters', coalesce(p_filters, '{}'::jsonb)));
end $$;

revoke execute on function public.log_audit_export_failed(jsonb) from public, anon;
grant  execute on function public.log_audit_export_failed(jsonb) to authenticated;
