import { z } from "zod";
import { PARTNER_FIRM_MESSAGE, PARTNER_FIRM_PATTERN } from "@/lib/consents";

export const REQUEST_KINDS = ["upload", "question", "approval", "consent"] as const;
export const QUESTION_TYPES = ["text", "yes_no", "choice", "date", "amount"] as const;
export const CONSENT_TYPES = ["lender_share", "regulated_referral", "engagement_letter"] as const;

export const KIND_LABELS: Record<string, string> = {
  upload: "Upload",
  question: "Question",
  approval: "Approval",
  consent: "Consent",
};
export const QUESTION_TYPE_LABELS: Record<string, string> = {
  text: "Free text",
  yes_no: "Yes / no",
  choice: "Choice",
  date: "Date",
  amount: "Amount (£)",
};
export const CONSENT_TYPE_LABELS: Record<string, string> = {
  lender_share: "Share with lenders",
  regulated_referral: "Regulated referral",
  engagement_letter: "Engagement letter",
};

/** The fields a request and a template blueprint have in common. Cross-field rules live here. */
const requestShape = {
  kind: z.enum(REQUEST_KINDS, "Choose a kind"),
  title: z.string().trim().min(1, "Enter a title").max(200, "Must be 200 characters or fewer"),
  help_text: z.string().trim().max(1000, "Must be 1,000 characters or fewer").nullish(),
  question_type: z.enum(QUESTION_TYPES).nullish(),
  options: z.array(z.string().trim().min(1).max(200)).max(20).nullish(),
  consent_type: z.enum(CONSENT_TYPES).nullish(),
  // The firm a regulated referral introduces the client to. Required for that consent (checked below) and nothing else.
  partner_firm: z.string().trim().max(120, "Must be 120 characters or fewer").nullish(),
};

type Shape = {
  kind: (typeof REQUEST_KINDS)[number];
  question_type?: string | null;
  options?: string[] | null;
  consent_type?: string | null;
  partner_firm?: string | null;
};

const isReferral = (v: Shape) => v.kind === "consent" && v.consent_type === "regulated_referral";

function crossChecks(v: Shape, ctx: z.RefinementCtx) {
  if (v.kind === "question" && !v.question_type) {
    ctx.addIssue({ code: "custom", path: ["question_type"], message: "Choose a question type" });
  }
  if (v.kind === "question" && v.question_type === "choice" && (v.options?.length ?? 0) < 2) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least two choices" });
  }
  if (v.kind === "consent" && !v.consent_type) {
    ctx.addIssue({ code: "custom", path: ["consent_type"], message: "Choose a consent type" });
  }
}

/** A request on a job must name the firm for a regulated referral. (A template blueprint cannot: staff add the firm later.) */
function firmCheck(v: Shape, ctx: z.RefinementCtx) {
  if (isReferral(v) && !PARTNER_FIRM_PATTERN.test(v.partner_firm ?? "")) {
    ctx.addIssue({ code: "custom", path: ["partner_firm"], message: PARTNER_FIRM_MESSAGE });
  }
}

/** Keeps only the fields that make sense for the kind, so stored data stays tidy. */
function tidy<T extends Shape & { help_text?: string | null }>(v: T, keepFirm: boolean) {
  const isQuestion = v.kind === "question";
  return {
    ...v,
    help_text: v.help_text || null,
    question_type: isQuestion ? (v.question_type ?? null) : null,
    options: isQuestion && v.question_type === "choice" ? (v.options ?? null) : null,
    consent_type: v.kind === "consent" ? (v.consent_type ?? null) : null,
    partner_firm: keepFirm && isReferral(v) ? v.partner_firm || null : null,
  };
}

// ── A request on a job ───────────────────────────────────────
export const requestSchema = z
  .object({
    ...requestShape,
    due_date: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date")
      .transform((v) => (v === "" ? null : v)),
  })
  .superRefine(crossChecks)
  .superRefine(firmCheck)
  .transform((v) => tidy(v, true));

// ── A blueprint in a template ────────────────────────────────
export const blueprintSchema = z
  .object({
    ...requestShape,
    due_offset_days: z.number().int("Whole days only").min(0, "Can't be negative").max(365, "Up to 365 days").nullish(),
  })
  .superRefine(crossChecks)
  .transform((v) => {
    const t = tidy(v, false);
    // Stored JSON omits empty keys, matching the seeded templates.
    return Object.fromEntries(Object.entries(t).filter(([, val]) => val !== null && val !== undefined));
  });

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200, "Must be 200 characters or fewer"),
  description: z
    .string()
    .trim()
    .max(1000, "Must be 1,000 characters or fewer")
    .transform((v) => (v === "" ? null : v)),
  active: z.boolean(),
  requests: z.array(blueprintSchema).max(60, "Up to 60 requests"),
});

/** One choice per line -> array. */
export const parseOptions = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export const noteSchema = z.object({
  body: z.string().trim().min(1, "Write a note first").max(5000, "Must be 5,000 characters or fewer"),
});

export const returnSchema = z.object({
  reason: z.string().trim().min(1, "Say what needs changing").max(1000, "Must be 1,000 characters or fewer"),
});

export const SERVICES = [
  "year_end",
  "self_assessment",
  "bookkeeping",
  "payroll",
  "vat",
  "property",
  "onboarding",
  "finance_application",
  "regulated_referral",
  "other",
] as const;

export const SERVICE_LABELS: Record<string, string> = {
  year_end: "Year-end accounts",
  self_assessment: "Self assessment",
  bookkeeping: "Bookkeeping",
  payroll: "Payroll",
  vat: "VAT",
  property: "Property",
  onboarding: "Onboarding",
  finance_application: "Finance application",
  regulated_referral: "Regulated referral",
  other: "Other",
};

export const STAGES = ["waiting_on_client", "in_progress", "ready_to_review", "completed", "cancelled"] as const;
export const FINANCE_STAGES = ["gathering", "submitted", "credit_decision", "offer", "completed", "declined"] as const;
export const FINANCE_STAGE_LABELS: Record<string, string> = {
  gathering: "Gathering information",
  submitted: "Submitted to lender",
  credit_decision: "Credit decision",
  offer: "Offer",
  completed: "Completed",
  declined: "Declined",
};

export const newJobSchema = z.object({
  client_id: z.uuid(),
  template_id: z.uuid("Choose a template"),
  title: z.string().trim().min(1, "Enter a title").max(200, "Must be 200 characters or fewer"),
  service: z.enum(SERVICES, "Choose a service"),
  period_end: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date")
    .transform((v) => (v === "" ? null : v)),
  due_date: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date")
    .transform((v) => (v === "" ? null : v)),
  assigned_to: z
    .string()
    .trim()
    .refine((v) => v === "" || z.uuid().safeParse(v).success, "Choose a team member")
    .transform((v) => (v === "" ? null : v)),
  contributors: z.array(z.uuid()),
});
