# ZenFinanceHub Portal — Build Prompts for Claude Code

Paste these into Claude Code one at a time, in order. Don't start the next until the current one's checks pass.
CLAUDE.md sits in the repo root, so Claude Code already knows the rules, brand and stack.

---

## Before you start (one-off, ~30 mins, by hand)

1. Create a GitHub repo `zfh-portal` and clone it.
2. Copy in: `CLAUDE.md` (root), `supabase/migrations/0001_init.sql`, `supabase/seed.sql`, `tests/rls/rls_test.sql`, `tests/rls/supabase_stub.sql`.
3. Create a Supabase project, **region London (eu-west-2)**, name `zfh-portal`. Save the DB password somewhere safe.
4. In Supabase → Authentication → Providers → Email: turn **off** "Allow new users to sign up". Turn **on** MFA (TOTP).
5. Create a Vercel project from the repo; set function region `lhr1`.
6. DNS: add `portal.zenfinancehub.com` as a CNAME to Vercel.
7. ~~Email provider~~ — done: Resend sending domain `mail.zenfinancehub.com` is verified (EU region); From `ZenFinanceHub <portal@mail.zenfinancehub.com>`, Reply-To craig@zen-finance.co.uk. Supabase auth emails already go through Resend SMTP. Create a Resend API key for the portal when you reach Prompt 7 and store it only as a Supabase Edge Function secret.

---

## Prompt 1 — Scaffold

```
Read CLAUDE.md. Scaffold the project:
- Next.js (latest stable, App Router, TypeScript strict, ESLint, Tailwind, src-less layout as in CLAUDE.md)
- Install @supabase/ssr, @supabase/supabase-js, zod
- Tailwind theme with the brand tokens from CLAUDE.md; dark black-and-gold base layout, mobile-first
- lib/supabase/server.ts, lib/supabase/client.ts, middleware.ts using @supabase/ssr (cookie-based sessions)
- Supabase CLI init; keep my existing supabase/migrations/0001_init.sql and supabase/seed.sql
- npm scripts: dev, build, lint, typecheck, db:types (supabase gen types → lib/database.types.ts), test:rls
- test:rls runs tests/rls/rls_test.sql against the LOCAL Supabase DB (supabase start) and fails on any error.
  On local Supabase, skip supabase_stub.sql (auth/storage already exist) — set request.jwt.claim.sub works the same.
- Security headers in next.config (CSP, HSTS, X-Frame-Options DENY, Referrer-Policy same-origin)
- A placeholder home page in brand styling.
Then run supabase start, apply migrations + seed, generate types, and run test:rls. Show me the output.
```

**Check:** `npm run test:rls` ends with `ALL RLS TESTS PASSED`. `npm run typecheck` clean.

---

## Prompt 2 — Auth

```
Build authentication per CLAUDE.md:
- /auth/login: email field only → Supabase magic link (shouldCreateUser: false, so unknown emails get a generic
  "If you have an account, check your email" message — never reveal whether an email exists)
- /auth/callback route handler exchanging the code for a session
- Staff: after login, if profile.is_staff and no verified TOTP factor → /auth/mfa/enrol (QR code + verify);
  if factor exists but session is aal1 → /auth/mfa/verify
- middleware: /admin/** requires is_staff AND aal2; client routes require any session; redirect otherwise
- Sign out button; call log_event('login', 'profiles', user id) once per login
- Branded, mobile-first, large inputs. UK English copy.
Write Playwright tests for: unauthenticated redirect, client blocked from /admin, staff without MFA blocked.
```

**Check:** You can log in as yourself, enrol MFA, reach `/admin`. Make yourself admin first:
`update public.profiles set is_staff = true, staff_role = 'admin' where email = 'craig@zen-finance.co.uk';`

---

## Prompt 3 — Admin: clients and contacts

```
Build /admin/clients:
- List (search by name, filter by status), create/edit client form (zod-validated): name, entity type,
  company number, UTR, Xero contact ID, year end, assigned staff, status
- Client detail page: contacts list with role (owner/contributor), jobs list, "Invite contact" button
- Edge function supabase/functions/invite-contact: staff-only (verify caller JWT is staff via profiles),
  uses service role to inviteUserByEmail (redirect to portal.zenfinancehub.com/auth/callback),
  then inserts client_contacts with the chosen role. If the user already exists, just link them.
- Invite email copy: "ZenFinanceHub has set up your secure client portal. Click below to sign in." No client data.
Add RLS tests for client_contacts writes being staff-only.
```

---

## Prompt 4 — Jobs, templates and requests

