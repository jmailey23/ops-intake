/**
 * The deterministic half of the pipeline.
 *
 * Everything here is a plain rule: predictable, free, and testable without a
 * network. These are the decisions that are expensive to get wrong (which
 * mail becomes work, who it belongs to, whether the owner has to decide), so
 * they are made by code a person can read, not by a model.
 */
import type { ItemKind, Person } from "./types.ts";

/** "Dana Reyes <dana@oakline.co>, marcus@oakline.co" -> ["dana@oakline.co", "marcus@oakline.co"] */
export function addresses(header: string): string[] {
  return String(header || "").toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) ?? [];
}

/**
 * Calendar invites, auto replies and bounces pass the "team to team" test
 * perfectly and are still not anybody's to-do. A calendar invite is the
 * calendar's job.
 */
const MACHINE_SUBJECT =
  /^\s*(re:\s*|fwd?:\s*)*(invitation|updated invitation|cancell?ed event|declined|accepted|tentative|automatic reply|auto[- ]?reply|out of office|undeliverable|delivery status notification|read receipt)\b/i;
const CALENDAR_MIME = /^(text\/calendar|application\/ics)/i;

export function isMachineMail(subject: string, attachmentMimes: string[] = []): boolean {
  return MACHINE_SUBJECT.test(subject) || attachmentMimes.some((m) => CALENDAR_MIME.test(m));
}

/** Signature lines, quoted replies and boilerplate. */
const NOISE =
  /^(sent from|get outlook|confidentiality|this email|thanks|thank you|--|__|on .* wrote:|>|from:|to:|cc:|subject:|date:)/i;

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * One note can be one task or a list of them. A list is two or more bulleted
 * or numbered lines; anything else is a single task titled by the subject,
 * with the body as its detail.
 */
export function splitTasks(subject: string, body: string, jobWords: string[] = []): string[] {
  const lines: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (NOISE.test(line)) break; // everything after a signature or a quote is exhaust
    lines.push(line);
  }
  const listed = lines.filter((l) => BULLET.test(l)).map((l) => l.replace(BULLET, "").trim()).filter(Boolean);
  if (listed.length >= 2) return listed.map(sentenceCase);

  // A subject that only names the job ("Hollis") says where, not what. The
  // first sentence of the body says what.
  const cleaned = subject.replace(/^\s*(re:|fwd?:)\s*/i, "").trim();
  const firstSentence = (lines.find(Boolean) ?? "").split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "");
  const title = !cleaned || onlyNames(cleaned, jobWords) ? firstSentence || cleaned : cleaned;
  return title ? [sentenceCase(title)] : [];
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function onlyNames(subject: string, words: string[]): boolean {
  let rest = ` ${subject.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const w of words) rest = rest.replace(` ${w.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `, " ");
  return rest.trim() === "";
}

/** The body up to the first signature or quoted line, whitespace tidied, words untouched. */
export function noteBody(body: string): string {
  const kept: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    if (NOISE.test(raw.trim())) break;
    kept.push(raw.trimEnd());
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const DECIDE =
  /\b(price|pricing|quote|bid|estimate|change order|contract|invoice|discount|refund|upset|unhappy|complain\w*|dispute|lawyer|attorney|approve|approval)\b/i;
const URGENT = /\b(crack\w*|leak\w*|broke|broken|damage\w*|flood\w*|fail\w*|stop work|urgent|asap|emergency)\b/i;
const ISSUE = /\b(crack\w*|leak\w*|broke|broken|damage\w*|defect\w*|complain\w*|wrong|missing|fail\w*)\b/i;
const MATERIAL = /\b(order|pick ?up|deliver\w*|dumpster|material\w*|supply|supplies|lumber|tile|paint|fixture\w*)\b/i;

export function classify(text: string): { kind: ItemKind; urgent: boolean; needsOwnerDecision: boolean } {
  // "change order" is a contract term, not a delivery.
  const forMaterial = text.replace(/\bchange orders?\b/gi, "");
  return {
    kind: ISSUE.test(text) ? "issue" : MATERIAL.test(forMaterial) ? "material" : "task",
    urgent: URGENT.test(text),
    needsOwnerDecision: DECIDE.test(text),
  };
}

/**
 * Delegation by name. "Marcus - order the tile" is Marcus's task. Only a name
 * at the start of the line counts: "ask Marcus about the tile" is still the
 * writer's.
 */
export function assigneeFor(title: string, team: Person[], writerId: string | null): Person | null {
  for (const p of team) {
    if (p.id === writerId) continue;
    const first = p.name.split(/\s+/)[0];
    if (new RegExp(`^${escape(first)}\\b[\\s:,-]*`, "i").test(title)) return p;
  }
  return null;
}

export function withoutLeadingName(title: string, person: Person): string {
  const first = person.name.split(/\s+/)[0];
  const stripped = title.replace(new RegExp(`^${escape(first)}\\b[\\s:,-]*`, "i"), "").trim();
  return stripped ? stripped[0].toUpperCase() + stripped.slice(1) : title;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
