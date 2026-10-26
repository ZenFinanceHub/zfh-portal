// LOCAL ONLY: creates the admin login and a test client owner in the local Supabase.
// Uses the local service role key from `npx supabase status`; it is never written anywhere.
// Refuses to run unless the API is on 127.0.0.1.
import { adminClient, ensureClientOwner, ensureUser, getLocal } from "./local-supabase.mjs";

const local = getLocal();
const admin = adminClient(local);

await ensureUser(admin, { email: "craig@zen-finance.co.uk", staff: true });
const ownerId = await ensureUser(admin, { email: "client.owner@example.com" });
await ensureClientOwner(admin, ownerId, "Test Client Ltd");

console.log("Local users ready:");
console.log("  craig@zen-finance.co.uk   admin (needs MFA)");
console.log("  client.owner@example.com  client owner of Test Client Ltd");
console.log("Sign in at http://localhost:3000/auth/login, then open the email in Mailpit: http://127.0.0.1:55324");
