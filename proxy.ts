import { NextResponse, type NextRequest } from "next/server";
import { isStaff, LOGIN_PATH, MFA_ENROL_PATH, MFA_VERIFY_PATH } from "@/lib/auth/routing";
import { MCP_PATH } from "@/lib/connector/http";
import { isSafeReturnTo, RETURN_TO_COOKIE } from "@/lib/connector/return-to";
import { updateSession } from "@/lib/supabase/middleware";

const isDev = process.env.NODE_ENV !== "production";

function buildCsp(nonce: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseUrl}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function redirectTo(request: NextRequest, path: string, from: NextResponse, csp: string) {
  const res = NextResponse.redirect(new URL(path, request.url));
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

// Next.js 16 renamed the `middleware` file convention to `proxy`.
export async function proxy(request: NextRequest) {
  // The Claude connector signs in with a bearer token, not a cookie, and the discovery documents are public.
  // The connector checks who is calling itself (see app/api/mcp/route.ts).
  const first = request.nextUrl.pathname;
  if (first === MCP_PATH || first.startsWith("/.well-known/")) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const { response, supabase, claims } = await updateSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", csp);

  const path = request.nextUrl.pathname;
  if (path === "/auth" || path.startsWith("/auth/")) return response;
  // The connector's consent pages handle sign-in themselves so the request is not lost on the way.
  if (path === "/oauth/start" || path === "/oauth/consent") return response;

  // Everything else needs a session.
  if (!claims) return redirectTo(request, LOGIN_PATH, response, csp);

  // Staff area: staff only, and only once they have passed TOTP (aal2).
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!(await isStaff(supabase, claims.sub))) return redirectTo(request, "/", response, csp);
    if (claims.aal !== "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const next = factors?.totp?.length ? MFA_VERIFY_PATH : MFA_ENROL_PATH;
      return redirectTo(request, next, response, csp);
    }
    // Someone who came from Claude to approve the connector goes back to that screen once signed in.
    const wanted = request.cookies.get(RETURN_TO_COOKIE)?.value;
    if (path === "/admin" && wanted) {
      const target = decodeURIComponent(wanted);
      const res = isSafeReturnTo(target) ? redirectTo(request, target, response, csp) : response;
      res.cookies.delete(RETURN_TO_COOKIE);
      return res;
    }
  }

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
