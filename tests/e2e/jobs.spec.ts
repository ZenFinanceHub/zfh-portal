import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  adminClient,
  ensureClientOwner,
  ensureUser,
  getLocal,
  magicLinkToken,
} from "../../scripts/local-supabase.mjs";
import { addDays, todayLondon } from "../../lib/dates";
import { formatDate } from "../../lib/labels";
import { signInAsStaffWithMfa } from "./helpers";

const admin = adminClient();
const local = getLocal();
const run = Date.now();

// A supabase-js client signed in as the given (non-staff) user, like their browser would be.
async function clientSession(email: string) {
  const anon = createClient(local.apiUrl, local.anonKey, { auth: { persistSession: false } });
  const { error } = await anon.auth.verifyOtp({ token_hash: await magicLinkToken(admin, email), type: "magiclink" });
  expect(error).toBeNull();
  return anon;
}

async function makeClient(name: string, ownerEmail: string) {
  const ownerId = await ensureUser(admin, { email: ownerEmail });
  const clientId = await ensureClientOwner(admin, ownerId, name);
  return { clientId, ownerId };
}

test("staff creates a job from a template, adds a held-back request, and sees it on the dashboard", async ({ page }) => {
  test.setTimeout(120_000);
  const name = `E2E Jobs Ltd ${run}`;
  const { clientId } = await makeClient(name, `jobs.owner.${run}@example.com`);
  await admin.from("clients").update({ year_end: "2026-03-31" }).eq("id", clientId);
  const contributorEmail = `jobs.contributor.${run}@example.com`;
  const contributorId = await ensureUser(admin, { email: contributorEmail });
  await admin.from("client_contacts").upsert({ client_id: clientId, profile_id: contributorId, role: "contributor" });

  const staffEmail = `e2e.staff.jobs.${run}@example.com`;
  await signInAsStaffWithMfa(page, staffEmail);

  // New job from the seeded year-end template.
  await page.goto(`/admin/clients/${clientId}`);
  await page.getByRole("link", { name: "New job" }).click();
  await page.getByLabel("Template").selectOption({ label: "Limited company year-end" });
  await expect(page.getByLabel("Title")).toHaveValue(/^Year-end accounts/);
  await page.getByLabel("Period end").fill("2026-03-31");
  await expect(page.getByLabel("Title")).toHaveValue("Year-end accounts 31/03/2026");
  await page.getByLabel("Assigned to").selectOption({ label: staffEmail });
  await page.getByLabel(contributorEmail).check();
  await page.getByRole("button", { name: "Create job" }).click();

  await expect(page).toHaveURL(/\/admin\/jobs\/[0-9a-f-]{36}$/);
  const jobId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { name: "Year-end accounts 31/03/2026" })).toBeVisible();

  // Eight dated requests, due today + 21 days (or 21 for the first seven) — the approval is held back.
  await expect(page.getByTestId("request")).toHaveCount(8);
  await expect(page.getByTestId("request").first()).toContainText(`Due ${formatDate(addDays(todayLondon(), 21))}`);
  await expect(page.getByRole("heading", { name: "Add later" })).toBeVisible();
  await expect(page.getByText("Approve your accounts and corporation tax return")).toBeVisible();

  const { data: contacts } = await admin.from("job_contacts").select("profile_id").eq("job_id", jobId);
  expect(contacts?.map((c) => c.profile_id)).toEqual([contributorId]);

  // One click adds the held-back approval.
  await page.getByRole("button", { name: "Add now" }).click();
  await expect(page.getByTestId("request")).toHaveCount(9);
  await expect(page.getByRole("heading", { name: "Add later" })).toHaveCount(0);

  // Stage selector (what the client sees) and audit trail.
  await page.getByLabel("Stage").selectOption({ label: "In progress" });
  await page.getByRole("button", { name: "Update stage" }).click();
  await expect.poll(async () => (await admin.from("jobs").select("stage").eq("id", jobId).single()).data?.stage).toBe("in_progress");
  const { data: audit } = await admin
    .from("audit_log")
    .select("entity, action, meta")
    .eq("entity_id", jobId)
    .eq("entity", "jobs");
  expect(audit?.some((a) => a.action === "insert")).toBe(true);
  expect(audit?.some((a) => a.action === "update" && (a.meta as { stage?: string }).stage === "in_progress")).toBe(true);

  // Internal note.
  await page.getByLabel("Add an internal note").fill("Chase for the loan agreement");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Chase for the loan agreement")).toBeVisible();

  // A submitted request shows up on the dashboard and links to the job.
  const { data: firstRequest } = await admin.from("requests").select("id").eq("job_id", jobId).order("sort_order").limit(1).single();
  await admin.from("requests").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", firstRequest!.id);
  await page.goto("/admin");
  const submitted = page.getByRole("region", { name: /Newly submitted/ });
  await expect(submitted.getByText(name).first()).toBeVisible();
  await submitted.getByText(name).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/jobs/${jobId}$`));

  // Overdue: back-date another request.
  const { data: second } = await admin.from("requests").select("id").eq("job_id", jobId).order("sort_order").range(1, 1).single();
  await admin.from("requests").update({ due_date: addDays(todayLondon(), -2) }).eq("id", second!.id);
  await page.goto("/admin");
  await expect(page.getByRole("region", { name: /Overdue/ }).getByText(name).first()).toBeVisible();
});

test("staff can edit a template: reorder, add, validate and save", async ({ page }) => {
  test.setTimeout(120_000);
  const { data: tpl } = await admin
    .from("templates")
    .insert({
      name: `E2E template ${run}`,
      service: "other",
      requests: [
        { kind: "upload", title: "First", due_offset_days: 3 },
        { kind: "approval", title: "Second" },
      ],
    })
    .select("id")
    .single();

  await signInAsStaffWithMfa(page, `e2e.staff.templates.${run}@example.com`);

  // The eight seeded templates are listed.
  await page.goto("/admin/templates");
  await expect(page.getByRole("link", { name: /Limited company year-end/ })).toBeVisible();
  expect(await page.getByRole("listitem").filter({ hasText: /requests/ }).count()).toBeGreaterThanOrEqual(8);

  await page.getByRole("link", { name: new RegExp(`E2E template ${run}`) }).click();
  await page.getByLabel("Description").fill("Edited by the e2e test");
  await page.getByRole("button", { name: "Move request 1 down" }).click();
  await page.getByRole("button", { name: "Add a request" }).click();

  const third = page.getByRole("listitem").filter({ hasText: "Request 3" });
  await third.getByLabel("Title (what the client sees)").fill("Third");
  await third.getByLabel("Kind").selectOption("question");
  await third.getByLabel("Question type").selectOption("choice");
  await third.getByLabel("Choices").fill("Only one");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Request 3: Add at least two choices")).toBeVisible();

  await third.getByLabel("Choices").fill("Yes please\nNo thanks");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page).toHaveURL(/\/admin\/templates$/);

  const { data: saved } = await admin.from("templates").select("description, requests").eq("id", tpl!.id).single();
  expect(saved?.description).toBe("Edited by the e2e test");
  expect(saved?.requests).toEqual([
    { kind: "approval", title: "Second" },
    { kind: "upload", title: "First", due_offset_days: 3 },
    { kind: "question", title: "Third", question_type: "choice", options: ["Yes please", "No thanks"] },
  ]);
});

test("a client cannot create jobs or requests", async () => {
  const email = `jobs.client.${run}@example.com`;
  const { clientId } = await makeClient(`E2E Refusal Ltd ${run}`, email);
  const { data: job } = await admin
    .from("jobs")
    .insert({ client_id: clientId, title: "Existing job", service: "other" })
    .select("id")
    .single();
  const { data: tpl } = await admin.from("templates").select("id").limit(1).single();

  const client = await clientSession(email);

  const viaRpc = await client.rpc("create_job_from_template", {
    p_client_id: clientId,
    p_template_id: tpl!.id,
    p_title: "Client-made job",
    p_service: "other",
    p_period_end: null as unknown as string,
    p_due_date: null as unknown as string,
    p_assigned_to: null as unknown as string,
    p_contributors: [],
  });
  expect(viaRpc.error).not.toBeNull();

  const viaJobs = await client.from("jobs").insert({ client_id: clientId, title: "Direct job", service: "other" });
  expect(viaJobs.error).not.toBeNull();

  const viaRequests = await client.from("requests").insert({ job_id: job!.id, kind: "upload", title: "Direct request" });
  expect(viaRequests.error).not.toBeNull();

  const pending = await client.rpc("add_pending_request", { p_job_id: job!.id, p_index: 0 });
  expect(pending.error).not.toBeNull();

  const { count } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  expect(count).toBe(1);
});

test("returning a request reopens it for the client, who can submit it again", async ({ page }) => {
  test.setTimeout(120_000);
  const email = `return.client.${run}@example.com`;
  const { clientId } = await makeClient(`E2E Return Ltd ${run}`, email);
  const { data: job } = await admin
    .from("jobs")
    .insert({ client_id: clientId, title: `Return job ${run}`, service: "other" })
    .select("id")
    .single();
  const { data: req } = await admin
    .from("requests")
    .insert({ job_id: job!.id, kind: "approval", title: "Approve the figures", status: "submitted", submitted_at: new Date().toISOString() })
    .select("id")
    .single();

  const staffEmail = `e2e.staff.return.${run}@example.com`;
  await signInAsStaffWithMfa(page, staffEmail);
  await page.goto(`/admin/jobs/${job!.id}`);
  const card = page.getByTestId("request");
  await expect(card.getByTestId("request-status")).toHaveText("Submitted — needs review");

  // A reason is required.
  await card.getByText("Return with reason").click();
  await card.getByRole("button", { name: "Return to client" }).click();
  await expect(card.getByText("Say what needs changing")).toBeVisible();

  await card.getByLabel("What does the client need to change?").fill("The VAT figure looks wrong");
  await card.getByRole("button", { name: "Return to client" }).click();
  await expect(card.getByTestId("request-status")).toHaveText("Returned to client");
  await expect(card.getByText("Reason given: The VAT figure looks wrong")).toBeVisible();

  // The client sees it reopened, with the reason, and can submit again.
  const client = await clientSession(email);
  const seen = await client.from("requests").select("status, return_reason").eq("id", req!.id).single();
  expect(seen.data).toEqual({ status: "returned", return_reason: "The VAT figure looks wrong" });
  const resubmit = await client.rpc("submit_request", { p_request_id: req!.id });
  expect(resubmit.error).toBeNull();
  const after = await client.from("requests").select("status, return_reason").eq("id", req!.id).single();
  expect(after.data).toEqual({ status: "submitted", return_reason: null });

  // Staff accept it.
  await page.reload();
  await expect(card.getByTestId("request-status")).toHaveText("Submitted — needs review");
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(card.getByTestId("request-status")).toHaveText("Accepted");

  // Both staff decisions are in the audit log, attributed to the staff member.
  const { data: staff } = await admin.from("profiles").select("id").eq("email", staffEmail).single();
  const { data: audit } = await admin
    .from("audit_log")
    .select("action, meta, actor_id")
    .eq("entity", "requests")
    .eq("entity_id", req!.id)
    .eq("actor_id", staff!.id);
  const statuses = (audit ?? []).map((a) => (a.meta as { status?: string }).status);
  expect(statuses).toEqual(expect.arrayContaining(["returned", "accepted"]));
});
