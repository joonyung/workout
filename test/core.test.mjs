import test from "node:test";
import assert from "node:assert/strict";
import {
  completedSets,
  createSessionFromPlan,
  inBodyWindow,
  mergeInBodyRows,
  mergeSessions,
  normalizeSeries,
  parseCsvLine,
  parseInBodyCsv,
  planNeedsRefresh,
  previousSessionForPlan,
  sessionProgress,
  weeklyStats,
  workingSets
} from "../src/core.js";

test("parseCsvLine handles commas and escaped quotes", () => {
  assert.deepEqual(
    parseCsvLine('"체육관, 강남","상태 ""좋음""",10'),
    ["체육관, 강남", '상태 "좋음"', "10"]
  );
});

test("parseInBodyCsv maps source headers and sorts through merge", () => {
  const rows = parseInBodyCsv(
    "날짜,체중(kg),골격근량(kg),체지방량(kg),체지방률(%)\n" +
    "20260703200811,69.2,33.1,10.5,15.2\n"
  );

  assert.equal(rows[0].date, "2026-07-03");
  assert.equal(rows[0].skeletalMuscleKg, 33.1);
  assert.deepEqual(
    mergeInBodyRows([{ date: "2026-07-04", weightKg: 69 }], rows).map((row) => row.date),
    ["2026-07-03", "2026-07-04"]
  );
});

test("createSessionFromPlan creates target sets and carries previous values", () => {
  const plan = {
    id: "plan-a",
    date: "2026-07-12",
    title: "A",
    focus: "기준선",
    generatedAt: "2026-07-12T00:00:00.000Z",
    phase: "Calibration",
    exercises: [{
      id: "press",
      name: "프레스",
      muscleGroup: "가슴",
      targetSets: 2,
      repRange: [6, 10],
      targetRpe: 7,
      restSeconds: 120,
      startingWeightKg: 50
    }]
  };
  const previous = {
    exercises: [{
      id: "press",
      sets: [
        { setType: "warmup", weightKg: 20, reps: 10 },
        { setType: "working", weightKg: 50, reps: 10 },
        { setType: "working", weightKg: 50, reps: 9 }
      ]
    }]
  };
  const session = createSessionFromPlan(plan, previous, new Date("2026-07-12T08:00:00+09:00"));

  assert.equal(session.date, "2026-07-12");
  assert.equal(session.exercises[0].sets.length, 2);
  assert.equal(session.exercises[0].sets[0].setType, "working");
  assert.equal(session.exercises[0].sets[0].weightKg, 50);
  assert.equal(session.exercises[0].sets[0].rpe, "");
  assert.equal(session.exercises[0].sets[0].previousWeightKg, 50);
  assert.equal(session.exercises[0].sets[1].previousReps, 9);
});

test("mergeSessions keeps the most recently updated copy", () => {
  const result = mergeSessions(
    [{ id: "a", updatedAt: "2026-07-12T02:00:00Z", notes: "local" }],
    [{ id: "a", updatedAt: "2026-07-12T01:00:00Z", notes: "remote" }]
  );
  assert.equal(result[0].notes, "local");
});

test("previousSessionForPlan collects each exercise from its latest finished session", () => {
  const sessions = [
    {
      finishedAt: "2026-07-10T10:00:00Z",
      exercises: [{ id: "row", sets: [{ weightKg: 60, reps: 10 }] }]
    },
    {
      finishedAt: "2026-07-06T10:00:00Z",
      exercises: [{ id: "bench", sets: [{ weightKg: 75, reps: 8 }] }]
    }
  ];
  const previous = previousSessionForPlan(sessions, {
    exercises: [{ id: "bench" }, { id: "row" }]
  });

  assert.deepEqual(previous.exercises.map((exercise) => exercise.id), ["bench", "row"]);
});

test("progress counts all checked sets while weekly stats exclude warmups", () => {
  const session = {
    id: "a",
    date: "2026-07-06",
    startedAt: "2026-07-06T10:00:00Z",
    finishedAt: "2026-07-06T11:00:00Z",
    exercises: [{
      id: "pull-up",
      name: "풀업",
      muscleGroup: "등",
      targetSets: 2,
      sets: [
        { completed: true, setType: "warmup", weightKg: "", reps: 8 },
        { completed: true, weightKg: 10, reps: 6 }
      ]
    }]
  };

  assert.equal(completedSets(session).length, 2);
  assert.equal(workingSets(session).length, 1);
  assert.equal(sessionProgress(session).ratio, 1);
  const stats = weeklyStats([session], new Date("2026-07-12T12:00:00+09:00"));
  assert.equal(stats.completed, 1);
  assert.equal(stats.tonnage, 60);
});

test("planNeedsRefresh compares plan and local date", () => {
  assert.equal(planNeedsRefresh({ date: "2026-07-12" }, "2026-07-12"), false);
  assert.equal(planNeedsRefresh({ date: "2026-07-11" }, "2026-07-12"), true);
});

test("inBodyWindow anchors ranges to the latest measurement date", () => {
  const rows = [
    { date: "2024-10-10", weightKg: 69.4 },
    { date: "2025-06-30", weightKg: 70.6 },
    { date: "2025-07-10", weightKg: 71.7 },
    { date: "2026-07-03", weightKg: 69.2 }
  ];

  assert.deepEqual(
    inBodyWindow(rows, "1y").rows.map((row) => row.date),
    ["2025-07-10", "2026-07-03"]
  );
  assert.deepEqual(
    inBodyWindow(rows, "2y").rows.map((row) => row.date),
    rows.map((row) => row.date)
  );
  assert.equal(inBodyWindow(rows, "all").startMs, Date.parse("2024-10-10T12:00:00Z"));
});

test("normalizeSeries indexes the first visible measurement to 100", () => {
  const normalized = normalizeSeries([
    { date: "2025-07-10", weightKg: 71.7 },
    { date: "2026-07-03", weightKg: 69.2 }
  ], "weightKg");

  assert.equal(normalized[0].normalizedValue, 100);
  assert.equal(Number(normalized[1].normalizedValue.toFixed(2)), 96.51);
});
