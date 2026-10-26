-- LOCAL ONLY (listed in config.toml under [db.seed], which `db push` never runs).
-- Tells the local database where the scan-file edge function is, and the shared secret it expects
-- (the same throwaway value as SCAN_WEBHOOK_SECRET under [edge_runtime.secrets] in config.toml).
-- From inside the database container, the host machine is host.docker.internal.
-- The hosted project has its own random secret, set from the command line and never stored in a file.
insert into private.config (key, value) values
  ('scan_file_url', 'http://host.docker.internal:55321/functions/v1/scan-file'),
  ('scan_webhook_secret', 'local-development-only-scan-secret')
on conflict (key) do update set value = excluded.value;
