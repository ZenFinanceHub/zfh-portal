import { cardClass } from "@/components/ui/styles";

export default function AdminDashboardPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Admin dashboard</h1>
      <div className={cardClass}>
        <p className="text-text-muted">Staff area. Clients, jobs and requests will appear here.</p>
      </div>
    </>
  );
}
