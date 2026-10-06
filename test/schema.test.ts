/**
 * The schema against a real Postgres (PGlite, in process). Policies are
 * checked as an ordinary role, because a superuser walks straight past RLS.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const ids = {
  dana: "00000000-0000-0000-0000-00000000000a",
  priya: "00000000-0000-0000-0000-00000000000b",
  sam: "00000000-0000-0000-0000-00000000000c",
  alder: "00000000-0000-0000-0000-0000000000a1",
  ridge: "00000000-0000-0000-0000-0000000000a2",
};

async function as(person: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; set app.uid = '${person ?? ""}'; set role app_user;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}

before(async () => {
  await db.exec(readFileSync(new URL("../schema/001_ops.sql", import.meta.url), "utf8"));
  await db.exec(`
    create role app_user nologin;
    grant usage on schema public to app_user;
    grant select, update on all tables in schema public to app_user;
    grant execute on all functions in schema public to app_user;

    insert into people (id, name, role, auth_uid) values
      ('${ids.dana}',  'Dana',  'owner', '${ids.dana}'),
      ('${ids.priya}', 'Priya', 'office', '${ids.priya}'),
      ('${ids.sam}',   'Sam',   'crew',  '${ids.sam}');
    insert into jobs (id, name, aliases) values
      ('${ids.alder}', '4412 Alder Ave', '{alder,"alder ave"}'),
      ('${ids.ridge}', 'Ridge Rd addition', '{ridge,"ridge rd"}');
    insert into job_people values ('${ids.ridge}', '${ids.sam}');

    insert into captures (id, message_id, from_addr, to_addr, received_at, internal)
      values ('00000000-0000-0000-0000-0000000000c1', 'm1', 'dana@oakline.co', 'priya@oakline.co', now(), true);
    insert into items (capture_id, title, job_id, needs_owner_decision) values
      ('00000000-0000-0000-0000-0000000000c1', 'Tile for Alder', '${ids.alder}', false),
      ('00000000-0000-0000-0000-0000000000c1', 'Gutters at Ridge', '${ids.ridge}', false),
      ('00000000-0000-0000-0000-0000000000c1', 'Revised estimate for Alder', '${ids.alder}', true);
  `);
});

test("file_text: one job files, two wait, none is general, words are whole", async () => {
  const f = async (t: string) => (await db.query<{ job_id: string | null; candidates: string[] }>("select * from file_text($1)", [t])).rows[0];
  assert.equal((await f("tile for Alder Ave")).job_id, ids.alder);
  assert.deepEqual((await f("permit at Alder and Ridge")).candidates, [ids.alder, ids.ridge]);
  assert.equal((await f("sharpen the blades")).job_id, null);
  assert.equal((await f("the ridgeline vent")).job_id, null);
});

test("captures cannot be edited or deleted, even by a superuser", async () => {
  await assert.rejects(db.exec("update captures set subject = 'x'"), /immutable/);
  await assert.rejects(db.exec("delete from captures"), /immutable/);
});

test("the office sees every item; crew sees only the jobs they are on", async () => {
  assert.equal((await as(ids.priya, "select title from items")).rows.length, 3);
  const crew = await as(ids.sam, "select title from items");
  assert.deepEqual(crew.rows.map((r: any) => r.title), ["Gutters at Ridge"]);
});

test("raw mail is office only", async () => {
  assert.equal((await as(ids.priya, "select * from captures")).rows.length, 1);
  assert.equal((await as(ids.sam, "select * from captures")).rows.length, 0);
});

test("nobody signed in sees nothing", async () => {
  assert.equal((await as(null, "select * from items")).rows.length, 0);
});

test("only the owner settles an owner decision", async () => {
  const sql = "update items set decision = 'approved', status = 'done' where needs_owner_decision";
  await assert.rejects(as(ids.priya, sql), /only the owner/);
  await as(ids.dana, sql);
  const row = (await db.query<{ decided_by: string }>("select decided_by from items where needs_owner_decision")).rows[0];
  assert.equal(row.decided_by, ids.dana);
});
