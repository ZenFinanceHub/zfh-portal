import { notFound } from "next/navigation";
import { z } from "zod";
import { listStaff } from "@/lib/admin/staff";
import { createClient } from "@/lib/supabase/server";
import { saveClient } from "../../actions";
import { ClientForm } from "../../client-form";

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (!client) notFound();
  const staff = await listStaff();

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">Edit client</h1>
      <ClientForm
        action={saveClient.bind(null, id)}
        defaults={{
          name: client.name,
          entity_type: client.entity_type,
          company_number: client.company_number ?? "",
          utr: client.utr ?? "",
          xero_contact_id: client.xero_contact_id ?? "",
          year_end: client.year_end ?? "",
          assigned_to: client.assigned_to ?? "",
          status: client.status,
        }}
        staff={staff}
        cancelHref={`/admin/clients/${id}`}
        submitLabel="Save changes"
      />
    </>
  );
}
