import { requireStaffPendingMfa } from "@/lib/auth/session";
import { cardClass } from "@/components/ui/styles";
import { EnrolForm } from "./enrol-form";

export default async function MfaEnrolPage() {
  await requireStaffPendingMfa("enrol");
  return (
    <div className={cardClass}>
      <h1 className="text-2xl font-semibold">Set up two-step sign-in</h1>
      <p className="mt-2 mb-6 text-text-muted">
        Staff accounts need an authenticator app (such as Google Authenticator, Microsoft
        Authenticator or 1Password). Scan the code below, then enter the 6-digit number it shows.
      </p>
      <EnrolForm />
    </div>
  );
}
