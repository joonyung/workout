import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "./runtime-paths.ts";
import type { Gym, Profile, WorkoutPlan, WorkoutSession } from "../src/types.ts";

const failures: string[] = [];

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function expect(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

function validateProfile(profile: Profile | null): void {
  expect(profile?.schemaVersion === 1, "profile: schemaVersion must be 1");
  expect(typeof profile?.goal === "string" && profile.goal, "profile: goal is required");
  expect(
    Number.isInteger(profile?.trainingDaysPerWeek) &&
      (profile?.trainingDaysPerWeek ?? 0) >= 1 &&
      (profile?.trainingDaysPerWeek ?? 0) <= 7,
    "profile: trainingDaysPerWeek must be between 1 and 7"
  );
  expect(
    Number.isInteger(profile?.sessionMinutes) &&
      (profile?.sessionMinutes ?? 0) >= 20 &&
      (profile?.sessionMinutes ?? 0) <= 180,
    "profile: sessionMinutes must be between 20 and 180"
  );
  expect(
    typeof profile?.painOrInjuryNotes === "string",
    "profile: painOrInjuryNotes must be a string"
  );
}

function validateGym(gym: Gym | null): void {
  const validStatuses = new Set(["unknown", "available", "limited", "unavailable"]);
  expect(gym?.schemaVersion === 1, "gym: schemaVersion must be 1");
  expect(typeof gym?.id === "string" && gym.id, "gym: id is required");
  expect(Array.isArray(gym?.equipment), "gym: equipment must be an array");
  const ids = new Set();

  for (const item of gym?.equipment || []) {
    expect(typeof item.id === "string" && item.id, "gym: each equipment item needs an id");
    expect(!ids.has(item.id), `gym: duplicate equipment id ${item.id}`);
    expect(validStatuses.has(item.status), `gym: invalid status for ${item.id}`);
    ids.add(item.id);
  }
}

function validatePlan(plan: WorkoutPlan | null, gym: Gym | null): void {
  const isRecoveryPlan = plan?.status === "recovery";
  expect(plan?.schemaVersion === 1, "plan: schemaVersion must be 1");
  expect(/^\d{4}-\d{2}-\d{2}$/.test(plan?.date || ""), "plan: date must use YYYY-MM-DD");
  expect(typeof plan?.id === "string" && plan.id, "plan: id is required");
  expect(
    Array.isArray(plan?.exercises) && (isRecoveryPlan || plan.exercises.length > 0),
    "plan: exercises are required unless status is recovery"
  );
  const ids = new Set();
  const equipmentIds = new Set((gym?.equipment || []).map((item) => item.id));

  for (const exercise of plan?.exercises || []) {
    expect(typeof exercise.id === "string" && exercise.id, "plan: each exercise needs an id");
    expect(!ids.has(exercise.id), `plan: duplicate exercise id ${exercise.id}`);
    expect(
      Number.isInteger(exercise.targetSets) && exercise.targetSets >= 1 && exercise.targetSets <= 8,
      `plan: targetSets for ${exercise.id} must be between 1 and 8`
    );
    expect(
      Array.isArray(exercise.repRange) &&
        exercise.repRange.length === 2 &&
        exercise.repRange[0] >= 1 &&
        exercise.repRange[1] >= exercise.repRange[0],
      `plan: repRange for ${exercise.id} is invalid`
    );
    expect(
      Number(exercise.targetRpe) >= 5 && Number(exercise.targetRpe) <= 10,
      `plan: targetRpe for ${exercise.id} must be between 5 and 10`
    );
    expect(
      Number(exercise.restSeconds) >= 30 && Number(exercise.restSeconds) <= 600,
      `plan: restSeconds for ${exercise.id} must be between 30 and 600`
    );
    expect(
      !exercise.equipmentId ||
        equipmentIds.has(exercise.equipmentId) ||
        (exercise.substitutions || []).length > 0,
      `plan: unknown equipment without substitutions for ${exercise.id}`
    );
    ids.add(exercise.id);
  }
}

function validateWorkouts(): number {
  const directory = join(dataRoot, "workouts");
  if (!existsSync(directory)) return 0;
  const files = readdirSync(directory).filter((name) => name.endsWith(".json"));

  for (const file of files) {
    const workout = readJson<WorkoutSession>(join(directory, file));
    expect(typeof workout?.id === "string" && workout.id, `${file}: workout id is required`);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(workout?.date || ""), `${file}: invalid date`);
    expect(Array.isArray(workout?.exercises), `${file}: exercises must be an array`);
    for (const exercise of workout?.exercises || []) {
      expect(Array.isArray(exercise?.sets), `${file}: ${exercise?.id || "exercise"} sets must be an array`);
      for (const set of exercise.sets || []) {
        expect(
          set.setType === undefined || ["warmup", "working"].includes(set.setType),
          `${file}: ${set?.id || "set"} has an invalid setType`
        );
      }
    }
  }

  return files.length;
}

const profile = readJson<Profile>(join(dataRoot, "profile.json"));
const gym = readJson<Gym>(join(dataRoot, "gyms", "current.json"));
const plansDirectory = join(dataRoot, "plans");
const plan = readJson<WorkoutPlan>(join(plansDirectory, "current.json"));

validateProfile(profile);
validateGym(gym);
const planFiles = readdirSync(plansDirectory).filter((name) => name.endsWith(".json"));
for (const file of planFiles) {
  validatePlan(readJson<WorkoutPlan>(join(plansDirectory, file)), gym);
}
const datedPlanPath = join(plansDirectory, `${plan?.date}.json`);
expect(existsSync(datedPlanPath), `plan: missing dated snapshot ${plan?.date}.json`);
if (existsSync(datedPlanPath)) {
  const datedPlan = readJson<WorkoutPlan>(datedPlanPath);
  expect(
    JSON.stringify(datedPlan) === JSON.stringify(plan),
    "plan: current.json must exactly match its dated snapshot"
  );
}
const workoutCount = validateWorkouts();

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exit(1);
}

console.log(`Data valid: 1 profile, ${gym?.equipment.length || 0} equipment items, ${planFiles.length} plans, ${workoutCount} workouts`);
