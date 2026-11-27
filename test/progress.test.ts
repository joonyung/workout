import test from "node:test";
import assert from "node:assert/strict";
import {
  exerciseProgressions,
  inBodyMetricTrend,
  inBodyWindow,
  isSettledSession,
  latestMuscleGroups,
  muscleVolume,
  progressionStatus,
  reviewEndDate,
  rollingTrainingSummary,
  shiftIsoDate
} from "../src/core.ts";
import type { ExerciseSessionPoint, WorkoutSession, WorkoutSet } from "../src/types.ts";

function set(weightKg: number | null, reps: number, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  return { weightKg: weightKg ?? "", reps, completed: true, setType: "working", ...extra };
}

function session(
  date: string,
  exercises: Array<{ id: string; name?: string; muscleGroup?: string; sets: WorkoutSet[] }>,
  extra: Partial<WorkoutSession> = {}
): WorkoutSession {
  return {
    id: `s-${date}-${exercises.map((exercise) => exercise.id).join("-")}`,
    date,
    startedAt: `${date}T09:00:00.000Z`,
    finishedAt: `${date}T10:00:00.000Z`,
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name || exercise.id,
      muscleGroup: exercise.muscleGroup || "가슴",
      targetSets: exercise.sets.length,
      repRange: [8, 12],
      targetRpe: 8,
      restSeconds: 120,
      sets: exercise.sets
    })),
    ...extra
  };
}

function point(topLoadKg: number | null, topReps: number[], date = "2026-11-01"): ExerciseSessionPoint {
  return {
    date,
    sessionId: date,
    topLoad: topLoadKg,
    topLoadKg,
    topReps,
    lighterSets: 0,
    bestE1rmKg: topLoadKg
  };
}

test("shiftIsoDate moves calendar days across month boundaries", () => {
  assert.equal(shiftIsoDate("2026-11-27", -7), "2026-11-20");
  assert.equal(shiftIsoDate("2026-03-01", -1), "2026-02-28");
});

test("today's unfinished session is in progress and ends the review window yesterday", () => {
  const sessions = [
    session("2026-11-25", [{ id: "bench", sets: [set(80, 10)] }]),
    session("2026-11-27", [{ id: "bench", sets: [set(82.5, 8)] }], { finishedAt: null })
  ];
  assert.equal(isSettledSession(sessions[1], "2026-11-27"), false);
  assert.equal(isSettledSession(sessions[1], "2026-11-28"), true);
  assert.equal(reviewEndDate(sessions, "2026-11-27"), "2026-11-26");
  assert.equal(reviewEndDate(sessions.slice(0, 1), "2026-11-27"), "2026-11-27");
});

test("rollingTrainingSummary compares 7 days with the prior 3-week weekly average", () => {
  const sessions = [
    // Prior weeks: 3 + 3 + 0 working sets.
    session("2026-11-01", [{ id: "bench", sets: [set(80, 10), set(80, 10), set(80, 10)] }]),
    session("2026-11-10", [{ id: "bench", sets: [set(80, 10), set(80, 10), set(80, 10, { completed: false })] }]),
    // Recent window (11-21 .. 11-27): 2 of 2 sets plus warmup and cardio.
    session("2026-11-24", [{
      id: "bench",
      sets: [set(40, 10, { setType: "warmup" }), set(80, 10), set(80, 10)]
    }], {
      cardio: [{
        id: "bike",
        name: "bike",
        targetMinutes: 15,
        rpeRange: [3, 4],
        durationMinutes: 12,
        distanceKm: "",
        averageHeartRate: "",
        rpe: "",
        completed: true,
        completedAt: null
      }]
    })
  ];
  const summary = rollingTrainingSummary(sessions, "2026-11-27");

  assert.equal(summary.endDate, "2026-11-27");
  assert.deepEqual(summary.recent, {
    sessions: 1,
    workingSets: 2,
    plannedSets: 2,
    adherence: 1,
    cardioMinutes: 12
  });
  assert.equal(summary.priorWeeks, 3);
  assert.equal(summary.priorWeeklyAverage?.workingSets, 5 / 3);
  assert.equal(summary.priorWeeklyAverage?.adherence, 5 / 6);
});

