# ZenFinanceHub Client Portal

Secure client portal for ZenFinanceHub (accounting + commercial finance brokerage + referred regulated work).
Clients upload documents, answer questions, approve work and give consents instead of using email.
Owner/admin: Craig Patterson. Live at `portal.zenfinancehub.com`, linked from `zenfinancehub.com`.

## Stack
- Next.js (App Router, latest stable) + TypeScript (strict) + Tailwind CSS
- Supabase: Auth, Postgres with row-level security (RLS), Storage, Edge Functions, pg_cron
- Supabase project region: **London (eu-west-2)**. Vercel functions region: **lhr1**
- `@supabase/ssr` for auth in server components, route handlers and middleware
- Transactional email: **Resend** (domain `zenfinancehub.com` already verified — DKIM, SPF `send` and DMARC records exist). From: `ZenFinanceHub <portal@zenfinancehub.com>`. zenfinancehub.com has no MX records, so always set Reply-To: craig@zen-finance.co.uk
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
- New request → email to client contacts on that job.
- Reminders 7, 3 and 1 days before `due_date` for open requests (pg_cron daily 08:00 Europe/London → `send-notifications` edge function).
- Client uploads, answers, approvals and consents → email to **craig@zen-finance.co.uk** (option for a daily digest at 17:00 instead).

## Definition of done for any feature
1. Types generated, `tsc --noEmit` clean, lint clean
2. RLS tests pass (`npm run test:rls`)
3. Works at 375px width
4. No sensitive data in logs/URLs/emails
5. Audit trail written for anything a client submits or downloads
