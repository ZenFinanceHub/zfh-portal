import { expect, test, type Page } from "@playwright/test";
import { adminClient, ensureClientOwner, ensureUser, magicLinkToken } from "../../scripts/local-supabase.mjs";
import { addDays, todayLondon } from "../../lib/dates";
import { accessTokenOf, signInAs, signInAsStaffWithMfa, totp } from "./helpers";
import { getLocal } from "../../scripts/local-supabase.mjs";

const admin = adminClient();
const run = Date.now();
let counter = 0;
const uid = () => `${run}-${++counter}`;

async function mixedClient() {
  const tag = uid();
  const ownerEmail = `areas.owner.${tag}@example.com`;
  const ownerId = await ensureUser(admin, { email: ownerEmail });
  const clientId = await ensureClientOwner(admin, ownerId, `Areas Client ${tag} Ltd`);
  const job = async (title: string, service: string) =>
    (await admin.from("jobs").insert({ client_id: clientId, title, service }).select("id").single()).data!.id as string;
  const accJob = await job(`Bookkeeping ${tag}`, "bookkeeping");
  const finJob = await job(`Loan application ${tag}`, "finance_application");
  const request = async (jobId: string, title: string, extra: Record<string, unknown> = {}) =>
    (
      await admin
        .from("requests")
        .insert({ job_id: jobId, kind: "upload", title, due_date: addDays(todayLondon(), 3), ...extra })
        .select("id")
        .single()
    ).data!.id as string;
  const accReq = await request(accJob, `Accounting request ${tag}`);
  const finReq = await request(finJob, `Finance request ${tag}`);
  return { tag, ownerEmail, ownerId, clientId, accJob, finJob, accReq, finReq };
}

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe("client tab bar at 375px", () => {
  test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

  test("a client with both areas gets tabs that filter, and the last tab is remembered", async ({ page }) => {
    const s = await mixedClient();
    await signInAs(page, s.ownerEmail);

    const tabs = page.getByRole("navigation", { name: "Areas" });
    await expect(tabs.getByRole("link")).toHaveText(["Accounting", "Business Finance"]);
    await expect(tabs.getByRole("link", { name: "Accounting" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(`Accounting request ${s.tag}`)).toBeVisible();
    await expect(page.getByText(`Finance request ${s.tag}`)).toHaveCount(0);
    await noSideways(page);

    await tabs.getByRole("link", { name: "Business Finance" }).click();
    await expect(page).toHaveURL(/area=finance/);
    await expect(page.getByText(`Finance request ${s.tag}`)).toBeVisible();
    await expect(page.getByText(`Accounting request ${s.tag}`)).toHaveCount(0);

    // Come back later (no ?area= in the address): the last tab is restored on this device.
    await page.goto("/");
    await expect(page).toHaveURL(/area=finance/);
    await expect(page.getByText(`Finance request ${s.tag}`)).toBeVisible();

    // Same tab bar on Documents and Messages, and the chosen tab carries over.
    for (const path of ["/documents", "/messages"]) {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Areas" }).getByRole("link", { name: "Business Finance" })).toHaveAttribute("aria-current", "page");
    }
    await page.getByRole("navigation", { name: "Areas" }).getByRole("link", { name: "Accounting" }).click();
    await expect(page.getByRole("heading", { name: `Bookkeeping ${s.tag}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Loan application ${s.tag}` })).toHaveCount(0);

    // Job pages say which area they belong to.
    await page.goto(`/jobs/${s.finJob}`);
    await expect(page.getByTestId("area-label")).toHaveText("Business Finance");
    await page.goto(`/jobs/${s.accJob}`);
    await expect(page.getByTestId("area-label")).toHaveText("Accounting");
    await noSideways(page);
  });

  test("a client with one area sees no tab bar", async ({ page }) => {
    const tag = uid();
    const ownerEmail = `single.owner.${tag}@example.com`;
    const ownerId = await ensureUser(admin, { email: ownerEmail });
    const clientId = await ensureClientOwner(admin, ownerId, `Single Area ${tag} Ltd`);
    const { data: job } = await admin
      .from("jobs")
      .insert({ client_id: clientId, title: `Referral ${tag}`, service: "regulated_referral" })
      .select("id")
      .single();
    await admin.from("requests").insert({ job_id: job!.id, kind: "upload", title: `Only request ${tag}` });

    await signInAs(page, ownerEmail);
    await expect(page.getByText(`Only request ${tag}`)).toBeVisible(); // finance-only client still sees their work
    for (const path of ["/", "/documents", "/messages"]) {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Areas" })).toHaveCount(0);
    }
    await page.goto(`/jobs/${job!.id}`);
    await expect(page.getByTestId("area-label")).toHaveText("Business Finance");
  });
});

test("accounting-only staff are blocked from a finance job, by address and everywhere else", async ({ page }) => {
  test.setTimeout(120_000);
  const s = await mixedClient();
  // A submitted request and a clean file on each job.
  await admin.from("requests").update({ status: "submitted", submitted_at: new Date().toISOString() }).in("id", [s.accReq, s.finReq]);
  const file = async (jobId: string, name: string) => {
    const id = crypto.randomUUID();
    const path = `${s.clientId}/${jobId}/${id}-${name}`;
    await admin.from("files").insert({ id, client_id: s.clientId, job_id: jobId, storage_path: path, original_name: name, uploaded_by: s.ownerId, scan_status: "clean" });
    await admin.storage.from("client-files").upload(path, Buffer.from(name), { contentType: "application/pdf" });
    return id;
  };
  const accFile = await file(s.accJob, "acc.pdf");
  const finFile = await file(s.finJob, "fin.pdf");

  await signInAsStaffWithMfa(page, `e2e.staff.acc.${run}@example.com`, ["accounting"]);

  // Their own area works…
  expect((await page.goto(`/admin/jobs/${s.accJob}`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: `Bookkeeping ${s.tag}` })).toBeVisible();
  expect((await page.request.get(`/download/${accFile}`, { maxRedirects: 0 })).status()).toBe(302);

  // …the other area does not exist for them, even with the exact address.
  expect((await page.goto(`/admin/jobs/${s.finJob}`))?.status()).toBe(404);
  await expect(page.getByText(`Loan application ${s.tag}`)).toHaveCount(0);
  expect((await page.request.get(`/download/${finFile}`, { maxRedirects: 0 })).status()).toBe(404);

  // The client page lists only the accounting job; the dashboard only accounting work.
  await page.goto(`/admin/clients/${s.clientId}`);
  await expect(page.getByRole("link", { name: new RegExp(`Bookkeeping ${s.tag}`) })).toBeVisible();
  await expect(page.getByText(`Loan application ${s.tag}`)).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByRole("navigation", { name: "Area filter" })).toHaveCount(0); // one area: nothing to filter
  await expect(page.getByText(`Accounting request ${s.tag}`)).toBeVisible();
  await expect(page.getByText(`Finance request ${s.tag}`)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Finance pipeline" })).toHaveCount(0);

  // New jobs: no finance templates or services on offer.
  await page.goto(`/admin/clients/${s.clientId}/jobs/new`);
  await expect(page.getByLabel("Template").locator("option", { hasText: /finance|referral/i })).toHaveCount(0);
  await expect(page.getByLabel("Service").locator("option", { hasText: /Finance application|Regulated referral/ })).toHaveCount(0);

  // The invite function respects areas too: no attaching contacts to a client they cannot see.
  const finOnlyOwner = await ensureUser(admin, { email: `finonly.owner.${s.tag}@example.com` });
  const finOnlyClient = await ensureClientOwner(admin, finOnlyOwner, `Finance Only ${s.tag} Ltd`);
  await admin.from("jobs").insert({ client_id: finOnlyClient, title: "Referral", service: "regulated_referral" });
  const invite = await fetch(`${getLocal().apiUrl}/functions/v1/invite-contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await accessTokenOf(page)}` },
    body: JSON.stringify({ client_id: finOnlyClient, full_name: "Nope", email: `nope.${s.tag}@example.com`, role: "owner" }),
  });
  expect(invite.status).toBe(400);
  expect(await invite.json()).toEqual({ error: "Something went wrong." });
  const { count: contactsAfter } = await admin.from("client_contacts").select("profile_id", { count: "exact", head: true }).eq("client_id", finOnlyClient);
  expect(contactsAfter).toBe(1); // still just the owner

  // Not an admin: no Settings.
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/admin/settings");
  await expect(page.getByText("Only the admin can change settings.")).toBeVisible();
});

