import { redirect } from "next/navigation";
import { ConsentForm } from "./consent-form";
import { cardClass } from "@/components/ui/styles";
import { isStaff } from "@/lib/auth/routing";
import { isAllowedRedirect, isAuthorizationId } from "@/lib/connector/return-to";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Connect Claude" };

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={cardClass}>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-text-muted">{children}</p>
    </div>
  );
}

// Supabase sends people here to approve an app. This is where the authenticator code is insisted on: without one the
// person is sent to sign in first, and nothing is approved. Only staff can approve, and an approval lasts 7 days.
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId } = await searchParams;
  if (!isAuthorizationId(authorizationId)) {
    return <Message title="This link isn’t valid">Please start again from Claude.</Message>;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect(`/oauth/start?authorization_id=${authorizationId}`);
  if (!(await isStaff(supabase, claims.sub))) {
    return (
      <Message title="This is for the ZenFinanceHub team">
        Claude can only be connected by a member of the ZenFinanceHub team. Nothing has been approved.
      </Message>
    );
  }
  if (claims.aal !== "aal2") redirect(`/oauth/start?authorization_id=${authorizationId}`);

  // Looked up first: if Supabase already remembers an earlier approval it skips the question and goes straight to
  // Claude, so the approval is recorded here, with the authenticator code just checked, before it does.
  const { data: appId } = await supabase.rpc("connector_authorization_client", { p_authorization_id: authorizationId });
  if (!appId) {
    return <Message title="This link has expired">Please start again from Claude.</Message>;
  }

  const details = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (details.error || !details.data) {
    return <Message title="This link has expired">Please start again from Claude.</Message>;
  }

  if (!("authorization_id" in details.data)) {
    // Approved before: renew the approval now (the authenticator code has just been checked), then carry on.
    const { error } = await supabase.rpc("connector_record_grant", { p_client_id: appId });
    if (error || !isAllowedRedirect(details.data.redirect_url)) {
      return <Message title="Something went wrong">Please start again from Claude.</Message>;
    }
    redirect(details.data.redirect_url);
  }

  return (
    <div className={cardClass}>
      <h1 className="text-2xl font-semibold">Connect Claude to the portal?</h1>
      <p className="mt-3 text-text-muted">
        You&apos;re signed in as {details.data.user.email}. If you allow this, Claude can work on the portal as you, in the
        areas you have access to:
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>Find clients and see their jobs and what is still outstanding (titles and due dates)</li>
        <li>Create jobs and add requests for clients to do</li>
        <li>Send a message to a client, or add a note only staff can see</li>
      </ul>
      <p className="mt-3 text-text-muted">
        It cannot see client documents, answers or messages. Anything that changes something is shown to you first, and only
        goes ahead when you say so in the chat. Access lasts 7 days, then you&apos;ll be asked again. You can switch it off
        any time in Settings → Connected apps.
      </p>
      <ConsentForm authorizationId={authorizationId} />
    </div>
  );
}
