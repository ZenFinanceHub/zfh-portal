# ZenFinanceHub Client Portal

Secure client portal for ZenFinanceHub — documents, questions, approvals and consents in one place instead of email.

- **CLAUDE.md** — project brief and non-negotiable rules for Claude Code
- **BUILD_PROMPTS.md** — the build plan: one-off setup, then 9 prompts to run in order
- **supabase/migrations/0001_init.sql** — schema, row-level security, RPCs, storage
- **supabase/seed.sql** — job templates for each service
- **tests/rls/** — security tests; must pass before any real client data goes in

Start with "Before you start" in BUILD_PROMPTS.md.
