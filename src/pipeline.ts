/**
 * One email in, work out.
 *
 *   1. Store the mail as a capture, exactly as received. Idempotent on
 *      message id, because mail pumps repeat themselves.
 *   2. Decide whether it is the team's own work: sent by someone on the team,
 *      to someone on the team, and not machine mail. Outside mail is kept and
 *      filed against its job as a trace, but never becomes a task. A task
 *      list full of correspondence is worse than one that is short and true.
 *   3. Split the note into tasks, find who each is for, classify it, and file
 *      it to a job. All rules (rules.ts, filing.ts).
 *   4. Then, and only then, ask the model the questions where it helps: is
 *      this also a meeting, what does the attached photo say.
 */
import { randomUUID } from "node:crypto";
import { fileToJob } from "./filing.ts";
import { addresses, assigneeFor, classify, isMachineMail, noteBody, splitTasks, withoutLeadingName } from "./rules.ts";
import type { Extractor } from "./extract.ts";
import type { Store } from "./store.ts";
import type { Capture, Item, Job, Mail, Meeting, Person, ReceiptFacts } from "./types.ts";

export const MEETING_CONFIDENCE = 0.8;

export interface IngestResult {
  captureId: string;
  duplicate: boolean;
  internal: boolean;
  items: Item[];
  meeting: Meeting | null;
  receipts: ReceiptFacts[];
}

export interface PipelineDeps {
  team: Person[];
  jobs: Job[];
  store: Store;
  extractor: Extractor;
}

export function createPipeline({ team, jobs, store, extractor }: PipelineDeps) {
  const byAddress = new Map<string, Person>();
  for (const p of team) for (const e of p.emails) byAddress.set(e.toLowerCase(), p);

  async function ingest(mail: Mail): Promise<IngestResult> {
    const seen = store.captureByMessageId(mail.messageId);
    if (seen) {
      return { captureId: seen.id, duplicate: true, internal: seen.internal, items: [], meeting: null, receipts: [] };
    }

    const from = addresses(mail.from);
    const to = addresses(mail.to);
    const attachments = mail.attachments ?? [];
    const machine = isMachineMail(mail.subject, attachments.map((a) => a.mime));
    const internal = from.some((a) => byAddress.has(a)) && to.some((a) => byAddress.has(a)) && !machine;
    const writer = from.map((a) => byAddress.get(a)).find(Boolean) ?? null;

    // Outside mail is filed by subject and the top of the body only: a long
    // thread quotes every job it has ever touched.
    const top = noteBody(mail.body).split("\n").slice(0, 3).join(" ");
    const capture: Capture = Object.freeze({
      id: randomUUID(),
      messageId: mail.messageId,
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      body: mail.body,
      receivedAt: new Date(mail.date).toISOString(),
      internal,
      writerId: internal ? (writer?.id ?? null) : null,
      filing: fileToJob(`${mail.subject} ${top}`, jobs),
    });
    store.addCapture(capture);

    const receipts = await readPictures(capture, attachments);
    if (!internal) {
      return { captureId: capture.id, duplicate: false, internal, items: [], meeting: null, receipts };
    }

    const titles = splitTasks(mail.subject, mail.body, jobs.flatMap((j) => j.aliases));
    const subjectOwner = assigneeFor(mail.subject, team, writer?.id ?? null);
    const items: Item[] = titles.map((raw) => {
      const lineOwner = titles.length > 1 ? assigneeFor(raw, team, writer?.id ?? null) : null;
      const owner = lineOwner ?? subjectOwner;
      const title = owner ? withoutLeadingName(raw, owner) : raw;
      const detail = titles.length === 1 ? noteBody(mail.body) || null : null;
      // A line that names its own job wins; otherwise the subject's job applies to every line.
      const ownFiling = fileToJob(title, jobs);
      return {
        id: randomUUID(),
        captureId: capture.id,
        title: title.slice(0, 200),
        detail,
        ...classify(`${title} ${detail ?? ""}`),
        ownerId: owner?.id ?? null,
        filing: ownFiling.status === "general" ? fileToJob(`${mail.subject} ${detail ?? ""}`, jobs) : ownFiling,
      };
    });
    items.forEach((i) => store.addItem(i));

    // Is a single-task note also a meeting? The task stays either way.
    let meeting: Meeting | null = null;
    if (titles.length === 1) {
      const guess = await extractor.readMeeting(mail.subject, noteBody(mail.body), new Date(mail.date));
      if (guess?.isMeeting && guess.confidence >= MEETING_CONFIDENCE && guess.title && guess.start) {
        meeting = {
          captureId: capture.id,
          title: guess.title,
          startsAt: guess.start,
          endsAt: guess.end,
          location: guess.location,
          confidence: guess.confidence,
        };
        store.addMeeting(meeting);
      }
    }

    return { captureId: capture.id, duplicate: false, internal, items, meeting, receipts };
  }

  async function readPictures(capture: Capture, attachments: Mail["attachments"] = []): Promise<ReceiptFacts[]> {
    const out: ReceiptFacts[] = [];
    for (const a of attachments) {
      if (!a.data || !a.mime.startsWith("image/")) continue;
      const guess = await extractor.readPicture(a.mime, a.data);
      if (!guess || guess.kind === "other") continue;
      const facts: ReceiptFacts = {
        captureId: capture.id,
        attachment: a.name,
        kind: guess.kind,
        amountCents: guess.amount == null ? null : Math.round(guess.amount * 100),
        payee: guess.payee,
        date: guess.date,
        reference: guess.reference,
        status: "needs_approval",
      };
      store.addReceipt(facts);
      out.push(facts);
    }
    return out;
  }

  return { ingest };
}
