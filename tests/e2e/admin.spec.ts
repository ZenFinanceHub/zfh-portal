import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { adminClient, ensureUser, getLocal, magicLinkToken } from "../../scripts/local-supabase.mjs";
import { signInAsStaffWithMfa } from "./helpers";

const MAILPIT = "http://127.0.0.1:55324";
const STAFF_EMAIL = "e2e.staff.admin@example.com";

const run = Date.now();
const CLIENT_NAME = `E2E Invite Ltd ${run}`;
const INVITEE = `invitee.${run}@example.com`;

test("staff can create a client and invite a contact; the invite email works", async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsStaffWithMfa(page, STAFF_EMAIL);

  // Create a client (with a validation error on the way).
  await page.goto("/admin/clients");
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await page.getByRole("link", { name: "New client" }).click();
  await page.getByLabel("Client name").fill(CLIENT_NAME);
  await page.getByLabel("UTR").fill("123");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByText("A UTR is 10 digits")).toBeVisible();
  await expect(page.getByLabel("Client name")).toHaveValue(CLIENT_NAME);

  await page.getByLabel("UTR").fill("1234567890");
  await page.getByLabel("Company number").fill("12345678");
  await page.getByLabel("Year end").fill("2026-03-31");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: CLIENT_NAME })).toBeVisible();
  await expect(page.getByText("31/03/2026")).toBeVisible();
  await expect(page.getByText("No jobs yet.")).toBeVisible();

  // Search and filter.
  await page.goto(`/admin/clients?q=${encodeURIComponent(String(run))}`);
  await expect(page.getByRole("link", { name: new RegExp(CLIENT_NAME) })).toBeVisible();
  await page.goto(`/admin/clients?q=${run}&status=former`);
  await expect(page.getByText("No clients match that search.")).toBeVisible();

  // Edit.
  await page.goto(`/admin/clients?q=${run}`);
  await page.getByRole("link", { name: new RegExp(CLIENT_NAME) }).click();
  await page.getByRole("link", { name: "Edit client" }).click();
  await page.getByLabel("Status").selectOption("prospect");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Prospect").first()).toBeVisible();

  // Invite a contact.
  await page.getByRole("button", { name: "Invite contact" }).click();
  await page.getByLabel("Email address").fill("not-an-email");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Enter their name")).toBeVisible();
  await page.getByLabel("Name").fill("Invited Person");
  await page.getByLabel("Email address").fill(INVITEE);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toContainText("Invite sent");
  await expect(page.getByText("Invited Person")).toBeVisible();

  // The email: right template, no client data, working link.
  let messageId = "";
  await expect
    .poll(async () => {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${INVITEE}`)}`);
      const body = await res.json();
      messageId = body.messages?.[0]?.ID ?? "";
      return messageId;
    })
    .not.toBe("");
  const message = await (await fetch(`${MAILPIT}/api/v1/message/${messageId}`)).json();
  expect(message.Subject).toBe("ZenFinanceHub has set up your secure client portal");
  expect(message.HTML).toContain("type=invite");
  expect(message.HTML).not.toContain(CLIENT_NAME);
  const link = /href="([^"]*type=invite[^"]*)"/.exec(message.HTML)![1].replaceAll("&amp;", "&");

  // Inviting the same person again links them without another email.
  await page.getByLabel("Email address").fill(INVITEE);
  await page.getByLabel("Name").fill("Invited Person");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toContainText("no email was sent");

  // The invited person can use the link and sees the client home, not /admin.
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/localhost:3000\/$/);
  await expect(page.getByRole("heading", { name: "Things to do" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/localhost:3000\/$/);
});

test("the invite function refuses anyone who is not signed-in MFA staff", async () => {
  const local = getLocal();
  const admin = adminClient(local);
  const url = `${local.apiUrl}/functions/v1/invite-contact`;
  const body = JSON.stringify({
    client_id: "00000000-0000-0000-0000-000000000000",
    full_name: "Nobody",
    email: `nobody.${run}@example.com`,
    role: "owner",
  });
  const call = (token?: string) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
    });

  expect((await call()).status).toBe(403);
  expect((await call(local.anonKey)).status).toBe(403);

  // A real client owner's session is refused too.
  const email = "e2e.client@example.com";
  await ensureUser(admin, { email });
  const anon = createClient(local.apiUrl, local.anonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: await magicLinkToken(admin, email),
    type: "magiclink",
  });
  expect(error).toBeNull();
  const res = await call(data.session!.access_token);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Not allowed." });
});
