import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { cardClass, primaryButtonInlineClass } from "@/components/ui/styles";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <>
      <SiteHeader signedIn={false} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className={cardClass} data-testid="not-found">
          <h1 className="text-2xl font-semibold">We can&apos;t find that page</h1>
          <p className="mt-3 text-text-muted">
            The page may have moved, or the link may be out of date. Nothing is wrong with your account.
          </p>
          <Link href="/" className={`${primaryButtonInlineClass} mt-6`}>
            Go to the portal
          </Link>
        </div>
      </main>
    </>
  );
}
