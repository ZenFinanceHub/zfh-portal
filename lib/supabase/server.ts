import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "@/lib/database.types";

async function build(extraHeaders?: Record<string, string>) {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: extraHeaders ? { headers: extraHeaders } : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component: the proxy refreshes the session instead.
          }
        },
      },
    },
  );
}

export async function createClient() {
  return build();
}

/**
 * For server actions that record evidence (e.g. consents): the database stores the caller's IP and
 * browser from the request headers, so pass the real visitor's through rather than this server's.
 * (The host, Vercel, sets x-forwarded-for itself, so a visitor cannot choose it.)
 */
export async function createClientForwardingVisitor() {
  const h = await headers();
  const forwarded: Record<string, string> = {};
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ua = h.get("user-agent");
  if (ip) forwarded["x-forwarded-for"] = ip;
  if (ua) forwarded["user-agent"] = ua;
  return build(forwarded);
}
