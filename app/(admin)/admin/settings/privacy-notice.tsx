import { PrivacyForm } from "./privacy-form";
import { cardClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/server";

// Admin only (the database checks). Clients see this as "How we handle your information" under each consent.
export async function PrivacyNotice() {
  const supabase = await createClient();
  const { data: url, error } = await supabase.rpc("get_privacy_notice_url");

  return (
    <section className={`${cardClass} !p-4 space-y-4`}>
      <h2 className="text-lg font-semibold">Privacy notice</h2>
      <p className="text-text-muted">
        The link clients see under each consent, labelled &ldquo;How we handle your information&rdquo;. Leave it empty and
        no link is shown.
      </p>
      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load this setting. Please refresh the page.
        </p>
      ) : (
        <PrivacyForm current={url ?? ""} />
      )}
    </section>
  );
}
