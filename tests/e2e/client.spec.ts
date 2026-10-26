import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  adminClient,
  ensureClientOwner,
  ensureUser,
  getLocal,
  magicLinkToken,
} from "../../scripts/local-supabase.mjs";
import { formatAnswer } from "../../lib/answers";
import { addDays, todayLondon } from "../../lib/dates";
import { signInAs, signInAsStaffWithMfa } from "./helpers";

// Everything here runs on a 375px-wide phone.
test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

const admin = adminClient();
const local = getLocal();
const run = Date.now();
let counter = 0;
const uid = () => `${run}-${++counter}`;

async function setup(opts: { requests?: Record<string, unknown>[]; jobTitle?: string } = {}) {
  const tag = uid();
  const ownerEmail = `owner.${tag}@example.com`;
  const ownerId = await ensureUser(admin, { email: ownerEmail });
  const clientId = await ensureClientOwner(admin, ownerId, `E2E Client ${tag} Ltd`);
  const { data: job } = await admin
    .from("jobs")
    .insert({ client_id: clientId, title: opts.jobTitle ?? `Year-end ${tag}`, service: "year_end" })
    .select("id")
    .single();
  const requests: { id: string }[] = [];
  for (const [i, r] of (opts.requests ?? []).entries()) {
    const { data } = await admin
      .from("requests")
      .insert({ job_id: job!.id, sort_order: i, ...r })
      .select("id")
      .single();
    requests.push(data!);
  }
  return { tag, ownerEmail, ownerId, clientId, jobId: job!.id as string, requests };
}

async function addContributor(clientId: string, jobId: string, tag: string) {
  const email = `contributor.${tag}@example.com`;
  const id = await ensureUser(admin, { email });
  await admin.from("client_contacts").upsert({ client_id: clientId, profile_id: id, role: "contributor" });
  await admin.from("job_contacts").upsert({ job_id: jobId, profile_id: id });
  return { email, id };
}

async function clientSession(email: string) {
  const anon = createClient(local.apiUrl, local.anonKey, { auth: { persistSession: false } });
  const { error } = await anon.auth.verifyOtp({ token_hash: await magicLinkToken(admin, email), type: "magiclink" });
  expect(error).toBeNull();
  return anon;
}

async function noSideways(page: Page) {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
}

const future = (days: number) => addDays(todayLondon(), days);

test("client uploads files and sends them; rejected files get friendly messages", async ({ page }) => {
  const s = await setup({
    requests: [{ kind: "upload", title: "Bank statements", help_text: "Every month, please.", due_date: future(10) }],
  });

  await signInAs(page, s.ownerEmail);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Things to do" })).toBeVisible();
  const card = page.getByTestId("todo");
  await expect(card).toContainText("Bank statements");
  await expect(card).toContainText("Every month, please.");
  await expect(card).toContainText(`Due ${future(10).split("-").reverse().join("/")}`);
  await noSideways(page);

  await card.getByRole("link", { name: "Upload files" }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: "Send to ZenFinanceHub" })).toBeDisabled();
  await noSideways(page);

  await page.getByTestId("file-input").setInputFiles([
    { name: "Statement March.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") },
    { name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(26 * 1024 * 1024) },
    { name: "virus.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") },
  ]);
  await expect(page.getByText("huge.pdf is larger than 25 MB")).toBeVisible();
  await expect(page.getByText("virus.exe isn't a type we can accept")).toBeVisible();
  await expect(page.getByTestId("received-files")).toContainText("Statement March.pdf");
  await expect(page.getByTestId("received-files")).toContainText("Received — being checked");
  await noSideways(page);

  await page.getByRole("button", { name: "Send to ZenFinanceHub" }).click();
  await expect(page.getByText("Received — nothing more needed from you")).toBeVisible();

  // Stored the way CLAUDE.md says: row first (pending), then the object at {client}/{job}/{file}-{name}.
  const { data: files } = await admin.from("files").select("*").eq("request_id", s.requests[0].id);
  expect(files).toHaveLength(1);
  expect(files![0].scan_status).toBe("pending");
  expect(files![0].storage_path).toBe(`${s.clientId}/${s.jobId}/${files![0].id}-statement-march.pdf`);
  expect(files![0].original_name).toBe("Statement March.pdf");
  const { data: stored } = await admin.storage.from("client-files").list(`${s.clientId}/${s.jobId}`);
  expect(stored?.map((o) => o.name)).toEqual([`${files![0].id}-statement-march.pdf`]);
  const { data: request } = await admin.from("requests").select("status").eq("id", s.requests[0].id).single();
  expect(request?.status).toBe("submitted");

  // It has left Things to do.
  await page.goto("/");
  await expect(page.getByText("You're all up to date — nothing needed from you right now.")).toBeVisible();
});

