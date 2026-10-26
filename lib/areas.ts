// The two areas of the business. The database derives `jobs.area` from `service` (and enforces access by
// it); this file is only for labels and for filtering what to *show*. It never decides who can see what.

export const AREAS = ["accounting", "finance"] as const;
export type Area = (typeof AREAS)[number];

/** What people are told. Clients and staff both see "Business Finance". */
export const AREA_LABELS: Record<Area, string> = {
  accounting: "Accounting",
  finance: "Business Finance",
};

export const isArea = (v: unknown): v is Area => typeof v === "string" && (AREAS as readonly string[]).includes(v);

/** Same rule as the database function area_of_service(); used to hide choices a person can't use. */
export const areaOfService = (service: string): Area =>
  service === "finance_application" || service === "regulated_referral" ? "finance" : "accounting";

/** The area to show: the requested one if it's available, otherwise the first available. */
export function resolveArea(requested: string | undefined, available: readonly Area[]): Area {
  return isArea(requested) && available.includes(requested) ? requested : (available[0] ?? "accounting");
}

/** Keep AREAS order, drop duplicates and anything unexpected. */
export const orderedAreas = (found: Iterable<string>): Area[] => {
  const set = new Set(found);
  return AREAS.filter((a) => set.has(a));
};

export const LAST_AREA_KEY = "zfh-last-area";
