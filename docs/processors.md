# Processors

Every outside service that handles client data on ZenFinanceHub's behalf. Keep this list in step with the privacy
notice and the data processing agreements. Add a row before any new service touches client data.

| Processor | What it does for us | Where data is held | What it sees |
|---|---|---|---|
| **Supabase** | Database, sign-in, file storage, edge functions (project `vvxrqwcmyisiweecqgyn`) | London, UK (AWS eu-west-2) | Everything in the portal: client records, answers, uploaded files, audit trail |
| **Vercel** | Hosts the website (`portal.zenfinancehub.com`); runs the pages and server actions | Functions in London (`lhr1`). Static assets are served from Vercel's edge network | Pages and requests as people use the portal, including signed-in session cookies. Files are not stored there; downloads go straight from Supabase |
| **Resend** | Sends email: sign-in links, invites, "you have something to do", staff alerts | EU region (sending domain `mail.zenfinancehub.com`) | Recipient email addresses and the fixed text of each email. Emails never contain file names, answers, amounts or message text |

## Virus scanning: no scanning processor yet

There is **no third-party virus scanner**. Uploaded files get basic checks only (the real file type matches its
extension and the allowed list, the file is not empty, and it is within 25 MB). That reduces risk but is **not** malware
detection, so staff must keep Microsoft Defender on and up to date on any device that opens client files (see the
README).

The scanner sits behind a small interface (`supabase/functions/_shared/scanner.ts`). `SCANNER_PROVIDER` selects it:
`none` today. A Scanii adapter (London endpoint) is written but not switched on. If a scanner is added, it becomes a
processor: add it to the table above (with region and what it sees), sign its data processing agreement, and update
the privacy notice.

## Checklist when adding a processor

1. Region: UK or EU where possible. Record it here.
2. Does it store or share what we send it? How long?
3. Data processing agreement signed.
4. Added to the privacy notice.