test("the admin grants an area in Settings; new staff see nothing until then; the Finance view has the pipeline", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const s = await mixedClient();
  const newStaffEmail = `e2e.staff.new.${run}@example.com`;
  await ensureUser(admin, { email: newStaffEmail, staff: true, areas: [] });

  // The new team member can sign in but has no access yet.
  const staffContext = await browser.newContext({ baseURL: "http://localhost:3000" });
  const staffPage = await staffContext.newPage();
  await signInAsStaffWithMfaKeepingUser(staffPage, newStaffEmail);
  await staffPage.goto("/admin");
  await expect(staffPage.getByText("You don't have access to any area yet.")).toBeVisible();
  expect((await staffPage.goto(`/admin/jobs/${s.accJob}`))?.status()).toBe(404);

  // Admin: Settings → Staff.
  await signInAsStaffWithMfa(page, `e2e.admin.${run}@example.com`);
  await page.goto("/admin/settings");
  const row = page.getByTestId("staff-row").filter({ hasText: newStaffEmail });
  await expect(row.getByText("No access yet")).toBeVisible();
  await row.getByLabel("Accounting").check();
  await row.getByRole("button", { name: "Save access" }).click();
  await expect(row.getByRole("status")).toHaveText("Saved.");

  const { data: profile } = await admin.from("profiles").select("id, staff_areas").eq("email", newStaffEmail).single();
  expect(profile?.staff_areas).toEqual(["accounting"]);
  const { data: audit } = await admin.from("audit_log").select("actor_id, meta").eq("action", "staff_areas_changed").eq("entity_id", profile!.id);
  expect(audit).toHaveLength(1);
  expect(audit![0].meta).toEqual({ areas: ["accounting"], previous: [] });

  // Takes effect straight away for them: accounting yes, finance no.
  expect((await staffPage.goto(`/admin/jobs/${s.accJob}`))?.status()).toBe(200);
  expect((await staffPage.goto(`/admin/jobs/${s.finJob}`))?.status()).toBe(404);
  await staffContext.close();

  // Admin's dashboard: both areas, with a filter; the pipeline only appears in the Finance view.
  await page.goto("/admin");
  const filter = page.getByRole("navigation", { name: "Area filter" });
  await expect(filter.getByRole("link")).toHaveText(["Everything", "Accounting", "Business Finance"]);
  await expect(page.getByRole("heading", { name: "Finance pipeline" })).toHaveCount(0);
  await filter.getByRole("link", { name: "Business Finance" }).click();
  await expect(page.getByRole("heading", { name: "Finance pipeline" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Finance pipeline" }).getByRole("link", { name: new RegExp(`Loan application ${s.tag}`) })).toBeVisible();
  await filter.getByRole("link", { name: "Accounting" }).click();
  await expect(page.getByRole("heading", { name: "Finance pipeline" })).toHaveCount(0);
});

// Signs in an existing staff user (created by the test) and enrols MFA through the UI.
async function signInAsStaffWithMfaKeepingUser(page: Page, email: string) {
  await page.goto(`/auth/callback?token_hash=${await magicLinkToken(admin, email)}&type=magiclink`);
  await expect(page).toHaveURL(/\/auth\/mfa\/enrol$/);
  await page.getByRole("button", { name: "Can't scan it?" }).click();
  const secret = (await page.locator("code").innerText()).replace(/ /g, "").trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