test("client answers questions: £ amount with autosave, and yes / no", async ({ page }) => {
  const s = await setup({
    requests: [
      { kind: "question", title: "Value of stock at year end", question_type: "amount", due_date: future(5) },
      { kind: "question", title: "Did you pay dividends?", question_type: "yes_no", due_date: future(6) },
    ],
  });
  const [amountReq, yesNoReq] = s.requests;
  await signInAs(page, s.ownerEmail);

  await page.goto(`/jobs/${s.jobId}/requests/${amountReq.id}`);
  await page.getByLabel("Your answer").fill("abc");
  await page.getByRole("button", { name: "Send to ZenFinanceHub" }).click();
  await expect(page.getByText("Please enter an amount in pounds")).toBeVisible();

  await page.getByLabel("Your answer").fill("1234.5");
  await page.getByLabel("Your answer").blur();
  await expect(page.getByLabel("Your answer")).toHaveValue("£1,234.50");

  // Autosave: leave and come back, it's still there.
  await page.goto("/");
  await page.goto(`/jobs/${s.jobId}/requests/${amountReq.id}`);
  await expect(page.getByLabel("Your answer")).toHaveValue("£1,234.50");

  await page.getByRole("button", { name: "Send to ZenFinanceHub" }).click();
  await expect(page.getByText("Received — nothing more needed from you")).toBeVisible();
  const { data: draft } = await page.evaluate((id) => ({ data: window.localStorage.getItem(`zfh-draft:${id}`) }), amountReq.id);
  expect(draft).toBeNull(); // draft cleared on submit

  const { data: answer } = await admin.from("responses").select("answer").eq("request_id", amountReq.id).single();
  expect(answer?.answer).toEqual({ value: 1234.5 });
  expect(formatAnswer(answer!.answer, "amount")).toBe("£1,234.50"); // what the admin page shows

  await page.goto(`/jobs/${s.jobId}/requests/${yesNoReq.id}`);
  await page.getByText("Yes", { exact: true }).click();
  await page.getByRole("button", { name: "Send to ZenFinanceHub" }).click();
  await expect(page.getByText("Received — nothing more needed from you")).toBeVisible();
  const { data: yn } = await admin.from("responses").select("answer").eq("request_id", yesNoReq.id).single();
  expect(yn?.answer).toEqual({ value: true });
  expect(formatAnswer(yn!.answer, "yes_no")).toBe("Yes");

  await page.goto("/");
  await expect(page.getByText("You're all up to date")).toBeVisible();
  await noSideways(page);
});

test("a contributor cannot approve; the owner can", async ({ page }) => {
  const s = await setup({
    requests: [{ kind: "approval", title: "Approve your accounts", help_text: "Please check the figures." }],
  });
  const contributor = await addContributor(s.clientId, s.jobId, s.tag);
  const approvalId = s.requests[0].id;

  await signInAs(page, contributor.email);
  await expect(page.getByText("You're all up to date")).toBeVisible(); // not something they can do
  await page.goto(`/jobs/${s.jobId}/requests/${approvalId}`);
  await expect(page.getByText("Your account owner needs to approve this.")).toBeVisible();
  await expect(page.getByRole("button", { name: "I approve" })).toHaveCount(0);
  await noSideways(page);

  // The database refuses too, not just the screen.
  const asContributor = await clientSession(contributor.email);
  const refused = await asContributor.rpc("submit_request", { p_request_id: approvalId });
  expect(refused.error).not.toBeNull();
  const { data: still } = await admin.from("requests").select("status").eq("id", approvalId).single();
  expect(still?.status).toBe("open");

  await page.context().clearCookies();
  await signInAs(page, s.ownerEmail);
  await page.goto(`/jobs/${s.jobId}/requests/${approvalId}`);
  await page.getByRole("button", { name: "I approve" }).click();
  await expect(page.getByText("Received — nothing more needed from you")).toBeVisible();
});

