import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, ensureClientOwner, ensureUser, getLocal, magicLinkToken } from "../../scripts/local-supabase.mjs";
import { signInAsStaffWithMfa } from "./helpers";

// The Claude connector, end to end against the local stack: the real OAuth sign-in (including the authenticator
// code on the consent page), the real token, and calls to /api/mcp and to the Supabase API with that token.

const local = getLocal();
const admin = adminClient(local);
const BASE = "http://localhost:3000";
const REDIRECT = "http://127.0.0.1:8123/cb"; // never contacted: the browser is stopped before it gets there

const uid = () => randomBytes(4).toString("hex");
const b64u = (b: Buffer) => b.toString("base64url");

type App = { clientId: string; secret: string };
async function newApp(): Promise<App> {
  const { data, error } = await admin.auth.admin.oauth.createClient({ client_name: "Claude (test)", redirect_uris: [REDIRECT] });
  expect(error).toBeNull();
  return { clientId: data!.client_id, secret: data!.client_secret! };
}

async function beginAuthorisation(app: App) {
  const verifier = b64u(randomBytes(32));
  const challenge = b64u(createHash("sha256").update(verifier).digest());
  const res = await fetch(
    `${local.apiUrl}/auth/v1/oauth/authorize?` +
      new URLSearchParams({
        client_id: app.clientId, response_type: "code", redirect_uri: REDIRECT,
        code_challenge: challenge, code_challenge_method: "S256", state: "s", scope: "openid",
      }),
    { redirect: "manual" },
  );
  const location = new URL(res.headers.get("location")!, BASE);
  expect(location.pathname).toBe("/oauth/consent");
  return { authorizationId: location.searchParams.get("authorization_id")!, verifier };
}

async function exchange(app: App, code: string, verifier: string) {
  const res = await fetch(`${local.apiUrl}/auth/v1/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + Buffer.from(`${app.clientId}:${app.secret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: app.clientId, redirect_uri: REDIRECT }),
  });
  const json = await res.json();
  return { status: res.status, access: json.access_token as string, refresh: json.refresh_token as string };
}

async function refresh(app: App, token: string) {
  const res = await fetch(`${local.apiUrl}/auth/v1/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + Buffer.from(`${app.clientId}:${app.secret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: app.clientId }),
  });
  return res.status;
}

/** Signs a staff member in with an authenticator code, approves Claude on the consent page, and returns the connector token. */
async function connect(page: Page, email: string, areas?: string[]) {
  await signInAsStaffWithMfa(page, email, areas);
  const app = await newApp();
  const { authorizationId, verifier } = await beginAuthorisation(app);
  await page.route("http://127.0.0.1:8123/**", (route) => route.fulfill({ status: 200, body: "ok" }));
  await page.goto(`/oauth/consent?authorization_id=${authorizationId}`);
  await expect(page.getByRole("heading", { name: "Connect Claude to the portal?" })).toBeVisible();
  await page.getByRole("button", { name: "Allow Claude to help me" }).click();
  await page.waitForURL(/127\.0\.0\.1:8123\/cb\?code=/);
  const code = new URL(page.url()).searchParams.get("code")!;
  const tokens = await exchange(app, code, verifier);
  expect(tokens.status).toBe(200);
  return { app, ...tokens };
}

async function mcp(token: string | null, method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.text();
  let json: { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }; error?: unknown } | null = null;
  try {
    json = JSON.parse(body);
  } catch {
    // not JSON
  }
  return { status: res.status, headers: res.headers, json, body };
}
async function tool(token: string, name: string, args: Record<string, unknown>) {
  const r = await mcp(token, "tools/call", { name, arguments: args });
  const text = r.json?.result?.content?.[0]?.text ?? "";
  let data: Record<string, unknown> | unknown[] | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    // an error message
  }
  return { ...r, text, data, isError: r.json?.result?.isError === true };
}

