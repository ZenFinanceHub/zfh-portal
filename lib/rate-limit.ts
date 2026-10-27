// Friendly wording for a refused attempt. The same words are used whatever the attempt was about, so they never
// reveal whether an email address belongs to an account.

export type Limited = { allowed: boolean; retry_after: number };

export function asLimited(value: unknown): Limited | null {
  const v = value as Partial<Limited> | null;
  return v && typeof v.allowed === "boolean" ? { allowed: v.allowed, retry_after: Number(v.retry_after) || 60 } : null;
}

/** "about 12 minutes" / "about a minute" */
export function waitPhrase(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes === 1) return "about a minute";
  if (minutes < 90) return `about ${minutes} minutes`;
  return `about ${Math.ceil(minutes / 60)} hours`;
}
