import { z } from "zod";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** "£1,234.5" / "1234.50" -> 1234.5, or null if it isn't a sensible amount. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n <= 1_000_000_000 ? n : null;
}

export const formatAmount = (n: number) => gbp.format(n);

export type QuestionType = "text" | "yes_no" | "choice" | "date" | "amount";

/**
 * Turns what the person typed into the stored answer value, or an error message.
 * Stored as { "value": … }: text -> string, yes_no -> boolean, choice -> string,
 * date -> "YYYY-MM-DD", amount -> number of pounds.
 */
export function buildAnswer(
  type: QuestionType,
  raw: string,
  options: string[],
): { value: string | number | boolean } | { error: string } {
  const text = raw.trim();
  switch (type) {
    case "text": {
      const r = z.string().min(1).max(5000).safeParse(text);
      return r.success ? { value: r.data } : { error: text ? "That answer is too long." : "Please type your answer." };
    }
    case "yes_no":
      return text === "yes" || text === "no" ? { value: text === "yes" } : { error: "Please choose Yes or No." };
    case "choice":
      return options.includes(text) ? { value: text } : { error: "Please choose one of the options." };
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && !isNaN(Date.parse(text))
        ? { value: text }
        : { error: "Please enter a valid date." };
    case "amount": {
      const n = parseAmount(text);
      return n === null ? { error: "Please enter an amount in pounds, for example 1,250.00." } : { value: n };
    }
  }
}

/** The text to show in the input for a stored answer value. */
export function answerToInput(type: QuestionType, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (type === "yes_no") return value === true ? "yes" : value === false ? "no" : "";
  if (type === "amount" && typeof value === "number") return formatAmount(value);
  return String(value);
}

export const messageSchema = z.object({
  body: z.string().trim().min(1, "Please write a message first.").max(5000, "That message is too long."),
});
