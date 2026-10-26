// Runs tests/rls/rls_test.sql inside a transaction that is rolled back, so the fixtures never stay in the DB.
//   npm run test:rls         -> LOCAL Supabase database
//   npm run test:rls:remote  -> database in SUPABASE_REMOTE_DB_URL (set in your own terminal for that run only)
// Uses psql if it is on PATH, otherwise the psql inside the local Supabase db container via docker.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const remote = process.argv.includes("--remote");

let dbUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (remote) {
  dbUrl = process.env.SUPABASE_REMOTE_DB_URL ?? "";
  if (!dbUrl) {
    console.error("SUPABASE_REMOTE_DB_URL is not set. Set it in your terminal for this run only; it is never stored in a file.");
    process.exit(1);
  }
}

let sql = readFileSync(join(root, "tests", "rls", "rls_test.sql"), "utf8");
// psql on Windows has no /dev/null; NUL is the equivalent.
if (process.platform === "win32") sql = sql.replaceAll("\\o /dev/null", "\\o NUL");
const input = `begin;\n${sql}\nrollback;\n`;

function has(cmd, args) {
  return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { input, stdio: ["pipe", "inherit", "inherit"] });
  if (res.error) {
    console.error(`Could not run ${cmd}: ${res.error.message}`);
    process.exit(1);
  }
  return res.status ?? 1;
}

if (remote) console.log("Running RLS tests against the REMOTE database (rolled back at the end)…");

let status;
if (has("psql", ["--version"])) {
  status = run("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"]);
} else if (has("docker", ["--version"])) {
  const ps = spawnSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
  const container = (ps.stdout ?? "").split(/\r?\n/).find((n) => n.startsWith("supabase_db_"));
  if (!container) {
    console.error("No running supabase_db_* container found. Run `npx supabase start` first.");
    process.exit(1);
  }
  const psqlArgs = remote
    ? [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"] // the container's psql connects out to the remote DB
    : ["-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"];
  status = run("docker", ["exec", "-i", container, "psql", ...psqlArgs]);
} else {
  console.error("Neither psql nor docker is available on PATH.");
  process.exit(1);
}
process.exit(status);
