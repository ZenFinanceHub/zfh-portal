"use client";

import "./globals.css";

// The last resort, when even the page frame fails. Plain text only: no codes, no reference numbers.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6" role="alert">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-3 text-text-muted">
            That didn&apos;t work, and it&apos;s not your fault. Please try again. If it keeps happening, email craig@zen-finance.co.uk.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-lg bg-gold px-5 text-base font-semibold text-ink hover:bg-gold-light"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
