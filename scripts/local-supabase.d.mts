import type { SupabaseClient } from "@supabase/supabase-js";

export function getLocal(): { apiUrl: string; anonKey: string; serviceKey: string };
export function adminClient(local?: ReturnType<typeof getLocal>): SupabaseClient;
export function ensureUser(
  admin: SupabaseClient,
  user: { email: string; staff?: boolean },
): Promise<string>;
export function ensureClientOwner(
  admin: SupabaseClient,
  userId: string,
  clientName: string,
): Promise<string>;
export function magicLinkToken(admin: SupabaseClient, email: string): Promise<string>;