async function fixtures() {
  const tag = uid();
  const ownerId = await ensureUser(admin, { email: `e2e.connector.owner.${tag}@example.com` });
  const clientName = `Connector ${tag} Ltd`;
  const clientId = await ensureClientOwner(admin, ownerId, clientName);
  const mk = async (title: string, service: string) =>
    (await admin.from("jobs").insert({ client_id: clientId, title, service }).select("id").single()).data!.id as string;
  const accJob = await mk(`Year end ${tag}`, "year_end");
  const finJob = await mk(`Loan ${tag}`, "finance_application");
  const helpText = `HELP-SECRET-${tag}`;
  const returnReason = `RETURN-SECRET-${tag}`;
  const answer = `ANSWER-SECRET-${tag}`;
  const message = `CLIENT-MESSAGE-SECRET-${tag}`;
  const { data: req } = await admin
    .from("requests")
    .insert({ job_id: accJob, kind: "upload", title: `Payslips ${tag}`, help_text: helpText, status: "returned", return_reason: returnReason, due_date: "2030-02-01" })
    .select("id")
    .single();
  await admin.from("responses").insert({ request_id: req!.id, author_id: ownerId, answer: { value: answer } });
  await admin.from("messages").insert({ job_id: accJob, author_id: ownerId, body: message, internal: false });
  await admin.from("notifications_queue").delete().eq("client_id", clientId);
  return { tag, ownerId, clientName, clientId, accJob, finJob, secrets: [helpText, returnReason, answer, message] };
}

const counts = async (jobId: string) => {
  const [r, m] = await Promise.all([
    admin.from("requests").select("id", { count: "exact", head: true }).eq("job_id", jobId),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("job_id", jobId),
  ]);
  return { requests: r.count, messages: m.count };
};

test.afterAll(async () => {
  // Leave no OAuth apps or approvals behind.
  const { data } = await admin.auth.admin.oauth.listClients();
  for (const c of data?.clients ?? []) if (c.client_name === "Claude (test)") await admin.auth.admin.oauth.deleteClient(c.client_id);
  await admin.from("connector_grants").delete().neq("id", "00000000-0000-0000-0000-000000000000");
});

test("without a token the connector says where to sign in, and publishes who signs people in", async () => {
  const r = await mcp(null, "tools/list");
  expect(r.status).toBe(401);
  const challenge = r.headers.get("www-authenticate") ?? "";
  expect(challenge).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp"`);

  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
    const meta = await (await fetch(`${BASE}${path}`)).json();
    expect(meta.resource).toBe(`${BASE}/api/mcp`);
    expect(meta.authorization_servers).toEqual([`${local.apiUrl}/auth/v1`]);
  }
  expect((await mcp("not-a-real-token", "tools/list")).status).toBe(401);
});

test("approving needs an authenticator code: signed-out and half-signed-in staff are sent to sign in, not approved", async ({ page }) => {
  const app = await newApp();
  const { authorizationId } = await beginAuthorisation(app);
  await page.goto(`/oauth/consent?authorization_id=${authorizationId}`);
  await expect(page).toHaveURL(/\/auth\/login$/); // not signed in: sent to sign in, the request remembered

  // A staff member who has signed in but not yet entered an authenticator code goes to the code page, not the consent page.
  const email = `e2e.connector.aal1.${uid()}@example.com`;
  await ensureUser(admin, { email, staff: true });
  const anon = createClient(local.apiUrl, local.anonKey, { auth: { persistSession: false } });
  await anon.auth.verifyOtp({ token_hash: await magicLinkToken(admin, email), type: "magiclink" });
  expect((await anon.auth.mfa.enroll({ factorType: "totp" })).error).toBeNull();
  const { authorizationId: second } = await beginAuthorisation(app);
  const res = await fetch(`${BASE}/oauth/start?authorization_id=${second}`, { redirect: "manual" });
  expect(res.status).toBe(307);
  expect(res.headers.get("set-cookie") ?? "").toContain("zfh_return_to");
});