test("a client cannot open another client's job by changing the address", async ({ page }) => {
  const a = await setup();
  const b = await setup({ requests: [{ kind: "upload", title: "Their private request" }] });
  const { data: bFile } = await admin
    .from("files")
    .insert({
      client_id: b.clientId,
      job_id: b.jobId,
      storage_path: `${b.clientId}/${b.jobId}/x-secret.pdf`,
      original_name: "secret.pdf",
      uploaded_by: b.ownerId,
      scan_status: "clean",
    })
    .select("id")
    .single();

  await signInAs(page, a.ownerEmail);
  for (const path of [
    `/jobs/${b.jobId}`,
    `/jobs/${b.jobId}/requests/${b.requests[0].id}`,
    `/jobs/${a.jobId}/requests/${b.requests[0].id}`, // right job, wrong request
    `/download/${bFile!.id}`,
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByText("Their private request")).toHaveCount(0);
  }
  await page.goto(`/jobs/${a.jobId}`);
  await expect(page.getByRole("heading", { name: `Year-end ${a.tag}` })).toBeVisible();
});

test("downloading a file writes an audit row; only clean files are served to clients", async ({ page }) => {
  const s = await setup();
  const mk = async (name: string, scan: string) => {
    const id = crypto.randomUUID();
    const path = `${s.clientId}/${s.jobId}/${id}-${name}`;
    await admin.from("files").insert({ id, client_id: s.clientId, job_id: s.jobId, storage_path: path, original_name: name, uploaded_by: s.ownerId, scan_status: scan });
    await admin.storage.from("client-files").upload(path, Buffer.from(`contents of ${name}`), { contentType: "application/pdf" });
    return id;
  };
  const clean = await mk("clean.pdf", "clean");
  const pending = await mk("pending.pdf", "pending");
  const infected = await mk("infected.pdf", "infected");

  await signInAs(page, s.ownerEmail);
  await page.goto("/documents");
  await expect(page.getByText("clean.pdf")).toBeVisible();
  await expect(page.getByText("pending.pdf")).toHaveCount(0);
  await expect(page.getByText("infected.pdf")).toHaveCount(0);
  await noSideways(page);

  const ok = await page.request.get(`/download/${clean}`, { maxRedirects: 0 });
  expect(ok.status()).toBe(302);
  const location = ok.headers()["location"];
  expect(location).toContain("/storage/v1/object/sign/client-files/");
  expect(location).toContain("token=");
  const body = await fetch(location);
  expect(body.status).toBe(200);
  expect(await body.text()).toBe("contents of clean.pdf");

  const { data: audit } = await admin
    .from("audit_log")
    .select("actor_id, client_id, entity, entity_id")
    .eq("action", "file_download")
    .eq("entity_id", clean);
  expect(audit).toEqual([{ actor_id: s.ownerId, client_id: s.clientId, entity: "files", entity_id: clean }]);

  for (const id of [pending, infected]) {
    expect((await page.request.get(`/download/${id}`, { maxRedirects: 0 })).status()).toBe(404);
  }
  const { count } = await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "file_download").in("entity_id", [pending, infected]);
  expect(count).toBe(0);
});

test("staff can download pending files but never infected ones", async ({ page }) => {
  test.setTimeout(120_000);
  const s = await setup();
  const mk = async (name: string, scan: string) => {
    const id = crypto.randomUUID();
    const path = `${s.clientId}/${s.jobId}/${id}-${name}`;
    await admin.from("files").insert({ id, client_id: s.clientId, job_id: s.jobId, storage_path: path, original_name: name, uploaded_by: s.ownerId, scan_status: scan });
    await admin.storage.from("client-files").upload(path, Buffer.from("x"), { contentType: "application/pdf" });
    return id;
  };
  const pending = await mk("pending.pdf", "pending");
  const infected = await mk("infected.pdf", "infected");

  const staffEmail = `e2e.staff.dl.${run}@example.com`;
  await signInAsStaffWithMfa(page, staffEmail);
  expect((await page.request.get(`/download/${pending}`, { maxRedirects: 0 })).status()).toBe(302);
  expect((await page.request.get(`/download/${infected}`, { maxRedirects: 0 })).status()).toBe(404);

  const { data: staff } = await admin.from("profiles").select("id").eq("email", staffEmail).single();
  const { data: audit } = await admin.from("audit_log").select("actor_id").eq("action", "file_download").eq("entity_id", pending);
  expect(audit).toEqual([{ actor_id: staff!.id }]);
});

