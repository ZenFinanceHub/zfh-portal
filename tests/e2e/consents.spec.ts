import { expect, test, type Page } from "@playwright/test";
import { adminClient, ensureClientOwner, ensureUser } from "../../scripts/local-supabase.mjs";
import { CONSENTS, PARTNER_FIRM_MESSAGE } from "../../lib/consents";
import { expectReceived, signInAs, signInAsStaffWithMfa } from "./helpers";

// Consent wording version 1: the exact texts, the partner firm on a regulated referral, and the privacy notice link.
// Everything here runs on a 375px-wide phone.
test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

const admin = adminClient();
const run = Date.now();
let counter = 0;
const uid = () => `${run}-${++counter}`;

async function setup(requests: Record<string, unknown>[], pendingBlueprints: unknown[] = []) {
  const tag = uid();
  const ownerEmail = `consent.owner.${tag}@example.com`;
  const ownerId = await ensureUser(admin, { email: ownerEmail });
  const clientId = await ensureClientOwner(admin, ownerId, `E2E Consent ${tag} Ltd`);
  const { data: job } = await admin
    .from("jobs")
    .insert({ client_id: clientId, title: `Consent job ${tag}`, service: "regulated_referral", pending_blueprints: pendingBlueprints })
    .select("id")
    .single();
  const ids: string[] = [];
  for (const [i, r] of requests.entries()) {
    const { data, error } = await admin.from("requests").insert({ job_id: job!.id, sort_order: i, ...r }).select("id").single();
    expect(error).toBeNull();
    ids.push(data!.id);
  }
  return { tag, ownerEmail, ownerId, clientId, jobId: job!.id as string, ids };
}

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

const FIRM = 'Smith & Sons "Advisers" $& Ltd';

test("a regulated referral shows the firm in the wording, escapes it, and records the filled-in wording", async ({ page }) => {
  const s = await setup([{ kind: "consent", title: "Meet our partner", consent_type: "regulated_referral", partner_firm: FIRM }]);

  await signInAs(page, s.ownerEmail);
  await page.goto(`/jobs/${s.jobId}/requests/${s.ids[0]}`);

  const wording = page.getByTestId("consent-wording");
  await expect(wording.getByRole("heading", { name: `Being introduced to ${FIRM}` })).toBeVisible();
  await expect(wording).toContainText("Zen Commercial Finance Ltd doesn't do this work and isn't giving you advice on it.");
  await expect(wording.getByRole("listitem")).toHaveCount(5);
  await expect(wording.getByRole("listitem").nth(0)).toHaveText(`If you agree, we'll pass your name, contact details and the short summary you've given us to ${FIRM} so they can contact you.`);
  await expect(wording.getByRole("listitem").nth(3)).toHaveText(`We may receive a fee from ${FIRM} if you become their client. Ask us and we'll tell you how much.`);
  await expect(page.getByText(`I agree that Zen Commercial Finance Ltd can pass my name, contact details and summary to ${FIRM} so they can contact me.`)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("{firm}");
  // The firm is text, never markup: the only elements inside the wording are the ones the page itself draws.
  expect(await wording.locator("*:not(h2):not(p):not(ul):not(li):not(a)").count()).toBe(0);
  await noSideways(page);

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "I agree" }).click();
  await expectReceived(page);

  const { data: consent } = await admin.from("consents").select("*").eq("request_id", s.ids[0]).single();
  expect(consent?.consent_type).toBe("regulated_referral");
  expect(consent?.wording_version).toBe("regulated_referral-v1");
  expect(consent?.recipient).toBe(FIRM);
  expect(consent?.wording_text).toContain(`Being introduced to ${FIRM}`);
  expect(consent?.wording_text).toContain(`- You don't have to use them, and you're free to go to another firm.`);
  expect(consent?.wording_text).toContain(`to ${FIRM} so they can contact me.`);
  expect(consent?.wording_text).not.toContain("{firm}");
});

