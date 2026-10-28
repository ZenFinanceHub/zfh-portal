// Smoke test of the LIVE project and portal. Needs no login: run it after every live push (`npm run smoke:live`).
//
// It reads nothing sensitive onto the screen. The public API key and the smoke-check secret are read in memory (the key
// from the Supabase CLI, the secret from the database) and used in requests; neither is printed or stored.
//
// Checks: the portal and its security headers, each edge function's response to an unauthenticated call, the API gate and
// anonymous access, a storage round trip with a throwaway object (through the smoke-check function), the function secrets
// (names, and digests against the local test values), both scheduled sweeps, and that a recent backup exists.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REF = "vvxrqwcmyisiweecqgyn";
const API = `https://${REF}.supabase.co`;
const PORTAL = "https://portal.zenfinancehub.com";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

function cli(args) {
  const res = spawnSync(`npx supabase ${args}`, { encoding: "utf8", shell: true, maxBuffer: 20 * 1024 * 1024 });
  return { status: res.status, out: res.stdout ?? "", err: res.stderr ?? "" };
}

function parseJson(text) {
  const i = text.search(/[{[]/);
  if (i === -1) return null;
  try {
    return JSON.parse(text.slice(i));
  } catch {
    return null;
  }
}

/** Runs SQL on the live database through the linked CLI (the same access `db push` uses). */
function sql(query) {
  const file = join(tmpdir(), `smoke-${randomUUID()}.sql`);
  writeFileSync(file, query);
  try {
    const { out, err } = cli(`db query --linked -f "${file}"`);
    const json = parseJson(out);
    if (!json) throw new Error(`database query failed: ${err.slice(0, 200) || out.slice(0, 200)}`);
    return json.rows ?? [];
  } finally {
    rmSync(file, { force: true });
  }
}

const http = async (url, init = {}) => {
  try {
    const res = await fetch(url, { redirect: "manual", ...init });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } catch (e) {
    return { status: 0, headers: new Headers(), text: String(e.message) };
  }
};

async function run() {
  // ── Portal ────────────────────────────────────────────────
  const login = await http(`${PORTAL}/auth/login`);
  check("portal sign-in page loads", login.status === 200, `HTTP ${login.status}`);
  const h = (n) => login.headers.get(n) ?? "";
  check("CSP with a nonce and no framing", /nonce-/.test(h("content-security-policy")) && /frame-ancestors 'none'/.test(h("content-security-policy")));
  check("HSTS, nosniff, frame denial, same-origin referrer, COOP",
    /max-age=\d{7,}/.test(h("strict-transport-security")) && h("x-content-type-options") === "nosniff" && h("x-frame-options") === "DENY" &&
      h("referrer-policy") === "same-origin" && h("cross-origin-opener-policy") === "same-origin");
  for (const path of ["/admin", "/admin/audit", "/admin/audit/export", "/admin/settings", "/"]) {
    const r = await http(`${PORTAL}${path}`);
    check(`signed-out ${path} goes to sign-in`, r.status === 307 && (r.headers.get("location") ?? "").includes("/auth/login"), `HTTP ${r.status}`);
  }
  const meta = await http(`${PORTAL}/.well-known/oauth-protected-resource/api/mcp`);
  let metaJson = null;
  try {
    metaJson = JSON.parse(meta.text);
  } catch {
    /* checked below */
  }
  check("connector discovery document", meta.status === 200 && metaJson?.resource === `${PORTAL}/api/mcp` && metaJson?.authorization_servers?.[0] === `${API}/auth/v1`);
  const mcp = await http(`${PORTAL}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("connector refuses a call without a token", mcp.status === 401 && (mcp.headers.get("www-authenticate") ?? "").includes("resource_metadata="), `HTTP ${mcp.status}`);

  // ── Edge functions, not signed in ─────────────────────────
  const fn = (name, body) =>
    http(`${API}/functions/v1/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const expectations = [
    ["send-notifications", { mode: "sweep" }, [401]],
    ["scan-file", { type: "SWEEP" }, [401]],
    ["job-zip", {}, [403]],
    ["client-export", { client_id: "00000000-0000-0000-0000-000000000000" }, [403]],
    ["invite-contact", {}, [401, 403]],
    ["retention-delete", {}, [401, 403]],
    ["smoke-check", {}, [401]],
  ];
  for (const [name, body, ok] of expectations) {
    const r = await fn(name, body);
    check(`${name} refuses a call with no sign-in or secret`, ok.includes(r.status), `HTTP ${r.status}`);
  }

  // ── The API as an anonymous visitor, and the gate ─────────
  const keys = parseJson(cli(`projects api-keys --project-ref ${REF} -o json`).out);
  const anon = keys?.find((k) => k.name === "anon" || k.id === "anon")?.api_key;
  check("public API key found", !!anon);
  if (anon) {
    const rest = (path, init = {}) => http(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    for (const t of ["clients", "jobs", "requests", "responses", "messages", "profiles", "files", "consents", "audit_log", "connector_grants", "rate_limits", "notifications_queue"]) {
      const r = await rest(`${t}?select=${t === "rate_limits" ? "scope" : "id"}&limit=1`); // rate_limits has no id column
      check(`anonymous visitors get nothing from ${t}`, r.status === 401 || r.status === 403 || r.text === "[]", `HTTP ${r.status}`);
    }
    for (const f of ["admin_audit", "admin_client_audit", "rate_limit_mfa", "connector_check", "connector_search_clients", "create_job_from_template", "submit_request"]) {
      const r = await rest(`rpc/${f}`, { method: "POST", body: "{}" });
      check(`anonymous visitors cannot call ${f}`, [401, 403, 404].includes(r.status) && !r.text.includes('"allowed"'), `HTTP ${r.status}`);
    }
    const buckets = await http(`${API}/storage/v1/bucket`, { headers: { apikey: anon, authorization: `Bearer ${anon}` } });
    check("anonymous visitors see no storage buckets", buckets.status === 200 ? buckets.text.trim() === "[]" : [401, 403].includes(buckets.status), `HTTP ${buckets.status}`);
  }

  // The gate logic and its settings, checked in the database inside a transaction that is rolled back.
  const gateRows = sql(`
begin;
create temp table g(step text, result text);
grant all on g to authenticated, anon;
do $$
declare v_user uuid := (select id from public.profiles where is_staff order by created_at limit 1);
begin
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated', 'client_id', gen_random_uuid())::text, true);
  perform set_config('request.path', '/clients', true);
  set local role authenticated;
  begin perform public.connector_gate(); insert into g values ('connector token on a table', 'ALLOWED'); exception when others then insert into g values ('connector token on a table', sqlerrm); end;
  perform set_config('request.path', '/rpc/create_job_from_template', true);
  begin perform public.connector_gate(); insert into g values ('connector token on a staff function', 'ALLOWED'); exception when others then insert into g values ('connector token on a staff function', sqlerrm); end;
  perform set_config('request.path', '/rpc/connector_check', true);
  begin perform public.connector_gate(); insert into g values ('connector token on a connector tool', 'allowed'); exception when others then insert into g values ('connector token on a connector tool', sqlerrm); end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('request.path', '/rpc/create_job_from_template', true);
  begin perform public.connector_gate(); insert into g values ('ordinary sign-in on a staff function', 'allowed'); exception when others then insert into g values ('ordinary sign-in on a staff function', sqlerrm); end;
  reset role;
end $$;
select step, result from g;
rollback;`);
  const gate = Object.fromEntries(gateRows.map((r) => [r.step, r.result]));
  const DENIED = "Connector tokens can only use the connector tools";
  check("gate refuses a connector token on tables", gate["connector token on a table"] === DENIED);
  check("gate refuses a connector token on staff functions", gate["connector token on a staff function"] === DENIED);
  check("gate lets a connector token call connector tools", gate["connector token on a connector tool"] === "allowed");
  check("gate does not affect ordinary sign-ins", gate["ordinary sign-in on a staff function"] === "allowed");

  const setting = sql(`
select (select count(*) from pg_db_role_setting s join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
         where r.rolname = 'authenticator' and c = 'pgrst.db_pre_request=public.connector_gate') as gate_set,
       has_function_privilege('anon', 'public.connector_gate()', 'execute') as anon_x,
       has_function_privilege('authenticated', 'public.connector_gate()', 'execute') as auth_x,
       has_function_privilege('service_role', 'public.connector_gate()', 'execute') as svc_x,
       (select count(*) from public.notifications_queue where state = 'pending') as pending_notifications,
       (select count(*) from public.files where scan_status = 'pending' and created_at < now() - interval '1 hour') as stuck_scans`)[0];
  check("pgrst.db_pre_request is set on the authenticator role", Number(setting.gate_set) === 1);
  check("every API role can run the gate", setting.anon_x && setting.auth_x && setting.svc_x);
  check("no file has been waiting for its virus check for over an hour", Number(setting.stuck_scans) === 0, `${setting.stuck_scans} waiting`);

  // ── Storage round trip ────────────────────────────────────
  const secretRow = sql("select value from private.config where key = 'smoke_webhook_secret'")[0];
  if (!secretRow) {
    check("storage round trip (throwaway object)", false, "smoke_webhook_secret is not set up in private.config");
  } else {
    const r = await http(`${API}/functions/v1/smoke-check`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secretRow.value },
      body: "{}",
    });
    let steps = {};
    try {
      steps = JSON.parse(r.text).steps ?? {};
    } catch {
      /* reported below */
    }
    check("storage: upload, signed download, identical bytes, removal", r.status === 200 && Object.values(steps).length === 5 && Object.values(steps).every(Boolean),
      `HTTP ${r.status}; ${Object.entries(steps).map(([k, v]) => `${k}=${v ? "ok" : "FAILED"}`).join(" ")}`);
  }
  const bad = await http(`${API}/storage/v1/object/sign/job-zips/none.zip?token=abc`);
  check("storage refuses a made-up signed link", bad.status === 400, `HTTP ${bad.status}`);

  // ── Function secrets: names, and digests against the local test values ──
  const secrets = parseJson(cli(`secrets list --project-ref ${REF} -o json`).out) ?? [];
  const names = secrets.map((s) => s.name);
  check("the expected function secrets exist", ["RESEND_API_KEY", "NOTIFY_WEBHOOK_SECRET", "SCAN_WEBHOOK_SECRET", "SMOKE_WEBHOOK_SECRET"].every((n) => names.includes(n)),
    ["RESEND_API_KEY", "NOTIFY_WEBHOOK_SECRET", "SCAN_WEBHOOK_SECRET", "SMOKE_WEBHOOK_SECRET"].filter((n) => !names.includes(n)).join(", ") || undefined);
  check("no local-only secret is on the live project", !names.includes("NOTIFY_TRANSPORT") && !names.includes("SCANNER_PROVIDER"));
  const envFile = join(process.cwd(), "supabase", "functions", ".env");
  if (existsSync(envFile)) {
    const local = new Set(
      readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => createHash("sha256").update(l.slice(l.indexOf("=") + 1)).digest("hex")),
    );
    const matching = secrets.filter((s) => local.has(String(s.value).toLowerCase())).map((s) => s.name);
    check("no live secret equals a local test value", matching.length === 0, matching.join(", "));
  } else {
    check("no live secret equals a local test value", false, "supabase/functions/.env not found, so the comparison could not run");
  }

  // ── Both scheduled sweeps ─────────────────────────────────
  const before = Number(sql("select coalesce(max(id), 0) as m from net._http_response")[0].m);
  sql(`select private.call_scan_function('{"type":"SWEEP"}'::jsonb); select private.call_notify_function('{"mode":"sweep"}'::jsonb);`);
  let fresh = [];
  for (let i = 0; i < 12 && fresh.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    fresh = sql(`select status_code from net._http_response where id > ${before} order by id`);
  }
  check("file-scan and notification sweeps both return 200", fresh.length >= 2 && fresh.every((r) => Number(r.status_code) === 200), fresh.map((r) => r.status_code).join(", ") || "no response");

  // ── Backups ───────────────────────────────────────────────
  const backups = parseJson(cli(`backups list --project-ref ${REF}`).out);
  const latest = backups?.backups?.filter((b) => b.status === "COMPLETED").map((b) => Date.parse(b.inserted_at)).sort((a, b) => b - a)[0];
  const hours = latest ? Math.round((Date.now() - latest) / 3_600_000) : null;
  check("a completed database backup exists from the last 36 hours", hours !== null && hours <= 36, hours === null ? "none found" : `${hours} hours old`);
}

try {
  await run();
} catch (e) {
  check("the smoke test itself ran to the end", false, e.message);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
if (failed.length) {
  console.log("FAILED:\n" + failed.map((f) => `  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`).join("\n"));
  process.exit(1);
}
