export type NumericInput = number | string | null;
export type WeightUnit = "kg" | "lb";
export type Readiness = "good" | "normal" | "tired";
export type EquipmentStatus = "unknown" | "available" | "limited" | "unavailable";
export type InBodyRange = "6m" | "1y" | "all";

export interface InBodyRow {
  date: string;
  weightKg?: number | null;
  skeletalMuscleKg?: number | null;
  bodyFatKg?: number | null;
  bodyFatPercent?: number | null;
  bmrKcal?: number | null;
  inbodyScore?: number | null;
  waistHipRatio?: number | null;
  visceralFatLevel?: number | null;
  bodyWaterL?: number | null;
  normalizedValue?: number;
}

export type InBodyMetricKey = keyof Omit<InBodyRow, "date" | "normalizedValue">;
export interface NormalizedInBodyRow extends InBodyRow {
  normalizedValue: number;
}

export interface WorkoutSet {
  id?: string;
  setNumber?: number;
  setType?: "warmup" | "working";
  weightKg?: NumericInput;
  weightLb?: NumericInput;
  reps?: NumericInput;
  rpe?: NumericInput;
  completed?: boolean;
  completedAt?: string | null;
  previousWeightKg?: NumericInput;
  previousWeightLb?: NumericInput;
  previousReps?: NumericInput;
  validForProgression?: boolean;
  load?: string;
}

export interface PlanExercise {
  id: string;
  name: string;
  muscleGroup: string;
  targetSets: number;
  repRange: [number, number];
  targetRpe: number;
  restSeconds: number;
  startingWeightKg?: NumericInput;
  startingWeightLb?: NumericInput;
  startingLoad?: string;
  equipmentId?: string;
  cue?: string;
  substitutions?: string[];
  warmupSets?: Array<Partial<WorkoutSet>>;
}

export interface SessionExercise extends PlanExercise {
  sets: WorkoutSet[];
}

export interface PlanCardio {
  id: string;
  name: string;
  targetMinutes: number;
  rpeRange: [number, number];
  equipmentId?: string;
  cue?: string;
  substitutions?: string[];
}

export interface SessionCardio extends PlanCardio {
  durationMinutes: NumericInput;
  distanceKm: NumericInput;
  averageHeartRate: NumericInput;
  rpe: NumericInput;
  completed: boolean;
  completedAt: string | null;
}

export interface WorkoutPlan {
  schemaVersion?: number;
  id: string;
  date: string;
  title: string;
  focus?: string;
  generatedAt?: string;
  generatedBy?: string;
  phase?: string;
  status?: string;
  estimatedMinutes?: number;
  assumptions?: string[];
  coachNotes?: string[];
  basedOn?: unknown;
  readinessRules?: Partial<Record<Readiness, string>>;
  recoveryGuidance?: string;
  recoveryActions?: Array<{ title: string; detail: string }>;
  exercises: PlanExercise[];
  cardio?: PlanCardio[];
}

export interface WorkoutSession {
  schemaVersion?: number;
  id: string;
  date: string;
  planId?: string;
  planDate?: string;
  templateId?: string;
  title?: string;
  focus?: string;
  gymName?: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string | null;
  readiness?: Readiness;
  sessionRpe?: number | null;
  notes?: string;
  timingRecorded?: boolean;
  planSnapshot?: {
    id: string;
    date: string;
    generatedAt?: string;
    phase?: string;
  };
  exercises: SessionExercise[];
  cardio?: SessionCardio[];
}

export interface CompletedSet extends WorkoutSet {
  date: string;
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
}

export interface EquipmentItem {
  id: string;
  name?: string;
  status: EquipmentStatus;
  loadUnit?: WeightUnit;
  notes?: string;
}

export interface Gym {
  schemaVersion: number;
  id: string;
  name: string;
  updatedAt: string;
  notes: string;
  contextFile?: string;
  equipment: EquipmentItem[];
}

export interface Profile {
  schemaVersion: number;
  updatedAt: string;
  displayName: string;
  goal: string;
  goalLabel: string;
  experience: string;
  trainingDaysPerWeek: number;
  sessionMinutes: number;
  painOrInjuryNotes: string;
  scheduleNotes: string;
  preferences: {
    prioritize: string[];
    avoid: string[];
  };
}

export interface BootstrapPayload {
  profile: Profile;
  gym: Gym;
  plan: WorkoutPlan | null;
  sessions: WorkoutSession[];
  deletedWorkoutIds: string[];
  inbodyFiles: string[];
  serverTime: string;
}

export interface WeeklyStats {
  sessions: number;
  completed: number;
  targetSets: number;
  adherence: number;
  tonnage: number;
  byMuscle: Record<string, number>;
  cardioMinutes: number;
  targetCardioMinutes: number;
}

export interface BestLift {
  exerciseId: string;
  exerciseName: string;
  e1rm: number;
  date: string;
}

export interface TrainingWindowSummary {
  sessions: number;
  workingSets: number;
  plannedSets: number;
  adherence: number | null;
  cardioMinutes: number;
}

export interface RollingTrainingSummary {
  /** Last day included in `recent` (yesterday while today's session is in progress). */
  endDate: string;
  recent: TrainingWindowSummary;
  /** Weekly average of the three 7-day buckets before `recent`; null without history. */
  priorWeeklyAverage: TrainingWindowSummary | null;
  priorWeeks: number;
}

export interface MuscleVolumeRow {
  muscleGroup: string;
  recentSets: number;
  priorWeeklyAverage: number | null;
}

export interface ExerciseSessionPoint {
  date: string;
  sessionId: string;
  /** Heaviest working load in the exercise's own unit; null for bodyweight work. */
  topLoad: number | null;
  topLoadKg: number | null;
  /** Repetitions of the sets performed at the top load, in set order. */
  topReps: number[];
  /** Working sets performed below the top load. */
  lighterSets: number;
  bestE1rmKg: number | null;
}

export type ProgressionStatus =
  | "baseline"
  | "load-up"
  | "reps-up"
  | "reps-down"
  | "holding"
  | "stalled"
  | "load-down";

export interface ExerciseProgression {
  exerciseId: string;
  name: string;
  muscleGroup: string;
  unit: WeightUnit;
  /** Sessions inside the trend window, oldest first (always includes the latest). */
  points: ExerciseSessionPoint[];
  latest: ExerciseSessionPoint;
  previous: ExerciseSessionPoint | null;
  status: ProgressionStatus;
  /** Consecutive latest sessions at the same load without a repetition gain. */
  holdStreak: number;
  /** Relative e1RM change from the first to the last point in the window. */
  e1rmChange: number | null;
}

export interface InBodyMetricTrend {
  count: number;
  first: { date: string; value: number } | null;
  latest: { date: string; value: number } | null;
  previousDelta: number | null;
  rangeDelta: number | null;
  /** Measurements in the latest run that moved in one direction (0 when under 3). */
  runLength: number;
  runDirection: "up" | "down" | null;
}
