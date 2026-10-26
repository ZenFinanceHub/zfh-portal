// Runs tests/rls/rls_test.sql against the LOCAL Supabase database inside a
// transaction that is rolled back, so the fixtures never stay in the DB.
// Uses psql if it is on PATH, otherwise the local Supabase db container via docker.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

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

let status;
if (has("psql", ["--version"])) {
  status = run("psql", [DB_URL, "-X", "-v", "ON_ERROR_STOP=1"]);
} else if (has("docker", ["--version"])) {
  const ps = spawnSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
  const container = (ps.stdout ?? "").split(/\r?\n/).find((n) => n.startsWith("supabase_db_"));
  if (!container) {
    console.error("No running supabase_db_* container found. Run `npx supabase start` first.");
    process.exit(1);
  }
  status = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"]);
} else {
  console.error("Neither psql nor docker is available on PATH.");
  process.exit(1);
}

process.exit(status);