```
Build jobs and requests for staff:
- /admin/templates: list and edit the seeded templates (request blueprints in templates.requests jsonb)
- "New job" on a client: pick template → title, service, period end, due date, assigned staff,
  contributors (job_contacts). Creating it inserts the job and one request per blueprint, with due_date =
  today + due_offset_days (approval requests start hidden/unscheduled until I add them — skip blueprints
  without due_offset_days, list them as "add later" on the job page)
- Job page (admin): requests with status, add/edit/cancel request, Accept or Return (with reason) a
  submitted request, change job stage; for finance_application jobs, finance_stage selector
- Internal notes (messages.internal = true) panel visible to staff only
- Admin dashboard /admin: counts and lists for "Newly submitted", "Overdue", "Due this week", by client
```

---

## Prompt 5 — Client experience

```
Build the client side, mobile-first, plain English (see CLAUDE.md product rules):
- / "Things to do": all open/returned requests across every client entity the user can see, soonest due first,
  grouped by entity if more than one. Each card: title, due date (DD/MM/YYYY), one action button.
- Returned requests show my return reason prominently.
- /jobs/[id]: client-facing stage name, the job's requests, shared documents, message thread
- Upload request: camera or file picker, multiple files, progress bar; insert files row first, then upload to
  {client_id}/{job_id}/{file_id}-{safe_filename}; then "Send to ZenFinanceHub" calls submit_request
- Question request: right input for question_type (text, yes/no, choice, date, £ amount); autosave draft
  locally; submit inserts response then submit_request
- Approval request: shows linked document(s) + "I approve" button (owner only; contributors see
  "Your account owner needs to approve this")
- Consent request: shows the exact wording (versioned constants in lib/consents.ts), checkbox + confirm
  → record_consent with that wording
- After every submit: a clear "Received — nothing more needed" confirmation
- /documents: files shared with the client (clean only), download via 60s signed URL + log_event
Test at 375px. No session timeouts for clients.
```

---

## Prompt 6 — Files: virus scan and zips

```
- Edge function scan-file, triggered by a database webhook on insert into public.files:
  download the object with service role, send to the virus-scan API (env VIRUS_SCAN_API_KEY), set
  scan_status clean/infected/error. Infected: delete the object, keep the row, email craig@zen-finance.co.uk
  ("A file failed a virus scan — check the portal"), no file details in the email.
- Edge function job-zip: staff-only, zips all clean files for a job, returns a 60s signed URL, logs
  job_zip_download
- "Lender pack" button on finance_application jobs: same as job-zip but only files on upload requests,
  logs lender_pack_download, and is blocked unless a lender_share consent exists for the job
- Set retain_until on new files: 6 years from period_end (or created_at), 5 years after client ended_at for
  onboarding ID documents. Admin page listing files past retain_until for me to review before deletion.
```

---

## Prompt 7 — Notifications

```
- Edge function send-notifications (Resend, API key from Edge Function secret RESEND_API_KEY, Reply-To craig@zen-finance.co.uk), modes:
  1. new_request: email each contact who can see the job: subject "You have something to do",
     body = one line + button to portal. No titles, amounts or names of documents.
  2. reminders: daily, open requests due in 7, 3 or 1 days → one email per contact listing only the count
  3. staff_alert: on client submit/consent → email craig@zen-finance.co.uk with client name and link to
     the job (internal email, still no file contents); setting for instant vs 17:00 daily digest
- pg_cron: reminders 08:00 Europe/London daily, digest 17:00
- Track sends in a notifications_log table (new migration + RLS + tests) to avoid duplicate emails
- Unsubscribe-from-reminders toggle on /account (stored on profiles; new migration)
```

---

## Prompt 8 — Audit, export and hardening

```
- /admin/audit: filter audit_log by client, action, date; CSV export
- Edge function client-export (admin only): zip of everything held on one client (data as JSON + clean files)
  for subject access requests; logs client_export
- Run a security review of the whole codebase against CLAUDE.md's security rules: service role usage,
  data in URLs/logs/emails, missing RLS tests, CSP. Fix what you find and list it.
- Rate-limit magic-link requests (per IP and per email)
- Error pages in brand style; no stack traces to the browser
- Production checklist in README: env vars, Supabase backups (enable PITR if budget allows), Resend
  domain, Vercel region, DNS, making the first admin
```

---

## Prompt 9 — Go live with pilot clients

```
Prepare for a pilot with 3–5 clients:
- Seed nothing in production except templates
- A one-page "How the portal works" help page for clients (plain English, screenshots placeholders)
- Add "Client login" button snippet for zenfinancehub.com (black and gold, links to portal)
- Smoke-test script: invite a test client, create a year-end job, upload, answer, approve, consent,
  download, zip — end to end on staging
```

**Gate before real data:** `npm run test:rls` passes on the production schema, MFA works for you, a test file is scanned and downloadable, and a client in one entity cannot see another (try it with two test accounts by hand too).
