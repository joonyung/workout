import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  bestLifts,
  mergeInBodyRows,
  parseInBodyCsv,
  weeklyStats
} from "../src/core.js";
import {
  dataRoot,
  inbodyRoot,
  resolveStateReference,
  stateRoot
} from "./runtime-paths.mjs";

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function readText(path, fallback = "") {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

function collectFiles(directory, extension) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(path, extension);
    return entry.name.toLowerCase().endsWith(extension) ? [path] : [];
  });
}

const profile = readJson(join(dataRoot, "profile.json"), {});
const gym = readJson(join(dataRoot, "gyms", "current.json"), {});
const gymContextMarkdown = gym.contextFile
  ? readText(resolveStateReference(gym.contextFile))
  : "";
const currentPlan = readJson(join(dataRoot, "plans", "current.json"), null);
const sessions = collectFiles(join(dataRoot, "workouts"), ".json")
  .map((path) => readJson(path, null))
  .filter(Boolean)
  .sort((a, b) => Date.parse(b.startedAt || b.date) - Date.parse(a.startedAt || a.date));
const inBody = mergeInBodyRows(
  ...collectFiles(inbodyRoot, ".csv").map((path) => (
    parseInBodyCsv(readFileSync(path, "utf8"))
  ))
);

const context = {
  generatedAt: new Date().toISOString(),
  profile,
  gym: {
    id: gym.id,
    name: gym.name,
    notes: gym.notes,
    contextFile: gym.contextFile || null,
    contextMarkdown: gymContextMarkdown || null,
    available: (gym.equipment || []).filter((item) => item.status === "available"),
    limited: (gym.equipment || []).filter((item) => item.status === "limited"),
    unavailable: (gym.equipment || []).filter((item) => item.status === "unavailable"),
    unknown: (gym.equipment || []).filter((item) => item.status === "unknown")
  },
  currentPlan: currentPlan ? {
    id: currentPlan.id,
    date: currentPlan.date,
    title: currentPlan.title,
    status: currentPlan.status
  } : null,
  latestInBody: inBody.at(-1) || null,
  previousInBody: inBody.at(-2) || null,
  workoutCount: sessions.length,
  recentSessions: sessions.slice(0, 8).map((session) => ({
    id: session.id,
    date: session.date,
    title: session.title,
    readiness: session.readiness,
    sessionRpe: session.sessionRpe,
    finishedAt: session.finishedAt,
    notes: session.notes,
    exercises: session.exercises?.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      sets: exercise.sets?.filter((set) => (
        set.completed && set.setType !== "warmup"
      )).map((set) => ({
        weightKg: set.weightKg,
        reps: set.reps,
        rpe: set.rpe,
        validForProgression: set.validForProgression !== false
      })),
      warmupSets: exercise.sets?.filter((set) => (
        set.completed && set.setType === "warmup"
      )).map((set) => ({
        weightKg: set.weightKg,
        reps: set.reps
      }))
    }))
  })),
  currentWeek: weeklyStats(sessions),
  bestLifts: bestLifts(sessions).slice(0, 10),
  sources: {
    stateRoot,
    dataRoot,
    inbodyRoot,
    inBodyFiles: collectFiles(inbodyRoot, ".csv").map((path) => relative(stateRoot, path)),
    gymContextFile: gym.contextFile || null,
    workoutDirectory: join(dataRoot, "workouts")
  }
};

console.log(JSON.stringify(context, null, 2));
