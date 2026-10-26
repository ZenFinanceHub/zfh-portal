import { signOut } from "@/app/auth/actions";
import { headerButtonClass } from "@/components/ui/styles";

export function SiteHeader({ signedIn = true }: { signedIn?: boolean }) {
  return (
    <header className="bg-gold-metal">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <p className="text-lg font-semibold tracking-wide text-ink">ZenFinanceHub</p>
        {signedIn ? (
          <form action={signOut}>
            <button
              type="submit"
              className={headerButtonClass}
            >
              Sign out
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
