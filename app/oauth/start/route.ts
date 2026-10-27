import { NextResponse, type NextRequest } from "next/server";
import { isStaff, LOGIN_PATH, staffMfaRedirect } from "@/lib/auth/routing";
import { consentPath, isAuthorizationId, RETURN_TO_COOKIE } from "@/lib/connector/return-to";
import { createClient } from "@/lib/supabase/server";

// Where the consent page sends someone who is not ready to approve (not signed in, or no authenticator code yet).
// It remembers the request in a short-lived cookie, takes them to sign in, and the portal brings them back.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const id = searchParams.get("authorization_id");
  if (!isAuthorizationId(id)) return NextResponse.redirect(`${origin}/oauth/consent`);

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  let next = LOGIN_PATH;
  if (data.user) {
    next = (await isStaff(supabase, data.user.id)) ? ((await staffMfaRedirect(supabase)) ?? consentPath(id)) : consentPath(id);
  }

  const res = NextResponse.redirect(`${origin}${next}`);
  res.cookies.set(RETURN_TO_COOKIE, encodeURIComponent(consentPath(id)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
