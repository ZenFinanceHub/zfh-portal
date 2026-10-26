// Upload rules. These mirror the `client-files` bucket (25 MB, allowed types) set in migration 0001,
// so people get a friendly message here instead of a storage error.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Some phones give HEIC photos an empty type; fall back to the extension.
const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const ACCEPT_ATTRIBUTE = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.csv,.xls,.xlsx,.doc,.docx,image/*";

const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** The MIME type to send, or null if this kind of file isn't allowed. */
export function uploadMimeType(file: { name: string; type: string }): string | null {
  if (file.type && ALLOWED_MIME.has(file.type)) return file.type;
  const fromExtension = EXTENSION_MIME[extensionOf(file.name)];
  return !file.type || file.type === "application/octet-stream" ? (fromExtension ?? null) : null;
}

/** A plain-English reason the file can't be sent, or null if it's fine. */
export function checkFile(file: { name: string; type: string; size: number }): string | null {
  if (file.size === 0) return `${file.name} is empty, so we haven't added it.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is larger than 25 MB. Please send a smaller file or split it up.`;
  if (!uploadMimeType(file)) {
    return `${file.name} isn't a type we can accept. Please send a PDF, photo, spreadsheet or Word document.`;
  }
  return null;
}

/** Lower-case, letters/numbers/dot/dash only, so the stored path is always safe. */
export function safeFilename(name: string): string {
  const ext = extensionOf(name);
  const base = name.slice(0, name.length - (ext ? ext.length + 1 : 0));
  const clean = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/_/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .toLowerCase();
  const stem = clean(base).slice(0, 80) || "file";
  const safeExt = clean(ext).slice(0, 10);
  return safeExt ? `${stem}.${safeExt}` : stem;
}

export const SCAN_LABELS_CLIENT: Record<string, string> = {
  pending: "Received — being checked",
  clean: "Received — checked",
  error: "Received — being checked",
  infected: "We couldn't accept this file. Please send a different one.",
};

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
