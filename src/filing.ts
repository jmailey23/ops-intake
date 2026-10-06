/**
 * Which job a piece of work belongs to.
 *
 * Deliberately not a model. Filing a note against the wrong job corrupts that
 * job's history, and nobody notices until a client asks why their kitchen has
 * someone else's plumbing on it. An unfiled note is visible; a misfiled one is
 * not. So the rule is whole-word alias matching, and it refuses to guess:
 *
 *   one job named      -> filed
 *   two or more named  -> ambiguous, waits for a person
 *   none named         -> general, the team's shared list
 *
 * The same rule exists in SQL (schema/001_ops.sql, file_text) so a backfill, an
 * alias edit and live ingest can never disagree.
 */
import type { Filing, Job } from "./types.ts";

export function fileToJob(text: string, jobs: Job[]): Filing {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const hits = new Set<string>();
  for (const job of jobs) {
    for (const alias of job.aliases) {
      const needle = alias.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (needle && haystack.includes(` ${needle} `)) hits.add(job.id);
    }
  }
  if (hits.size === 1) return { status: "filed", jobId: [...hits][0] };
  if (hits.size > 1) return { status: "ambiguous", candidates: [...hits].sort() };
  return { status: "general" };
}
