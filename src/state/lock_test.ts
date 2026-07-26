import { assertEquals, assertRejects } from "@std/assert";
import {
  acquireLock,
  defaultLockPath,
  isRunLive,
  liveLockHolder,
  type LockInfo,
  readLockInfo,
  releaseLock,
} from "./lock.ts";

Deno.test("FR-E54 readLockInfo — valid JSON of the wrong shape is a SyntaxError", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  // `null`, arrays and pid-less records parse as JSON but are not locks.
  // Classifying them up front keeps "corrupt" a single, handled category
  // instead of a TypeError thrown from the first property access.
  for (const body of ["null", "[]", '{"run_id":"x"}']) {
    await Deno.writeTextFile(lockPath, body);
    await assertRejects(() => readLockInfo(lockPath), SyntaxError);
  }

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FR-E54 acquireLock — reclaims a structurally corrupt lock file", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  // Debris from a crashed writer names no PID, so it cannot be proven live.
  // Reclaiming it is the documented behaviour for corrupted locks.
  await Deno.writeTextFile(lockPath, "null");

  await acquireLock(lockPath, "run-after-corrupt");

  assertEquals((await readLockInfo(lockPath)).run_id, "run-after-corrupt");

  await releaseLock(lockPath);
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FR-E54 acquireLock — genuine I/O errors propagate (fail fast)", async () => {
  const tmpDir = await Deno.makeTempDir();
  // A directory at the lock path: `Deno.open(createNew)` reports
  // AlreadyExists, then reading it fails with an I/O error that is neither
  // NotFound nor SyntaxError. It must surface rather than be reclaimed —
  // reclaiming on an unexplained error is the destructive option.
  const lockPath = `${tmpDir}/.lock`;
  await Deno.mkdir(lockPath);

  await assertRejects(() => acquireLock(lockPath, "run-io-error"));

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FR-E54 acquireLock — creation is atomic against a concurrent racer", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  // Both callers observe an empty folder before either writes. With the old
  // read-then-write shape both concluded the workflow was free and both
  // "acquired" it; exclusive creation makes the kernel pick one winner.
  const results = await Promise.allSettled([
    acquireLock(lockPath, "run-a"),
    acquireLock(lockPath, "run-b"),
  ]);
  const granted = results.filter((r) => r.status === "fulfilled");
  assertEquals(granted.length, 1);

  await releaseLock(lockPath);
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("acquireLock — creates lock file with pid, hostname, and run_id", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  await acquireLock(lockPath, "run-001");

  const info = await readLockInfo(lockPath);
  assertEquals(info.run_id, "run-001");
  assertEquals(info.pid, Deno.pid);
  assertEquals(info.hostname, Deno.hostname());
  assertEquals(typeof info.started_at, "string");

  await releaseLock(lockPath);
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("acquireLock — fails if same-host live process holds lock", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  // Write a lock with current PID and hostname (simulates another running process)
  const fakeLock: LockInfo = {
    pid: Deno.pid,
    hostname: Deno.hostname(),
    run_id: "run-existing",
    started_at: new Date().toISOString(),
  };
  await Deno.writeTextFile(lockPath, JSON.stringify(fakeLock));

  let caught = false;
  try {
    await acquireLock(lockPath, "run-new");
  } catch (err) {
    caught = true;
    assertEquals((err as Error).message.includes("run-existing"), true);
    assertEquals((err as Error).message.includes("already running"), true);
  }
  assertEquals(caught, true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("acquireLock — reclaims stale lock from different host (dead PID)", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  // Lock from a different hostname with dead PID — should be reclaimed
  const remoteLock: LockInfo = {
    pid: 99999999, // PID doesn't exist locally
    hostname: "docker-container-abc123",
    run_id: "run-remote",
    started_at: new Date().toISOString(),
  };
  await Deno.writeTextFile(lockPath, JSON.stringify(remoteLock));

  // Dead PID → stale lock, reclaim regardless of hostname
  await acquireLock(lockPath, "run-local");

  const info = await readLockInfo(lockPath);
  assertEquals(info.run_id, "run-local");
  assertEquals(info.pid, Deno.pid);

  await releaseLock(lockPath);
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("acquireLock — reclaims stale lock (dead PID, same host)", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  // Lock with dead PID on same hostname — stale, should be reclaimed
  const staleLock: LockInfo = {
    pid: 99999999,
    hostname: Deno.hostname(),
    run_id: "run-stale",
    started_at: new Date().toISOString(),
  };
  await Deno.writeTextFile(lockPath, JSON.stringify(staleLock));

  // Should succeed — stale lock is reclaimed
  await acquireLock(lockPath, "run-fresh");

  const info = await readLockInfo(lockPath);
  assertEquals(info.run_id, "run-fresh");
  assertEquals(info.pid, Deno.pid);
  assertEquals(info.hostname, Deno.hostname());

  await releaseLock(lockPath);
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("acquireLock — reclaims lock without hostname field (backward compat)", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  // Old lock format without hostname — treat as same host, check PID
  const oldLock = {
    pid: 99999999,
    run_id: "run-old",
    started_at: new Date().toISOString(),
  };
  await Deno.writeTextFile(lockPath, JSON.stringify(oldLock));

  // PID is dead → should reclaim
  await acquireLock(lockPath, "run-new");

  const info = await readLockInfo(lockPath);
  assertEquals(info.run_id, "run-new");

  await releaseLock(lockPath);
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("releaseLock — removes lock file", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  await acquireLock(lockPath, "run-001");
  await releaseLock(lockPath);

  let exists = true;
  try {
    await Deno.stat(lockPath);
  } catch {
    exists = false;
  }
  assertEquals(exists, false);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("releaseLock — no error if lock file already removed", async () => {
  const tmpDir = await Deno.makeTempDir();
  const lockPath = `${tmpDir}/.lock`;

  // Should not throw even if file doesn't exist
  assertEquals(await releaseLock(lockPath), undefined);

  let exists = true;
  try {
    await Deno.stat(lockPath);
  } catch {
    exists = false;
  }
  assertEquals(exists, false);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("readLockInfo — throws if lock file missing", async () => {
  let caught = false;
  try {
    await readLockInfo("/nonexistent/.lock");
  } catch {
    caught = true;
  }
  assertEquals(caught, true);
});

// FR-E75: liveness probe for the unified command layer — tells `answer`
// whether the engine process is alive (and resuming) or whether the caller
// must resume separately.
Deno.test("FR-E75 isRunLive — true when lock holds matching run_id and live PID", async () => {
  const wf = await Deno.makeTempDir();
  const held: LockInfo = {
    pid: Deno.pid, // current process is alive by definition
    hostname: Deno.hostname(),
    run_id: "run-live",
    started_at: new Date().toISOString(),
  };
  await Deno.mkdir(`${wf}/runs`, { recursive: true });
  await Deno.writeTextFile(defaultLockPath(wf), JSON.stringify(held));

  assertEquals(await isRunLive(wf, "run-live"), true);

  await Deno.remove(wf, { recursive: true });
});

Deno.test("FR-E75 isRunLive — false when lock PID is dead", async () => {
  const wf = await Deno.makeTempDir();
  const dead: LockInfo = {
    pid: 99999999, // not a live PID
    hostname: Deno.hostname(),
    run_id: "run-dead",
    started_at: new Date().toISOString(),
  };
  await Deno.mkdir(`${wf}/runs`, { recursive: true });
  await Deno.writeTextFile(defaultLockPath(wf), JSON.stringify(dead));

  assertEquals(await isRunLive(wf, "run-dead"), false);

  await Deno.remove(wf, { recursive: true });
});

Deno.test("FR-E75 isRunLive — false when lock run_id does not match", async () => {
  const wf = await Deno.makeTempDir();
  const other: LockInfo = {
    pid: Deno.pid, // alive, but belongs to a different run
    hostname: Deno.hostname(),
    run_id: "run-other",
    started_at: new Date().toISOString(),
  };
  await Deno.mkdir(`${wf}/runs`, { recursive: true });
  await Deno.writeTextFile(defaultLockPath(wf), JSON.stringify(other));

  assertEquals(await isRunLive(wf, "run-requested"), false);

  await Deno.remove(wf, { recursive: true });
});

Deno.test("FR-E75 isRunLive — false when no lock file exists", async () => {
  const wf = await Deno.makeTempDir();
  assertEquals(await isRunLive(wf, "run-x"), false);
  await Deno.remove(wf, { recursive: true });
});

// FR-E84: pre-check for `startRun` background launch — "is ANY run active
// for this workflow folder", independent of a specific run_id.
Deno.test("FR-E84 liveLockHolder — returns info when a live process holds the lock", async () => {
  const wf = await Deno.makeTempDir();
  const held: LockInfo = {
    pid: Deno.pid, // current process is alive by definition
    hostname: Deno.hostname(),
    run_id: "run-live",
    started_at: new Date().toISOString(),
  };
  await Deno.mkdir(`${wf}/runs`, { recursive: true });
  await Deno.writeTextFile(defaultLockPath(wf), JSON.stringify(held));

  const holder = await liveLockHolder(wf);
  assertEquals(holder?.run_id, "run-live");
  assertEquals(holder?.pid, Deno.pid);

  await Deno.remove(wf, { recursive: true });
});

Deno.test("FR-E84 liveLockHolder — null when lock PID is dead", async () => {
  const wf = await Deno.makeTempDir();
  const dead: LockInfo = {
    pid: 99999999,
    hostname: Deno.hostname(),
    run_id: "run-dead",
    started_at: new Date().toISOString(),
  };
  await Deno.mkdir(`${wf}/runs`, { recursive: true });
  await Deno.writeTextFile(defaultLockPath(wf), JSON.stringify(dead));

  assertEquals(await liveLockHolder(wf), null);

  await Deno.remove(wf, { recursive: true });
});

Deno.test("FR-E84 liveLockHolder — null when no lock file exists", async () => {
  const wf = await Deno.makeTempDir();
  assertEquals(await liveLockHolder(wf), null);
  await Deno.remove(wf, { recursive: true });
});

Deno.test("defaultLockPath — derives <workflowDir>/runs/.lock (FR-E54)", () => {
  assertEquals(
    defaultLockPath(".flowai-workflow/github-inbox"),
    ".flowai-workflow/github-inbox/runs/.lock",
  );
  assertEquals(
    defaultLockPath(".flowai-workflow/github-inbox-opencode"),
    ".flowai-workflow/github-inbox-opencode/runs/.lock",
  );
  assertEquals(defaultLockPath("."), "./runs/.lock");
});

Deno.test("acquireLock — distinct workflow dirs hold independent locks (FR-E54)", async () => {
  // Two sibling workflow folders under one repo simulate the multi-workflow
  // layout (`.flowai-workflow/<a>` and `.flowai-workflow/<b>`).
  const tmpRoot = await Deno.makeTempDir();
  const wfA = `${tmpRoot}/wf-a`;
  const wfB = `${tmpRoot}/wf-b`;
  const lockA = defaultLockPath(wfA);
  const lockB = defaultLockPath(wfB);

  // Both acquire concurrently — must succeed even though the current PID is
  // the holder of lockA when lockB is acquired.
  await acquireLock(lockA, "run-a");
  await acquireLock(lockB, "run-b");

  const infoA = await readLockInfo(lockA);
  const infoB = await readLockInfo(lockB);
  assertEquals(infoA.run_id, "run-a");
  assertEquals(infoB.run_id, "run-b");
  assertEquals(infoA.pid, Deno.pid);
  assertEquals(infoB.pid, Deno.pid);

  await releaseLock(lockA);
  await releaseLock(lockB);
  await Deno.remove(tmpRoot, { recursive: true });
});

Deno.test("acquireLock — same workflow dir still serializes (FR-E54 carry-over of FR-E25)", async () => {
  // Per-workflow scope must NOT relax same-folder serialization: a live
  // PID holding `<workflowDir>/runs/.lock` still blocks a second acquire
  // against the same path.
  const tmpRoot = await Deno.makeTempDir();
  const wf = `${tmpRoot}/wf`;
  const lockPath = defaultLockPath(wf);

  // Simulate another live process holding the lock: write current PID
  // (alive by definition) and current hostname.
  await Deno.mkdir(`${wf}/runs`, { recursive: true });
  const held: LockInfo = {
    pid: Deno.pid,
    hostname: Deno.hostname(),
    run_id: "run-first",
    started_at: new Date().toISOString(),
  };
  await Deno.writeTextFile(lockPath, JSON.stringify(held));

  let caught = false;
  try {
    await acquireLock(lockPath, "run-second");
  } catch (err) {
    caught = true;
    assertEquals((err as Error).message.includes("run-first"), true);
  }
  assertEquals(caught, true);

  await Deno.remove(tmpRoot, { recursive: true });
});
