import type {
  BestLift,
  CompletedSet,
  ExerciseProgression,
  ExerciseSessionPoint,
  InBodyMetricTrend,
  MuscleVolumeRow,
  ProgressionStatus,
  RollingTrainingSummary,
  TrainingWindowSummary,
  WeightUnit,
  InBodyRange,
  InBodyMetricKey,
  InBodyRow,
  NormalizedInBodyRow,
  NumericInput,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSet,
  WeeklyStats,
  SessionCardio
} from "./types.ts";

export const KILOGRAMS_PER_POUND = 0.45359237;

export function uid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function todayIso(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === "-") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function poundsToKilograms(value: NumericInput | undefined): number | null {
  const pounds = numberOrNull(value);
  return pounds === null ? null : pounds * KILOGRAMS_PER_POUND;
}

export function workoutSetWeightKg(
  set: Pick<WorkoutSet, "weightKg" | "weightLb">
): number | null {
  const pounds = numberOrNull(set.weightLb);
  if (pounds !== null) return poundsToKilograms(pounds);
  return numberOrNull(set.weightKg);
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
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

export function parseInBodyCsv(csvText: string): InBodyRow[] {
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

export function mergeInBodyRows(...collections: InBodyRow[][]): InBodyRow[] {
  const byDate = new Map<string, InBodyRow>();

  for (const row of collections.flat()) {
    if (!row?.date) continue;
    const previous = byDate.get(row.date) || {};
    byDate.set(row.date, { ...previous, ...row });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function inBodyWindow(rows: InBodyRow[], range: InBodyRange = "1y"): {
  rows: InBodyRow[];
  startMs: number | null;
  endMs: number | null;
} {
  const sorted = [...(rows || [])]
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row?.date || ""))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { rows: [], startMs: null, endMs: null };

  const timestamp = (date: string) => Date.parse(date + "T12:00:00Z");
  const endMs = timestamp(sorted.at(-1)!.date);
  let startMs = timestamp(sorted[0].date);

  if (range === "1y") {
    const start = new Date(endMs);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    startMs = start.getTime();
  } else if (range === "6m") {
    const start = new Date(endMs);
    start.setUTCMonth(start.getUTCMonth() - 6);
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

export function normalizeSeries(rows: InBodyRow[], key: InBodyMetricKey): NormalizedInBodyRow[] {
  const validRows = (rows || []).filter((row) => numberOrNull(row?.[key]) !== null);
  const baseline = numberOrNull(validRows[0]?.[key]);
  if (baseline === null || baseline === 0) return [];

  return validRows.map((row) => ({
    ...row,
    normalizedValue: (numberOrNull(row[key])! / baseline) * 100
  }));
}

export function createSessionFromPlan(
  plan: WorkoutPlan,
  previousSession: Pick<WorkoutSession, "exercises"> | null = null,
  now = new Date()
): WorkoutSession {
  if (
    !plan?.id ||
    !Array.isArray(plan.exercises) ||
    (!plan.exercises.length && !(plan.cardio || []).length)
  ) {
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
      const usesPounds = exercise.startingWeightLb !== undefined;
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
            ...(usesPounds
              ? { weightLb: exercise.startingWeightLb ?? "" }
              : { weightKg: exercise.startingWeightKg ?? "" }),
            reps: "",
            rpe: "",
            completed: false,
            completedAt: null,
            previousWeightKg: previousSet?.weightKg ?? null,
            previousWeightLb: previousSet?.weightLb ?? null,
            previousReps: previousSet?.reps ?? null
          };
        })
      };
    }),
    cardio: (plan.cardio || []).map((item) => ({
      ...item,
      durationMinutes: item.targetMinutes,
      distanceKm: "",
      averageHeartRate: "",
      rpe: "",
      completed: false,
      completedAt: null
    }))
  };
}

