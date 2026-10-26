export const inputClass =
  "block w-full min-h-12 rounded-lg border border-line bg-ink px-4 text-base text-text placeholder:text-text-muted/70 focus:border-gold";

export const primaryButtonClass =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-gold px-5 text-base font-semibold text-ink hover:bg-gold-light disabled:opacity-60";

export const primaryButtonInlineClass = primaryButtonClass.replace("w-full", "w-auto");

export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-base text-text hover:border-gold";

// Sits on the gold header: ink text/outline on gold is 8.7:1 (WCAG AA needs 4.5:1).
export const headerButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-ink bg-transparent px-4 text-base font-semibold text-ink hover:bg-ink hover:text-gold-light";

export const cardClass = "rounded-xl border border-line bg-surface p-6 sm:p-8";
