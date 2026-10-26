import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  adminClient,
  ensureClientOwner,
  ensureUser,
  getLocal,
  magicLinkToken,
} from "../../scripts/local-supabase.mjs";
import { accessTokenOf, signInAs, signInAsStaffWithMfa } from "./helpers";

// Files: scanning, staff documents, zips and retention. Runs on a 375px phone.
// The local scan-file function uses the "mock" scanner (basic checks, plus the EICAR test string counts as a virus).
test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

const admin = adminClient();
const local = getLocal();
const run = Date.now();
let counter = 0;
const uid = () => `${run}-${++counter}`;

// The throwaway secret the local database and local functions share (supabase/config.toml and seed_local.sql).
const LOCAL_SCAN_WEBHOOK_SECRET = "local-development-only-scan-secret";

const PDF = (text = "test") => Buffer.from(`%PDF-1.4 ${text}`);
// The industry-standard harmless antivirus test string.
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

async function setup(service = "year_end") {
  const tag = uid();
  const ownerEmail = `files.owner.${tag}@example.com`;
  const ownerId = await ensureUser(admin, { email: ownerEmail });
  const clientId = await ensureClientOwner(admin, ownerId, `Files Client ${tag} Ltd`);
  const { data: job } = await admin
    .from("jobs")
    .insert({ client_id: clientId, title: `Job ${tag}`, service })
    .select("id")
    .single();
  return { tag, ownerEmail, ownerId, clientId, jobId: job!.id as string };
}

async function addRequest(jobId: string, row: Record<string, unknown>) {
  const { data } = await admin.from("requests").insert({ job_id: jobId, ...row }).select("id").single();
  return data!.id as string;
}

/** Registers a file row and (optionally) stores its object the way the app does; storing it triggers the scan. */
async function addFile(
  s: { clientId: string; jobId: string },
  o: { name: string; by: string; bytes?: Buffer | null; requestId?: string; visibility?: "client" | "internal" },
) {
  const id = crypto.randomUUID();
  const path = `${s.clientId}/${s.jobId}/${id}-${o.name}`;
  const { error } = await admin.from("files").insert({
    id,
    client_id: s.clientId,
    job_id: s.jobId,
    request_id: o.requestId ?? null,
    storage_path: path,
    original_name: o.name,
    mime_type: "application/pdf",
    size_bytes: o.bytes?.length ?? 0,
    uploaded_by: o.by,
    visibility: o.visibility ?? "client",
  });
  expect(error).toBeNull();
  if (o.bytes !== null) {
    const { error: upError } = await admin.storage
      .from("client-files")
      .upload(path, o.bytes ?? PDF(), { contentType: "application/pdf" });
    expect(upError).toBeNull();
  }
  return { id, path };
}

async function status(id: string) {
  const { data } = await admin.from("files").select("scan_status").eq("id", id).single();
  return data?.scan_status;
}
const waitFor = (id: string, expected: string) =>
  expect.poll(() => status(id), { timeout: 30_000, intervals: [500] }).toBe(expected);

async function clientSession(email: string) {
  const anon = createClient(local.apiUrl, local.anonKey, { auth: { persistSession: false } });
  const { error } = await anon.auth.verifyOtp({ token_hash: await magicLinkToken(admin, email), type: "magiclink" });
  expect(error).toBeNull();
  return anon;
}

async function staffId(email: string) {
  const { data } = await admin.from("profiles").select("id").eq("email", email).single();
  return data!.id as string;
}

async function switchToClient(page: Page, email: string) {
  await page.context().clearCookies();
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/$/);
}

