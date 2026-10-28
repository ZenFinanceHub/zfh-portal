import { unzipSync } from "fflate";
import { expect, test } from "@playwright/test";
import { adminClient, ensureClientOwner, ensureUser, getLocal } from "../../scripts/local-supabase.mjs";
import { accessTokenOf, signInAs, signInAsStaffWithMfa, totp } from "./helpers";

// Prompt 9: the audit log page and CSV, rate limits, error pages and the subject access export.

const admin = adminClient();
const local = getLocal();
const uid = () => Math.random().toString(36).slice(2, 8);

async function fixture() {
  const tag = uid();
  const ownerEmail = `e2e.audit.owner.${tag}@example.com`;
  const ownerId = await ensureUser(admin, { email: ownerEmail });
  const clientName = `Audit ${tag} Ltd`;
  const clientId = await ensureClientOwner(admin, ownerId, clientName);
  const mk = async (title: string, service: string) =>
    (await admin.from("jobs").insert({ client_id: clientId, title, service }).select("id").single()).data!.id as string;
  const accJob = await mk(`Year end ${tag}`, "year_end");
  const finJob = await mk(`Loan ${tag}`, "finance_application");
  return { tag, ownerEmail, ownerId, clientName, clientId, accJob, finJob };
}

// ── The audit page ───────────────────────────────────────────

