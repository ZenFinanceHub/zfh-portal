# ZenFinanceHub Client Portal

Secure client portal for ZenFinanceHub (accounting + commercial finance brokerage + referred regulated work).
Clients upload documents, answer questions, approve work and give consents instead of using email.
Owner/admin: Craig Patterson. Live at `portal.zenfinancehub.com`, linked from `zenfinancehub.com`.

## Stack
- Next.js (App Router, latest stable) + TypeScript (strict) + Tailwind CSS
- Supabase: Auth, Postgres with row-level security (RLS), Storage, Edge Functions, pg_cron
- Supabase project region: **London (eu-west-2)**. Vercel functions region: **lhr1**
- `@supabase/ssr` for auth in server components, route handlers and middleware
- Transactional email: **Resend** (sending domain `mail.zenfinancehub.com`, verified in Resend, EU region). From: `ZenFinanceHub <portal@mail.zenfinancehub.com>`. Always set Reply-To: craig@zen-finance.co.uk. Supabase auth emails (invites, magic links) also go out through Resend SMTP.
- Supabase project ref: `vvxrqwcmyisiweecqgyn` (London). Vercel project: `zfh-portal`, domain `portal.zenfinancehub.com`
- Zod for all input validation; generated Supabase types (`supabase gen types`) — never hand-write DB types

## Folder layout
```
app/(client)/        client-facing pages: /, /jobs/[id], /documents, /messages, /account
app/(admin)/admin/   staff pages: dashboard, clients, jobs, templates, audit
app/auth/            login, callback, MFA enrol/verify
components/          shared UI (ui/ = primitives)
lib/supabase/        server + browser clients, middleware helper
lib/validation/      zod schemas
supabase/migrations/ SQL migrations (0001_init.sql is the base schema + RLS)
supabase/functions/  edge functions (invite-contact, scan-file, send-notifications, job-zip, client-export)
supabase/seed.sql    job templates
tests/rls/           RLS tests that must pass before any real client data goes in
```

## Brand
- Black and gold only. Never navy, green or teal.
- Tokens (Tailwind theme): `ink #0A0A0A` (background), `surface #151515`, `line #2A2A2A`, `gold #C9A84C`, `gold-light #E3C77A`, `text #FFFFFF`, `text-muted #B5B5B5`, `danger #E5484D`
- Primary buttons: gold background, black text. Headings white. Metallic feel via subtle gold gradient on the logo/header only.
- Mobile-first. Large tap targets (min 44px), base font 16px+, no session time-outs for clients, answers autosave.

## Product rules
- Clients see plain English only. No internal codes, percentages or job IDs.
  - Stages shown to clients: Waiting on you · In progress · Ready to review · Completed
- Client home = one "Things to do" list across all their entities, soonest due first.
- Roles: `admin` (Craig), `staff` (e.g. Chris), client `owner`, client `contributor`.
  - Contributors only see jobs they are added to and cannot approve or consent.
- Only staff create clients, jobs and requests. Clients respond.
- Requests have a `kind`: upload · question · approval · consent.
- Brokerage jobs (`service = finance_application`) also carry `finance_stage`: gathering → submitted → credit_decision → offer → completed/declined.
- Regulated referrals capture the minimum fact-find plus explicit consent, then hand off. The portal must never word anything as regulated advice.
- UK English, dates DD/MM/YYYY, money in GBP (£1,234.56), Europe/London time zone.
- **Areas (Accounting and Business Finance):** every job has an `area`, derived from `service` and never set by hand: `finance_application` and `regulated_referral` → `finance`; every other service → `accounting`. It is a generated column (`jobs.area`, also `templates.area`) so it cannot drift. Clients see the labels "Accounting" and "Business Finance"; the brand is ZenFinanceHub throughout.
  - Clients with jobs in both areas get an "Accounting | Business Finance" tab bar on Things to do, Documents and Messages (no tab bar with only one area). The last tab is remembered per device.
  - Staff access is by area, enforced in RLS: `profiles.staff_areas` (`accounting`, `finance`). Admin always has both. New staff start with none and see nothing until the admin grants an area (/admin/settings → Staff; changes are audited). Staff see a client only if they can access an area that client has a job in, or the client has no jobs yet. `staff_can_access_area()` / `staff_can_access_job()` are the helpers every staff policy and RPC uses.
  - The finance pipeline (`finance_stage`) is only shown in the Finance view.

## Security rules (non-negotiable)
- RLS is the security boundary. Every table has RLS on; never disable it, never query with the service role from browser or server components.
- The service role key is used **only** inside Supabase Edge Functions. It never appears in Next.js env vars that reach the client, and preferably not in Next.js at all.
- Client-side writes that change state go through the RPCs in the migration (`submit_request`, `record_consent`, `log_event`), not direct table updates.
- Files: private bucket `client-files`, path `{client_id}/{job_id}/{file_id}-{safe_filename}`. Insert the `files` row first, then upload. Serve downloads only through signed URLs with a 60-second expiry, and call `log_event('file_download', …)` when issuing one.
- Clients can only download files with `scan_status = 'clean'`.
- No personal or financial data in: URLs/query strings, emails, push notifications, logs, analytics, error trackers. Emails say "You have something to do" + a link, nothing more.
- Auth: invite-only (public sign-ups disabled in Supabase). Clients use magic links. Staff must have TOTP MFA and every `/admin` route requires `aal2`.
- Security headers: strict CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, no third-party scripts on portal pages.
- Every schema change ships as a new migration with RLS policies **and** matching tests in `tests/rls/`.

## Notifications
To clients:
- New request → email to client contacts on that job ("You have something to do" + link, nothing more).
- Reminders 7, 3 and 1 days before `due_date` for open requests (pg_cron daily 08:00 Europe/London → `send-notifications` edge function).

To staff (rules set by Craig, built in Prompt 7):
- **Batching:** when a client submits (upload or question) or sends a message, send ONE email per client per batch, 15 minutes after that client's last activity, e.g. "Alpha Ltd sent 3 items and 1 message on the Year-end job". Never one email per file.
- **Urgent — sent immediately, even in quiet hours:** approvals, `lender_share` consents, and any upload or submit on a `finance_application` job.
- **Quiet hours:** 18:00–08:00 Europe/London, plus Saturday and Sunday, plus UK bank holidays (from an editable table). Non-urgent alerts are held and sent as one email at 08:00 on the next working day.
- **Routing:** to the job's assigned staff member; if none is assigned, to craig@zen-finance.co.uk.
- **Daily digest:** to craig@zen-finance.co.uk at 17:00 on working days, grouped by area (Accounting, Business Finance), then by client. Skipped if nothing happened.
- **Content:** client name, job title, kind and count of items, and a link. NEVER file names, answers, amounts or message text.
- **Settings and log:** the rules live in a `notification_settings` table, editable at `/admin/settings`. Every send is recorded in `notifications_log` to prevent duplicates.

## Definition of done for any feature
1. Types generated, `tsc --noEmit` clean, lint clean
2. RLS tests pass (`npm run test:rls`)
3. Works at 375px width
4. No sensitive data in logs/URLs/emails
5. Audit trail written for anything a client submits or downloads
