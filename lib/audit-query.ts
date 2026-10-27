import { z } from "zod";

// The audit page's filters live in the web address (they are choices, ids and dates: nothing personal).
const optionalUuid = z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional());
const optionalDate = z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

export const auditFilterSchema = z.object({
  client: optionalUuid,
  actor: optionalUuid,
  action: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[a-z_]{2,60}$/).optional()),
  area: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["accounting", "finance"]).optional()),
  from: optionalDate,
  to: optionalDate,
  page: z.preprocess((v) => (v === "" || v === undefined ? 1 : Number(v)), z.number().int().min(1).max(10000)),
});

export type AuditFilters = z.infer<typeof auditFilterSchema>;

export function parseAuditFilters(params: Record<string, string | string[] | undefined>): AuditFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = auditFilterSchema.safeParse(flat);
  return parsed.success ? parsed.data : { page: 1 };
}

export const PAGE_SIZE = 50;

/** The arguments for public.admin_audit(). */
export function auditArgs(f: AuditFilters, limit: number, offset: number) {
  return {
    p_client: f.client,
    p_actor: f.actor,
    p_action: f.action,
    p_area: f.area,
    p_from: f.from,
    p_to: f.to,
    p_limit: limit,
    p_offset: offset,
  };
}
