import { requireStaffPendingMfa } from "@/lib/auth/session";
import { cardClass } from "@/components/ui/styles";
import { VerifyForm } from "./verify-form";

export default async function MfaVerifyPage() {
  const { factorId } = await requireStaffPendingMfa("verify");
  return (
    <div className={cardClass}>
      <h1 className="text-2xl font-semibold">Enter your code</h1>
      <p className="mt-2 mb-6 text-text-muted">
        Open your authenticator app and enter the 6-digit code for ZenFinanceHub.
      </p>
      <VerifyForm factorId={factorId!} />
    </div>
  );
}
