import assert from "node:assert/strict";
import { test } from "node:test";
import { fileToJob } from "../src/filing.ts";
import { assigneeFor, classify, isMachineMail, splitTasks } from "../src/rules.ts";
import { jobs, team } from "../demo/fixtures.ts";

test("a bulleted note becomes one task per line, signature dropped", () => {
  const tasks = splitTasks("Tomorrow", "- order tile\n- swap dumpster\n\nSent from my iPhone\n- not a task");
  assert.deepEqual(tasks, ["Order tile", "Swap dumpster"]);
});

test("a single line note is titled by its subject", () => {
  assert.deepEqual(splitTasks("Gutters at Ridge", "Downspout is loose on the north side."), ["Gutters at Ridge"]);
});

test("a subject that only names the job defers to the body", () => {
  assert.deepEqual(splitTasks("Hollis", "Supply line leaking. Get the plumber out.", ["hollis"]), ["Supply line leaking"]);
});

test("money, scope and unhappy clients go to the owner", () => {
  assert.equal(classify("send the revised estimate").needsOwnerDecision, true);
  assert.equal(classify("client is unhappy with the grout color").needsOwnerDecision, true);
  assert.equal(classify("sweep the garage").needsOwnerDecision, false);
});

test("a change order is not a material order", () => {
  assert.equal(classify("call about the change order").kind, "task");
  assert.equal(classify("order the tile").kind, "material");
});

test("leaks are urgent issues", () => {
  assert.deepEqual(classify("supply line is leaking"), { kind: "issue", urgent: true, needsOwnerDecision: false });
});

test("calendar invites and auto replies are machine mail", () => {
  assert.equal(isMachineMail("Invitation: site walk @ Fri 10am"), true);
  assert.equal(isMachineMail("Re: Automatic reply: out today"), true);
  assert.equal(isMachineMail("Site walk", ["text/calendar"]), true);
  assert.equal(isMachineMail("Invitations went out to the subs"), false);
});

test("a leading name delegates, a name mid sentence does not", () => {
  assert.equal(assigneeFor("Marcus order the tile", team, "p-dana")?.id, "p-marcus");
  assert.equal(assigneeFor("ask Marcus about tile", team, "p-dana"), null);
  assert.equal(assigneeFor("Dana call the client", team, "p-dana"), null, "the writer is not their own assignee");
});

test("filing refuses to guess", () => {
  assert.deepEqual(fileToJob("tile for Alder", jobs), { status: "filed", jobId: "j-alder" });
  assert.deepEqual(fileToJob("permit at Alder and Ridge", jobs), { status: "ambiguous", candidates: ["j-alder", "j-ridge"] });
  assert.deepEqual(fileToJob("sharpen the blades", jobs), { status: "general" });
});

test("filing matches whole words only", () => {
  assert.deepEqual(fileToJob("the ridgeline vent", jobs), { status: "general" });
});
