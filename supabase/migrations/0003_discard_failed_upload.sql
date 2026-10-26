-- Prompt 5: let a user clean up after a failed upload.
--
-- The client app inserts the files row first, then uploads the file. If the upload fails, the row would
-- be left behind (and submit_request would count it). Users have no delete policy on files, so this
-- function removes the caller's own still-pending row, but only when no object was stored for it.
-- (It checks storage.objects directly because users cannot see pending objects through RLS.)

create or replace function public.discard_failed_upload(p_file_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.files;
begin
  select * into f from public.files where id = p_file_id for update;
  if not found or f.uploaded_by is distinct from auth.uid() then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  if f.scan_status <> 'pending' then
    raise exception 'This file can no longer be removed';
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'client-files' and o.name = f.storage_path) then
    raise exception 'This file was uploaded';
  end if;

  delete from public.files where id = f.id;

  insert into public.audit_log (actor_id, action, entity, entity_id, client_id, ip)
  values (auth.uid(), 'upload_discarded', 'files', f.id, f.client_id, public.request_ip());
end $$;

revoke execute on function public.discard_failed_upload(uuid) from public, anon;
grant  execute on function public.discard_failed_upload(uuid) to authenticated;
