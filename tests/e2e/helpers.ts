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

/** Creates a brand-new staff user, enrols an authenticator through the UI and lands on /admin. */
export async function signInAsStaffWithMfa(page: Page, email: string) {
  const { data: old } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (old) await admin.auth.admin.deleteUser(old.id);
  await ensureUser(admin, { email, staff: true });

  await signInAs(page, email);
  await expect(page).toHaveURL(/\/auth\/mfa\/enrol$/);
  await page.getByRole("button", { name: "Can't scan it?" }).click();
  const secret = (await page.locator("code").innerText()).replace(/ /g, "").trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
