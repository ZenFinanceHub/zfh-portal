// The scanner behind a small interface, so the provider can be swapped without touching scan-file.
//   SCANNER_PROVIDER = 'none'   (default) basic checks only, no third party sees the file
//   SCANNER_PROVIDER = 'scanii' Scanii, London endpoint (needs SCANNER_API_KEY / SCANNER_API_SECRET)
//   SCANNER_PROVIDER = 'mock'   local testing only: basic checks plus the standard EICAR test string = infected

export const MAX_BYTES = 25 * 1024 * 1024;

export type ScanResult =
  | { status: "clean" }
  | { status: "infected" }
  // retry: true for failures worth trying again (provider down, timeout); false for a file that is simply not acceptable.
  | { status: "error"; retry: boolean };

export interface Scanner {
  scanFile(bytes: Uint8Array, meta: { name: string }): Promise<ScanResult>;
}

// ── Basic checks (the 'none' provider) ───────────────────────

type Kind = "pdf" | "jpeg" | "png" | "webp" | "heif" | "csv" | "docx" | "xlsx";

const EXTENSION_KIND: Record<string, Kind> = {
  pdf: "pdf",
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  heic: "heif",
  heif: "heif",
  csv: "csv",
  docx: "docx",
  xlsx: "xlsx",
};

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));

function startsWith(bytes: Uint8Array, sig: number[], at = 0) {
  return sig.every((b, i) => bytes[at + i] === b);
}

function indexOfAscii(haystack: Uint8Array, needle: string, from = 0): number {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = from; i <= haystack.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

const HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"];

/** What the bytes say the file really is, or null if it is not one of the allowed types. */
export function detectKind(bytes: Uint8Array): Kind | null {
  if (bytes.length === 0) return null;
  if (indexOfAscii(bytes.subarray(0, 1024), "%PDF-") !== -1) return "pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.includes(ascii(bytes, 8, 12))) return "heif";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // DOCX / XLSX are zip files. Look for their main part in the central directory at the end (and the start).
    const tail = bytes.subarray(Math.max(0, bytes.length - 512 * 1024));
    const head = bytes.subarray(0, Math.min(bytes.length, 8 * 1024));
    const has = (s: string) => indexOfAscii(tail, s) !== -1 || indexOfAscii(head, s) !== -1;
    if (has("vbaProject.bin")) return null; // macros do not belong in a plain document
    if (has("word/document.xml")) return "docx";
    if (has("xl/workbook.xml")) return "xlsx";
    return null;
  }
  // CSV is plain text: no NUL bytes and no stray control characters at the start.
  const sample = bytes.subarray(0, 8 * 1024);
  for (const b of sample) {
    if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) return null;
  }
  return "csv";
}

/** null = passed; otherwise the failing result. */
export function basicChecks(bytes: Uint8Array, name: string): ScanResult | null {
  if (bytes.length === 0) return { status: "error", retry: false };
  if (bytes.length > MAX_BYTES) return { status: "error", retry: false };
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const expected = EXTENSION_KIND[ext];
  if (!expected) return { status: "error", retry: false };
  // The real type must match the extension (and so be on the allowed list).
  if (detectKind(bytes) !== expected) return { status: "error", retry: false };
  return null;
}

const noneScanner: Scanner = {
  scanFile(bytes, meta) {
    return Promise.resolve(basicChecks(bytes, meta.name) ?? { status: "clean" });
  },
};

// ── Local testing: EICAR is the industry-standard harmless test string ──
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const mockScanner: Scanner = {
  scanFile(bytes, meta) {
    const failed = basicChecks(bytes, meta.name);
    if (failed) return Promise.resolve(failed);
    return Promise.resolve(indexOfAscii(bytes, EICAR) !== -1 ? { status: "infected" } : { status: "clean" });
  },
};

// ── Scanii (not selected today; to use it: create the account, set the secrets, set SCANNER_PROVIDER=scanii) ──
// The region is fixed in code so a typo in configuration can never send files to another region.
const SCANII_BASE = "https://api-eu2.scanii.com"; // London
const SCANII_TIMEOUT_MS = 60_000;

function scaniiScanner(): Scanner {
  const key = Deno.env.get("SCANNER_API_KEY");
  const secret = Deno.env.get("SCANNER_API_SECRET");
  return {
    async scanFile(bytes, meta) {
      // Still apply the basic checks first: they are free and catch mismatched types.
      const failed = basicChecks(bytes, meta.name);
      if (failed) return failed;
      if (!key || !secret) return { status: "error", retry: true };

      const auth = "Basic " + btoa(`${key}:${secret}`);
      const form = new FormData();
      form.append("file", new Blob([bytes]), "upload");
      try {
        const res = await fetch(`${SCANII_BASE}/v2.2/files`, {
          method: "POST",
          headers: { Authorization: auth },
          body: form,
          signal: AbortSignal.timeout(SCANII_TIMEOUT_MS),
        });
        if (!res.ok) return { status: "error", retry: true };
        const body = await res.json();
        // Remove Scanii's record of the scan too (the content itself is deleted by Scanii after analysis).
        if (typeof body.id === "string") {
          fetch(`${SCANII_BASE}/v2.2/files/${encodeURIComponent(body.id)}`, {
            method: "DELETE",
            headers: { Authorization: auth },
          }).catch(() => {});
        }
        return Array.isArray(body.findings) && body.findings.length > 0
          ? { status: "infected" }
          : { status: "clean" };
      } catch {
        return { status: "error", retry: true };
      }
    },
  };
}

export function getScanner(): Scanner {
  const provider = (Deno.env.get("SCANNER_PROVIDER") ?? "none").toLowerCase();
  if (provider === "scanii") return scaniiScanner();
  if (provider === "mock") {
    // Never on the hosted project: the mock is for local tests only.
    if ((Deno.env.get("SUPABASE_URL") ?? "").startsWith("https://")) return noneScanner;
    return mockScanner;
  }
  return noneScanner;
}