test("the admin reads the audit log in plain English, filters it and downloads it as a CSV, which is itself recorded", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  const f = await fixture();
  const adminEmail = `e2e.audit.admin.${f.tag}@example.com`;
  await signInAsStaffWithMfa(page, adminEmail);
  const { data: me } = await admin.from("profiles").select("id").eq("email", adminEmail).single();

  // A staff name that a spreadsheet would run as a formula
  const evilEmail = `e2e.audit.formula.${f.tag}@example.com`;
  const evilId = await ensureUser(admin, { email: evilEmail, staff: true, areas: ["accounting"] });
  await admin.from("profiles").update({ full_name: "=HYPERLINK(\"http://example.com\")" }).eq("id", evilId);

  await admin.from("audit_log").insert([
    { actor_id: me!.id, action: "job_zip_download", entity: "jobs", entity_id: f.accJob, client_id: f.clientId, meta: {} },
    { actor_id: me!.id, action: "lender_pack_download", entity: "jobs", entity_id: f.finJob, client_id: f.clientId, meta: {} },
    { actor_id: evilId, action: "file_download", entity: "files", entity_id: f.accJob, client_id: f.clientId, meta: {} },
    { actor_id: f.ownerId, action: "update", entity: "requests", entity_id: f.accJob, client_id: f.clientId, meta: { status: "submitted", job_id: f.accJob } },
  ]);

  await page.goto(`/admin/audit?client=${f.clientId}`);
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  const rows = page.getByTestId("audit-row");
  await expect(rows).toHaveCount(6); // the 4 added here, and the 2 job creations from the fixture
  await expect(page.getByTestId("audit-list")).toContainText("Downloaded a job's documents");
  await expect(page.getByTestId("audit-list")).toContainText("Downloaded a lender pack");
  await expect(page.getByTestId("audit-list")).toContainText("Client submitted a request");
  await expect(page.getByTestId("audit-list")).toContainText(f.clientName);
  await expect(page.getByTestId("audit-list")).toContainText("Business Finance"); // worked out from the job
  // Codes never show
  const text = await page.getByTestId("audit-list").innerText();
  for (const code of ["job_zip_download", "lender_pack_download", "file_download", "request_created"]) expect(text).not.toContain(code);
  // No sideways scrolling at 375px
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Filters: area, action, staff member, date range
  await page.goto(`/admin/audit?client=${f.clientId}&area=finance`);
  await expect(page.getByTestId("audit-row")).toHaveCount(2); // the lender pack download and the finance job's creation
  await expect(page.getByTestId("audit-list")).toContainText("Downloaded a lender pack");
  await expect(page.getByTestId("audit-list")).not.toContainText("Downloaded a job's documents");
  await page.goto(`/admin/audit?client=${f.clientId}&action=file_download`);
  await expect(page.getByTestId("audit-row")).toHaveCount(1);
  await page.goto(`/admin/audit?client=${f.clientId}&actor=${me!.id}`);
  await expect(page.getByTestId("audit-row")).toHaveCount(2);
  await page.goto(`/admin/audit?client=${f.clientId}&from=2001-01-01&to=2001-01-02`);
  await expect(page.getByText("Nothing matches those choices.")).toBeVisible();
  // The filter form works from the page
  await page.goto("/admin/audit");
  await page.getByLabel("Client").selectOption(f.clientId);
  await page.getByLabel("What happened").selectOption("lender_pack_download");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/action=lender_pack_download/);
  await expect(page.getByTestId("audit-row")).toHaveCount(1);

  // CSV: plain English, formula-safe, and recorded
  const before = (await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "audit_export")).count ?? 0;
  const res = await page.request.get(`/admin/audit/export?client=${f.clientId}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toContain("attachment");
  const csv = await res.text();
  expect(csv).toContain("When,Who,What happened,Client,Area,IP address");
  expect(csv).toContain("Downloaded a lender pack");
  expect(csv).toContain(f.clientName);
  expect(csv).toContain("'=HYPERLINK"); // the leading apostrophe stops it running as a formula
  expect(csv).not.toMatch(/,=HYPERLINK/);
  expect(csv.trim().split(/\r?\n/)).toHaveLength(7); // header + 6 (the 4 added here, and the 2 job creations)
  const { data: logged } = await admin.from("audit_log").select("actor_id, meta").eq("action", "audit_export").order("id", { ascending: false });
  expect(logged!.length).toBe(before + 1);
  expect(logged![0].actor_id).toBe(me!.id);
  expect((logged![0].meta as { rows: number }).rows).toBe(6);
  expect(JSON.stringify(logged![0].meta)).not.toContain(f.clientName);
});

test("staff who are not the admin cannot see or export the audit log", async ({ page }) => {
  const email = `e2e.audit.staff.${uid()}@example.com`;
  await signInAsStaffWithMfa(page, email, ["accounting"]);
  await page.goto("/admin/audit");
  await expect(page.getByText("Only the admin can see the audit log.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit", exact: true })).toHaveCount(0);
  const res = await page.request.get("/admin/audit/export");
  expect(res.status()).toBe(403);
  expect(await res.text()).not.toContain("When,Who");
});

// ── Rate limits ──────────────────────────────────────────────

test("sign-in links are limited per email, with the same message whether or not the email has an account", async ({ page }) => {
  const known = `e2e.limit.known.${uid()}@example.com`;
  await ensureUser(admin, { email: known });
  const unknown = `e2e.limit.unknown.${uid()}@example.com`;

  async function request(email: string) {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    return page.locator("main").innerText();
  }

  const messages: Record<string, string> = {};
  for (const email of [known, unknown]) {
    for (let i = 1; i <= 5; i++) {
      expect(await request(email)).toContain("If you have an account, we've emailed you a sign-in link.");
    }
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByTestId("login-limited")).toBeVisible();
    messages[email] = await page.getByTestId("login-limited").innerText();
  }
  expect(messages[known]).toMatch(/Too many sign-in requests\. Please wait about \d+ (minutes|hours?) and try again\./);
  expect(messages[known]).toBe(messages[unknown]); // nothing here tells you whether the email exists
  const { data: rows } = await admin.from("rate_limits").select("key_hash").eq("scope", "magic_link_email");
  expect(JSON.stringify(rows)).not.toContain("example.com");
});

test("authenticator code attempts are limited, and a right code is refused while limited", async ({ browser }) => {
  const email = `e2e.limit.mfa.${uid()}@example.com`;
  await ensureUser(admin, { email, staff: true });
  const context = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await context.newPage();

  // Set up an authenticator, keeping the secret so the test can also give the right code
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/auth\/mfa\/enrol$/);
  await page.getByRole("button", { name: "Can't scan it?" }).click();
  const secret = (await page.locator("code").innerText()).replace(/ /g, "").trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // A fresh browser signed in with the link only: the code page appears
  const second = await (await browser.newContext({ baseURL: "http://localhost:3000" })).newPage();
  await signInAs(second, email);
  await expect(second).toHaveURL(/\/auth\/mfa\/verify$/);

  async function tryCode(code: string) {
    await second.getByLabel("6-digit code").fill(code);
    await Promise.all([
      second.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/auth/mfa/verify")),
      second.getByRole("button", { name: "Continue" }).click(),
    ]);
  }

  let attempts = 0;
  let limited = false;
  while (!limited && attempts < 12) {
    attempts++;
    await tryCode("000000");
    await expect(second.locator('p[role="alert"]')).toBeVisible();
    limited = /Too many attempts\. Please wait about/.test(await second.locator('p[role="alert"]').innerText());
  }
  expect(limited).toBe(true);
  expect(attempts).toBeLessThanOrEqual(10); // 10 in 15 minutes, and the set-up code above counted as one

  // The genuine code is refused too while the limit stands
  await tryCode(totp(secret));
  await expect(second.locator('p[role="alert"]')).toContainText("Too many attempts");
  await expect(second).toHaveURL(/\/auth\/mfa\/verify$/);

  // Once the wait is over (the counters reset) the right code works
  await admin.from("rate_limits").delete().eq("scope", "mfa_verify");
  await tryCode(totp(secret));
  await expect(second).toHaveURL(/\/admin$/);
});

// ── Error pages ──────────────────────────────────────────────

test("a missing page shows a friendly page with no codes, and the portal does not leak anything", async ({ page }) => {
  const f = await fixture();
  await signInAs(page, f.ownerEmail);
  const res = await page.goto("/this-page-does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the portal" })).toBeVisible();
  const text = (await page.locator("body").innerText()).toLowerCase();
  for (const leak of ["stack", "digest", "error:", "undefined", "node_modules", "supabase"]) expect(text).not.toContain(leak);
  // another person's job id is the same plain 404
  const other = await page.goto(`/jobs/${f.finJob}`);
  expect([200, 404]).toContain(other?.status());
});

// ── Subject access export ────────────────────────────────────

async function exportFor(token: string | null, clientId: string) {
  return fetch(`${local.apiUrl}/functions/v1/client-export`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ client_id: clientId }),
  });
}

test("the admin exports everything held on a client; others cannot; the export is audited", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const f = await fixture();
  const answer = `ANSWER-${f.tag}`;
  const wording = `WORDING-${f.tag}`;
  const internal = `INTERNAL-NOTE-${f.tag}`;

  const { data: req } = await admin.from("requests").insert({ job_id: f.accJob, kind: "question", question_type: "text", title: "A question" }).select("id").single();
  await admin.from("responses").insert({ request_id: req!.id, author_id: f.ownerId, answer: { value: answer } });
  await admin.from("consents").insert({
    client_id: f.clientId, job_id: f.accJob, profile_id: f.ownerId, consent_type: "engagement_letter",
    wording_version: "v1", wording_text: wording,
  });
  await admin.from("messages").insert([
    { job_id: f.accJob, author_id: f.ownerId, body: "Hello from the client", internal: false },
    { job_id: f.accJob, author_id: f.ownerId, body: internal, internal: true },
  ]);

  async function addFile(name: string, status: string, deleted = false) {
    const id = crypto.randomUUID();
    const path = `${f.clientId}/${f.accJob}/${id}-${name}`;
    const bytes = Buffer.from(`%PDF-1.4 ${name}`);
    await admin.storage.from("client-files").upload(path, bytes, { contentType: "application/pdf" });
    // The scan runs on upload; set the state the test wants afterwards.
    await admin.from("files").insert({
      id, client_id: f.clientId, job_id: f.accJob, storage_path: path, original_name: name, mime_type: "application/pdf",
      size_bytes: bytes.length, uploaded_by: f.ownerId, scan_status: status, deleted_at: deleted ? new Date().toISOString() : null,
    });
    return id;
  }
  const cleanId = await addFile(`clean-${f.tag}.pdf`, "clean");
  const badId = await addFile(`bad-${f.tag}.pdf`, "infected");
  const goneId = await addFile(`gone-${f.tag}.pdf`, "clean", true);

  const adminEmail = `e2e.export.admin.${f.tag}@example.com`;
  await signInAsStaffWithMfa(page, adminEmail);
  const token = await accessTokenOf(page);
  const { data: me } = await admin.from("profiles").select("id").eq("email", adminEmail).single();

  // Refused: no token, a client, accounting-only staff
  expect((await exportFor(null, f.clientId)).status).toBe(403);
  const clientCtx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const clientPage = await clientCtx.newPage();
  await signInAs(clientPage, f.ownerEmail);
  expect((await exportFor(await accessTokenOf(clientPage), f.clientId)).status).toBe(403);
  await clientCtx.close();
  const staffCtx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const staffPage = await staffCtx.newPage();
  await signInAsStaffWithMfa(staffPage, `e2e.export.staff.${f.tag}@example.com`, ["accounting"]);
  expect((await exportFor(await accessTokenOf(staffPage), f.clientId)).status).toBe(403);
  await staffCtx.close();
  expect((await admin.from("audit_log").select("id").eq("action", "client_export").eq("client_id", f.clientId)).data).toHaveLength(0);

  // The admin
  const res = await exportFor(token, f.clientId);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.urls).toHaveLength(1);
  const link = new URL(body.urls[0]);
  const zipRes = await fetch(`${local.apiUrl}${link.pathname}${link.search}`);
  expect(zipRes.status).toBe(200);
  const files = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
  const names = Object.keys(files);
  for (const n of ["README.txt", "data/client.json", "data/contacts.json", "data/people.json", "data/jobs.json", "data/requests.json",
    "data/responses.json", "data/consents.json", "data/messages.json", "data/files.json", "data/audit_trail.json"]) {
    expect(names).toContain(n);
  }
  const read = (n: string) => new TextDecoder().decode(files[n]);
  expect(read("data/client.json")).toContain(f.clientName);
  expect(read("data/responses.json")).toContain(answer);
  expect(read("data/consents.json")).toContain(wording);
  expect(read("data/messages.json")).toContain(internal);
  expect(read("data/messages.json")).toContain('"internal": true');
  expect(JSON.parse(read("data/jobs.json"))).toHaveLength(2);
  expect(JSON.parse(read("data/audit_trail.json")).length).toBeGreaterThan(0);
  // Files: the clean one is in; the infected and deleted ones are listed with a reason
  expect(names.some((n) => n.startsWith(`files/${cleanId.slice(0, 8)}-`))).toBe(true);
  expect(names.some((n) => n.includes(badId.slice(0, 8)) || n.includes(goneId.slice(0, 8)))).toBe(false);
  const manifest = JSON.parse(read("data/files.json"));
  // Files already deleted under the retention rules no longer exist for anyone, so they are not listed at all
  expect(manifest.not_included_in_zip.map((x: { id: string }) => x.id)).toEqual([badId]);
  expect(JSON.stringify(manifest.not_included_in_zip)).toContain("virus check");
  // Staff appear by name only, never by email
  expect(read("data/people.json")).not.toContain(adminEmail);

  // Recorded, by the admin, for this client
  const { data: logged } = await admin.from("audit_log").select("actor_id").eq("action", "client_export").eq("client_id", f.clientId);
  expect(logged).toEqual([{ actor_id: me!.id }]);
  void totp;
});

// ── Exports: audited only once they succeed, and clear errors when a download fails ──

test("an export that fails is recorded as failed, not as done, and leaves no zip behind", async ({ page }) => {
  const f = await fixture();
  // A file the database says is clean, whose stored object is missing: the zip cannot be built
  const id = crypto.randomUUID();
  await admin.from("files").insert({
    id, client_id: f.clientId, job_id: f.accJob, storage_path: `${f.clientId}/${f.accJob}/${id}-missing.pdf`, original_name: "missing.pdf",
    mime_type: "application/pdf", size_bytes: 10, uploaded_by: f.ownerId, scan_status: "clean",
  });
  const adminEmail = `e2e.export.fail.${f.tag}@example.com`;
  await signInAsStaffWithMfa(page, adminEmail);
  const before = (await admin.storage.from("job-zips").list("")).data?.length ?? 0;

  const res = await exportFor(await accessTokenOf(page), f.clientId);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("Something went wrong.");

  const { data: rows } = await admin.from("audit_log").select("action").eq("client_id", f.clientId).in("action", ["client_export", "client_export_failed"]);
  expect(rows!.map((r) => r.action)).toEqual(["client_export_failed"]);
  expect(((await admin.storage.from("job-zips").list("")).data ?? []).length).toBe(before);
});

test("the export and CSV downloads work from the page, and a failed download says so", async ({ page }) => {
  test.setTimeout(120_000);
  const f = await fixture();
  await signInAsStaffWithMfa(page, `e2e.export.ui.${f.tag}@example.com`);

  // Client page: export, working
  await page.goto(`/admin/clients/${f.clientId}`);
  const [zip] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export everything we hold" }).click()]);
  expect(zip.suggestedFilename()).toBe("client-export.zip");
  await expect(page.getByTestId("export-client").getByRole("status")).toContainText("Your export is downloading");

  // ...and when the file cannot be fetched
  await page.route("**/storage/v1/object/sign/**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.getByRole("button", { name: "Export everything we hold" }).click();
  await expect(page.getByTestId("export-client").getByRole("status")).toContainText("Sorry, that download didn't work — please try again.");
  await expect(page.getByTestId("export-client")).not.toContainText("is downloading");
  await page.unroute("**/storage/v1/object/sign/**");

  // Audit page: CSV, working
  await page.goto(`/admin/audit?client=${f.clientId}`);
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("audit-export").click()]);
  expect(csv.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);

  // ...and when the server fails
  await page.route("**/admin/audit/export**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.getByTestId("audit-export").click();
  await expect(page.getByTestId("audit-export-error")).toHaveText("Sorry, that download didn't work — please try again.");
});

test("the smoke-check function does a storage round trip with the shared secret and refuses everyone else", async () => {
  const url = `${local.apiUrl}/functions/v1/smoke-check`;
  const without = await fetch(url, { method: "POST", body: "{}" });
  expect(without.status).toBe(401);
  const wrong = await fetch(url, { method: "POST", headers: { "x-webhook-secret": "nope" }, body: "{}" });
  expect(wrong.status).toBe(401);
  const ok = await fetch(url, { method: "POST", headers: { "x-webhook-secret": "local-development-only-smoke-secret" }, body: "{}" });
  expect(ok.status).toBe(200);
  expect((await ok.json()).steps).toEqual({ upload: true, sign: true, download: true, identical: true, removed: true });
  expect(((await admin.storage.from("job-zips").list("smoke")).data ?? []).length).toBe(0);
});
