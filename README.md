# ZenFinanceHub Client Portal

Secure client portal for ZenFinanceHub — documents, questions, approvals and consents in one place instead of email.

- **CLAUDE.md** — project brief and non-negotiable rules for Claude Code
- **BUILD_PROMPTS.md** — the build plan: one-off setup, then 9 prompts to run in order
- **supabase/migrations/0001_init.sql** — schema, row-level security, RPCs, storage
- **supabase/seed.sql** — job templates for each service
- **tests/rls/** — security tests; must pass before any real client data goes in

Start with "Before you start" in BUILD_PROMPTS.md.

## Staff devices

Uploaded files are **not** scanned for malware by a third-party service yet (see `docs/processors.md`); the portal only
checks that each file really is the type it claims to be. So **staff must keep Microsoft Defender on and up to date on
any device that opens client files.** Open files from the portal's download links, not from forwarded copies.

## Edge function secrets

Edge functions read secrets set on the Supabase project (never in files):

- `RESEND_API_KEY` — alert and notification emails (e.g. a failed file check, "you have something to do").
- `SCANNER_PROVIDER` — `none` (default). `scanii` later, together with `SCANNER_API_KEY` and `SCANNER_API_SECRET`.
- `NOTIFY_WEBHOOK_SECRET` — shared secret for `send-notifications`. The database sends the same value (stored in `private.config` as `notify_webhook_secret`, with `notify_url`) when pg_cron or an urgent trigger calls the function. Until both are set, no notification emails are sent.

**Local test settings never go in `config.toml`.** The Supabase CLI copies `[edge_runtime.secrets]` from `supabase/config.toml` to the
live project whenever functions are deployed. Local-only values (mock scanner, capture-only mailer, test webhook secrets) therefore
live in `supabase/functions/.env` (not committed; copy `supabase/functions/.env.example`). After any `functions deploy`, check
`npx supabase secrets list --project-ref vvxrqwcmyisiweecqgyn` shows no `NOTIFY_TRANSPORT` or `SCANNER_PROVIDER=mock`.

### Deploy checklist

After deploying functions (`npx supabase functions deploy <name>`), **always run `npx supabase secrets list --project-ref vvxrqwcmyisiweecqgyn`**.
It lists names and SHA-256 digests (never values). There must be no `NOTIFY_TRANSPORT`, no `SCANNER_PROVIDER=mock`, and no digest matching a
value in `supabase/functions/.env` (hash each local value with SHA-256 and compare). Then check one sweep returns 200: from the SQL editor run
`select private.call_notify_function('{"mode":"sweep"}'::jsonb);` and read the newest row of `net._http_response`.

## Running the end-to-end tests

Needs Docker running and local Supabase started (`npx supabase start`). Then `npm run test:e2e` (or `npm run test:e2e:low`, one worker).

`supabase start` does not serve the edge functions, which the export, job-zip, invite and smoke-check tests call. The e2e global setup
(`tests/e2e/global-setup.ts`) checks for them and, if they are not running, starts `npx supabase functions serve --env-file supabase/functions/.env`
itself, then stops it and removes its container when the run ends. If you already have `functions serve` running it is left alone. The
`.env` is the local-only file described above, so copy `supabase/functions/.env.example` first.

## Notifications

Emails are decided by `send-notifications` using the rules in `notification_settings` and `uk_bank_holidays`, which the admin edits at
**/admin/settings → Notifications**. Database triggers queue what happened (ids only, never content); pg_cron runs the function every
5 minutes and at 08:00 and 17:00 London time. Every send is recorded once in `notifications_log`. The rules themselves are plain
functions in `supabase/functions/_shared/notify-rules.ts`, tested in `tests/e2e/notifications.spec.ts`.

## Claude connector (MCP)

A remote MCP server at `/api/mcp` lets staff manage requests from a Claude chat. Claude signs in through Supabase's OAuth 2.1
server; every call runs as that staff member (no service role), so row-level security and the area rules apply.

- **MFA.** Supabase marks connector tokens `aal1` whatever the sign-in was, so the token cannot prove an authenticator code.
  Instead a *grant* (`connector_grants`) is created only by `connector_record_grant()`, which refuses anything but an ordinary
  staff session at `aal2`, and only the consent page (`/oauth/consent`) calls it. Every `connector_*` database function checks
  the grant (not revoked, under 7 days old), that the caller is staff and has a verified authenticator. No grant or an old one:
  401, and the Supabase consent and tokens are ended so Claude has to ask again through the consent page.
- **Data.** A connector token cannot read or write any table or stored file (restrictive `no_connector_tokens` policy on every
  table), and the API gate (`connector_gate`, run by PostgREST as `pgrst.db_pre_request`) refuses it on everything except
  `connector_*` functions. The tools return names, titles, statuses and due dates only.
- **Writes.** Write tools preview unless `confirm=true`; the database does the previewing, so nothing is written without it.
  Changes are audited with `meta.source = 'claude_connector'`.
- **Switching it off.** Settings → Connected apps lists the grants and revokes them at once (audited). Emergency off for
  everything: `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';` removes the API gate;
  to stop the connector itself, disable the OAuth server in Supabase (Authentication → OAuth Server).

Set-up in Supabase (Authentication): *OAuth Server* on, Authorization Path `/oauth/consent`, dynamic registration **off**; then
*OAuth Apps → Add a new client* named Claude, confidential, **token endpoint authentication method `client_secret_post`** (claude.ai sends the
secret in the request body; with the default `client_secret_basic` the token exchange fails and claude.ai only says "Authorization failed"), redirect URIs `https://claude.ai/api/mcp/auth_callback` and
`https://claude.com/api/mcp/auth_callback`. The client secret is shown once; paste it straight into claude.ai (Settings →
Connectors → Add custom connector → Advanced settings) and don't store it anywhere else.

