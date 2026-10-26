import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  adminClient,
  ensureClientOwner,
  ensureUser,
  magicLinkToken,
} from "../../scripts/local-supabase.mjs";

const admin = adminClient();
const CLIENT_EMAIL = "e2e.client@example.com";
const STAFF_EMAIL = "e2e.staff.nomfa@example.com";
const MFA_STAFF_EMAIL = "e2e.staff.mfa@example.com";

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) so the test can act as the authenticator app.
function totp(secret: string, atMs = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const offset = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

// Signs in through the real /auth/callback route using a one-off token for the user.
async function signInAs(page: Page, email: string) {
  const token = await magicLinkToken(admin, email);
  await page.goto(`/auth/callback?token_hash=${token}&type=magiclink`);
}

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
  const secret = (await page.locator("code").innerText()).trim();

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
