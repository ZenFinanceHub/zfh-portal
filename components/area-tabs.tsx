"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AREA_LABELS, LAST_AREA_KEY, isArea, type Area } from "@/lib/areas";

type Props = {
  areas: Area[];
  current: Area;
  /** True when the address has no ?area= (so a remembered tab may take over). */
  fromAddress: boolean;
};

// The "Accounting | Business Finance" tab bar. Only rendered when there is more than one area.
// The last tab is remembered per device; storage can be blocked, so every use is wrapped.
export function AreaTabs({ areas, current, fromAddress }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    try {
      if (fromAddress) {
        window.localStorage.setItem(LAST_AREA_KEY, current);
        return;
      }
      const stored = window.localStorage.getItem(LAST_AREA_KEY);
      if (isArea(stored) && areas.includes(stored) && stored !== current) {
        router.replace(`${pathname}?area=${stored}`);
      }
    } catch {
      /* remembering the tab is a convenience only */
    }
  }, [areas, current, fromAddress, pathname, router]);

  return (
    <nav aria-label="Areas" className="mb-6">
      <ul className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-line bg-surface p-1">
        {areas.map((area) => {
          const active = area === current;
          return (
            <li key={area}>
              <Link
                href={`${pathname}?area=${area}`}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  try {
                    window.localStorage.setItem(LAST_AREA_KEY, area);
                  } catch {
                    /* ignore */
                  }
                }}
                className={`flex min-h-11 items-center justify-center rounded-lg px-3 text-center text-base font-semibold ${
                  active ? "bg-gold text-ink" : "text-text hover:text-gold-light"
                }`}
              >
                {AREA_LABELS[area]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
