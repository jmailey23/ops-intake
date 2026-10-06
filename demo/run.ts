/**
 * npm run demo                  rules only, no network
 * npm run demo -- --with-claude meeting detection by Claude as well
 */
import { ClaudeExtractor, NoExtractor } from "../src/extract.ts";
import { createPipeline } from "../src/pipeline.ts";
import { MemoryStore } from "../src/store.ts";
import type { Filing } from "../src/types.ts";
import { jobs, mail, team } from "./fixtures.ts";

const withClaude = process.argv.includes("--with-claude");
const store = new MemoryStore();
const pipeline = createPipeline({ team, jobs, store, extractor: withClaude ? new ClaudeExtractor() : NoExtractor });

const jobName = (f: Filing) =>
  f.status === "filed"
    ? jobs.find((j) => j.id === f.jobId)!.name
    : f.status === "ambiguous"
      ? `needs a person (${f.candidates.map((id) => jobs.find((j) => j.id === id)!.name).join(" or ")})`
      : "general";
const who = (id: string | null) => team.find((p) => p.id === id)?.name.split(" ")[0] ?? "team";

for (const m of mail) {
  const r = await pipeline.ingest(m);
  console.log(`\n${m.messageId}  "${m.subject}"`);
  if (r.duplicate) {
    console.log("  already ingested, skipped");
    continue;
  }
  if (!r.internal) {
    const c = store.captures.find((c) => c.id === r.captureId)!;
    console.log(`  outside or machine mail: kept on file, no task  ->  ${jobName(c.filing)}`);
    continue;
  }
  for (const i of r.items) {
    const flags = [i.kind !== "task" && i.kind, i.urgent && "URGENT", i.needsOwnerDecision && "owner decides"]
      .filter(Boolean)
      .join(", ");
    console.log(`  [${who(i.ownerId)}] ${i.title}${flags ? `  (${flags})` : ""}  ->  ${jobName(i.filing)}`);
  }
  if (r.meeting) console.log(`  + meeting: ${r.meeting.title} at ${r.meeting.startsAt} (${r.meeting.confidence})`);
}

const items = store.items;
const jobRelated = items.filter((i) => i.filing.status !== "general");
const filed = jobRelated.filter((i) => i.filing.status === "filed");
console.log(
  `\n${store.captures.length} captures, ${items.length} items, ` +
    `${filed.length} of ${jobRelated.length} job related items filed automatically, ` +
    `${items.filter((i) => i.needsOwnerDecision).length} for the owner, ${store.meetings.length} meetings`,
);
