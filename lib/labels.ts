// Display text for stored values, and DD/MM/YYYY dates.
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  limited_company: "Limited company",
  sole_trader: "Sole trader",
  individual: "Individual",
  partnership: "Partnership",
  llp: "LLP",
  other: "Other",
};

export const CLIENT_STATUS_LABELS: Record<string, string> = {
  prospect: "Prospect",
  active: "Active",
  former: "Former",
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  contributor: "Contributor",
};

export const STAGE_LABELS: Record<string, string> = {
  waiting_on_client: "Waiting on you",
  in_progress: "In progress",
  ready_to_review: "Ready to review",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** "2026-03-31" -> "31/03/2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
