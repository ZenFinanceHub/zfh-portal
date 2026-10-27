"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { cardClass, primaryButtonInlineClass, secondaryButtonClass } from "@/components/ui/styles";

// Shown when something goes wrong on a page. It never shows what went wrong, no codes and no reference numbers:
// the details stay in the server logs, without any personal data.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <SiteHeader signedIn={false} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className={cardClass} role="alert" data-testid="error-page">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-3 text-text-muted">
            That didn&apos;t work, and it&apos;s not your fault. Please try again. If it keeps happening, email craig@zen-finance.co.uk.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={reset} className={primaryButtonInlineClass}>
              Try again
            </button>
            <Link href="/" className={secondaryButtonClass}>
              Go to the portal
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
