import { z } from "zod";

export const ENTITY_TYPES = [
  "limited_company",
  "sole_trader",
  "individual",
  "partnership",
  "llp",
  "other",
] as const;

export const CLIENT_STATUSES = ["prospect", "active", "former"] as const;

export const CONTACT_ROLES = ["owner", "contributor"] as const;

// Optional text: blank becomes null.
const optionalText = (max: number, pattern?: RegExp, patternMessage?: string) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .refine((v) => v === "" || !pattern || pattern.test(v), patternMessage ?? "Check this value")
    .transform((v) => (v === "" ? null : v));

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Enter the client's name").max(200, "Must be 200 characters or fewer"),
  entity_type: z.enum(ENTITY_TYPES, "Choose a type"),
  company_number: optionalText(10, /^[A-Za-z0-9]+$/, "Letters and numbers only"),
  utr: optionalText(10, /^\d{10}$/, "A UTR is 10 digits"),
  xero_contact_id: optionalText(64),
  year_end: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date")
    .transform((v) => (v === "" ? null : v)),
  assigned_to: z
    .string()
    .trim()
    .refine((v) => v === "" || z.uuid().safeParse(v).success, "Choose a team member")
    .transform((v) => (v === "" ? null : v)),
  status: z.enum(CLIENT_STATUSES, "Choose a status"),
});

export type ClientInput = z.infer<typeof clientSchema>;

export const inviteContactSchema = z.object({
  client_id: z.uuid(),
  full_name: z.string().trim().min(1, "Enter their name").max(200, "Must be 200 characters or fewer"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254)),
  role: z.enum(CONTACT_ROLES, "Choose a role"),
});
