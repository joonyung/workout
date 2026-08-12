export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function todayIso(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function numberOrNull(value) {
  if (value === undefined || value === null || value === "" || value === "-") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell);
  return cells;
}

export function parseInBodyCsv(csvText) {
  const lines = String(csvText || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const rawDate = row["날짜"] || "";
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

    return {
      date,
      weightKg: numberOrNull(row["체중(kg)"]),
      skeletalMuscleKg: numberOrNull(row["골격근량(kg)"]),
      bodyFatKg: numberOrNull(row["체지방량(kg)"]),
      bodyFatPercent: numberOrNull(row["체지방률(%)"]),
      bmrKcal: numberOrNull(row["기초대사량(kcal)"]),
      inbodyScore: numberOrNull(row["인바디점수"]),
      waistHipRatio: numberOrNull(row["복부지방률"]),
      visceralFatLevel: numberOrNull(row["내장지방레벨(Level)"]),
      bodyWaterL: numberOrNull(row["체수분(L)"])
    };
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

export function mergeInBodyRows(...collections) {
  const byDate = new Map();

  for (const row of collections.flat()) {
    if (!row?.date) continue;
    const previous = byDate.get(row.date) || {};
    byDate.set(row.date, { ...previous, ...row });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function inBodyWindow(rows, range = "1y") {
  const sorted = [...(rows || [])]
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row?.date || ""))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { rows: [], startMs: null, endMs: null };

  const timestamp = (date) => Date.parse(date + "T12:00:00Z");
  const endMs = timestamp(sorted.at(-1).date);
  let startMs = timestamp(sorted[0].date);

  if (range === "1y" || range === "2y") {
    const start = new Date(endMs);
    start.setUTCFullYear(start.getUTCFullYear() - (range === "1y" ? 1 : 2));
    startMs = start.getTime();
  }

  return {
    rows: sorted.filter((row) => {
      const value = timestamp(row.date);
      return value >= startMs && value <= endMs;
    }),
    startMs,
    endMs
  };
}

export function normalizeSeries(rows, key) {
  const validRows = (rows || []).filter((row) => numberOrNull(row?.[key]) !== null);
  const baseline = numberOrNull(validRows[0]?.[key]);
  if (baseline === null || baseline === 0) return [];

  return validRows.map((row) => ({
    ...row,
    normalizedValue: (numberOrNull(row[key]) / baseline) * 100
  }));
}

export function createSessionFromPlan(plan, previousSession = null, now = new Date()) {
  if (!plan?.id || !Array.isArray(plan.exercises) || !plan.exercises.length) {
    throw new Error("A valid plan is required to create a session.");
  }

  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    id: uid("workout"),
    date: todayIso(now),
    planId: plan.id,
    planDate: plan.date,
    title: plan.title,
    focus: plan.focus,
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    readiness: "normal",
    sessionRpe: null,
    notes: "",
    planSnapshot: {
      id: plan.id,
      date: plan.date,
      generatedAt: plan.generatedAt,
      phase: plan.phase
    },
    exercises: plan.exercises.map((exercise) => {
      const previousExercise = previousSession?.exercises?.find((item) => item.id === exercise.id);
      const previousWorkingSets = previousExercise?.sets?.filter((set) => (
        set.setType !== "warmup" && set.validForProgression !== false
      ));
      return {
        ...exercise,
        sets: Array.from({ length: exercise.targetSets }, (_, index) => {
          const previousSet = previousWorkingSets?.[index];
          return {
            id: uid("set"),
            setNumber: index + 1,
            setType: "working",
            weightKg: exercise.startingWeightKg ?? "",
            reps: "",
            rpe: "",
            completed: false,
            completedAt: null,
            previousWeightKg: previousSet?.weightKg ?? null,
            previousReps: previousSet?.reps ?? null
          };
        })
      };
    })
  };
}

export function mergeSessions(localSessions = [], remoteSessions = []) {
  const sessions = new Map();

  for (const session of [...remoteSessions, ...localSessions]) {
    if (!session?.id) continue;
    const current = sessions.get(session.id);
    const currentTime = Date.parse(current?.updatedAt || current?.startedAt || 0);
    const candidateTime = Date.parse(session.updatedAt || session.startedAt || 0);
    if (!current || candidateTime >= currentTime) sessions.set(session.id, session);
  }

  return [...sessions.values()].sort((a, b) => {
    const aTime = Date.parse(a.startedAt || a.date || 0);
    const bTime = Date.parse(b.startedAt || b.date || 0);
    return bTime - aTime;
  });
}

export function completedSets(source) {
  const sessions = Array.isArray(source) ? source : source ? [source] : [];
  return sessions.flatMap((session) => (
    (session.exercises || []).flatMap((exercise) => (
      (exercise.sets || [])
        .filter((set) => set.completed)
        .map((set) => ({
          ...set,
          date: session.date,
          sessionId: session.id,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup
        }))
    ))
  ));
}

export function workingSets(source) {
  return completedSets(source).filter((set) => set.setType !== "warmup");
}

export function sessionProgress(session) {
  const total = (session?.exercises || []).reduce(
    (sum, exercise) => sum + (exercise.sets?.length || exercise.targetSets || 0),
    0
  );
  const completed = completedSets(session).length;
  return {
    total,
    completed,
    ratio: total ? completed / total : 0
  };
}

export function weeklyStats(sessions, referenceDate = new Date()) {
  const start = new Date(referenceDate);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);

  const weekSessions = sessions.filter((session) => {
    const date = new Date(`${session.date}T00:00:00`);
    return date >= start && date <= referenceDate;
  });
  const sets = workingSets(weekSessions);
  const targetSets = weekSessions.reduce(
    (sum, session) => sum + (session.exercises || []).reduce(
      (exerciseSum, exercise) => exerciseSum + (exercise.sets || [])
        .filter((set) => set.setType !== "warmup").length,
      0
    ),
    0
  );
  const tonnage = sets.reduce((sum, set) => {
    const weight = numberOrNull(set.weightKg);
    const reps = numberOrNull(set.reps);
    return sum + (weight !== null && reps !== null ? weight * reps : 0);
  }, 0);
  const byMuscle = sets.reduce((result, set) => {
    result[set.muscleGroup] = (result[set.muscleGroup] || 0) + 1;
    return result;
  }, {});

  return {
    sessions: weekSessions.filter((session) => session.finishedAt).length,
    completed: sets.length,
    targetSets,
    adherence: targetSets ? sets.length / targetSets : 0,
    tonnage,
    byMuscle
  };
}

