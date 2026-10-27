import { SiteHeader } from "@/components/site-header";

export default function OAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader signedIn={false} />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10">{children}</main>
    </>
  );
}
