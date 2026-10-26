import { cardClass } from "@/components/ui/styles";

export default function HomePage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Things to do</h1>
      <div className={cardClass}>
        <p className="text-text-muted">Nothing yet.</p>
      </div>
    </>
  );
}
