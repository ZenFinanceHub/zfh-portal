import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { saveTemplate } from "../actions";
import { TemplateForm, type Blueprint } from "../template-form";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: t } = await supabase.from("templates").select("*").eq("id", id).maybeSingle();
  if (!t) notFound();

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">Edit template</h1>
      <TemplateForm
        action={saveTemplate.bind(null, id)}
        template={{
          name: t.name,
          description: t.description ?? "",
          active: t.active,
          requests: (Array.isArray(t.requests) ? t.requests : []) as unknown as Blueprint[],
        }}
      />
    </>
  );
}
