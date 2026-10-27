import { METADATA_HEADERS, protectedResourceMetadata } from "@/lib/connector/http";

// The same document at the path MCP clients ask for when the server is /api/mcp.
export function GET(req: Request) {
  return new Response(JSON.stringify(protectedResourceMetadata(new URL(req.url).origin)), { headers: METADATA_HEADERS });
}
