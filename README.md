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
*OAuth Apps → Add a new client* named Claude, confidential, redirect URIs `https://claude.ai/api/mcp/auth_callback` and
`https://claude.com/api/mcp/auth_callback`. The client secret is shown once; paste it straight into claude.ai (Settings →
Connectors → Add custom connector → Advanced settings) and don't store it anywhere else.
