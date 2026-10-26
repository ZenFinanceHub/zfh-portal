import type { Json } from "@/lib/database.types";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/**
 * Answers are stored as { "value": … }. Shown to staff as plain text:
 * yes/no as Yes/No, amounts as £1,234.56, dates as DD/MM/YYYY.
 */
export function formatAnswer(answer: Json, questionType: string | null): string {
  const value =
    answer && typeof answer === "object" && !Array.isArray(answer) && "value" in answer ? answer.value : answer;

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === "yes" || value === "no") return value === "yes" ? "Yes" : "No";
  if (questionType === "amount" && (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))))) {
    return gbp.format(Number(value));
  }
  if (questionType === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}
