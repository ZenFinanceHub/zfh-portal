import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { adminClient, getLocal } from "../../scripts/local-supabase.mjs";

// `supabase start` does not serve the edge functions, and the export, job-zip, invite and smoke-check tests need them.
// Local kong answers 503 (or 500 just after the runtime is removed) for /functions/v1/* while nothing is serving.
// Unauthenticated, a running smoke-check answers 401, so any non-5xx status means the functions are up.
const EDGE_RUNTIME_CONTAINER = "supabase_edge_runtime_zfh-portal";

async function functionsUp(apiUrl: string) {
  try {
    const res = await fetch(`${apiUrl}/functions/v1/smoke-check`, { method: "POST", body: "{}" });
    return res.status < 500;
  } catch {
    return false;
  }
}

// Starts `supabase functions serve` unless it is already running. Returns a stopper, or null if we left it alone.
async function ensureFunctionsServed(apiUrl: string): Promise<(() => void) | null> {
  if (await functionsUp(apiUrl)) return null;
  const child: ChildProcess = spawn("npx supabase functions serve --env-file supabase/functions/.env", {
    shell: true,
    stdio: "ignore",
  });
  let exited = false;
  child.on("exit", () => (exited = true));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error("`supabase functions serve` exited early. Check supabase/functions/.env and that Docker is running.");
    if (await functionsUp(apiUrl)) return () => stopFunctions(child);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  stopFunctions(child);
  throw new Error("Edge functions did not start within 2 minutes.");
}

function stopFunctions(child: ChildProcess) {
  // npx runs under a shell on Windows, so kill the whole tree; the CLI leaves its container behind when killed.
  if (process.platform === "win32" && child.pid) spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: "ignore" });
  else child.kill();
  spawnSync(`docker rm -f ${EDGE_RUNTIME_CONTAINER}`, { shell: true, stdio: "ignore" });
}

// Every run creates its own throwaway staff accounts. Left alone they pile up in Settings → Staff
// until the page is too long for the tests to use, so retire the ones from earlier runs first.
// (Local Supabase only: adminClient() refuses anything that isn't 127.0.0.1.)
export default async function globalSetup() {
  const local = getLocal();
  const stopFunctionsIfWeStartedThem = await ensureFunctionsServed(local.apiUrl);
  const admin = adminClient(local);
  const { error } = await admin
    .from("profiles")
    .update({ is_staff: false, staff_role: null, staff_areas: [] })
    .like("email", "e2e.%@example.com")
    .eq("is_staff", true);
  if (error) throw new Error(`Could not tidy earlier test staff: ${error.message}`);

  // Sign-in and code attempts are counted per hour; start each run with clean counters so earlier runs can't block this one.
  const cleared = await admin.from("rate_limits").delete().neq("scope", "");
  if (cleared.error) throw new Error(`Could not reset the rate limit counters: ${cleared.error.message}`);

  // Playwright runs the returned function once the whole run is over.
  return () => stopFunctionsIfWeStartedThem?.();
}
