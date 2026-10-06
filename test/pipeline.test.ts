import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeExtractor, NoExtractor, type Extractor, type MeetingGuess } from "../src/extract.ts";
import { createPipeline } from "../src/pipeline.ts";
import { MemoryStore } from "../src/store.ts";
import type { Mail } from "../src/types.ts";
import { jobs, mail, team } from "../demo/fixtures.ts";

const setup = (extractor: Extractor = NoExtractor) => {
  const store = new MemoryStore();
  return { store, ingest: createPipeline({ team, jobs, store, extractor }).ingest };
};

const note = (over: Partial<Mail>): Mail => ({
  messageId: Math.random().toString(36),
  from: "dana@oakline.co",
  to: "marcus@oakline.co",
  subject: "Note",
  body: "",
  date: "2026-10-06T16:40:00-05:00",
  ...over,
});

test("the demo inbox: tasks only from the team, duplicates skipped", async () => {
  const { store, ingest } = setup();
  for (const m of mail) await ingest(m);
  assert.equal(store.captures.length, 6, "the repeat delivery is not stored twice");
  assert.equal(store.items.length, 6);
  assert.ok(store.captures.every(Object.isFrozen), "captures are immutable");
  assert.equal(store.items.filter((i) => i.captureId === store.captures[4].id).length, 0, "vendor mail makes no task");
});

test("outside mail is kept and filed as a trace, never a task", async () => {
  const { store, ingest } = setup();
  const r = await ingest(note({ from: "orders@tiledepot.example", to: "dana@oakline.co", subject: "Quote for Alder" }));
  assert.equal(r.internal, false);
  assert.equal(r.items.length, 0);
  assert.deepEqual(store.captures[0].filing, { status: "filed", jobId: "j-alder" });
});

test("a line that names its own job overrides the subject's job", async () => {
  const { ingest } = setup();
  const r = await ingest(note({ subject: "Alder", body: "- tile for the bath\n- check the Ridge gutters" }));
  assert.deepEqual(r.items.map((i) => i.filing), [
    { status: "filed", jobId: "j-alder" },
    { status: "filed", jobId: "j-ridge" },
  ]);
});

const meetingAt = (confidence: number): Extractor => ({
  readMeeting: async (): Promise<MeetingGuess> => ({
    isMeeting: true, confidence, title: "Walk the framing with the Okafors", start: "2026-10-08T14:00", end: null, location: "Ridge Rd",
  }),
  readPicture: async () => null,
});

test("a confident meeting is recorded, and the task stays", async () => {
  const { store, ingest } = setup(meetingAt(0.92));
  const r = await ingest(note({ subject: "Ridge walkthrough", body: "Meet the Okafors at Ridge Thursday at 2." }));
  assert.equal(r.items.length, 1);
  assert.equal(store.meetings.length, 1);
});

test("an unsure meeting is not recorded", async () => {
  const { store, ingest } = setup(meetingAt(0.5));
  await ingest(note({ subject: "Ridge", body: "We should meet at Ridge sometime." }));
  assert.equal(store.meetings.length, 0);
});

test("receipt facts are held for approval, never booked", async () => {
  const { store, ingest } = setup({
    readMeeting: async () => null,
    readPicture: async () => ({ kind: "check", amount: 1284.5, payee: "Oakline Builders", date: "2026-10-05", reference: "1042" }),
  });
  await ingest(note({ subject: "Okafor check", attachments: [{ name: "check.jpg", mime: "image/jpeg", data: "AAAA" }] }));
  assert.deepEqual(store.receipts.map((r) => [r.amountCents, r.status]), [[128450, "needs_approval"]]);
});

/** A stand-in for the SDK client: just the one method the extractor calls. */
const fakeClient = (reply: object) =>
  ({ beta: { messages: { parse: async () => reply } } }) as unknown as Anthropic;

test("Claude's structured answer is passed through", async () => {
  const guess = { isMeeting: true, confidence: 0.9, title: "Site walk", start: "2026-10-08T14:00", end: null, location: null };
  const x = new ClaudeExtractor({ client: fakeClient({ stop_reason: "end_turn", parsed_output: guess }) });
  assert.deepEqual(await x.readMeeting("Walk", "Thursday at 2", new Date()), guess);
});

test("a refusal or an unparseable answer is no answer", async () => {
  const refused = new ClaudeExtractor({ client: fakeClient({ stop_reason: "refusal", parsed_output: null }) });
  assert.equal(await refused.readMeeting("x", "y", new Date()), null);
  const empty = new ClaudeExtractor({ client: fakeClient({ stop_reason: "end_turn", parsed_output: null }) });
  assert.equal(await empty.readMeeting("x", "y", new Date()), null);
});

test("pictures that are not images are never sent", async () => {
  let called = false;
  const client = { beta: { messages: { parse: async () => ((called = true), {}) } } } as unknown as Anthropic;
  assert.equal(await new ClaudeExtractor({ client }).readPicture("application/pdf", "AAAA"), null);
  assert.equal(called, false);
});
