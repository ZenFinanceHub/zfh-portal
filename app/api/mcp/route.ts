import { createClient } from "@supabase/supabase-js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bearerToken, forbidden, unauthorised } from "@/lib/connector/http";
import { buildServer } from "@/lib/connector/tools";
import type { Database } from "@/lib/database.types";

// The Claude connector: a remote MCP server (streamable HTTP, no sessions). Claude signs the staff member in through
// Supabase's OAuth server; each call here runs as that person, so row-level security and the area rules apply.
// There is no service role. The token is used only against our own Supabase project and is never logged or passed on.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function handle(req: Request) {
  const origin = new URL(req.url).origin;
  const token = bearerToken(req);
  if (!token) return unauthorised(origin, "Sign in to continue.");

  const db = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // 1. The token must be a genuine, unexpired Supabase token for a connector (OAuth) session, issued by our project.
  const { data, error } = await db.auth.getClaims(token);
  const claims = data?.claims;
  const aud = claims?.aud as string | string[] | undefined;
  if (
    error ||
    !claims ||
    claims.iss !== `${SUPABASE_URL}/auth/v1` ||
    !(aud === "authenticated" || (Array.isArray(aud) && aud.includes("authenticated"))) ||
    typeof claims.client_id !== "string"
  ) {
    return unauthorised(origin);
  }

  // 2. The database decides whether this person may use the connector right now (staff, authenticator, fresh grant).
  //    MFA cannot be read from the token (Supabase marks connector tokens aal1), so the approval, which can only be
  //    made with an authenticator code, is what counts. No approval, or one older than 7 days: 401.
  const { data: status } = await db.rpc("connector_check");
  if (status !== "ok") {
    if (status === "expired" || status === "revoked") await db.rpc("connector_expire");
    if (status === "not_staff" || status === "no_authenticator") {
      return forbidden("The connector is for ZenFinanceHub staff with an authenticator set up.");
    }
    return unauthorised(origin, "Approve access again in the portal to continue.");
  }

  const server = buildServer(db);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
