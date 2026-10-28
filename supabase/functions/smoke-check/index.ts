// Live smoke test for file storage, called by scripts/smoke-live.mjs with a shared secret (the script reads it from the
// database, so it never appears on screen). It uploads a tiny throwaway object to a test-only path in the zip bucket,
// reads it back through a signed link exactly as a download would, checks it is identical, then deletes it.
// It touches no client file, no table and no personal data, and returns only pass/fail for each step.
import { json, sameSecret, serviceClient } from "../_shared/common.ts";

const BUCKET = "job-zips";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Not allowed." });
  if (!sameSecret(req.headers.get("x-webhook-secret"), Deno.env.get("SMOKE_WEBHOOK_SECRET"))) {
    return json(401, { error: "Not allowed." });
  }

  const admin = serviceClient();
  const path = `smoke/${crypto.randomUUID()}.zip`;
  // The smallest valid zip file: just its end-of-archive record.
  const bytes = new Uint8Array(22);
  bytes.set([0x50, 0x4b, 0x05, 0x06]);

  const steps: Record<string, boolean> = { upload: false, sign: false, download: false, identical: false, removed: false };
  try {
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, new Blob([bytes], { type: "application/zip" }), { contentType: "application/zip" });
    steps.upload = !uploadError;

    if (steps.upload) {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60);
      steps.sign = !!signed?.signedUrl;
      if (signed?.signedUrl) {
        const res = await fetch(signed.signedUrl);
        steps.download = res.ok;
        if (res.ok) {
          const got = new Uint8Array(await res.arrayBuffer());
          steps.identical = got.length === bytes.length && got.every((b, i) => b === bytes[i]);
        }
      }
    }
  } catch {
    console.error("smoke-check step threw"); // no details: nothing here is personal, but nothing needs to be
  } finally {
    const { error: removeError } = await admin.storage.from(BUCKET).remove([path]);
    const { data: left } = await admin.storage.from(BUCKET).list("smoke", { search: path.split("/")[1] });
    steps.removed = !removeError && (left ?? []).length === 0;
  }

  const ok = Object.values(steps).every(Boolean);
  return json(ok ? 200 : 500, { ok, steps });
});