export function completedCardio(
  source: WorkoutSession | WorkoutSession[] | null | undefined
): SessionCardio[] {
  const sessions = Array.isArray(source) ? source : source ? [source] : [];
  return sessions.flatMap((session) => (
    (session.cardio || []).filter((item) => item.completed)
  ));
}

export function mergeSessions(
  localSessions: WorkoutSession[] = [],
  remoteSessions: WorkoutSession[] = []
): WorkoutSession[] {
  const sessions = new Map<string, WorkoutSession>();

  for (const session of [...remoteSessions, ...localSessions]) {
    if (!session?.id) continue;
    const current = sessions.get(session.id);
    const currentTime = Date.parse(current?.updatedAt || current?.startedAt || "1970-01-01");
    const candidateTime = Date.parse(session.updatedAt || session.startedAt || "1970-01-01");
    if (!current || candidateTime >= currentTime) sessions.set(session.id, session);
  }

  return [...sessions.values()].sort((a, b) => {
    const aTime = Date.parse(a.startedAt || a.date || "1970-01-01");
    const bTime = Date.parse(b.startedAt || b.date || "1970-01-01");
    return bTime - aTime;
  });
}

export function completedSets(
  source: WorkoutSession | WorkoutSession[] | null | undefined
): CompletedSet[] {
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
          muscleGroup: exercise.muscleGroup || "기타"
        }))
    ))
  ));
}

export function workingSets(
  source: WorkoutSession | WorkoutSession[] | null | undefined
): CompletedSet[] {
  return completedSets(source).filter((set) => set.setType !== "warmup");
}

export function sessionProgress(session: WorkoutSession | null | undefined): {
  total: number;
  completed: number;
  ratio: number;
} {
  const strengthTotal = (session?.exercises || []).reduce(
    (sum, exercise) => sum + (exercise.sets?.length || exercise.targetSets || 0),
    0
  );
  const total = strengthTotal + (session?.cardio || []).length;
  const completed = completedSets(session).length + completedCardio(session).length;
  return {
    total,
    completed,
    ratio: total ? completed / total : 0
  };
}

export function weeklyStats(
  sessions: WorkoutSession[],
  referenceDate = new Date()
): WeeklyStats {
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
    const weight = workoutSetWeightKg(set);
    const reps = numberOrNull(set.reps);
    return sum + (weight !== null && reps !== null ? weight * reps : 0);
  }, 0);
  const byMuscle = sets.reduce<Record<string, number>>((result, set) => {
    result[set.muscleGroup] = (result[set.muscleGroup] || 0) + 1;
    return result;
  }, {});
  const cardioMinutes = completedCardio(weekSessions).reduce(
    (sum, item) => sum + (numberOrNull(item.durationMinutes) || 0),
    0
  );
  const targetCardioMinutes = weekSessions.reduce(
    (sum, session) => sum + (session.cardio || []).reduce(
      (cardioSum, item) => cardioSum + (numberOrNull(item.targetMinutes) || 0),
      0
    ),
    0
  );

  return {
    sessions: weekSessions.filter((session) => session.finishedAt).length,
    completed: sets.length,
    targetSets,
    adherence: targetSets ? sets.length / targetSets : 0,
    tonnage,
    byMuscle,
    cardioMinutes,
    targetCardioMinutes
  };
}

export function e1rm(
  weight: NumericInput | undefined,
  reps: NumericInput | undefined,
  unit: "kg" | "lb" = "kg"
): number {
  const rawLoad = numberOrNull(weight);
  const load = unit === "lb" ? poundsToKilograms(rawLoad) : rawLoad;
  const repetitions = numberOrNull(reps);
  if (load === null || repetitions === null || load <= 0 || repetitions <= 0) return 0;
  return load * (1 + repetitions / 30);
}