test("the whole flow: approve with an authenticator code, then Claude can find clients, preview and add requests", async ({ page }) => {
  const f = await fixtures();
  const { access, app } = await connect(page, `e2e.connector.admin.${f.tag}@example.com`);

  // The token is a connector token whose MFA level is aal1: the grant, not the token, is the evidence.
  const claims = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString());
  expect(claims.client_id).toBe(app.clientId);
  expect(claims.aal).toBe("aal1");

  const list = await mcp(access, "tools/list");
  expect(list.status).toBe(200);
  expect(list.json?.result?.tools?.map((t) => t.name).sort()).toEqual(
    ["add_internal_note", "add_requests", "create_job", "get_outstanding", "list_jobs", "search_clients", "send_client_message"],
  );

  const found = await tool(access, "search_clients", { query: f.clientName.slice(0, 14) });
  expect(found.data).toEqual([{ client_id: f.clientId, name: f.clientName }]);
  const jobs = await tool(access, "list_jobs", { client_id: f.clientId });
  expect((jobs.data as { title: string }[]).map((j) => j.title).sort()).toEqual([`Loan ${f.tag}`, `Year end ${f.tag}`]);

  // Nothing client-written or staff-written leaks out of any read tool.
  const outstanding = await tool(access, "get_outstanding", { client_id: f.clientId });
  expect(outstanding.text).toContain(`Payslips ${f.tag}`);
  for (const secret of f.secrets) {
    for (const t of [found, jobs, outstanding, await tool(access, "get_outstanding", { job_id: f.accJob })]) {
      expect(t.text).not.toContain(secret);
    }
  }

  // Without confirm: a preview, nothing changes, nobody is emailed.
  const before = await counts(f.accJob);
  const items = [
    { kind: "upload", title: `Bank statements ${f.tag}`, due_date: "2030-03-01" },
    { kind: "question", title: `Any new loans ${f.tag}?`, question_type: "yes_no" },
  ];
  const preview = await tool(access, "add_requests", { job_id: f.accJob, requests: items, lender_text: `Lender says: LENDER-WORDS-${f.tag}` });
  expect((preview.data as { preview: boolean }).preview).toBe(true);
  expect(preview.text).toContain("Only call this tool again with confirm=true");
  const onlyPreview = await tool(access, "send_client_message", { job_id: f.accJob, body: "Hello there" });
  expect((onlyPreview.data as { changes_nothing: boolean }).changes_nothing).toBe(true);
  expect(await counts(f.accJob)).toEqual(before);
  expect((await admin.from("notifications_queue").select("id").eq("client_id", f.clientId)).data).toHaveLength(0);

  // With confirm: it happens, the lender's words go in an internal note, the client email is queued, the audit says claude_connector.
  const done = await tool(access, "add_requests", { job_id: f.accJob, requests: items, lender_text: `Lender says: LENDER-WORDS-${f.tag}`, confirm: true });
  expect((done.data as { count: number }).count).toBe(2);
  const { data: note } = await admin.from("messages").select("body, internal").like("body", `%LENDER-WORDS-${f.tag}%`);
  expect(note).toHaveLength(1);
  expect(note![0].internal).toBe(true);
  const { data: queued } = await admin.from("notifications_queue").select("audience, event").eq("client_id", f.clientId);
  expect(queued).toEqual([
    { audience: "client", event: "request_created" },
    { audience: "client", event: "request_created" },
  ]);
  const created2 = (done.data as { request_ids: string[] }).request_ids;
  const { data: audit } = await admin.from("audit_log").select("meta, actor_id").in("entity_id", created2).eq("entity", "requests").eq("action", "insert");
  expect(audit).toHaveLength(2);
  for (const row of audit!) expect((row.meta as { source?: string }).source).toBe("claude_connector");

  // A message to the client, and a note
  expect((await tool(access, "send_client_message", { job_id: f.accJob, body: "We have what we need.", confirm: true })).data).toMatchObject({ posted: true, visible_to_client: true });
  expect((await tool(access, "add_internal_note", { job_id: f.accJob, body: "Call lender Monday", confirm: true })).data).toMatchObject({ posted: true, visible_to_client: false });

  // A new job from a template: preview first, then it exists
  const jobPreview = await tool(access, "create_job", { client_id: f.clientId, service: "bookkeeping", title: `Bookkeeping ${f.tag}` });
  expect((jobPreview.data as { preview: boolean }).preview).toBe(true);
  expect((await admin.from("jobs").select("id").eq("title", `Bookkeeping ${f.tag}`)).data).toHaveLength(0);
  const created = await tool(access, "create_job", { client_id: f.clientId, service: "bookkeeping", title: `Bookkeeping ${f.tag}`, confirm: true });
  expect((created.data as { created: boolean }).created).toBe(true);

  // The token cannot be used on the portal's tables or other functions through the Supabase API
  const headers = { apikey: local.anonKey, authorization: `Bearer ${access}`, "content-type": "application/json" };
  const table = await fetch(`${local.apiUrl}/rest/v1/clients?select=id`, { headers });
  expect(table.status).toBe(403);
  const fn = await fetch(`${local.apiUrl}/rest/v1/rpc/create_job_from_template`, { method: "POST", headers, body: JSON.stringify({ p_client_id: f.clientId, p_template_id: f.clientId, p_title: "x", p_service: "year_end", p_period_end: null, p_due_date: null, p_assigned_to: null, p_contributors: [] }) });
  expect(fn.status).toBe(403);
  const ok = await fetch(`${local.apiUrl}/rest/v1/rpc/connector_check`, { method: "POST", headers, body: "{}" });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toBe("ok");
});

