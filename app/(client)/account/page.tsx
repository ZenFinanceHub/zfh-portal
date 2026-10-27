import { RemindersForm } from "./reminders-form";
import { cardClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/server";

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, email_reminders")
    .eq("id", auth.user!.id)
    .single();

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Your account</h1>
      <div className={`${cardClass} mb-4 space-y-1`}>
        {profile?.full_name ? <p className="text-lg font-medium">{profile.full_name}</p> : null}
        <p className="text-text-muted">{profile?.email}</p>
      </div>
      <div className={`${cardClass} space-y-4`}>
        <h2 className="text-xl font-semibold">Emails</h2>
        <RemindersForm initial={profile?.email_reminders ?? true} />
      </div>
    </>
  );
}
