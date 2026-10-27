import { z } from "zod";

const minutes = (what: string) =>
  z.coerce
    .number({ error: `${what} must be a number of minutes.` })
    .int(`${what} must be a whole number of minutes.`)
    .min(1, `${what} must be at least 1 minute.`)
    .max(240, `${what} can be at most 240 minutes.`);

const time = (what: string) => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${what} must be a time, like 08:00.`);

/** "7, 3, 1" -> [7, 3, 1] (largest first, no repeats). */
const reminderDays = z.string().transform((value, ctx) => {
  const parts = value.split(/[\s,]+/).filter(Boolean);
  const days = parts.map(Number);
  if (parts.length < 1 || parts.length > 6 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 60)) {
    ctx.addIssue({ code: "custom", message: "Reminder days must be 1 to 6 whole numbers between 1 and 60, like 7, 3, 1." });
    return z.NEVER;
  }
  return [...new Set(days)].sort((a, b) => b - a);
});

export const notificationSettingsSchema = z
  .object({
    staff_batch_minutes: minutes("The wait before staff are emailed"),
    client_bundle_minutes: minutes("The wait before clients are emailed"),
    quiet_start: time("Quiet hours start"),
    quiet_end: time("Quiet hours end"),
    urgent_approvals: z.boolean(),
    urgent_lender_consents: z.boolean(),
    urgent_finance_activity: z.boolean(),
    digest_enabled: z.boolean(),
    digest_time: time("The digest time"),
    fallback_email: z.email("The fallback address must be a valid email address.").max(254),
    reminders_enabled: z.boolean(),
    reminder_days: reminderDays,
    bank_holiday_region: z.enum(["scotland", "england_wales"]),
  })
  .refine((v) => v.quiet_start > v.quiet_end, {
    path: ["quiet_start"],
    message: "Quiet hours run overnight: the start (evening) must be later than the end (morning).",
  });

export const holidaySchema = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  name: z.string().trim().min(1, "Give the day a name.").max(80, "That name is too long."),
});
