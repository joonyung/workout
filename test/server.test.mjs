import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);

async function startServer() {
  const stateRoot = await mkdtemp(join(tmpdir(), "workout-server-test-"));
  await mkdir(join(stateRoot, "data", "workouts"), { recursive: true });
  await mkdir(join(stateRoot, "data", "gyms"), { recursive: true });
  await mkdir(join(stateRoot, "data", "plans"), { recursive: true });
  await mkdir(join(stateRoot, "inbody"), { recursive: true });

  const child = spawn(process.execPath, ["scripts/dev-server.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      WORKOUT_STATE_ROOT: stateRoot,
      REQUIRE_ORIGIN: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const baseUrl = await new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server start timed out. ${stderr}`)), 5000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const match = chunk.match(/Workout OS running at (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (!match) return;
      clearTimeout(timeout);
      resolveUrl(match[1]);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with ${code}. ${stderr}`));
    });
  });

  return { baseUrl, child, stateRoot };
}

test("server restricts static files, checks origins, and rejects stale workouts", async (t) => {
  let server;
  try {
    server = await startServer();
  } catch (error) {
    if (String(error).includes("listen EPERM")) {
      t.skip("The current sandbox does not allow local TCP listeners.");
      return;
    }
    throw error;
  }
  t.after(async () => {
    server.child.kill("SIGTERM");
    await rm(server.stateRoot, { recursive: true, force: true });
  });

  assert.equal((await fetch(`${server.baseUrl}api/health`)).status, 200);
  assert.equal((await fetch(`${server.baseUrl}AGENTS.md`)).status, 404);

  const workout = {
    id: "workout-test",
    date: "2026-08-12",
    updatedAt: "2026-08-12T10:00:00.000Z",
    exercises: []
  };
  const blocked = await fetch(`${server.baseUrl}api/workouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workout)
  });
  assert.equal(blocked.status, 403);

  const saved = await fetch(`${server.baseUrl}api/workouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": server.baseUrl.slice(0, -1)
    },
    body: JSON.stringify(workout)
  });
  assert.equal(saved.status, 200);

  const stale = await fetch(`${server.baseUrl}api/workouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": server.baseUrl.slice(0, -1)
    },
    body: JSON.stringify({
      ...workout,
      updatedAt: "2026-08-12T09:00:00.000Z",
      notes: "stale"
    })
  });
  assert.deepEqual(await stale.json(), {
    ok: true,
    discarded: true,
    reason: "stale",
    currentUpdatedAt: workout.updatedAt
  });

  const stored = JSON.parse(await readFile(
    join(server.stateRoot, "data", "workouts", "workout-test.json"),
    "utf8"
  ));
  assert.equal(stored.notes, undefined);
  assert.equal(stored.updatedAt, workout.updatedAt);
});
