import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isStaff, MFA_ENROL_PATH, MFA_VERIFY_PATH } from "@/lib/auth/routing";
import { createClient } from "@/lib/supabase/server";

// Landing point for the magic link. Supports the PKCE `code` flow (links sent
// from the login form) and `token_hash` (email templates / local test sign-in).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const fail = () => NextResponse.redirect(`${origin}/auth/login?error=expired`);

  const supabase = await createClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  let error;
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else {
    return fail();
  }
  if (error) return fail();

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return fail();

  // One audit entry per successful login.
  await supabase.rpc("log_event", { p_action: "login", p_entity: "profiles", p_entity_id: user.id });

  if (await isStaff(supabase, user.id)) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const next = factors?.totp?.length ? MFA_VERIFY_PATH : MFA_ENROL_PATH;
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/admin`);
  }
  return NextResponse.redirect(`${origin}/`);
}
