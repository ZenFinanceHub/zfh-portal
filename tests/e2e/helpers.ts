import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { adminClient, ensureUser, magicLinkToken } from "../../scripts/local-supabase.mjs";

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) so the test can act as the authenticator app.
export function totp(secret: string, atMs = Date.now()) {
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

const admin = adminClient();

// Signs in through the real /auth/callback route using a one-off token for the user.
export async function signInAs(page: Page, email: string, type: "magiclink" | "invite" = "magiclink") {
  const token = await magicLinkToken(admin, email);
  await page.goto(`/auth/callback?token_hash=${token}&type=${type}`);
}

/**
 * Creates a brand-new staff user, enrols an authenticator through the UI and lands on /admin.
 * Admin by default; pass `areas` for an ordinary staff member limited to those areas.
 */
export async function signInAsStaffWithMfa(page: Page, email: string, areas?: string[]) {
  const { data: old } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (old) await admin.auth.admin.deleteUser(old.id);
  await ensureUser(admin, { email, staff: true, areas });

  await signInAs(page, email);
  await expect(page).toHaveURL(/\/auth\/mfa\/enrol$/);
  await page.getByRole("button", { name: "Can't scan it?" }).click();
  const secret = (await page.locator("code").innerText()).replace(/ /g, "").trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** The signed-in user's access token, read from the Supabase session cookies in the browser context. */
export async function accessTokenOf(page: Page): Promise<string> {
  const cookies = (await page.context().cookies())
    .filter((c) => /^sb-.*-auth-token(.d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const joined = cookies.map((c) => c.value).join("").replace(/^base64-/, "");
  const session = JSON.parse(Buffer.from(joined, "base64url").toString("utf8"));
  return session.access_token as string;
}

/**
 * The confirmation after sending something. It depends on what is left to do: either a count with "Back to my list",
 * or "That's everything for now" with "Back to home". Pass `more` when the test knows which one to expect.
 */
export async function expectReceived(page: Page, more?: boolean) {
  const status = page.getByRole("status").filter({ hasText: "Received — thank you." });
  await expect(status).toBeVisible();
  await expect(status).not.toContainText("nothing more needed");
  const remaining = status.getByText(/You have \d+ more things? to do/);
  const everything = status.getByText("That's everything for now.");
  if (more === true) await expect(remaining).toBeVisible();
  else if (more === false) await expect(everything).toBeVisible();
  else await expect(remaining.or(everything)).toBeVisible();
  const link = status.getByRole("link", { name: /Back to (my list|home)/ });
  if ((await remaining.count()) > 0) await expect(link).toHaveText("Back to my list");
  else await expect(link).toHaveText("Back to home");
}
