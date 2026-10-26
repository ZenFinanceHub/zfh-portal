"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page every few seconds while `active`, e.g. while documents are being checked. */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
