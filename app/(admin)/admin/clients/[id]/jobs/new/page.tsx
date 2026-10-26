import { notFound } from "next/navigation";
import { z } from "zod";
import { listStaff } from "@/lib/admin/staff";
import { createClient } from "@/lib/supabase/server";
import { NewJobForm } from "./new-job-form";

export default async function NewJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, name, year_end").eq("id", id).maybeSingle();
  if (!client) notFound();

  const [{ data: templates }, { data: contacts }, staff] = await Promise.all([
    supabase.from("templates").select("id, name, service").eq("active", true).order("name"),
    supabase
      .from("client_contacts")
      .select("role, profile:profiles(id, full_name, email)")
      .eq("client_id", id)
      .eq("role", "contributor"),
    listStaff(),
  ]);

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold sm:text-3xl">New job</h1>
      <p className="mb-6 text-text-muted">{client.name}</p>
      <NewJobForm
        clientId={id}
        clientYearEnd={client.year_end}
        templates={templates ?? []}
        contributors={(contacts ?? []).flatMap((c) =>
          c.profile ? [{ id: c.profile.id, name: c.profile.full_name || c.profile.email }] : [],
        )}
        staff={staff}
      />
    </>
  );
}
