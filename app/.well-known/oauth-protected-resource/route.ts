import { METADATA_HEADERS, protectedResourceMetadata } from "@/lib/connector/http";

// Public: says which authorisation server signs people in for the connector. Contains no personal data.
export function GET(req: Request) {
  return new Response(JSON.stringify(protectedResourceMetadata(new URL(req.url).origin)), { headers: METADATA_HEADERS });
}