test("rollingTrainingSummary averages only weeks covered by history", () => {
  const sessions = [
    session("2026-11-18", [{ id: "bench", sets: [set(80, 10), set(80, 10)] }]),
    session("2026-11-24", [{ id: "bench", sets: [set(80, 10)] }])
  ];
  const summary = rollingTrainingSummary(sessions, "2026-11-27");
  assert.equal(summary.priorWeeks, 1);
  assert.equal(summary.priorWeeklyAverage?.workingSets, 2);

  const fresh = rollingTrainingSummary(sessions.slice(1), "2026-11-27");
  assert.equal(fresh.priorWeeklyAverage, null);
});

test("muscleVolume groups each exercise by its latest muscle label", () => {
  const sessions = [
    session("2026-11-05", [{ id: "lateral", muscleGroup: "어깨", sets: [set(20, 15), set(20, 15)] }]),
    session("2026-11-24", [
      { id: "lateral", muscleGroup: "측면 삼각근", sets: [set(25, 15), set(25, 15)] },
      { id: "bench", muscleGroup: "가슴", sets: [set(80, 10), set(80, 10), set(40, 10, { setType: "warmup" })] }
    ])
  ];
  assert.equal(latestMuscleGroups(sessions).get("lateral"), "측면 삼각근");

  const rows = muscleVolume(sessions, "2026-11-27");
  assert.deepEqual(rows.map((row) => row.muscleGroup), ["가슴", "측면 삼각근"]);
  assert.equal(rows[0].recentSets, 2);
  assert.equal(rows[1].recentSets, 2);
  assert.equal(rows[1].priorWeeklyAverage, 2 / 3);
});

test("progressionStatus follows the protocol's load, reps, and stall rules", () => {
  assert.equal(progressionStatus([point(80, [10, 10, 10])]).status, "baseline");
  assert.equal(progressionStatus([point(80, [10, 10, 10]), point(82.5, [8, 8])]).status, "load-up");
  assert.equal(progressionStatus([point(80, [10, 10, 10]), point(77.5, [10, 10, 10])]).status, "load-down");
  assert.equal(progressionStatus([point(80, [10, 8, 8]), point(80, [10, 10, 9])]).status, "reps-up");
  assert.equal(progressionStatus([point(80, [10, 10, 10]), point(80, [10, 8, 8])]).status, "reps-down");
  assert.deepEqual(progressionStatus([point(80, [10, 10]), point(80, [10, 10])]), {
    status: "holding",
    holdStreak: 1
  });
  assert.deepEqual(progressionStatus([
    point(80, [10, 10, 10]),
    point(80, [10, 10, 9]),
    point(80, [10, 10, 9]),
    point(80, [10, 9, 9])
  ]), { status: "stalled", holdStreak: 3 });
});

test("progressionStatus matches sets so a planned set-count change is not a rep change", () => {
  // 3 sets -> 2 sets at the same load: matched reps 24 -> 24 is a hold, not a drop.
  assert.equal(progressionStatus([point(72.5, [12, 12, 7]), point(72.5, [12, 12])]).status, "holding");
  // Equal matched reps plus an extra set counts as a repetition gain.
  assert.equal(progressionStatus([point(70, [12, 12]), point(70, [12, 12, 10])]).status, "reps-up");
  // Bodyweight work compares repetitions only.
  assert.equal(progressionStatus([point(null, [12, 12]), point(null, [13, 12])]).status, "reps-up");
});

