import { listStaff } from "@/lib/admin/staff";
import { saveClient } from "../actions";
import { ClientForm } from "../client-form";

export default async function NewClientPage() {
  const staff = await listStaff();
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">New client</h1>
      <ClientForm
        action={saveClient.bind(null, null)}
        defaults={{ name: "", entity_type: "limited_company", company_number: "", utr: "", xero_contact_id: "", year_end: "", assigned_to: "", status: "active" }}
        staff={staff}
        cancelHref="/admin/clients"
        submitLabel="Create client"
      />
    </>
  );
}