test("staff shares a document with an approval; the client can approve once it is clean", async ({ page }) => {
  const s = await setup();
  const approvalId = await addRequest(s.jobId, { kind: "approval", title: "Approve your accounts" });
  const staffEmail = `files.staff.${s.tag}@example.com`;

  await signInAsStaffWithMfa(page, staffEmail);
  await page.goto(`/admin/jobs/${s.jobId}`);
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(page.getByLabel("Share with client")).toBeChecked();
  await page.getByLabel("Attach to a request (optional)").selectOption({ label: "Approval: Approve your accounts" });
  await page.getByTestId("document-input").setInputFiles([{ name: "Draft accounts.pdf", mimeType: "application/pdf", buffer: PDF("draft") }]);
  await expect(page.getByTestId("document").filter({ hasText: "Draft accounts.pdf" })).toContainText("Shared with client");

  const { data: row } = await admin.from("files").select("*").eq("job_id", s.jobId).single();
  expect(row!.request_id).toBe(approvalId);
  expect(row!.visibility).toBe("client");
  expect(row!.storage_path).toBe(`${s.clientId}/${s.jobId}/${row!.id}-draft-accounts.pdf`);
  await waitFor(row!.id, "clean");

  // Retention was set when the file was added: 6 years from the upload date (the job has no period end).
  expect(row!.retain_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // The client sees the document and can approve.
  await switchToClient(page, s.ownerEmail);
  await page.goto(`/jobs/${s.jobId}/requests/${approvalId}`);
  await expect(page.getByRole("heading", { name: "Documents to look at" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Draft accounts.pdf" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I approve" })).toBeEnabled();
  await page.getByRole("button", { name: "I approve" }).click();
  await expect(page.getByText("Received — nothing more needed from you")).toBeVisible();
  const { data: req } = await admin.from("requests").select("status").eq("id", approvalId).single();
  expect(req?.status).toBe("submitted");
});

test("a client cannot approve until the attached document is clean", async ({ page }) => {
  const s = await setup();
  const approvalId = await addRequest(s.jobId, { kind: "approval", title: "Approve your accounts" });
  const staffEmail = `files.staff.${s.tag}@example.com`;
  await signInAsStaffWithMfa(page, staffEmail); // creates the staff profile used as the uploader
  const by = await staffId(staffEmail);

  // The row exists but nothing has been stored yet, so it cannot have been checked.
  const doc = await addFile(s, { name: "draft.pdf", by, requestId: approvalId, bytes: null });

  await switchToClient(page, s.ownerEmail);
  await page.goto(`/jobs/${s.jobId}/requests/${approvalId}`);
  await expect(page.getByText("We're just checking the documents for you.")).toBeVisible();
  await expect(page.getByRole("link", { name: "draft.pdf" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "I approve" })).toBeDisabled();

  // Not just the button: the database refuses too.
  const owner = await clientSession(s.ownerEmail);
  const refused = await owner.rpc("submit_request", { p_request_id: approvalId });
  expect(refused.error?.message).toContain("still being checked");

  // The file arrives, is checked, and the page unlocks by itself.
  const { error } = await admin.storage.from("client-files").upload(doc.path, PDF(), { contentType: "application/pdf" });
  expect(error).toBeNull();
  await waitFor(doc.id, "clean");
  await expect(page.getByRole("link", { name: "draft.pdf" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "I approve" })).toBeEnabled();
  await page.getByRole("button", { name: "I approve" }).click();
  await expect(page.getByText("Received — nothing more needed from you")).toBeVisible();
});

test("an internal document is never visible to the client, and sharing it later is audited", async ({ page, browser }) => {
  const s = await setup();
  const staffEmail = `files.staff.${s.tag}@example.com`;

  await signInAsStaffWithMfa(page, staffEmail);
  await page.goto(`/admin/jobs/${s.jobId}`);
  await page.getByRole("button", { name: "Add document" }).click();
  await page.getByLabel("Internal only").check();
  await page.getByTestId("document-input").setInputFiles([{ name: "Working paper.pdf", mimeType: "application/pdf", buffer: PDF("internal") }]);
  const card = page.getByTestId("document").filter({ hasText: "Working paper.pdf" });
  await expect(card).toContainText("Internal only");
  const { data: row } = await admin.from("files").select("*").eq("job_id", s.jobId).single();
  expect(row!.visibility).toBe("internal");
  await waitFor(row!.id, "clean");

  // The client, in their own browser: not in Documents, not downloadable, not readable through the API or storage.
  const clientContext = await browser.newContext({
    baseURL: "http://localhost:3000",
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const clientPage = await clientContext.newPage();
  await signInAs(clientPage, s.ownerEmail);
  await expect(clientPage).toHaveURL(/\/$/);
  await clientPage.goto("/documents");
  await expect(clientPage.getByText("No documents to show yet.")).toBeVisible();
  const download = await clientPage.request.get(`/download/${row!.id}`, { maxRedirects: 0 });
  expect(download.status()).toBe(404);
  const owner = await clientSession(s.ownerEmail);
  const { data: seen } = await owner.from("files").select("id").eq("id", row!.id);
  expect(seen).toEqual([]);
  const stored = await owner.storage.from("client-files").download(row!.storage_path);
  expect(stored.error).not.toBeNull();

  // Staff share it: now the client can see it, and the change is audited with who made it.
  await card.getByRole("button", { name: "Share with client" }).click();
  await expect(card).toContainText("Shared with client");
  const staff = await staffId(staffEmail);
  const { data: audit } = await admin
    .from("audit_log")
    .select("actor_id, meta")
    .eq("entity", "files")
    .eq("entity_id", row!.id)
    .eq("action", "update");
  expect(audit?.some((a) => a.actor_id === staff && (a.meta as { visibility?: string }).visibility === "client")).toBe(true);
  await clientPage.goto("/documents");
  await expect(clientPage.getByRole("link", { name: /Working paper.pdf/ })).toBeVisible();

  // And back to internal: gone again.
  await card.getByRole("button", { name: "Make internal only" }).click();
  await expect(card).toContainText("Internal only");
  const { data: after } = await owner.from("files").select("id").eq("id", row!.id);
  expect(after).toEqual([]);
  await clientPage.goto("/documents");
  await expect(clientPage.getByText("No documents to show yet.")).toBeVisible();
  await clientContext.close();
});

test("an infected or unacceptable file shows the re-upload message; the infected object is deleted", async ({ page }) => {
  const s = await setup();
  const requestId = await addRequest(s.jobId, { kind: "upload", title: "Bank statements" });

  await signInAs(page, s.ownerEmail);
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/jobs/${s.jobId}/requests/${requestId}`);
  await page.getByTestId("file-input").setInputFiles([
    { name: "good.pdf", mimeType: "application/pdf", buffer: PDF("fine") },
    { name: "infected.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n${EICAR}`) },
    // Says it is a PDF but is plain text: the real type does not match the extension.
    { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("just some words, not a PDF") },
  ]);

  const message = "There was a problem with this file — please upload it again";
  await expect(page.getByRole("alert").filter({ hasText: "infected.pdf" })).toContainText(message, { timeout: 30_000 });
  await expect(page.getByRole("alert").filter({ hasText: "fake.pdf" })).toContainText(message);
  await expect(page.getByTestId("received-files")).toContainText("good.pdf");
  await expect(page.getByTestId("received-files")).not.toContainText("infected.pdf");

  const { data: rows } = await admin.from("files").select("id, original_name, scan_status, storage_path").eq("job_id", s.jobId);
  const by = Object.fromEntries((rows ?? []).map((r) => [r.original_name, r]));
  expect(by["good.pdf"].scan_status).toBe("clean");
  expect(by["infected.pdf"].scan_status).toBe("infected");
  expect(by["fake.pdf"].scan_status).toBe("error");

  // The infected object is gone from storage but the row stays, and the status change is audited.
  const { data: stored } = await admin.storage.from("client-files").list(`${s.clientId}/${s.jobId}`);
  expect(stored?.map((o) => o.name).some((n) => n.endsWith("infected.pdf"))).toBe(false);
  const { data: audit } = await admin
    .from("audit_log")
    .select("meta")
    .eq("entity", "files")
    .eq("entity_id", by["infected.pdf"].id)
    .eq("action", "update");
  expect(audit?.some((a) => (a.meta as { scan_status?: string }).scan_status === "infected")).toBe(true);

  // Problem files do not count: only the good one lets them send.
  await expect(page.getByRole("button", { name: "Send to ZenFinanceHub" })).toBeEnabled();
});