export function e1rm(weight, reps) {
  const load = numberOrNull(weight);
  const repetitions = numberOrNull(reps);
  if (load === null || repetitions === null || load <= 0 || repetitions <= 0) return 0;
  return load * (1 + repetitions / 30);
}

export function bestLifts(sessions) {
  const best = {};

  for (const set of workingSets(sessions).filter((item) => item.validForProgression !== false)) {
    const estimate = e1rm(set.weightKg, set.reps);
    if (!estimate) continue;
    if (!best[set.exerciseId] || estimate > best[set.exerciseId].e1rm) {
      best[set.exerciseId] = {
        exerciseId: set.exerciseId,
        exerciseName: set.exerciseName,
        e1rm: estimate,
        date: set.date
      };
    }
  }

  return Object.values(best).sort((a, b) => b.e1rm - a.e1rm);
}

export function previousSessionForPlan(sessions, plan) {
  const finishedSessions = [...sessions]
    .filter((session) => session.finishedAt)
    .sort((a, b) => (
      Date.parse(b.finishedAt || b.startedAt || b.date) -
      Date.parse(a.finishedAt || a.startedAt || a.date)
    ));
  const exercises = (plan?.exercises || []).flatMap((plannedExercise) => {
    const previousExercise = finishedSessions
      .flatMap((session) => session.exercises || [])
      .find((exercise) => exercise.id === plannedExercise.id);
    return previousExercise ? [previousExercise] : [];
  });

  return exercises.length ? { exercises } : null;
}

export function planNeedsRefresh(plan, date = todayIso()) {
  return !plan || plan.date !== date;
}
