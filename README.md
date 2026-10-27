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

## Notifications

Emails are decided by `send-notifications` using the rules in `notification_settings` and `uk_bank_holidays`, which the admin edits at
**/admin/settings → Notifications**. Database triggers queue what happened (ids only, never content); pg_cron runs the function every
5 minutes and at 08:00 and 17:00 London time. Every send is recorded once in `notifications_log`. The rules themselves are plain
functions in `supabase/functions/_shared/notify-rules.ts`, tested in `tests/e2e/notifications.spec.ts`.