test("staff can scan a failed file again", async ({ page }) => {
  const s = await setup();
  const staffEmail = `files.staff.${s.tag}@example.com`;
  await signInAsStaffWithMfa(page, staffEmail);
  const doc = await addFile(s, { name: "stuck.pdf", by: await staffId(staffEmail) });
  await waitFor(doc.id, "clean");
  // Pretend the earlier check failed.
  await admin.from("files").update({ scan_status: "error", scan_retry: false }).eq("id", doc.id);

  await page.goto(`/admin/jobs/${s.jobId}`);
  const card = page.getByTestId("document").filter({ hasText: "stuck.pdf" });
  await expect(card.getByTestId("document-scan")).toHaveText("check failed");
  await card.getByRole("button", { name: "Scan again" }).click();
  await expect(card.getByTestId("document-scan")).toHaveText("clean", { timeout: 20_000 });
  await waitFor(doc.id, "clean");

  // Not just anyone: no sign-in, no scan.
  const anon = await fetch(`${local.apiUrl}/functions/v1/scan-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: doc.id }),
  });
  expect(anon.status).toBe(403);
});

test("zip of all documents, and a lender pack that needs lender consent", async ({ page }) => {
  test.setTimeout(180_000); // includes waiting for the temporary zips to be tidied away (about 90 seconds)
  const s = await setup("finance_application");
  const uploadReq = await addRequest(s.jobId, { kind: "upload", title: "Bank statements" });
  const consentReq = await addRequest(s.jobId, { kind: "consent", title: "Share with lenders", consent_type: "lender_share" });
  const staffEmail = `files.staff.${s.tag}@example.com`;
  await signInAsStaffWithMfa(page, staffEmail);
  const by = await staffId(staffEmail);

  const fromClient = await addFile(s, { name: "bank.pdf", by: s.ownerId, requestId: uploadReq });
  const fromStaff = await addFile(s, { name: "working.pdf", by, visibility: "internal" });
  await waitFor(fromClient.id, "clean");
  await waitFor(fromStaff.id, "clean");

  await page.goto(`/admin/jobs/${s.jobId}`);
  const lender = page.getByRole("button", { name: "Lender pack" });
  await expect(lender).toBeDisabled();
  await expect(page.getByText("The lender pack is available once the client has agreed")).toBeVisible();

  // The function says no too, whatever the button does.
  const token = await accessTokenOf(page);
  const call = (kind: string) =>
    fetch(`${local.apiUrl}/functions/v1/job-zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ job_id: s.jobId, kind }),
    });
  expect((await call("lender_pack")).status).toBe(409);

  // All documents: both files.
  const zipResponse = page.waitForResponse((r) => r.url().includes("/functions/v1/job-zip"));
  const [allDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download all documents (zip)" }).click(),
  ]);
  expect((await zipResponse).status()).toBe(200);
  const all = await (await import("node:fs/promises")).readFile((await allDownload.path())!);
  expect(all.includes(Buffer.from("bank.pdf"))).toBe(true);
  expect(all.includes(Buffer.from("working.pdf"))).toBe(true);
  const { count: zips } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "job_zip_download")
    .eq("entity_id", s.jobId);
  expect(zips).toBe(1);

  // The client gives lender consent; now the pack works, with only what the client sent.
  await admin.from("consents").insert({
    client_id: s.clientId,
    job_id: s.jobId,
    request_id: consentReq,
    profile_id: s.ownerId,
    consent_type: "lender_share",
    wording_version: "test",
    wording_text: "test",
  });
  await page.goto(`/admin/jobs/${s.jobId}`);
  await expect(lender).toBeEnabled();
  const [packDownload] = await Promise.all([page.waitForEvent("download"), lender.click()]);
  const pack = await (await import("node:fs/promises")).readFile((await packDownload.path())!);
  expect(pack.includes(Buffer.from("bank.pdf"))).toBe(true);
  expect(pack.includes(Buffer.from("working.pdf"))).toBe(false);
  const { count: packs } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "lender_pack_download")
    .eq("entity_id", s.jobId);
  expect(packs).toBe(1);

  // The temporary zips are tidied away.
  await expect
    .poll(async () => ((await admin.storage.from("job-zips").list("")).data ?? []).length, { timeout: 120_000, intervals: [3000] })
    .toBe(0);
});

