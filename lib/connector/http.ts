// Shared bits of the Claude connector's HTTP surface: where it lives and how it asks for a sign-in.
// The connector speaks MCP over HTTP at /api/mcp and signs people in through Supabase's OAuth server.

export const MCP_PATH = "/api/mcp";
export const METADATA_PATH = "/.well-known/oauth-protected-resource";

export function resourceUrl(origin: string) {
  return `${origin}${MCP_PATH}`;
}

/** Where a client finds out which authorisation server to use (RFC 9728). */
export function metadataUrl(origin: string) {
  return `${origin}${METADATA_PATH}${MCP_PATH}`;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "ZenFinanceHub portal",
  };
}

export const METADATA_HEADERS = {
  "content-type": "application/json",
  "cache-control": "public, max-age=300",
  "access-control-allow-origin": "*",
};

/** A 401 that tells the caller where to start signing in. Never says why beyond the OAuth error name. */
export function unauthorised(origin: string, description = "Sign in again to continue.") {
  return Response.json(
    { error: "invalid_token", error_description: description },
    {
      status: 401,
      headers: {
        "www-authenticate": `Bearer error="invalid_token", error_description="${description}", resource_metadata="${metadataUrl(origin)}"`,
        "cache-control": "no-store",
      },
    },
  );
}

export function forbidden(description: string) {
  return Response.json(
    { error: "insufficient_scope", error_description: description },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/i.exec(header);
  return match ? match[1] : null;
}