## Audit log, exports and limits

- **/admin/audit** (admin only): filter by client, team member, what happened, area and dates; plain-English wording; **Download as CSV**
  (every export is itself recorded as "Exported the audit log"). The log holds ids, actions and counts, never answers, file names or message text.
- **Subject access request:** on a client's page (admin only), *Export everything we hold* builds a zip: the records as JSON (client, contacts, jobs,
  requests, answers, consents with their exact wording, messages **including internal notes**, the client's audit trail) plus every stored file that
  passed its virus check. Files that failed or are still being checked are listed in `data/files.json` with the reason. Check staff notes before
  sharing them: they can name other people or be exempt. Links last 60 seconds; the export is recorded as `client_export` first (no record, no download).
  Limit: 400 MB of files per export (split into zips of about 50 MB).
- **Rate limits** (counters in the `rate_limits` table, hashed, cleared after two days): 5 sign-in links every 15 minutes per email address and 20 an hour per IP address,
  10 authenticator code attempts per 15 minutes per person, 120 connector calls a minute per person. Messages never say whether an email has an account.

## Production checklist

**Hosting and plans**
- Vercel **Pro** (the free Hobby plan is not for commercial use), project `zfh-portal`, functions region `lhr1`, domain `portal.zenfinancehub.com`.
  Vercel environment variables are exactly two: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **Never add a service role key.**
- Supabase **Pro**, project `vvxrqwcmyisiweecqgyn`, region London (eu-west-2).
- Resend: domain `mail.zenfinancehub.com` verified (EU region); Supabase auth emails go out through Resend SMTP.

**Backups**
- Daily backups are on (check Dashboard → Database → Backups; or `npx supabase backups list --project-ref vvxrqwcmyisiweecqgyn`). Pro keeps 7 days.
- **Point-in-time recovery is off.** It is an add-on: about $100 a month for 7 days, $200 for 14, $400 for 28, and it needs at least the Small compute size.
  Turning it on replaces the daily backups.
- **Backups do not include stored files.** Client documents in Storage are not in a database backup, and a restore will not bring back a file deleted since.
  Keep that in mind before running retention deletes, and consider a periodic copy of the `client-files` bucket.

**After every deploy**
- Functions: run `npx supabase secrets list --project-ref vvxrqwcmyisiweecqgyn` (see *Deploy checklist* above) and one sweep check.
- Database: `npx supabase db push --linked --dry-run` first, then the push, **then** the code. Run `npm run test:rls:remote` afterwards; it also checks the API gate
  (`pgrst.db_pre_request`) is still set, which a platform update could reset.
- Headers: `curl -sI https://portal.zenfinancehub.com/auth/login` shows the CSP (with a nonce), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`,
  `Cross-Origin-Opener-Policy: same-origin` and `X-Content-Type-Options: nosniff`.
- `npm audit` should say 0 vulnerabilities.

**Add the first admin** (once): create the user in Supabase (Authentication → Users → Add user, confirm email), then in the SQL editor
`update public.profiles set is_staff = true, staff_role = 'admin' where email = 'craig@zen-finance.co.uk';` The first sign-in asks them to set up an authenticator app.

**Add a staff member**
1. Supabase dashboard → Authentication → Users → *Invite user* (their email). Public sign-ups stay off.
2. SQL editor: `update public.profiles set is_staff = true, staff_role = 'staff' where email = '…';`
3. They open the invite link and set up an authenticator app (required for every staff page).
4. Settings → Staff: tick their areas (Accounting, Business Finance). Until you do they see nothing. If they need the Claude connector, they connect it themselves.

**Offboard a staff member** (do all four, in this order)
1. Settings → Staff: untick every area (audited), and reassign any clients or jobs assigned to them.
2. Settings → Connected apps: *Switch off* their Claude access.
3. Supabase → Authentication → Users → the person → *Ban user* (this disables login; keep the account so the audit log still shows their name).
   Then end any open sessions: SQL editor `delete from auth.sessions where user_id = (select id from auth.users where email = '…');`
4. SQL editor: `update public.profiles set is_staff = false, staff_role = null, staff_areas = '{}' where email = '…';`

**Incidents**
- *A staff login may be stolen:* ban the user (as above) and delete their sessions; Settings → Connected apps → *Switch off*; read /admin/audit filtered to them.
  Rotate anything they could have seen (below).
- *The connector misbehaves:* Settings → Connected apps → *Switch off* (stops it at once). To stop everyone, turn off *OAuth Server* in Supabase (Authentication → OAuth Server).
  If the API gate itself causes trouble: `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';` (then fix and re-set it).
- *Rotate a function secret* (never paste values into chat or files): generate it, set it in the function, and put the same value in the database in one command, e.g. for the scan secret
  `S=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")` then `npx supabase secrets set "SCAN_WEBHOOK_SECRET=$S" --project-ref vvxrqwcmyisiweecqgyn`
  and `npx supabase db query --linked "update private.config set value = '$S' where key = 'scan_webhook_secret'"`; `unset S`. The notifier uses `NOTIFY_WEBHOOK_SECRET` / `notify_webhook_secret` the same way.
  `RESEND_API_KEY`: create a new key in Resend, set it with `npx supabase secrets set RESEND_API_KEY=…` yourself, then delete the old key in Resend.
  The Claude connector's client secret: Supabase → Authentication → OAuth Apps → Claude → regenerate, then paste the new one into claude.ai.
- *Client account compromised:* ban the user in Supabase, delete their sessions, review /admin/audit for the client, and invite them again once safe.
- *Personal data exposed:* note what and when from the audit log, and consider whether the ICO needs telling (72 hours).