test("accounting-only staff cannot zip a finance job, and lender packs are for finance jobs only", async ({ page }) => {
  const fin = await setup("finance_application");
  const acc = await setup("bookkeeping");
  await signInAsStaffWithMfa(page, `files.acc.${fin.tag}@example.com`, ["accounting"]);
  const token = await accessTokenOf(page);
  const call = (jobId: string, kind: string) =>
    fetch(`${local.apiUrl}/functions/v1/job-zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ job_id: jobId, kind }),
    });
  expect((await call(fin.jobId, "all")).status).toBe(403);
  expect((await call(fin.jobId, "lender_pack")).status).toBe(403);
  expect((await call(acc.jobId, "lender_pack")).status).toBe(400);

  // Nobody signed in as a client can use it either.
  await switchToClient(page, fin.ownerEmail);
  const clientToken = await accessTokenOf(page);
  const asClient = await fetch(`${local.apiUrl}/functions/v1/job-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clientToken}` },
    body: JSON.stringify({ job_id: fin.jobId, kind: "all" }),
  });
  expect(asClient.status).toBe(403);
});

test("retention: the admin reviews files past their date and deletes them one at a time", async ({ page }) => {
  const s = await setup();
  const adminEmail = `files.admin.${s.tag}@example.com`;
  await signInAsStaffWithMfa(page, adminEmail);
  const by = await staffId(adminEmail);
  const old = await addFile(s, { name: "expired.pdf", by: s.ownerId });
  const fresh = await addFile(s, { name: "current.pdf", by: s.ownerId });
  await waitFor(old.id, "clean");
  await waitFor(fresh.id, "clean");
  await admin.from("files").update({ retain_until: "2020-01-31" }).eq("id", old.id);

  await page.goto("/admin/retention");
  const card = page.getByTestId("retention-file").filter({ hasText: "expired.pdf" });
  await expect(card).toContainText("Keep until 31/01/2020");
  await expect(page.getByTestId("retention-file").filter({ hasText: "current.pdf" })).toHaveCount(0);

  // Two steps, so a stray tap does nothing.
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Delete this file for good?")).toBeVisible();
  await page.getByRole("button", { name: "Keep it" }).click();
  expect((await admin.storage.from("client-files").list(`${s.clientId}/${s.jobId}`)).data?.length).toBe(2);

  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page.getByTestId("retention-file").filter({ hasText: "expired.pdf" })).toHaveCount(0);

  // The object is gone; the row stays as a tombstone; the deletion is audited (no file name in it).
  const names = ((await admin.storage.from("client-files").list(`${s.clientId}/${s.jobId}`)).data ?? []).map((o) => o.name);
  expect(names.some((n) => n.endsWith("expired.pdf"))).toBe(false);
  expect(names.some((n) => n.endsWith("current.pdf"))).toBe(true);
  const { data: tomb } = await admin.from("files").select("deleted_at, deleted_by").eq("id", old.id).single();
  expect(tomb?.deleted_at).not.toBeNull();
  expect(tomb?.deleted_by).toBe(by);
  const { data: audit } = await admin.from("audit_log").select("actor_id, meta").eq("action", "file_deleted_retention").eq("entity_id", old.id);
  expect(audit).toHaveLength(1);
  expect(audit![0].actor_id).toBe(by);
  expect(JSON.stringify(audit![0].meta)).not.toContain("expired");

  // Not past its date: refused, nothing removed.
  const token = await accessTokenOf(page);
  const refused = await fetch(`${local.apiUrl}/functions/v1/retention-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ file_id: fresh.id }),
  });
  expect(refused.status).toBe(409);
  expect(await status(fresh.id)).toBe("clean");

  // Ordinary staff cannot see the page or use the function.
  await page.context().clearCookies();
  await signInAsStaffWithMfa(page, `files.staff.${s.tag}@example.com`, ["accounting"]);
  await page.goto("/admin/retention");
  await expect(page.getByText("Only the admin can review retention.")).toBeVisible();
  const staffToken = await accessTokenOf(page);
  const denied = await fetch(`${local.apiUrl}/functions/v1/retention-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({ file_id: old.id }),
  });
  expect(denied.status).toBe(403);
});

test("the scan webhook refuses calls without the shared secret", async () => {
  const url = `${local.apiUrl}/functions/v1/scan-file`;
  const call = (headers: Record<string, string>) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ type: "SWEEP" }) });

  const none = await call({});
  expect(none.status).toBe(401);
  expect(await none.json()).toEqual({ error: "Not allowed." });
  expect((await call({ "x-webhook-secret": "not-the-secret" })).status).toBe(401);
  expect((await call({ "x-webhook-secret": "" })).status).toBe(401);

  // An INSERT-style call (as the storage trigger makes) is refused the same way.
  const insert = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "INSERT", record: { bucket_id: "client-files", name: "x/y/z.pdf" } }),
  });
  expect(insert.status).toBe(401);

  // The right secret (the throwaway local one) is let through.
  expect((await call({ "x-webhook-secret": LOCAL_SCAN_WEBHOOK_SECRET })).status).toBe(200);
});
