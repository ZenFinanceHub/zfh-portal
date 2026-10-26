import { notFound } from "next/navigation";
import { z } from "zod";
import { getMyAreas } from "@/lib/admin/areas";
import { listStaff } from "@/lib/admin/staff";
import { areaOfService } from "@/lib/areas";
import { createClient } from "@/lib/supabase/server";
import { SERVICES } from "@/lib/validation/request";
import { NewJobForm } from "./new-job-form";

export default async function NewJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, name, year_end").eq("id", id).maybeSingle();
  if (!client) notFound();

  // Only offer what this person is allowed to use (the database enforces it too).
  const mine = await getMyAreas();
  const [{ data: templates }, { data: contacts }, staff] = await Promise.all([
    supabase.from("templates").select("id, name, service").eq("active", true).in("area", mine.areas).order("name"),
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
        services={SERVICES.filter((s) => mine.areas.includes(areaOfService(s)))}
      />
    </>
  );
}
