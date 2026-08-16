import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  canonicalJson,
  getJournalPath,
  hashJournalEvent,
  RunJournalWriter,
  verifyJournalChain,
} from "./run-journal.ts";
import type { RunJournalEvent } from "../types.ts";

async function withRunDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir();
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function seedJournal(dir: string): Promise<RunJournalWriter> {
  const writer = await RunJournalWriter.open(dir, "r1");
  await writer.append({
    kind: "run_started",
    config_path: "workflow.yaml",
    started_at: "2026-08-16T00:00:00.000Z",
    args: {},
    env_keys: [],
  });
  await writer.append({ kind: "attempt_started", node_id: "build" });
  await writer.append({ kind: "attempt_started", node_id: "test" });
  return writer;
}

async function readEvents(dir: string): Promise<RunJournalEvent[]> {
  const text = await Deno.readTextFile(getJournalPath(dir));
  return text.trim().split("\n").map((l) => JSON.parse(l) as RunJournalEvent);
}

Deno.test("FR-E92 canonicalJson — key order does not change the encoding", () => {
  assertEquals(
    canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
    canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
  );
});

Deno.test("FR-E92 every appended event carries a hash linked to its predecessor", async () => {
  await withRunDir(async (dir) => {
    await seedJournal(dir);
    const events = await readEvents(dir);

    assertEquals(events.length, 3);
    assertEquals(events[0].prev_hash, "");
    for (let i = 0; i < events.length; i++) {
      assert(events[i].hash, `event ${i} has no hash`);
      assertEquals(events[i].hash, await hashJournalEvent(events[i]));
      if (i > 0) assertEquals(events[i].prev_hash, events[i - 1].hash);
    }
  });
});

Deno.test("FR-E92 verifyJournalChain accepts an untouched journal", async () => {
  await withRunDir(async (dir) => {
    await seedJournal(dir);
    const result = await verifyJournalChain(dir);
    assertEquals(result.ok, true);
    assertEquals(result.verified, 3);
    assertEquals(result.broken, undefined);
  });
});

Deno.test("FR-E92 an edited record is reported at its own sequence number", async () => {
  await withRunDir(async (dir) => {
    await seedJournal(dir);
    const events = await readEvents(dir);
    (events[1] as { node_id: string }).node_id = "tampered";
    await Deno.writeTextFile(
      getJournalPath(dir),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const result = await verifyJournalChain(dir);
    assertEquals(result.ok, false);
    assertEquals(result.broken?.seq, events[1].seq);
    assertEquals(result.broken?.reason, "hash_mismatch");
    // The report identifies the record as written, not as edited: `event_id`
    // was minted at append time from the original payload, which is exactly
    // what an operator greps for in the file.
    assertEquals(result.broken?.event_id, events[1].event_id);
    assertStringIncludes(result.broken?.event_id ?? "", "attempt_started");
  });
});

Deno.test("FR-E92 a removed record is reported at the record that followed it", async () => {
  await withRunDir(async (dir) => {
    await seedJournal(dir);
    const events = await readEvents(dir);
    const kept = [events[0], events[2]];
    await Deno.writeTextFile(
      getJournalPath(dir),
      kept.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const result = await verifyJournalChain(dir);
    assertEquals(result.ok, false);
    assertEquals(result.broken?.seq, events[2].seq);
    assertEquals(result.broken?.reason, "prev_hash_mismatch");
  });
});

Deno.test("FR-E92 verification names the first divergence, not the last", async () => {
  await withRunDir(async (dir) => {
    await seedJournal(dir);
    const events = await readEvents(dir);
    (events[1] as { node_id: string }).node_id = "first-edit";
    (events[2] as { node_id: string }).node_id = "second-edit";
    await Deno.writeTextFile(
      getJournalPath(dir),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const result = await verifyJournalChain(dir);
    assertEquals(result.broken?.seq, events[1].seq);
    assertEquals(result.verified, 1);
  });
});

Deno.test("FR-E92 a journal written before hashing existed verifies as unchained", async () => {
  await withRunDir(async (dir) => {
    await Deno.writeTextFile(
      getJournalPath(dir),
      JSON.stringify({
        schema_version: 1,
        run_id: "r1",
        seq: 1,
        event_id: "r1:1:run_started",
        ts: "2026-08-16T00:00:00.000Z",
        kind: "run_started",
        config_path: "workflow.yaml",
        started_at: "2026-08-16T00:00:00.000Z",
        args: {},
        env_keys: [],
      }) + "\n",
    );

    const result = await verifyJournalChain(dir);
    assertEquals(result.ok, true);
    assertEquals(result.verified, 0);
    assertEquals(result.unchained, 1);
  });
});

Deno.test("FR-E92 a writer reopened on an existing journal continues the chain", async () => {
  await withRunDir(async (dir) => {
    await seedJournal(dir);
    const reopened = await RunJournalWriter.open(dir, "r1");
    await reopened.append({ kind: "attempt_started", node_id: "deploy" });

    const events = await readEvents(dir);
    assertEquals(events.length, 4);
    assertEquals(events[3].prev_hash, events[2].hash);
    assertEquals((await verifyJournalChain(dir)).ok, true);
  });
});
