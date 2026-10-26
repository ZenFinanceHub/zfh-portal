import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/clients", label: "Clients" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <nav aria-label="Admin" className="border-b border-line">
        <ul className="mx-auto flex w-full max-w-3xl gap-2 px-4">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="inline-flex min-h-11 items-center px-2 text-base text-text hover:text-gold-light">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