test("accounting-only staff can use the connector but cannot add finance requests through it", async ({ page }) => {
  const f = await fixtures();
  const { access } = await connect(page, `e2e.connector.acc.${f.tag}@example.com`, ["accounting"]);

  const jobs = await tool(access, "list_jobs", { client_id: f.clientId });
  expect((jobs.data as { title: string }[]).map((j) => j.title)).toEqual([`Year end ${f.tag}`]);

  const before = await counts(f.finJob);
  for (const confirm of [false, true]) {
    const r = await tool(access, "add_requests", { job_id: f.finJob, requests: [{ kind: "upload", title: "Sneaky" }], confirm });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Job not found");
  }
  expect((await tool(access, "send_client_message", { job_id: f.finJob, body: "x", confirm: true })).isError).toBe(true);
  expect((await tool(access, "add_internal_note", { job_id: f.finJob, body: "x", confirm: true })).isError).toBe(true);
  expect(await counts(f.finJob)).toEqual(before);
});

test("a client account cannot use the connector, even if it gets a token", async () => {
  const f = await fixtures();
  const ownerEmail = (await admin.from("profiles").select("email").eq("id", f.ownerId).single()).data!.email as string;

  // The client signs in and approves Claude themselves through Supabase directly, skipping the portal's screen.
  const app = await newApp();
  const { authorizationId, verifier } = await beginAuthorisation(app);
  const sb = createClient(local.apiUrl, local.anonKey, { auth: { persistSession: false } });
  await sb.auth.verifyOtp({ token_hash: await magicLinkToken(admin, ownerEmail), type: "magiclink" });
  await sb.auth.oauth.getAuthorizationDetails(authorizationId);
  const approved = await sb.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  const code = new URL(approved.data!.redirect_url).searchParams.get("code")!;
  const tokens = await exchange(app, code, verifier);
  expect(tokens.status).toBe(200);

  const r = await mcp(tokens.access, "tools/list");
  expect(r.status).toBe(403);
  const t = await tool(tokens.access, "search_clients", { query: "Connector" });
  expect(t.status).toBe(403);
  const rest = await fetch(`${local.apiUrl}/rest/v1/rpc/connector_search_clients`, {
    method: "POST",
    headers: { apikey: local.anonKey, authorization: `Bearer ${tokens.access}`, "content-type": "application/json" },
    body: JSON.stringify({ p_query: "Connector" }),
  });
  expect(rest.ok).toBe(false);
});

test("a token obtained without the portal's authenticator step has no approval and is refused", async () => {
  const f = await fixtures();
  const email = `e2e.connector.skip.${f.tag}@example.com`;
  const id = await ensureUser(admin, { email, staff: true });
  // A real, verified authenticator, so the only thing missing is the portal approval
  const first = createClient(local.apiUrl, local.anonKey, { auth: { persistSession: false } });
  await first.auth.verifyOtp({ token_hash: await magicLinkToken(admin, email), type: "magiclink" });
  const enrol = await first.auth.mfa.enroll({ factorType: "totp" });
  const { totp } = await import("./helpers");
  const ch = await first.auth.mfa.challenge({ factorId: enrol.data!.id });
  expect((await first.auth.mfa.verify({ factorId: enrol.data!.id, challengeId: ch.data!.id, code: totp(enrol.data!.totp.secret) })).error).toBeNull();

  // Now a plain sign-in (aal1) approves Claude directly with Supabase, never visiting the portal's consent page.
  const sb = createClient(local.apiUrl, local.anonKey, { auth: { persistSession: false } });
  await sb.auth.verifyOtp({ token_hash: await magicLinkToken(admin, email), type: "magiclink" });
  const app = await newApp();
  const { authorizationId, verifier } = await beginAuthorisation(app);
  await sb.auth.oauth.getAuthorizationDetails(authorizationId);
  const approved = await sb.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  const tokens = await exchange(app, new URL(approved.data!.redirect_url).searchParams.get("code")!, verifier);
  expect(tokens.status).toBe(200);

  const r = await mcp(tokens.access, "tools/call", { name: "search_clients", arguments: { query: "Connector" } });
  expect(r.status).toBe(401);
  expect(r.headers.get("www-authenticate")).toContain("resource_metadata=");
  expect((await admin.from("connector_grants").select("id").eq("user_id", id)).data).toHaveLength(0);
});

