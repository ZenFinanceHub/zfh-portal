import type { SupabaseClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.types";

// The tools Claude can use. Every one calls a connector_* database function, which checks the staff member's
// grant, their areas and what may be returned. Nothing here reads a table, and no tool returns answers, documents,
// client messages, help text or consent wording: only names, titles, statuses and due dates.

type Db = SupabaseClient<Database>;

const text = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const PREVIEW_NOTE =
  "This was only a preview and nothing has changed. Show it to Craig in full. Only call this tool again with confirm=true after Craig has clearly said to send or go ahead.";

async function call(db: Db, fn: keyof Database["public"]["Functions"], args: Record<string, Json | undefined>) {
  // Missing optional values go to the database as explicit nulls so every function signature matches.
  const named = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v === undefined ? null : v]));
  const { data, error } = await db.rpc(fn as never, named as never);
  if (error) {
    // The database's own messages are short and written for people ("Job not found", "That job is finished").
    return text(`That didn't work: ${String(error.message).slice(0, 300)}`, true);
  }
  if (data && typeof data === "object" && !Array.isArray(data) && (data as { preview?: boolean }).preview) {
    return text({ ...(data as object), next_step: PREVIEW_NOTE });
  }
  return text(data ?? { done: true });
}

const id = (what: string) => z.string().uuid(`${what} must be an id from a previous result`);
const confirm = z
  .boolean()
  .default(false)
  .describe(
    "Leave false (the default) to get a preview that changes nothing. Set true ONLY after Craig has seen the preview and explicitly said to send it.",
  );

const requestItem = z.object({
  kind: z.enum(["upload", "question", "approval"]).describe("upload = client sends documents; question = client answers; approval = client approves something"),
  title: z.string().min(1).max(200).describe("What the client sees as the task. Plain English, no jargon, no amounts, account numbers or UTRs."),
  help_text: z.string().max(1000).optional().describe("A short, friendly explanation for the client. Plain English."),
  question_type: z.enum(["text", "yes_no", "choice", "date", "amount"]).optional().describe("Required when kind is question"),
  options: z.array(z.string().min(1).max(100)).max(12).optional().describe("Required for a choice question: at least two"),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
});

export function buildServer(db: Db) {
  const server = new McpServer({ name: "zenfinancehub-portal", version: "1.0.0" });

  server.registerTool(
    "search_clients",
    {
      description:
        "Find clients by part of their name. Returns client ids and names only. Use the client_id in other tools.",
      inputSchema: { query: z.string().min(2).max(100) },
    },
    ({ query }) => call(db, "connector_search_clients", { p_query: query }),
  );

  server.registerTool(
    "list_jobs",
    {
      description:
        "List a client's jobs: job_id, title, service, area, stage and due date. Only jobs in the areas Craig works in are shown.",
      inputSchema: { client_id: id("client_id"), open_only: z.boolean().default(true).describe("true hides completed and cancelled jobs") },
    },
    ({ client_id, open_only }) => call(db, "connector_list_jobs", { p_client_id: client_id, p_open_only: open_only }),
  );

  server.registerTool(
    "get_outstanding",
    {
      description:
        "What a client still has to do, soonest due first: request titles, kind, status and due date, with the job and client. Give EITHER client_id OR job_id. It never includes the client's answers, files or messages.",
      inputSchema: { client_id: id("client_id").optional(), job_id: id("job_id").optional() },
    },
    ({ client_id, job_id }) => call(db, "connector_outstanding", { p_client_id: client_id, p_job_id: job_id }),
  );

  server.registerTool(
    "create_job",
    {
      description:
        "Create a job for a client from a template. Give a template name or a service (year_end, self_assessment, bookkeeping, payroll, vat, property, onboarding, finance_application, regulated_referral, other). " +
        "ALWAYS call first without confirm to get a preview, show it to Craig, and only call again with confirm=true after he explicitly says to send. Creating a job also creates its template requests.",
      inputSchema: {
        client_id: id("client_id"),
        template: z.string().max(200).optional().describe("Template name, if Craig named one"),
        service: z.string().max(40).optional().describe("Service, used to pick the standard template when no template is named"),
        title: z.string().min(1).max(200).describe("A clear job title, e.g. 'Year end 31/03/2026'"),
        confirm,
      },
    },
    ({ client_id, template, service, title, confirm: go }) =>
      call(db, "connector_create_job", { p_client_id: client_id, p_template: template, p_service: service, p_title: title, p_confirm: go }),
  );

  server.registerTool(
    "add_requests",
    {
      description:
        "Add requests (things for the client to upload, answer or approve) to a job. The client is emailed 'You have something to do' (no details). " +
        "RULES: (1) Write each title and help_text in plain English for the client, in your own words. Never copy a lender's wording, and never put amounts, account numbers, UTRs or names in them. " +
        "(2) Put the lender's or other source's original text, exactly as Craig pasted it, in lender_text: it is saved as an internal staff-only note. " +
        "(3) ALWAYS call first without confirm to get a preview, show Craig the preview in full, and only call again with confirm=true after he explicitly says to send. " +
        "Consent requests cannot be added here.",
      inputSchema: {
        job_id: id("job_id"),
        requests: z.array(requestItem).min(1).max(25),
        lender_text: z.string().max(30000).optional().describe("The pasted source text, verbatim. Saved as an internal note, never shown to the client."),
        confirm,
      },
    },
    ({ job_id, requests, lender_text, confirm: go }) =>
      call(db, "connector_add_requests", { p_job_id: job_id, p_requests: requests as Json, p_lender_text: lender_text, p_confirm: go }),
  );

  server.registerTool(
    "send_client_message",
    {
      description:
        "Send a message on a job that the client will see in their portal (they get an email saying only 'You have a new message'). Plain English, no regulated advice. " +
        "ALWAYS call first without confirm to get a preview, show Craig the exact text, and only call again with confirm=true after he explicitly says to send.",
      inputSchema: { job_id: id("job_id"), body: z.string().min(1).max(5000), confirm },
    },
    ({ job_id, body, confirm: go }) => call(db, "connector_send_message", { p_job_id: job_id, p_body: body, p_confirm: go }),
  );

  server.registerTool(
    "add_internal_note",
    {
      description:
        "Add a note on a job that only staff can see. ALWAYS call first without confirm to get a preview, then call again with confirm=true only after Craig explicitly says to save it.",
      inputSchema: { job_id: id("job_id"), body: z.string().min(1).max(5000), confirm },
    },
    ({ job_id, body, confirm: go }) => call(db, "connector_add_note", { p_job_id: job_id, p_body: body, p_confirm: go }),
  );

  return server;
}
