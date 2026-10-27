import { NextResponse, type NextRequest } from "next/server";
import { AREA_NAMES, describeAudit } from "@/lib/audit-labels";
import { auditArgs, parseAuditFilters } from "@/lib/audit-query";
import { createClient } from "@/lib/supabase/server";

// CSV download of the audit log with the page's filters. Admin only (the database checks), and the export is itself
// recorded: if it cannot be recorded, nothing is handed over.
const MAX_ROWS = 20000;
const PAGE = 1000;

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));

// A cell that starts with = + - or @ can run as a formula when opened in a spreadsheet; a leading apostrophe stops that.
function cell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const filters = parseAuditFilters(Object.fromEntries(request.nextUrl.searchParams));
  const supabase = await createClient();

  const lines = [["When", "Who", "What happened", "Client", "Area", "IP address"].map(cell).join(",")];
  let rowCount = 0;
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await supabase.rpc("admin_audit", auditArgs(filters, PAGE, offset));
    if (error) return new NextResponse("Not allowed.", { status: 403, headers: { "cache-control": "no-store" } });
    for (const r of data ?? []) {
      rowCount++;
      lines.push(
        [
          when(r.created_at),
          r.actor_name ?? "The system",
          describeAudit({ action: r.action, entity: r.entity, meta: r.meta as Record<string, unknown> | null }),
          r.client_name ?? "",
          r.area ? (AREA_NAMES[r.area] ?? r.area) : "",
          r.ip ?? "",
        ]
          .map(cell)
          .join(","),
      );
    }
    if ((data?.length ?? 0) < PAGE) break;
  }

  const { page: _page, ...applied } = filters;
  void _page;
  const { error: logError } = await supabase.rpc("log_audit_export", { p_rows: rowCount, p_filters: applied });
  if (logError) return new NextResponse("Something went wrong.", { status: 500, headers: { "cache-control": "no-store" } });

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