test("an approval older than 7 days stops working at once, and the connection is ended so Claude must ask again", async ({ page }) => {
  const f = await fixtures();
  const { access, refresh: refreshToken, app } = await connect(page, `e2e.connector.old.${f.tag}@example.com`);
  expect((await tool(access, "search_clients", { query: f.clientName.slice(0, 14) })).status).toBe(200);

  const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
  await admin.from("connector_grants").update({ approved_at: old }).eq("client_id", app.clientId);

  const r = await tool(access, "search_clients", { query: f.clientName.slice(0, 14) });
  expect(r.status).toBe(401);
  expect(r.headers.get("www-authenticate")).toContain("resource_metadata=");
  // every call stays refused, and the refresh token no longer works, so Claude has to go back through the portal
  expect((await mcp(access, "tools/list")).status).toBe(401);
  expect(await refresh(app, refreshToken)).toBeGreaterThanOrEqual(400);
});

test("the admin sees connected apps in Settings and can switch one off, which stops it at once", async ({ page }) => {
  const f = await fixtures();
  const { access, refresh: refreshToken, app } = await connect(page, `e2e.connector.revoke.${f.tag}@example.com`);
  expect((await tool(access, "search_clients", { query: f.clientName.slice(0, 14) })).status).toBe(200);
  await tool(access, "add_internal_note", { job_id: f.accJob, body: "Seen in the activity list", confirm: true });

  await page.goto("/admin/settings?tab=connected");
  const row = page.getByTestId("connector-grant").filter({ hasText: `e2e.connector.revoke.${f.tag}@example.com` });
  await expect(row).toContainText("Active");
  await expect(page.getByTestId("connector-activity")).toContainText("Added an internal note");
  await row.getByRole("button", { name: "Switch off" }).click();
  await expect(row).toContainText("Switched off");

  expect((await tool(access, "search_clients", { query: f.clientName.slice(0, 14) })).status).toBe(401);
  expect(await refresh(app, refreshToken)).toBeGreaterThanOrEqual(400);
  const { data: audit } = await admin.from("audit_log").select("action").eq("action", "connector_revoked");
  expect(audit!.length).toBeGreaterThan(0);
});

test("renewing needs the authenticator step whether or not Supabase remembers the app", async ({ page }) => {
  const f = await fixtures();
  const email = `e2e.connector.again.${f.tag}@example.com`;
  const first = await connect(page, email);
  const stale = () => admin.from("connector_grants").update({ approved_at: new Date(Date.now() - 9 * 86_400_000).toISOString() }).eq("client_id", first.app.clientId);

  // (1) The approval lapses but nobody has tried to use it, so Supabase still remembers the app and would skip the
  // question. The portal's page sits in the way: signed in with the authenticator done, it renews the approval itself.
  await stale();
  const a = await beginAuthorisation(first.app);
  const hop = await page.context().request.get(`${BASE}/oauth/consent?authorization_id=${a.authorizationId}`, { maxRedirects: 0 });
  expect(hop.status()).toBe(307);
  const back = new URL(hop.headers()["location"]);
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  const t1 = await exchange(first.app, back.searchParams.get("code")!, a.verifier);
  expect(t1.status).toBe(200);
  expect((await tool(t1.access, "search_clients", { query: f.clientName.slice(0, 14) })).status).toBe(200);

  // (2) The approval lapses and Claude tries to use it: the connection is ended, so the next attempt shows the question again.
  await stale();
  expect((await tool(t1.access, "search_clients", { query: "Connector" })).status).toBe(401);
  const b = await beginAuthorisation(first.app);
  await page.goto(`/oauth/consent?authorization_id=${b.authorizationId}`);
  await page.getByRole("button", { name: "Allow Claude to help me" }).click();
  await page.waitForURL(/127\.0\.0\.1:8123\/cb\?code=/);
  const t2 = await exchange(first.app, new URL(page.url()).searchParams.get("code")!, b.verifier);
  expect((await tool(t2.access, "search_clients", { query: f.clientName.slice(0, 14) })).status).toBe(200);
});

test("the connector is limited to 120 calls a minute per person, with a Retry-After", async ({ page }) => {
  test.setTimeout(120_000);
  const f = await fixtures();
  const { access } = await connect(page, `e2e.connector.rate.${f.tag}@example.com`);
  await admin.from("rate_limits").delete().eq("scope", "connector");

  const statuses: number[] = [];
  let retryAfter: string | null = null;
  for (let batch = 0; batch < 14; batch++) {
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const r = await mcp(access, "tools/list");
        if (r.status === 429) retryAfter = r.headers.get("retry-after");
        return r.status;
      }),
    );
    statuses.push(...results);
  }
  expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(100);
  expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(121);
  expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  expect(Number(retryAfter)).toBeGreaterThan(0);

  // And it recovers once the counters reset
  await admin.from("rate_limits").delete().eq("scope", "connector");
  expect((await mcp(access, "tools/list")).status).toBe(200);
});