test("an owner gives a consent with the server's wording; a returned request shows why", async ({ page }) => {
  const s = await setup({
    requests: [
      { kind: "consent", title: "Share with lenders", consent_type: "lender_share" },
      { kind: "upload", title: "Payslips", status: "returned", return_reason: "The March payslip is missing" },
    ],
  });
  const contributor = await addContributor(s.clientId, s.jobId, s.tag);
  const consentId = s.requests[0].id;

  // Contributors can read but not agree.
  await signInAs(page, contributor.email);
  await page.goto(`/jobs/${s.jobId}/requests/${consentId}`);
  await expect(page.getByText("Your account owner needs to agree to this.")).toBeVisible();
  await expect(page.getByRole("button", { name: "I agree" })).toHaveCount(0);

  await page.context().clearCookies();
  await signInAs(page, s.ownerEmail);

  // A returned request leads with the reason, kindly.
  const returned = page.getByTestId("todo").filter({ hasText: "Payslips" });
  await expect(returned).toContainText("We need a little more from you");
  await expect(returned).toContainText("The March payslip is missing");
  await expect(returned.getByRole("link", { name: "Update and resend" })).toBeVisible();
  await noSideways(page);

  await page.getByTestId("todo").filter({ hasText: "Share with lenders" }).getByRole("link", { name: "Read and agree" }).click();
  await expect(page.getByRole("button", { name: "I agree" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "I agree" }).click();
  await expect(page.getByText("Received — nothing more needed from you")).toBeVisible();

  const { data: consent } = await admin.from("consents").select("*").eq("request_id", consentId).single();
  expect(consent?.consent_type).toBe("lender_share");
  expect(consent?.wording_version).toMatch(/^lender_share-DRAFT-/);
  expect(consent?.wording_text).toContain("Sharing your information with lenders");
  expect(consent?.profile_id).toBe(s.ownerId);
  expect(consent?.ip).toBeTruthy();
  expect(consent?.user_agent).toBeTruthy();
  const { data: req } = await admin.from("requests").select("status").eq("id", consentId).single();
  expect(req?.status).toBe("submitted");
});

test("messages: clients see only non-internal messages and can reply", async ({ page }) => {
  const s = await setup();
  const { data: staff } = await admin.from("profiles").select("id").eq("is_staff", true).limit(1).maybeSingle();
  const staffId = staff?.id ?? (await ensureUser(admin, { email: `staff.msg.${run}@example.com`, staff: true }));
  await admin.from("messages").insert([
    { job_id: s.jobId, author_id: staffId, body: "Hello from the team", internal: false },
    { job_id: s.jobId, author_id: staffId, body: "Internal: chase them", internal: true },
  ]);

  const reply = `Thanks, sending it today (${s.tag})`;
  await signInAs(page, s.ownerEmail);
  await page.goto("/messages");
  await expect(page.getByText("Hello from the team")).toBeVisible();
  await expect(page.getByText("Internal: chase them")).toHaveCount(0);
  await expect(page.getByTestId("message").first()).toContainText("ZenFinanceHub");

  await page.getByLabel("Write a message").fill(reply);
  await page.getByRole("button", { name: "Send message" }).click();
  // (match the posted message, not the text box, which also contains the typed words)
  await expect(page.getByTestId("message").filter({ hasText: reply })).toBeVisible();
  const { data: sent } = await admin.from("messages").select("internal, author_id").eq("job_id", s.jobId).eq("body", reply).single();
  expect(sent).toEqual({ internal: false, author_id: s.ownerId });

  // Same thread on the job page, with the plain-English stage.
  await page.goto(`/jobs/${s.jobId}`);
  await expect(page.getByTestId("stage")).toHaveText("Waiting on you");
  await expect(page.getByText("Internal: chase them")).toHaveCount(0);
  await noSideways(page);
});