test("the lender and engagement wording is version 1, word for word", async ({ page }) => {
  const s = await setup([
    { kind: "consent", title: "Share with lenders", consent_type: "lender_share" },
    { kind: "consent", title: "Engagement letter", consent_type: "engagement_letter" },
  ]);
  await signInAs(page, s.ownerEmail);

  await page.goto(`/jobs/${s.jobId}/requests/${s.ids[0]}`);
  const wording = page.getByTestId("consent-wording");
  await expect(wording.getByRole("heading", { name: "Sharing your information with lenders" })).toBeVisible();
  await expect(wording).toContainText("Zen Commercial Finance Ltd (trading as ZenFinanceHub) arranges business finance by introducing you to lenders.");
  await expect(wording.getByRole("listitem")).toHaveCount(5);
  await expect(wording.getByRole("listitem").nth(1)).toHaveText(
    "Lenders will usually run credit and identity checks on the business, and may also check its directors, owners or guarantors. These checks may be recorded on credit files.",
  );
  await expect(page.getByText("I confirm I'm authorised to agree this for the business, and that anyone else whose details I've provided knows they're being shared.")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "I agree" }).click();
  await expectReceived(page);
  const { data: lender } = await admin.from("consents").select("wording_version, wording_text").eq("request_id", s.ids[0]).single();
  expect(lender?.wording_version).toBe("lender_share-v1");
  expect(lender?.wording_text).not.toMatch(/DRAFT/i);

  await page.goto(`/jobs/${s.jobId}/requests/${s.ids[1]}`);
  await expect(page.getByTestId("consent-wording").getByRole("heading", { name: "Our engagement letter" })).toBeVisible();
  await expect(page.getByTestId("consent-wording")).toContainText("Our engagement letter explains the work ZenFinanceHub will do for you");
  await expect(page.getByTestId("consent-wording").getByRole("listitem")).toHaveCount(0);
  await expect(page.getByText("I have read the engagement letter and agree to its terms. I confirm I'm authorised to agree this for the business.")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "I agree" }).click();
  await expectReceived(page);
  const { data: letter } = await admin.from("consents").select("wording_version").eq("request_id", s.ids[1]).single();
  expect(letter?.wording_version).toBe("engagement_letter-v1");

  // No version that clients can be shown is still a draft.
  for (const w of Object.values(CONSENTS)) expect(w.version).not.toMatch(/DRAFT/i);
});

test("a regulated referral cannot be created without a firm, in the database or the admin form", async ({ page }) => {
  const s = await setup([]);

  // The database refuses a blank firm, markup characters, and a firm on any other kind of request.
  for (const firm of [null, "   ", "<img src=x onerror=alert(1)>", "Acme {firm}", "A"]) {
    const { error } = await admin
      .from("requests")
      .insert({ job_id: s.jobId, kind: "consent", title: "Bad referral", consent_type: "regulated_referral", partner_firm: firm });
    expect(error?.code, `firm ${JSON.stringify(firm)}`).toBe("23514");
  }
  const { error: stray } = await admin.from("requests").insert({ job_id: s.jobId, kind: "upload", title: "Stray firm", partner_firm: "Acme" });
  expect(stray?.code).toBe("23514");

  // The admin form insists too, and says so.
  await signInAsStaffWithMfa(page, `e2e.staff.consent.${uid()}@example.com`);
  await page.goto(`/admin/jobs/${s.jobId}`);
  await page.getByRole("button", { name: "Add a request" }).click();
  await page.getByLabel("Kind").selectOption("consent");
  await page.getByLabel("Consent type").selectOption("regulated_referral");
  await page.getByLabel("Title (what the client sees)").fill("Meet our partner");
  await page.getByRole("button", { name: "Add request" }).click();
  await expect(page.getByText(PARTNER_FIRM_MESSAGE)).toBeVisible();

  await page.getByLabel(/Partner firm/).fill("<b>Evil</b> Ltd");
  await page.getByRole("button", { name: "Add request" }).click();
  await expect(page.getByText(PARTNER_FIRM_MESSAGE)).toBeVisible();
  expect((await admin.from("requests").select("id").eq("job_id", s.jobId)).data).toHaveLength(0);

  await page.getByLabel(/Partner firm/).fill("Quay Finance Ltd");
  await page.getByRole("button", { name: "Add request" }).click();
  await expect(page.getByTestId("partner-firm")).toHaveText("Introduces the client to: Quay Finance Ltd");
  const { data: added } = await admin.from("requests").select("partner_firm, consent_type").eq("job_id", s.jobId).single();
  expect(added).toEqual({ partner_firm: "Quay Finance Ltd", consent_type: "regulated_referral" });
});

