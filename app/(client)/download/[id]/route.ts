import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Hands out a 60-second signed link to one file, and records the download.
// The file is looked up with the visitor's own session, so row-level security decides if it exists for them,
// and the storage policy only allows clean files for clients (and anything not infected for staff).
// The only thing in the address is the file's id; no names go in query strings.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notAvailable = () =>
    new NextResponse("This file isn't available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  if (!z.uuid().safeParse(id).success) return notAvailable();

  const supabase = await createClient();
  const { data: file } = await supabase
    .from("files")
    .select("id, client_id, storage_path, scan_status")
    .eq("id", id)
    .maybeSingle();
  if (!file || file.scan_status === "infected") return notAvailable();

  const { data: signed, error } = await supabase.storage.from("client-files").createSignedUrl(file.storage_path, 60);
  if (error || !signed) return notAvailable();

  // Fail closed: no audit entry, no download.
  const { error: logError } = await supabase.rpc("log_event", {
    p_action: "file_download",
    p_entity: "files",
    p_entity_id: file.id,
    p_client_id: file.client_id,
  });
  if (logError) return notAvailable();

  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
