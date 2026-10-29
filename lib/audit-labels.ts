// Plain-English wording for audit log entries. The log holds ids, actions and counts only (never answers, file names
// or message text), so a label can only describe what happened, not what was said.

import { STAGE_LABELS } from "@/lib/labels";

export type AuditRow = {
  action: string;
  entity: string;
  meta: Record<string, unknown> | null;
};

/** The choices in the "What happened" filter: the stored action and how it reads. */
export const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "login", label: "Signed in" },
  { value: "file_download", label: "Downloaded a file" },
  { value: "job_zip_download", label: "Downloaded a job's documents" },
  { value: "lender_pack_download", label: "Downloaded a lender pack" },
  { value: "client_export", label: "Exported everything held on a client" },
  { value: "audit_export", label: "Exported the audit log" },
  { value: "insert", label: "Something was created or sent" },
  { value: "update", label: "Something was changed" },
  { value: "file_deleted_retention", label: "A file was deleted under retention" },
  { value: "staff_areas_changed", label: "A team member's areas changed" },
  { value: "notification_settings_changed", label: "Email rules changed" },
  { value: "privacy_notice_url_changed", label: "The privacy notice link changed" },
  { value: "bank_holiday_added", label: "A bank holiday was added" },
  { value: "bank_holiday_removed", label: "A bank holiday was removed" },
  { value: "connector_approved", label: "Claude was approved" },
  { value: "connector_revoked", label: "Claude was switched off" },
  { value: "connector_job_created", label: "Claude created a job" },
  { value: "connector_requests_added", label: "Claude added requests" },
  { value: "connector_message_sent", label: "Claude sent a client message" },
  { value: "connector_note_added", label: "Claude added an internal note" },
];

const SIMPLE: Record<string, string> = Object.fromEntries(
  ACTION_FILTERS.filter((a) => a.value !== "insert" && a.value !== "update").map((a) => [a.value, a.label]),
);

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export function describeAudit(row: AuditRow): string {
  const meta = row.meta ?? {};
  const count = typeof meta.count === "number" ? meta.count : typeof meta.rows === "number" ? meta.rows : undefined;
  if (row.action === "audit_export") return `Exported the audit log${count !== undefined ? ` (${count} entries)` : ""}`;
  if (row.action === "connector_requests_added") return `Claude added ${count ?? "some"} request${count === 1 ? "" : "s"}`;
  if (SIMPLE[row.action]) return SIMPLE[row.action];

  const status = str(meta.status);
  const kind = str(meta.kind);
  const created = row.action === "insert";
  switch (row.entity) {
    case "requests":
      if (created) return `Request created${kind ? ` (${kind})` : ""}`;
      return (
        {
          submitted: "Client submitted a request",
          accepted: "Request accepted",
          returned: "Request returned to the client",
          cancelled: "Request cancelled",
          open: "Request reopened",
        }[status ?? ""] ?? "Request changed"
      );
    case "responses":
      return "Client answered a question";
    case "files": {
      if (created) return str(meta.visibility) === "internal" ? "Internal document added" : "File uploaded";
      const scan = str(meta.scan_status);
      if (scan === "clean") return "File passed the virus check";
      if (scan === "infected") return "File failed the virus check";
      if (scan === "error") return "File check could not finish";
      return "File changed";
    }
    case "jobs": {
      if (created) return "Job created";
      const stage = str(meta.stage);
      if (stage) return `Job moved to "${STAGE_LABELS[stage] ?? stage}"`;
      return meta.finance_stage ? "Finance stage changed" : "Job changed";
    }
    case "consents":
      return "Client gave a consent";
    case "messages":
      return "Message or note added";
    default:
      return row.action.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
  }
}

/** Where in the business it happened, as the client sees it. */
export const AREA_NAMES: Record<string, string> = { accounting: "Accounting", finance: "Business Finance" };