test("a referral held back from a template is added later with the firm's name", async ({ page }) => {
  const s = await setup([], [{ kind: "consent", title: "Agree to be introduced to our partner firm", consent_type: "regulated_referral" }]);
  await signInAsStaffWithMfa(page, `e2e.staff.held.${uid()}@example.com`);
  await page.goto(`/admin/jobs/${s.jobId}`);

  await expect(page.getByText("Add later")).toBeVisible();
  // The firm is required: the browser will not send the form without it.
  await page.getByRole("button", { name: "Add now" }).click();
  expect((await admin.from("requests").select("id").eq("job_id", s.jobId)).data).toHaveLength(0);

  await page.getByLabel("Partner firm (required)").fill("Harbour Advisers Ltd");
  await page.getByRole("button", { name: "Add now" }).click();
  await expect(page.getByTestId("partner-firm")).toHaveText("Introduces the client to: Harbour Advisers Ltd");
  const { data: added } = await admin.from("requests").select("partner_firm").eq("job_id", s.jobId).single();
  expect(added?.partner_firm).toBe("Harbour Advisers Ltd");
  const { data: job } = await admin.from("jobs").select("pending_blueprints").eq("id", s.jobId).single();
  expect(job?.pending_blueprints).toEqual([]);
});

test("the privacy notice link: set by the admin, hidden until then, shown under each consent", async ({ page }) => {
  const s = await setup([
    { kind: "consent", title: "Share with lenders", consent_type: "lender_share" },
    { kind: "consent", title: "Engagement letter", consent_type: "engagement_letter" },
  ]);
  const url = `https://example.com/privacy-${run}`;
  const link = (p: Page) => p.getByRole("link", { name: "How we handle your information" });

  try {
    await admin.from("portal_settings").update({ privacy_notice_url: null }).eq("id", true);

    // Not set: no link.
    await signInAs(page, s.ownerEmail);
    for (const id of s.ids) {
      await page.goto(`/jobs/${s.jobId}/requests/${id}`);
      await expect(page.getByTestId("consent-wording")).toBeVisible();
      await expect(link(page)).toHaveCount(0);
    }

    // The admin sets it; an address that is not https is refused.
    await page.context().clearCookies();
    await signInAsStaffWithMfa(page, `e2e.staff.privacy.${uid()}@example.com`);
    await page.goto("/admin/settings?tab=privacy");
    await page.getByLabel("Privacy notice address").fill("http://example.com/privacy");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Enter an address that starts with https://")).toBeVisible();
    await page.getByLabel("Privacy notice address").fill(url);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    const { data: audit } = await admin.from("audit_log").select("meta").eq("action", "privacy_notice_url_changed").order("id", { ascending: false }).limit(1).single();
    expect(audit?.meta).toEqual({ set: true, was_set: false });

    // Set: the link is under each consent and opens safely in a new tab.
    await page.context().clearCookies();
    await signInAs(page, s.ownerEmail);
    for (const id of s.ids) {
      await page.goto(`/jobs/${s.jobId}/requests/${id}`);
      await expect(link(page)).toHaveAttribute("href", url);
      await expect(link(page)).toHaveAttribute("target", "_blank");
      await expect(link(page)).toHaveAttribute("rel", /noopener/);
      await noSideways(page);
    }
  } finally {
    await admin.from("portal_settings").update({ privacy_notice_url: null }).eq("id", true);
  }
});
