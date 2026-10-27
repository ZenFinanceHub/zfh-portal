import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

const NAV = [
  { href: "/", label: "Things to do" },
  { href: "/documents", label: "Documents" },
  { href: "/messages", label: "Messages" },
  { href: "/account", label: "Account" },
];

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <nav aria-label="Main" className="border-b border-line">
        <ul className="mx-auto flex w-full max-w-3xl gap-1 overflow-x-auto px-2">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center whitespace-nowrap px-3 text-base text-text hover:text-gold-light"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-8">{children}</main>
    </>
  );
}
