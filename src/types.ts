export type NumericInput = number | string | null;
export type Readiness = "good" | "normal" | "tired";
export type EquipmentStatus = "unknown" | "available" | "limited" | "unavailable";
export type InBodyRange = "1y" | "2y" | "all";
export type InBodySeries = "weight" | "muscle" | "fat";

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
  reps?: NumericInput;
  rpe?: NumericInput;
  completed?: boolean;
  completedAt?: string | null;
  previousWeightKg?: NumericInput;
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
  startingLoad?: string;
  equipmentId?: string;
  cue?: string;
  substitutions?: string[];
  warmupSets?: Array<Partial<WorkoutSet>>;
}

export interface SessionExercise extends PlanExercise {
  sets: WorkoutSet[];
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
}

export interface BestLift {
  exerciseId: string;
  exerciseName: string;
  e1rm: number;
  date: string;
}