test("exerciseProgressions keeps lb loads native, compares in kg, and skips in-progress work", () => {
  const sessions = [
    session("2026-10-01", [{ id: "old-press", sets: [set(50, 10)] }]),
    session("2026-11-03", [{
      id: "leg-extension",
      name: "Leg Extension",
      muscleGroup: "대퇴사두",
      sets: [
        { weightLb: 115, reps: 15, completed: true, setType: "working" },
        { weightLb: 115, reps: 15, completed: true, setType: "working" }
      ]
    }]),
    session("2026-11-23", [{
      id: "leg-extension",
      name: "Leg Extension",
      muscleGroup: "대퇴사두",
      sets: [
        { weightLb: 135, reps: 15, completed: true, setType: "working" },
        { weightLb: 135, reps: 15, completed: true, setType: "working" },
        { weightLb: 135, reps: 12, completed: true, setType: "working", validForProgression: false }
      ]
    }]),
    session("2026-11-27", [{
      id: "leg-extension",
      name: "Leg Extension",
      muscleGroup: "대퇴사두",
      sets: [{ weightLb: 140, reps: 6, completed: true, setType: "working" }]
    }], { finishedAt: null })
  ];
  const [extension, ...rest] = exerciseProgressions(sessions, "2026-11-27");

  assert.equal(rest.length, 0, "exercises not trained in the last 28 days are omitted");
  assert.equal(extension.unit, "lb");
  assert.equal(extension.latest.date, "2026-11-23");
  assert.equal(extension.latest.topLoad, 135);
  assert.deepEqual(extension.latest.topReps, [15, 15]);
  assert.equal(extension.status, "load-up");
  assert.equal(Number(extension.latest.topLoadKg?.toFixed(3)), 61.235);
  assert.equal(Number(extension.e1rmChange?.toFixed(4)), Number((135 / 115 - 1).toFixed(4)));
});

test("exerciseProgressions orders by latest session, then by exercise order", () => {
  const sessions = [
    session("2026-11-20", [{ id: "squat", sets: [set(90, 8)] }, { id: "row", sets: [set(55, 12)] }]),
    session("2026-11-23", [{ id: "bench", sets: [set(80, 10)] }, { id: "pulldown", sets: [set(60, 12)] }])
  ];
  assert.deepEqual(
    exerciseProgressions(sessions, "2026-11-27").map((item) => item.exerciseId),
    ["bench", "pulldown", "squat", "row"]
  );
});

test("inBodyMetricTrend reports range change and a same-direction run of 3+", () => {
  const rows = [
    { date: "2026-07-03", bodyFatKg: 10.5, skeletalMuscleKg: 33.1 },
    { date: "2026-09-06", bodyFatKg: 8.8, skeletalMuscleKg: 34.5 },
    { date: "2026-10-14", bodyFatKg: 8.9, skeletalMuscleKg: 34.4 },
    { date: "2026-11-13", bodyFatKg: 8.6, skeletalMuscleKg: 35.1 },
    { date: "2026-11-27", bodyFatKg: 8.2, skeletalMuscleKg: 35.0 }
  ];
  const fat = inBodyMetricTrend(rows, "bodyFatKg");
  assert.equal(fat.count, 5);
  assert.equal(fat.first?.date, "2026-07-03");
  assert.equal(Number(fat.previousDelta?.toFixed(1)), -0.4);
  assert.equal(Number(fat.rangeDelta?.toFixed(1)), -2.3);
  assert.equal(fat.runLength, 3);
  assert.equal(fat.runDirection, "down");

  const muscle = inBodyMetricTrend(rows, "skeletalMuscleKg");
  assert.equal(muscle.runLength, 0, "a single reversal resets the run");
  assert.equal(muscle.runDirection, null);

  const single = inBodyMetricTrend(rows.slice(0, 1), "bodyFatKg");
  assert.equal(single.previousDelta, null);
  assert.equal(single.rangeDelta, null);
});

test("inBodyWindow supports a 6-month range", () => {
  const rows = [
    { date: "2026-05-01", weightKg: 70 },
    { date: "2026-06-01", weightKg: 69.5 },
    { date: "2026-11-27", weightKg: 69.4 }
  ];
  assert.deepEqual(inBodyWindow(rows, "6m").rows.map((row) => row.date), ["2026-06-01", "2026-11-27"]);
});
