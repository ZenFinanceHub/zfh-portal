import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { getMyAreas } from "@/lib/admin/areas";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = await getMyAreas();
  const nav = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/clients", label: "Clients" },
    { href: "/admin/templates", label: "Templates" },
    ...(isAdmin ? [{ href: "/admin/settings", label: "Settings" }] : []),
  ];

  return (
    <>
      <SiteHeader />
      <nav aria-label="Admin" className="border-b border-line">
        <ul className="mx-auto flex w-full max-w-3xl gap-2 overflow-x-auto px-4">
          {nav.map((item) => (
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
