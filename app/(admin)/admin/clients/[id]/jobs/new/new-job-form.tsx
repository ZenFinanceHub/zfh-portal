"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createJob } from "../actions";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { formatDate } from "@/lib/labels";
import { SERVICE_LABELS } from "@/lib/validation/request";

type Props = {
  clientId: string;
  clientYearEnd: string | null;
  templates: { id: string; name: string; service: string }[];
  contributors: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  services: readonly string[];
};

// "Year-end accounts 31/03/2026"
const suggestTitle = (service: string, periodEnd: string) =>
  [SERVICE_LABELS[service] ?? "", periodEnd ? formatDate(periodEnd) : ""].filter(Boolean).join(" ");

export function NewJobForm({ clientId, clientYearEnd, templates, contributors, staff, services }: Props) {
  const [state, action, pending] = useActionState(createJob, {});
  const e = state.errors ?? {};

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [service, setService] = useState(templates[0]?.service ?? "other");
  const [periodEnd, setPeriodEnd] = useState(templates[0]?.service === "year_end" ? (clientYearEnd ?? "") : "");
  const [title, setTitle] = useState(() => suggestTitle(templates[0]?.service ?? "other", periodEnd));
  const [titleEdited, setTitleEdited] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  function retitle(nextService: string, nextPeriodEnd: string) {
    if (!titleEdited) setTitle(suggestTitle(nextService, nextPeriodEnd));
  }

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const nextPeriodEnd = t.service === "year_end" && !periodEnd ? (clientYearEnd ?? "") : periodEnd;
    setService(t.service);
    setPeriodEnd(nextPeriodEnd);
    retitle(t.service, nextPeriodEnd);
  }

  if (templates.length === 0) {
    return <p className="text-text-muted">There are no active templates. Activate one under Templates first.</p>;
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="client_id" value={clientId} />

      <div>
        <label htmlFor="template_id" className="mb-2 block text-base font-medium">Template</label>
        <select id="template_id" name="template_id" value={templateId} onChange={(ev) => pickTemplate(ev.target.value)} className={inputClass}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {e.template_id ? <p role="alert" className="mt-1 text-danger">{e.template_id}</p> : null}
      </div>

      <div>
        <label htmlFor="title" className="mb-2 block text-base font-medium">Title</label>
        <input
          id="title"
          name="title"
          value={title}
          onChange={(ev) => {
            setTitle(ev.target.value);
            setTitleEdited(true);
          }}
          autoComplete="off"
          className={inputClass}
        />
        {e.title ? <p role="alert" className="mt-1 text-danger">{e.title}</p> : null}
      </div>

      <div>
        <label htmlFor="service" className="mb-2 block text-base font-medium">Service</label>
        <select
          id="service"
          name="service"
          value={service}
          onChange={(ev) => {
            setService(ev.target.value);
            retitle(ev.target.value, periodEnd);
          }}
          className={inputClass}
        >
          {services.map((s) => (
            <option key={s} value={s}>{SERVICE_LABELS[s]}</option>
          ))}
        </select>
        {e.service ? <p role="alert" className="mt-1 text-danger">{e.service}</p> : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="period_end" className="mb-2 block text-base font-medium">Period end</label>
          <input
            id="period_end"
            name="period_end"
            type="date"
            value={periodEnd}
            onChange={(ev) => {
              setPeriodEnd(ev.target.value);
              retitle(service, ev.target.value);
            }}
            className={inputClass}
          />
          {e.period_end ? <p role="alert" className="mt-1 text-danger">{e.period_end}</p> : null}
        </div>
        <div>
          <label htmlFor="due_date" className="mb-2 block text-base font-medium">Due date</label>
          <input id="due_date" name="due_date" type="date" value={dueDate} onChange={(ev) => setDueDate(ev.target.value)} className={inputClass} />
          {e.due_date ? <p role="alert" className="mt-1 text-danger">{e.due_date}</p> : null}
        </div>
      </div>

      <div>
        <label htmlFor="assigned_to" className="mb-2 block text-base font-medium">Assigned to</label>
        <select id="assigned_to" name="assigned_to" value={assignedTo} onChange={(ev) => setAssignedTo(ev.target.value)} className={inputClass}>
          <option value="">Not assigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {e.assigned_to ? <p role="alert" className="mt-1 text-danger">{e.assigned_to}</p> : null}
      </div>

      <fieldset>
        <legend className="mb-2 block text-base font-medium">Contributors on this job</legend>
        {contributors.length === 0 ? (
          <p className="text-sm text-text-muted">
            This client has no contributors. Owners see every job automatically.
          </p>
        ) : (
          <div className="space-y-1">
            {contributors.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-3 text-base">
                <input
                  type="checkbox"
                  name="contributors"
                  value={c.id}
                  checked={picked.includes(c.id)}
                  onChange={(ev) => setPicked((p) => (ev.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                  className="size-5 accent-gold"
                />
                {c.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {state.message ? (
        <p role="alert" className="rounded-lg border border-danger p-3 text-danger">{state.message}</p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
          {pending ? "Creating…" : "Create job"}
        </button>
        <Link href={`/admin/clients/${clientId}`} className={secondaryButtonClass}>Cancel</Link>
      </div>
    </form>
  );
}
