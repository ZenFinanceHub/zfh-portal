// The words and layout of every notification email. Plain functions with no imports.
//
// What may appear in an email (CLAUDE.md → Notifications):
//   clients: "You have something to do" / "You have a new message" / a count. Nothing else.
//   staff:   client name, job title, kind and count of items, and a link. Never file names, answers,
//            amounts or message text. Nothing here receives those, so they cannot leak.
// Same black-and-gold inline-styled layout as the sign-in emails (supabase/templates).

export type Email = { subject: string; html: string; text: string };

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** One line, no control characters: safe in a subject header. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function shell(opts: {
  preheader: string;
  heading: string;
  /** Already-escaped HTML paragraphs. */
  paragraphs: string[];
  button?: { label: string; href: string };
  /** Already-escaped HTML. */
  footer?: string;
}): string {
  const paragraphs = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;color:#FFFFFF;">${p}</p>`)
    .join("\n            ");
  const button = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px 0;">
              <tr>
                <td bgcolor="#C9A84C" style="background-color:#C9A84C;border-radius:8px;">
                  <a href="${esc(opts.button.href)}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#0A0A0A;text-decoration:none;border-radius:8px;">${esc(opts.button.label)}</a>
                </td>
              </tr>
            </table>`
    : "";
  const footer = opts.footer
    ? `<p style="margin:24px 0 0 0;font-size:14px;line-height:1.5;color:#B5B5B5;">${opts.footer}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0A0A0A;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0A0A0A" style="background-color:#0A0A0A;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td bgcolor="#C9A84C" style="background-color:#C9A84C;padding:16px 24px;border-radius:8px 8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#0A0A0A;">
            ZenFinanceHub
          </td>
        </tr>
        <tr>
          <td bgcolor="#151515" style="background-color:#151515;padding:32px 24px;border:1px solid #2A2A2A;border-top:0;border-radius:0 0 8px 8px;font-family:Arial,Helvetica,sans-serif;color:#FFFFFF;">
            <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;color:#FFFFFF;">${esc(opts.heading)}</h1>
            ${paragraphs}
            ${button}
            ${footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ── Clients ──────────────────────────────────────────────────
export function clientNewRequest(portal: string): Email {
  const subject = "You have something to do";
  return {
    subject,
    html: shell({
      preheader: "Something is waiting for you in your ZenFinanceHub portal.",
      heading: subject,
      paragraphs: ["Something is waiting for you in your ZenFinanceHub client portal."],
      button: { label: "Open my portal", href: portal },
    }),
    text: `${subject}\n\nSomething is waiting for you in your ZenFinanceHub client portal.\n\n${portal}`,
  };
}

export function clientMessage(portal: string): Email {
  const subject = "You have a new message";
  const link = `${portal}/messages`;
  return {
    subject,
    html: shell({
      preheader: "There is a new message for you in your ZenFinanceHub portal.",
      heading: subject,
      paragraphs: ["There is a new message for you in your ZenFinanceHub client portal."],
      button: { label: "Read my message", href: link },
    }),
    text: `${subject}\n\nThere is a new message for you in your ZenFinanceHub client portal.\n\n${link}`,
  };
}

export function clientReminder(count: number, portal: string): Email {
  const subject = `You have ${plural(count, "thing", "things")} to do`;
  const account = `${portal}/account`;
  return {
    subject,
    html: shell({
      preheader: "A friendly reminder from ZenFinanceHub.",
      heading: subject,
      paragraphs: ["A friendly reminder from ZenFinanceHub. Everything is in your client portal."],
      button: { label: "Open my portal", href: portal },
      footer: `Don&#39;t need these reminders? You can switch them off in <a href="${esc(account)}" style="color:#E3C77A;">your account</a>.`,
    }),
    text: `${subject}\n\nA friendly reminder from ZenFinanceHub. Everything is in your client portal.\n\n${portal}\n\nDon't need these reminders? You can switch them off in your account: ${account}`,
  };
}

// ── Staff ────────────────────────────────────────────────────
export type Tally = { upload: number; question: number; approval: number; consent: number; message: number };
export const emptyTally = (): Tally => ({ upload: 0, question: 0, approval: 0, consent: 0, message: 0 });

export type JobSummary = { jobId: string; jobTitle: string; tally: Tally };
export type ClientSummary = { clientId: string; clientName: string; jobs: JobSummary[] };

const itemsIn = (t: Tally) => t.upload + t.question + t.approval + t.consent;

/** "2 uploads, 1 answer, 1 message": the kinds and counts, nothing else. */
export function tallyLine(t: Tally): string {
  const parts: string[] = [];
  if (t.upload) parts.push(plural(t.upload, "upload", "uploads"));
  if (t.question) parts.push(plural(t.question, "answer", "answers"));
  if (t.approval) parts.push(plural(t.approval, "approval", "approvals"));
  if (t.consent) parts.push(plural(t.consent, "consent", "consents"));
  if (t.message) parts.push(plural(t.message, "message", "messages"));
  return parts.join(", ");
}

function sumTallies(summaries: ClientSummary[]): Tally {
  const total = emptyTally();
  for (const c of summaries) {
    for (const j of c.jobs) for (const k of Object.keys(total) as (keyof Tally)[]) total[k] += j.tally[k];
  }
  return total;
}

/** "3 items and 1 message" */
function countPhrase(t: Tally): string {
  const items = itemsIn(t);
  const parts: string[] = [];
  if (items) parts.push(plural(items, "item", "items"));
  if (t.message) parts.push(plural(t.message, "message", "messages"));
  return parts.join(" and ");
}

/** "Alpha Ltd sent 3 items and 1 message on the Year-end job" */
export function headline(c: ClientSummary): string {
  const total = sumTallies([c]);
  const on = c.jobs.length === 1 ? ` on the ${c.jobs[0].jobTitle} job` : "";
  return oneLine(`${c.clientName} sent ${countPhrase(total)}${on}`);
}

const jobLink = (portal: string, c: ClientSummary) =>
  c.jobs.length === 1 ? `${portal}/admin/jobs/${c.jobs[0].jobId}` : `${portal}/admin/clients/${c.clientId}`;

function clientBlockHtml(portal: string, c: ClientSummary): string {
  const lines = c.jobs.map((j) => `${esc(j.jobTitle)}: ${esc(tallyLine(j.tally))}`).join("<br>");
  return `<a href="${esc(jobLink(portal, c))}" style="color:#E3C77A;font-weight:bold;">${esc(c.clientName)}</a><br>${lines}`;
}

function clientBlockText(portal: string, c: ClientSummary): string {
  return `${c.clientName}\n${c.jobs.map((j) => `  ${j.jobTitle}: ${tallyLine(j.tally)}`).join("\n")}\n  ${jobLink(portal, c)}`;
}

/** One client, one batch (or an urgent item). */
export function staffClientEmail(kind: "batch" | "urgent", c: ClientSummary, portal: string): Email {
  const text = headline(c);
  const subject = kind === "urgent" ? `Urgent: ${text}` : text;
  const link = jobLink(portal, c);
  return {
    subject,
    html: shell({
      preheader: "Open the portal to see what came in.",
      heading: text,
      paragraphs: c.jobs.map((j) => `${esc(j.jobTitle)}: ${esc(tallyLine(j.tally))}`),
      button: { label: "Open in the portal", href: link },
    }),
    text: `${text}\n\n${c.jobs.map((j) => `${j.jobTitle}: ${tallyLine(j.tally)}`).join("\n")}\n\n${link}`,
  };
}

/** Everything that came in while the office was closed, in one email. */
export function staffHeldEmail(summaries: ClientSummary[], portal: string): Email {
  const total = sumTallies(summaries);
  const subject = oneLine(
    `Since you were last in: ${countPhrase(total)} from ${plural(summaries.length, "client", "clients")}`,
  );
  return {
    subject,
    html: shell({
      preheader: "Held while the office was closed.",
      heading: "Since you were last in",
      paragraphs: [
        `${esc(countPhrase(total))} from ${esc(plural(summaries.length, "client", "clients"))}, held while the office was closed.`,
        ...summaries.map((c) => clientBlockHtml(portal, c)),
      ],
      button: { label: "Open the portal", href: `${portal}/admin` },
    }),
    text: `${subject}\n\n${summaries.map((c) => clientBlockText(portal, c)).join("\n\n")}\n\n${portal}/admin`,
  };
}

export type DigestArea = { label: string; clients: ClientSummary[] };

/** The end-of-day summary, by area and then client. */
export function staffDigestEmail(areas: DigestArea[], dateLabel: string, portal: string): Email {
  const total = sumTallies(areas.flatMap((a) => a.clients));
  const subject = oneLine(`Daily digest ${dateLabel}: ${countPhrase(total)}`);
  const sectionsHtml = areas.map(
    (a) =>
      `<span style="color:#C9A84C;font-weight:bold;font-size:18px;">${esc(a.label)}</span><br><br>${a.clients
        .map((c) => clientBlockHtml(portal, c))
        .join("<br><br>")}`,
  );
  const sectionsText = areas.map((a) => `${a.label.toUpperCase()}\n\n${a.clients.map((c) => clientBlockText(portal, c)).join("\n\n")}`);
  return {
    subject,
    html: shell({
      preheader: "What came in today.",
      heading: `Daily digest, ${dateLabel}`,
      paragraphs: [`${esc(countPhrase(total))} today.`, ...sectionsHtml],
      button: { label: "Open the portal", href: `${portal}/admin` },
    }),
    text: `${subject}\n\n${sectionsText.join("\n\n")}\n\n${portal}/admin`,
  };
}