export function bestLifts(sessions: WorkoutSession[]): BestLift[] {
  const best: Record<string, BestLift> = {};

  for (const set of workingSets(sessions).filter((item) => item.validForProgression !== false)) {
    const estimate = e1rm(workoutSetWeightKg(set), set.reps);
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

export function previousSessionForPlan(
  sessions: WorkoutSession[],
  plan: WorkoutPlan | null | undefined
): Pick<WorkoutSession, "exercises"> | null {
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

export function planNeedsRefresh(
  plan: Pick<WorkoutPlan, "date"> | null | undefined,
  date = todayIso()
): boolean {
  return !plan || plan.date !== date;
}

// ---------------------------------------------------------------------------
// Progress view calculations. All windows are calendar-date based (YYYY-MM-DD
// string comparisons) so results do not depend on the device time zone.
// ---------------------------------------------------------------------------

export function shiftIsoDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * A session counts toward review numbers once it is finished or its day has
 * passed. Today's unfinished session is still in progress, so partial sets
 * would understate adherence and repetitions.
 */
export function isSettledSession(session: WorkoutSession, today: string): boolean {
  return Boolean(session.finishedAt) || session.date < today;
}

function sessionsBetween(
  sessions: WorkoutSession[],
  startExclusive: string,
  endInclusive: string,
  today: string
): WorkoutSession[] {
  return sessions.filter((session) => (
    session.date > startExclusive &&
    session.date <= endInclusive &&
    isSettledSession(session, today)
  ));
}

export function trainingWindowSummary(sessions: WorkoutSession[]): TrainingWindowSummary {
  const plannedSets = sessions.reduce((sum, session) => sum + (session.exercises || []).reduce(
    (exerciseSum, exercise) => exerciseSum + (exercise.sets || [])
      .filter((set) => set.setType !== "warmup").length,
    0
  ), 0);
  const done = workingSets(sessions).length;
  const cardioMinutes = completedCardio(sessions).reduce(
    (sum, item) => sum + (numberOrNull(item.durationMinutes) || 0),
    0
  );
  const trained = sessions.filter((session) => (
    workingSets(session).length || completedCardio(session).length
  ));
  return {
    sessions: trained.length,
    workingSets: done,
    plannedSets,
    adherence: plannedSets ? done / plannedSets : null,
    cardioMinutes
  };
}

/** Number of prior 7-day buckets (max 3) that end on or after the first session. */
function coveredPriorWeeks(sessions: WorkoutSession[], end: string, today: string): number {
  const settled = sessions.filter((session) => isSettledSession(session, today));
  if (!settled.length) return 0;
  const firstDate = settled.reduce((min, session) => (
    session.date < min ? session.date : min
  ), settled[0].date);
  let weeks = 0;
  for (let bucket = 1; bucket <= 3; bucket += 1) {
    const bucketEnd = shiftIsoDate(end, -7 * bucket);
    if (bucketEnd >= firstDate) weeks += 1;
  }
  return weeks;
}

/**
 * Last day of the rolling review window. While today's session is still in
 * progress the window ends yesterday, so a training day never reads as a
 * 6-day week with one session missing.
 */
export function reviewEndDate(sessions: WorkoutSession[], today: string): string {
  const inProgress = sessions.some((session) => (
    session.date === today && !isSettledSession(session, today)
  ));
  return inProgress ? shiftIsoDate(today, -1) : today;
}

/** Latest 7 days compared with the weekly average of the 3 weeks before it. */
export function rollingTrainingSummary(
  sessions: WorkoutSession[],
  today: string
): RollingTrainingSummary {
  const end = reviewEndDate(sessions, today);
  const recentStart = shiftIsoDate(end, -7);
  const priorStart = shiftIsoDate(end, -28);
  const recent = trainingWindowSummary(sessionsBetween(sessions, recentStart, end, today));
  const priorWeeks = coveredPriorWeeks(sessions, end, today);
  if (!priorWeeks) return { endDate: end, recent, priorWeeklyAverage: null, priorWeeks };

  const prior = trainingWindowSummary(sessionsBetween(sessions, priorStart, recentStart, today));
  return {
    endDate: end,
    recent,
    priorWeeks,
    priorWeeklyAverage: {
      sessions: prior.sessions / priorWeeks,
      workingSets: prior.workingSets / priorWeeks,
      plannedSets: prior.plannedSets / priorWeeks,
      adherence: prior.adherence,
      cardioMinutes: prior.cardioMinutes / priorWeeks
    }
  };
}

/**
 * Muscle-group labels changed over time for the same exercise id (for example
 * lateral raises moved from "어깨" to "측면 삼각근"). The most recent label wins
 * so one exercise never splits across two groups.
 */
export function latestMuscleGroups(sessions: WorkoutSession[]): Map<string, string> {
  const groups = new Map<string, { date: string; group: string }>();
  for (const session of sessions) {
    for (const exercise of session.exercises || []) {
      if (!exercise.muscleGroup) continue;
      const current = groups.get(exercise.id);
      if (!current || session.date >= current.date) {
        groups.set(exercise.id, { date: session.date, group: exercise.muscleGroup });
      }
    }
  }
  return new Map([...groups].map(([id, value]) => [id, value.group]));
}

export const MUSCLE_GROUP_ORDER = [
  "가슴", "등", "어깨", "측면 삼각근", "후면 삼각근", "이두", "삼두",
  "하체", "대퇴사두", "둔근", "햄스트링", "종아리", "코어"
];

function muscleGroupRank(group: string): number {
  const index = MUSCLE_GROUP_ORDER.indexOf(group);
  return index === -1 ? MUSCLE_GROUP_ORDER.length : index;
}

/** Direct working sets per muscle group: latest 7 days and prior 3-week weekly average. */
export function muscleVolume(sessions: WorkoutSession[], today: string): MuscleVolumeRow[] {
  const groups = latestMuscleGroups(sessions);
  const end = reviewEndDate(sessions, today);
  const recentStart = shiftIsoDate(end, -7);
  const priorStart = shiftIsoDate(end, -28);
  const priorWeeks = coveredPriorWeeks(sessions, end, today);
  const count = (windowSessions: WorkoutSession[]) => workingSets(windowSessions)
    .reduce<Map<string, number>>((result, set) => {
      const group = groups.get(set.exerciseId) || set.muscleGroup;
      result.set(group, (result.get(group) || 0) + 1);
      return result;
    }, new Map());
  const recent = count(sessionsBetween(sessions, recentStart, end, today));
  const prior = count(sessionsBetween(sessions, priorStart, recentStart, today));
  const names = new Set([...recent.keys(), ...prior.keys()]);

  return [...names]
    .map((muscleGroup) => ({
      muscleGroup,
      recentSets: recent.get(muscleGroup) || 0,
      priorWeeklyAverage: priorWeeks ? (prior.get(muscleGroup) || 0) / priorWeeks : null
    }))
    .sort((a, b) => (
      muscleGroupRank(a.muscleGroup) - muscleGroupRank(b.muscleGroup) ||
      a.muscleGroup.localeCompare(b.muscleGroup, "ko")
    ));
}

const LOAD_EPSILON_KG = 0.01;

function sameLoad(a: ExerciseSessionPoint, b: ExerciseSessionPoint): boolean {
  if (a.topLoadKg === null || b.topLoadKg === null) return a.topLoadKg === b.topLoadKg;
  return Math.abs(a.topLoadKg - b.topLoadKg) < LOAD_EPSILON_KG;
}

function matchedReps(previous: ExerciseSessionPoint, current: ExerciseSessionPoint): [number, number] {
  const matched = Math.min(previous.topReps.length, current.topReps.length);
  const sum = (reps: number[]) => reps.slice(0, matched).reduce((total, value) => total + value, 0);
  return [sum(previous.topReps), sum(current.topReps)];
}

/**
 * Repetition gain at the same load. Sets are matched in order so a planned
 * change in set count does not read as a performance change; an extra set at
 * equal matched reps still counts as a gain.
 */
export function repsImproved(previous: ExerciseSessionPoint, current: ExerciseSessionPoint): boolean {
  const [before, after] = matchedReps(previous, current);
  if (after !== before) return after > before;
  return current.topReps.length > previous.topReps.length;
}

/**
 * Status follows docs/COACHING_PROTOCOL.md: load or reps going up is
 * progression; three consecutive sessions at the same load without a rep gain
 * is a stall. Below that, a same-load session with fewer matched reps is
 * reported as "reps-down" so a drop is not hidden behind "holding".
 */
export function progressionStatus(points: ExerciseSessionPoint[]): {
  status: ProgressionStatus;
  holdStreak: number;
} {
  if (points.length < 2) return { status: "baseline", holdStreak: 0 };
  const latest = points.at(-1)!;
  const previous = points.at(-2)!;

  if (!sameLoad(previous, latest) && latest.topLoadKg !== null && previous.topLoadKg !== null) {
    return {
      status: latest.topLoadKg > previous.topLoadKg ? "load-up" : "load-down",
      holdStreak: 0
    };
  }
  if (repsImproved(previous, latest)) return { status: "reps-up", holdStreak: 0 };

  let holdStreak = 0;
  for (let index = points.length - 1; index > 0; index -= 1) {
    const current = points[index];
    const before = points[index - 1];
    if (!sameLoad(before, current) || repsImproved(before, current)) break;
    holdStreak += 1;
  }
  if (holdStreak >= 3) return { status: "stalled", holdStreak };
  const [before, after] = matchedReps(previous, latest);
  return { status: after < before ? "reps-down" : "holding", holdStreak };
}

function exerciseUnit(sets: WorkoutSet[], fallback?: { startingWeightLb?: NumericInput }): WeightUnit {
  if (sets.some((set) => numberOrNull(set.weightLb) !== null)) return "lb";
  if (fallback?.startingWeightLb !== undefined) return "lb";
  return "kg";
}

function sessionPoint(
  session: WorkoutSession,
  sets: WorkoutSet[],
  unit: WeightUnit
): ExerciseSessionPoint | null {
  const valid = sets
    .map((set) => {
      const reps = numberOrNull(set.reps);
      const loadKg = workoutSetWeightKg(set);
      const raw = unit === "lb" ? numberOrNull(set.weightLb) : numberOrNull(set.weightKg);
      const load = raw ?? (loadKg === null ? null : unit === "lb" ? loadKg / KILOGRAMS_PER_POUND : loadKg);
      return { reps, loadKg, load };
    })
    .filter((set): set is { reps: number; loadKg: number | null; load: number | null } => (
      set.reps !== null && set.reps > 0
    ));
  if (!valid.length) return null;

  const loads = valid.map((set) => set.loadKg).filter((value): value is number => value !== null);
  const topLoadKg = loads.length ? Math.max(...loads) : null;
  const atTop = valid.filter((set) => (
    topLoadKg === null ? set.loadKg === null : set.loadKg !== null && Math.abs(set.loadKg - topLoadKg) < LOAD_EPSILON_KG
  ));
  const estimates = valid
    .map((set) => (set.loadKg === null ? 0 : e1rm(set.loadKg, set.reps)))
    .filter((value) => value > 0);

  return {
    date: session.date,
    sessionId: session.id,
    topLoad: atTop[0].load,
    topLoadKg,
    topReps: atTop.map((set) => set.reps),
    lighterSets: valid.length - atTop.length,
    bestE1rmKg: estimates.length ? Math.max(...estimates) : null
  };
}

/**
 * Per-exercise progression for exercises trained in the last `activeDays`.
 * Each exercise id is its own baseline, so equipment variants never mix.
 */
export function exerciseProgressions(
  sessions: WorkoutSession[],
  today: string,
  { activeDays = 28, trendDays = 42 }: { activeDays?: number; trendDays?: number } = {}
): ExerciseProgression[] {
  const groups = latestMuscleGroups(sessions);
  const ordered = sessions
    .filter((session) => isSettledSession(session, today))
    .sort((a, b) => (
      a.date.localeCompare(b.date) ||
      Date.parse(a.startedAt || a.date) - Date.parse(b.startedAt || b.date)
    ));
  const byExercise = new Map<string, {
    name: string;
    unit: WeightUnit;
    points: ExerciseSessionPoint[];
    lastOrder: number;
  }>();

  for (const session of ordered) {
    (session.exercises || []).forEach((exercise, order) => {
      const sets = (exercise.sets || []).filter((set) => (
        set.completed && set.setType !== "warmup" && set.validForProgression !== false
      ));
      if (!sets.length) return;
      const entry = byExercise.get(exercise.id) || {
        name: exercise.name,
        unit: exerciseUnit(sets, exercise),
        points: [],
        lastOrder: order
      };
      const point = sessionPoint(session, sets, entry.unit);
      if (!point) return;
      entry.name = exercise.name;
      entry.lastOrder = order;
      entry.points.push(point);
      byExercise.set(exercise.id, entry);
    });
  }

  const activeSince = shiftIsoDate(today, -activeDays);
  const trendSince = shiftIsoDate(today, -trendDays);

  return [...byExercise.entries()]
    .filter(([, entry]) => entry.points.at(-1)!.date > activeSince)
    .map(([exerciseId, entry]) => {
      const latest = entry.points.at(-1)!;
      const windowPoints = entry.points.filter((point) => point.date > trendSince);
      const points = windowPoints.length ? windowPoints : [latest];
      const first = points[0];
      const { status, holdStreak } = progressionStatus(entry.points);
      const e1rmChange = points.length > 1 && first.bestE1rmKg && latest.bestE1rmKg
        ? latest.bestE1rmKg / first.bestE1rmKg - 1
        : null;
      return {
        exerciseId,
        name: entry.name,
        muscleGroup: groups.get(exerciseId) || "기타",
        unit: entry.unit,
        points,
        latest,
        previous: entry.points.at(-2) || null,
        status,
        holdStreak,
        e1rmChange,
        lastOrder: entry.lastOrder
      };
    })
    .sort((a, b) => b.latest.date.localeCompare(a.latest.date) || a.lastOrder - b.lastOrder)
    .map(({ lastOrder: _lastOrder, ...progression }) => progression);
}

/**
 * Range-aware InBody trend for one metric. `runLength` reports how many of
 * the latest measurements moved in one direction, which is the signal the
 * coaching protocol trusts over a single measurement-to-measurement change.
 */
export function inBodyMetricTrend(rows: InBodyRow[], key: InBodyMetricKey): InBodyMetricTrend {
  const values = rows
    .map((row) => ({ date: row.date, value: numberOrNull(row[key]) }))
    .filter((row): row is { date: string; value: number } => row.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = values[0] || null;
  const latest = values.at(-1) || null;
  const previous = values.at(-2) || null;

  let runDirection: "up" | "down" | null = null;
  let steps = 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    const delta = values[index].value - values[index - 1].value;
    const direction = delta > 0 ? "up" : delta < 0 ? "down" : null;
    if (!direction || (runDirection && direction !== runDirection)) break;
    runDirection = direction;
    steps += 1;
  }
  const runLength = steps >= 2 ? steps + 1 : 0;

  return {
    count: values.length,
    first,
    latest,
    previousDelta: latest && previous ? latest.value - previous.value : null,
    rangeDelta: latest && first && values.length > 1 ? latest.value - first.value : null,
    runLength,
    runDirection: runLength ? runDirection : null
  };
}

/** Weekly direct-set target per muscle group from docs/COACHING_PROTOCOL.md. */
export const WEEKLY_SET_TARGET: readonly [number, number] = [8, 12];
