import { expect, test } from "@playwright/test";
import {
  adminClient,
  ensureClientOwner,
  ensureUser,
} from "../../scripts/local-supabase.mjs";
import { signInAs, totp } from "./helpers";

const admin = adminClient();
const CLIENT_EMAIL = "e2e.client@example.com";
const STAFF_EMAIL = "e2e.staff.nomfa@example.com";
const MFA_STAFF_EMAIL = "e2e.staff.mfa@example.com";


test.beforeAll(async () => {
  const clientId = await ensureUser(admin, { email: CLIENT_EMAIL });
  await ensureClientOwner(admin, clientId, "E2E Client Ltd");
  await ensureUser(admin, { email: STAFF_EMAIL, staff: true });
});

test("signed-out visitors are sent to the login page", async ({ page }) => {
  for (const path of ["/", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/login$/);
  }
});

test("a client can sign in but is blocked from /admin", async ({ page }) => {
  await signInAs(page, CLIENT_EMAIL);
  await expect(page).toHaveURL(/localhost:3000\/$/);
  await expect(page.getByRole("heading", { name: "Things to do" })).toBeVisible();

  await page.goto("/admin");
  await expect(page).toHaveURL(/localhost:3000\/$/);
  await expect(page.getByText("Admin dashboard")).toHaveCount(0);
});

test("staff without MFA are sent to set it up and cannot reach /admin", async ({ page }) => {
  await signInAs(page, STAFF_EMAIL);
  await expect(page).toHaveURL(/\/auth\/mfa\/enrol$/);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/auth\/mfa\/enrol$/);
  await expect(page.getByAltText(/QR code/)).toBeVisible();
});

test("staff can enrol an authenticator, then sign in again with a code", async ({ page }) => {
  test.setTimeout(120_000);
  // Start from a brand-new user so there are no leftover factors.
  const { data: old } = await admin.from("profiles").select("id").eq("email", MFA_STAFF_EMAIL).maybeSingle();
  if (old) await admin.auth.admin.deleteUser(old.id);
  await ensureUser(admin, { email: MFA_STAFF_EMAIL, staff: true });

  await signInAs(page, MFA_STAFF_EMAIL);
  await expect(page).toHaveURL(/\/auth\/mfa\/enrol$/);
  await expect(page.getByAltText(/QR code/)).toBeVisible();
  // The setup key is hidden until asked for, then shown in groups of four.
  await expect(page.locator("code")).toHaveCount(0);
  await page.getByRole("button", { name: "Can't scan it?" }).click();
  const shown = (await page.locator("code").innerText()).trim();
  expect(shown).toMatch(/^([A-Z2-7]{4} )*[A-Z2-7]{1,4}$/);
  const secret = shown.replace(/ /g, "");
  await expect(page.getByRole("button", { name: "Copy key" })).toBeVisible();

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect(page.locator("p[role=alert]")).toContainText("isn't right");

  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);

  await signInAs(page, MFA_STAFF_EMAIL);
  await expect(page).toHaveURL(/\/auth\/mfa\/verify$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/auth\/mfa\/verify$/);

  // A code from the next 30-second window, so it cannot clash with the one just used.
  await page.getByLabel("6-digit code").fill(totp(secret, Date.now() + 30000));
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("an invalid or used link shows a clear error", async ({ page }) => {
  await page.goto("/auth/callback?token_hash=not-a-real-token&type=magiclink");
  await expect(page).toHaveURL(/\/auth\/login\?error=expired/);
  await expect(page.locator("p[role=alert]")).toContainText("expired");
});

test("login message is identical for known and unknown emails", async ({ page }) => {
  async function messageFor(email: string) {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: /sign-in link/i }).click();
    const status = page.getByRole("status");
    await expect(status).toBeVisible();
    return status.innerText();
  }

  const known = await messageFor(CLIENT_EMAIL);
  const unknown = await messageFor("nobody.at.all@example.com");
  expect(known).toBe("If you have an account, we've emailed you a sign-in link.");
  expect(unknown).toBe(known);
});
