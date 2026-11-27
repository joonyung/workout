import {
  WEEKLY_SET_TARGET,
  completedCardio,
  completedSets,
  createSessionFromPlan,
  exerciseProgressions,
  inBodyMetricTrend,
  inBodyWindow,
  isSettledSession,
  mergeInBodyRows,
  mergeSessions,
  muscleVolume,
  numberOrNull,
  parseInBodyCsv,
  planNeedsRefresh,
  previousSessionForPlan,
  sessionProgress,
  rollingTrainingSummary,
  shiftIsoDate,
  todayIso,
  uid,
  workoutSetWeightKg
} from "./core.ts";
import type {
  BootstrapPayload,
  EquipmentItem,
  ExerciseProgression,
  ExerciseSessionPoint,
  Gym,
  InBodyRange,
  InBodyMetricKey,
  InBodyRow,
  NumericInput,
  PlanExercise,
  ProgressionStatus,
  Profile,
  Readiness,
  SessionCardio,
  SessionExercise,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSet,
  WeightUnit
} from "./types.ts";

type InBodyKey = Extract<
  InBodyMetricKey,
  "weightKg" | "skeletalMuscleKg" | "bodyFatKg" | "bodyFatPercent"
>;
type SetField = "weightKg" | "weightLb" | "reps" | "rpe";
type CardioField = "durationMinutes" | "distanceKm" | "averageHeartRate" | "rpe";

const QA_MODE = new URLSearchParams(window.location.search).get("qa") === "1";
const STORAGE_KEY = QA_MODE ? "workout-os-state-v2-qa" : "workout-os-state-v2";
const LEGACY_STORAGE_KEY = "workout-os-state-v1";

const fallbackProfile: Profile = {
  schemaVersion: 1,
  updatedAt: "1970-01-01T00:00:00.000Z",
  displayName: "나",
  goal: "recomposition",
  goalLabel: "근육 증가 중심 리컴포지션",
  experience: "intermediate",
  trainingDaysPerWeek: 4,
  sessionMinutes: 70,
  painOrInjuryNotes: "",
  scheduleNotes: "",
  preferences: { prioritize: [], avoid: [] }
};

const fallbackGym: Gym = {
  schemaVersion: 1,
  id: "current-gym",
  name: "현재 체육관",
  updatedAt: "1970-01-01T00:00:00.000Z",
  notes: "",
  equipment: []
};

type SyncStatus = "loading" | "syncing" | "synced" | "local";
type TabId = "today" | "history" | "progress" | "settings";

interface AppState {
  activeTab: TabId;
  profile: Profile;
  gym: Gym;
  plan: WorkoutPlan | null;
  sessions: WorkoutSession[];
  inBody: InBodyRow[];
  inBodyRange: InBodyRange;
  preReadiness: Readiness;
  finishSheetOpen: boolean;
  timer: {
    running: boolean;
    endsAt: number | null;
    remaining: number;
    exerciseName: string;
  };
  sync: {
    status: SyncStatus;
    serverAvailable: boolean;
    lastSavedAt: string | null;
  };
  toast: string;
}

let state: AppState = {
  activeTab: "today",
  profile: fallbackProfile,
  gym: fallbackGym,
  plan: null,
  sessions: [],
  inBody: [],
  inBodyRange: "1y",
  preReadiness: "normal",
  finishSheetOpen: false,
  timer: {
    running: false,
    endsAt: null,
    remaining: 0,
    exerciseName: ""
  },
  sync: {
    status: "loading",
    serverAvailable: false,
    lastSavedAt: null
  },
  toast: ""
};

let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw) as Partial<AppState>;
      state = {
        ...state,
        ...saved,
        profile: { ...fallbackProfile, ...(saved.profile || {}) },
        gym: { ...fallbackGym, ...(saved.gym || {}) },
        sync: state.sync,
        finishSheetOpen: false,
        toast: ""
      };
      state.sessions = state.sessions.filter((session) => !(
        session.templateId &&
        !session.finishedAt &&
        !completedSets(session).length &&
        !completedCardio(session).length
      ));
      if (!["6m", "1y", "all"].includes(state.inBodyRange)) {
        state.inBodyRange = "1y";
      }
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacyRaw) return;

  try {
    const legacy = JSON.parse(legacyRaw) as {
      sessions?: WorkoutSession[];
      inBody?: InBodyRow[];
    };
    state.sessions = (legacy.sessions || [])
      .filter((session) => (
        session.finishedAt ||
        completedCardio(session).length ||
        (session.exercises || []).some((exercise) => (
          (exercise.sets || []).some((set) => set.completed)
        ))
      ))
      .map((session) => ({
        ...session,
        planId: session.planId || session.templateId || "legacy-plan",
        title: session.title || session.templateId || "이전 운동",
        updatedAt: session.updatedAt || session.finishedAt || session.startedAt
      }));
    state.inBody = legacy.inBody || [];
  } catch {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    activeTab: state.activeTab,
    profile: state.profile,
    gym: state.gym,
    plan: state.plan,
    sessions: state.sessions,
    inBody: state.inBody,
    inBodyRange: state.inBodyRange,
    preReadiness: state.preReadiness,
    timer: state.timer
  }));
}

function newerRecord<T extends object>(
  localValue: T | null,
  remoteValue: T | null,
  field: keyof T = "updatedAt" as keyof T
): T | null {
  if (!localValue) return remoteValue;
  if (!remoteValue) return localValue;
  const localTime = Date.parse(String(localValue[field] || "1970-01-01"));
  const remoteTime = Date.parse(String(remoteValue[field] || "1970-01-01"));
  return remoteTime >= localTime ? remoteValue : localValue;
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

async function loadInBodyFiles(files: string[]): Promise<InBodyRow[]> {
  const uniqueFiles = [...new Set(files || [])];
  const results = await Promise.allSettled(
    uniqueFiles.map(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load ${url}`);
      return parseInBodyCsv(await response.text());
    })
  );

  return mergeInBodyRows(
    state.inBody,
    ...results.filter((result) => result.status === "fulfilled").map((result) => result.value)
  );
}

async function loadBootstrap({ quiet = false } = {}) {
  if (!quiet) setSyncStatus("loading");

  try {
    const data = await fetchJson<BootstrapPayload>("/api/bootstrap");
    state.profile = newerRecord(state.profile, data.profile) ?? fallbackProfile;
    state.gym = newerRecord(state.gym, data.gym) ?? fallbackGym;
    state.plan = newerRecord(state.plan, data.plan, "generatedAt");
    const deletedIds = new Set(data.deletedWorkoutIds || []);
    state.sessions = mergeSessions(state.sessions, data.sessions || [])
      .filter((session) => !deletedIds.has(session.id));
    state.inBody = await loadInBodyFiles(data.inbodyFiles || []);
    state.sync.serverAvailable = true;
    state.sync.lastSavedAt = data.serverTime;
    setSyncStatus("synced");
  } catch {
    state.sync.serverAvailable = false;
    setSyncStatus("local");
  }

  saveLocalState();
}

function syncLabel() {
  if (state.sync.status === "loading") return "불러오는 중";
  if (state.sync.status === "syncing") return "저장 중";
  if (state.sync.status === "synced") return "파일 저장됨";
  return "이 기기에 저장";
}

function setSyncStatus(status: SyncStatus): void {
  state.sync.status = status;
  const badge = document.querySelector<HTMLInputElement>("#sync-status");
  if (badge) {
    badge.dataset.status = status;
    const label = badge.querySelector("span:last-child");
    if (label) label.textContent = syncLabel();
  }
}

async function postJson<T>(url: string, method: string, value: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method,
    body: JSON.stringify(value)
  });
}

async function syncSession(session: WorkoutSession | null): Promise<void> {
  if (!session) return;
  if (QA_MODE) {
    setSyncStatus("local");
    return;
  }
  setSyncStatus("syncing");

  try {
    await postJson("/api/workouts", "POST", session);
    state.sync.serverAvailable = true;
    state.sync.lastSavedAt = new Date().toISOString();
    setSyncStatus("synced");
  } catch {
    state.sync.serverAvailable = false;
    setSyncStatus("local");
  }
}

function scheduleSessionSync(session: WorkoutSession): void {
  if (syncTimeout) clearTimeout(syncTimeout);
  setSyncStatus("syncing");
  syncTimeout = setTimeout(() => syncSession(session), 350);
}

async function syncAllSessions() {
  if (!state.sessions.length) return;
  if (QA_MODE) {
    setSyncStatus("local");
    return;
  }
  setSyncStatus("syncing");
  try {
    await Promise.all(state.sessions.map((session) => (
      postJson("/api/workouts", "POST", session)
    )));
    state.sync.serverAvailable = true;
    state.sync.lastSavedAt = new Date().toISOString();
    setSyncStatus("synced");
  } catch {
    state.sync.serverAvailable = false;
    setSyncStatus("local");
  }
}

function activeSession(): WorkoutSession | null {
  return state.sessions.find((session) => (
    session.date === todayIso() && !session.finishedAt
  )) || null;
}

function latestTodaySession(): WorkoutSession | null {
  return state.sessions.find((session) => session.date === todayIso()) || null;
}

function touchSession(session: WorkoutSession): void {
  session.updatedAt = new Date().toISOString();
  state.sessions = mergeSessions(state.sessions, []);
  saveLocalState();
  scheduleSessionSync(session);
}

function startWorkout() {
  if (!state.plan) {
    showToast("현재 프로그램을 불러오지 못했습니다.");
    return;
  }
  if (activeSession()) return;

  const previous = previousSessionForPlan(state.sessions, state.plan);
  const session = createSessionFromPlan(state.plan, previous);
  session.readiness = state.preReadiness;
  state.sessions.unshift(session);
  saveLocalState();
  scheduleSessionSync(session);
  render();
}

function updateReadiness(value: Readiness): void {
  state.preReadiness = value;
  const session = activeSession();
  if (session) {
    session.readiness = value;
    touchSession(session);
  } else {
    saveLocalState();
  }
  render();
}

function updateSet(exerciseId: string, setId: string, field: SetField, value: string): void {
  const session = activeSession();
  const exercise = session?.exercises?.find((item) => item.id === exerciseId);
  const set = exercise?.sets?.find((item) => item.id === setId);
  if (!session || !set) return;

  set[field] = value;
  touchSession(session);
}

function toggleSet(exerciseId: string, setId: string): void {
  const session = activeSession();
  const exercise = session?.exercises?.find((item) => item.id === exerciseId);
  const set = exercise?.sets?.find((item) => item.id === setId);
  if (!session || !exercise || !set) return;

  if (!set.completed && numberOrNull(set.reps) === null) {
    document.querySelector<HTMLInputElement>(
      `[data-exercise="${exerciseId}"][data-set="${setId}"][data-field="reps"]`
    )?.focus();
    showToast("반복수를 먼저 입력하세요.");
    return;
  }

  if (!set.completed && numberOrNull(set.rpe) === null) {
    document.querySelector<HTMLInputElement>(
      `[data-exercise="${exerciseId}"][data-set="${setId}"][data-field="rpe"]`
    )?.focus();
    showToast("세트가 끝났을 때의 실제 RPE를 입력하세요.");
    return;
  }

  set.completed = !set.completed;
  set.completedAt = set.completed ? new Date().toISOString() : null;
  touchSession(session);
  if (set.completed) startTimer(exercise.restSeconds, exercise.name);
  render();
}

function updateCardio(cardioId: string, field: CardioField, value: string): void {
  const session = activeSession();
  const cardio = session?.cardio?.find((item) => item.id === cardioId);
  if (!session || !cardio) return;

  cardio[field] = value;
  touchSession(session);
}

function toggleCardio(cardioId: string): void {
  const session = activeSession();
  const cardio = session?.cardio?.find((item) => item.id === cardioId);
  if (!session || !cardio) return;

  if (!cardio.completed && (numberOrNull(cardio.durationMinutes) || 0) <= 0) {
    document.querySelector<HTMLInputElement>(
      `[data-cardio="${cardioId}"][data-cardio-field="durationMinutes"]`
    )?.focus();
    showToast("유산소 시간을 먼저 입력하세요.");
    return;
  }
  if (!cardio.completed && numberOrNull(cardio.rpe) === null) {
    document.querySelector<HTMLInputElement>(
      `[data-cardio="${cardioId}"][data-cardio-field="rpe"]`
    )?.focus();
    showToast("유산소가 끝났을 때의 실제 RPE를 입력하세요.");
    return;
  }

  cardio.completed = !cardio.completed;
  cardio.completedAt = cardio.completed ? new Date().toISOString() : null;
  touchSession(session);
  render();
}

function addSet(exerciseId: string): void {
  const session = activeSession();
  const exercise = session?.exercises?.find((item) => item.id === exerciseId);
  if (!session || !exercise) return;

  const previousSet = exercise.sets.at(-1);
  const usesPounds = exerciseWeightUnit(exercise) === "lb";
  exercise.sets.push({
    id: uid("set"),
    setNumber: exercise.sets.length + 1,
    setType: "working",
    ...(usesPounds
      ? { weightLb: previousSet?.weightLb || "" }
      : { weightKg: previousSet?.weightKg || "" }),
    reps: "",
    rpe: "",
    completed: false,
    completedAt: null,
    previousWeightKg: null,
    previousWeightLb: null,
    previousReps: null
  });
  touchSession(session);
  render();
}

function openFinishSheet() {
  const session = activeSession();
  if (!session || (!completedSets(session).length && !completedCardio(session).length)) {
    showToast("완료한 운동이 아직 없습니다.");
    return;
  }
  state.finishSheetOpen = true;
  render();
}

function finishWorkout() {
  const session = activeSession();
  if (!session) return;
  const rpeInput = document.querySelector<HTMLInputElement>("#session-rpe");
  const notesInput = document.querySelector<HTMLInputElement>("#session-notes");
  session.sessionRpe = numberOrNull(rpeInput?.value);
  session.notes = notesInput?.value?.trim() || session.notes || "";
  session.finishedAt = new Date().toISOString();
  state.finishSheetOpen = false;
  touchSession(session);
  dismissTimer();
  render();
}

function reopenWorkout(sessionId: string): void {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session || session.date !== todayIso()) return;
  session.finishedAt = null;
  touchSession(session);
  render();
}

function timerRemaining(): number {
  if (!state.timer.running || !state.timer.endsAt) return state.timer.remaining || 0;
  return Math.max(0, Math.ceil((state.timer.endsAt - Date.now()) / 1000));
}

function startTimer(seconds: number, exerciseName = ""): void {
  const duration = Number(seconds) || 90;
  state.timer = {
    running: true,
    endsAt: Date.now() + duration * 1000,
    remaining: duration,
    exerciseName
  };
  saveLocalState();
  startTimerInterval();
  renderTimerBar();
}

function pauseTimer() {
  const remaining = timerRemaining();
  state.timer.running = false;
  state.timer.endsAt = null;
  state.timer.remaining = remaining;
  saveLocalState();
  renderTimerBar();
}

function resumeTimer() {
  if (!state.timer.remaining) return;
  state.timer.running = true;
  state.timer.endsAt = Date.now() + state.timer.remaining * 1000;
  saveLocalState();
  startTimerInterval();
  renderTimerBar();
}

function dismissTimer() {
  state.timer = {
    running: false,
    endsAt: null,
    remaining: 0,
    exerciseName: ""
  };
  saveLocalState();
  renderTimerBar();
}

function startTimerInterval() {
  if (timerInterval) clearInterval(timerInterval);
  if (!state.timer.running) return;
  timerInterval = setInterval(() => {
    if (!state.timer.running) return;
    const remaining = timerRemaining();
    state.timer.remaining = remaining;
    renderTimerBar();
    if (remaining === 0) {
      state.timer.running = false;
      state.timer.endsAt = null;
      saveLocalState();
      if (timerInterval) clearInterval(timerInterval);
      showToast("휴식이 끝났습니다.");
    }
  }, 500);
}

function formatTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function renderTimerBar() {
  const container = document.querySelector<HTMLInputElement>("#rest-timer");
  if (!container) return;
  const remaining = timerRemaining();
  const visible = remaining > 0 || state.timer.running;
  container.hidden = !visible;
  document.body.classList.toggle("timer-visible", visible);
  if (!visible) return;

  container.innerHTML = `
    <div class="timer-copy">
      <span>${escapeHtml(state.timer.exerciseName || "휴식")}</span>
      <strong>${formatTimer(remaining)}</strong>
    </div>
    <div class="timer-controls">
      <button class="icon-button" data-action="${state.timer.running ? "timer-pause" : "timer-resume"}"
        aria-label="${state.timer.running ? "휴식 타이머 일시정지" : "휴식 타이머 다시 시작"}"
        title="${state.timer.running ? "일시정지" : "다시 시작"}">
        ${state.timer.running ? "Ⅱ" : "▶"}
      </button>
      <button class="icon-button" data-action="timer-dismiss" aria-label="휴식 타이머 닫기" title="닫기">×</button>
    </div>
  `;
  bindTimerEvents();
}

function formatDateKorean(dateString: string): string {
  if (!dateString) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(`${dateString}T12:00:00`));
}

function formatShortDate(dateString?: string): string {
  if (!dateString) return "-";
  return dateString.replaceAll("-", ".");
}

function planSetCount(plan: WorkoutPlan | null = state.plan): number {
  return (plan?.exercises || []).reduce((sum, exercise) => sum + exercise.targetSets, 0);
}

function planCardioMinutes(plan: WorkoutPlan | null = state.plan): number {
  return (plan?.cardio || []).reduce((sum, item) => sum + item.targetMinutes, 0);
}

function planActivityCount(plan: WorkoutPlan | null = state.plan): number {
  return planSetCount(plan) + (plan?.cardio || []).length;
}

function exerciseStartingLoad(exercise: PlanExercise): string {
  if (numberOrNull(exercise.startingWeightLb) !== null) {
    return `${exercise.startingWeightLb}lb`;
  }
  if (numberOrNull(exercise.startingWeightKg) !== null) {
    return `${exercise.startingWeightKg}kg`;
  }
  return exercise.startingLoad || "";
}

function exerciseWeightUnit(exercise: PlanExercise | SessionExercise): WeightUnit {
  if (
    exercise.startingWeightLb !== undefined ||
    ("sets" in exercise && exercise.sets.some((set) => set.weightLb !== undefined))
  ) return "lb";
  return "kg";
}

function workoutSetRawWeight(set: WorkoutSet): { value: number | null; unit: WeightUnit } {
  const pounds = numberOrNull(set.weightLb);
  if (pounds !== null) return { value: pounds, unit: "lb" };
  return { value: numberOrNull(set.weightKg), unit: "kg" };
}

function workoutSetLoadText(set: WorkoutSet): string {
  if (set.load) return set.load;
  const { value, unit } = workoutSetRawWeight(set);
  return value === null ? "BW" : `${value}${unit}`;
}

function exerciseWarmupText(exercise: PlanExercise | SessionExercise): string {
  return (exercise.warmupSets || []).map((set) => {
    return `${workoutSetLoadText(set)} × ${set.reps}`;
  }).join(" · ");
}

function readinessLabel(value: Readiness): string {
  return { good: "좋음", normal: "보통", tired: "피곤" }[value] || "보통";
}

function readinessGuidance(value: Readiness): string {
  return state.plan?.readinessRules?.[value] || "목표 RPE를 우선해 수행합니다.";
}

function renderReadiness(selected: Readiness): string {
  return `
    <div class="readiness" role="group" aria-label="오늘의 준비 상태">
      ${[
        ["good", "좋음"],
        ["normal", "보통"],
        ["tired", "피곤"]
      ].map(([value, label]) => `
        <button class="${selected === value ? "selected" : ""}" data-readiness="${value}"
          aria-pressed="${selected === value}">${label}</button>
      `).join("")}
    </div>
  `;
}

function renderPlanHeader(session: WorkoutSession | null = null): string {
  const plan = state.plan;
  const isRecoveryPlan = plan?.status === "recovery";
  const progress = session
    ? sessionProgress(session)
    : { completed: 0, total: planActivityCount(plan), ratio: 0 };
  const stale = planNeedsRefresh(plan);

  return `
    <header class="workout-header">
      <div class="date-line">${formatDateKorean(todayIso())}</div>
      <div class="title-row">
        <div>
          <h1>${escapeHtml(plan?.title || "오늘 프로그램 대기")}</h1>
          <p>${escapeHtml(plan?.focus || "Codex가 생성한 프로그램이 여기에 표시됩니다.")}</p>
        </div>
        ${isRecoveryPlan ? `
          <div class="progress-ring is-recovery" aria-label="오늘은 회복일">
            <strong>회복</strong>
          </div>
        ` : `
          <div class="progress-ring" style="--progress:${Math.round(progress.ratio * 100)}"
            aria-label="${progress.completed} / ${progress.total} 운동 항목 완료">
            <strong>${progress.completed}</strong>
            <span>/${progress.total}</span>
          </div>
        `}
      </div>
      ${plan ? `
        <div class="plan-facts">
          ${isRecoveryPlan ? `
            <span>근력운동 없음</span>
            <span>선택 활동만</span>
          ` : `
            <span>${plan.estimatedMinutes || "-"}분</span>
            <span>${planSetCount(plan)}세트</span>
            ${planCardioMinutes(plan) ? `<span>유산소 ${planCardioMinutes(plan)}분</span>` : ""}
          `}
          <span>${escapeHtml(plan.phase || "Plan")}</span>
          <span>Codex</span>
        </div>
      ` : ""}
      ${stale ? `
        <div class="notice warning">
          <strong>오늘 날짜의 프로그램이 아닙니다.</strong>
          <span>현재 파일: ${formatShortDate(plan?.date)}</span>
        </div>
      ` : ""}
    </header>
  `;
}

function renderToday() {
  if (!state.plan) {
    return `
      <section class="empty-state">
        <h1>오늘 프로그램 대기</h1>
        <p>프로그램 파일을 새로 불러오세요.</p>
        <button class="primary-button" data-action="refresh">새로고침</button>
      </section>
    `;
  }

  const session = activeSession();
  const finished = !session ? latestTodaySession() : null;
  if (finished?.finishedAt) return renderFinishedWorkout(finished);
  if (state.plan.status === "recovery") return renderRecoveryDay();

  return `
    ${renderPlanHeader(session)}
    <section class="readiness-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">컨디션</span>
          <h2>오늘의 준비 상태</h2>
        </div>
        <span class="status-text">${readinessLabel(session?.readiness || state.preReadiness)}</span>
      </div>
      ${renderReadiness(session?.readiness || state.preReadiness)}
      <p class="guidance">${escapeHtml(readinessGuidance(session?.readiness || state.preReadiness))}</p>
    </section>

    ${session ? renderActiveWorkout(session) : renderWorkoutPreview()}
  `;
}

function renderRecoveryDay() {
  const plan = state.plan;
  if (!plan) return "";
  const actions = plan.recoveryActions || [];
  return `
    ${renderPlanHeader()}
    <section class="content-section recovery-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">오늘의 결정</span>
          <h2>근력운동은 쉬어갑니다</h2>
        </div>
        <span class="status-text">회복 우선</span>
      </div>
      <p class="recovery-guidance">${escapeHtml(plan.recoveryGuidance || "")}</p>
      <div class="recovery-list">
        ${actions.map((action, index) => `
          <div class="recovery-row">
            <span>${String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>${escapeHtml(action.title)}</strong>
              <p>${escapeHtml(action.detail)}</p>
            </div>
          </div>
        `).join("")}
      </div>
    </section>
    <section class="coach-notes">
      <details open>
        <summary>다음 근력운동 조건</summary>
        <ul>
          ${(plan.coachNotes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
        </ul>
      </details>
    </section>
  `;
}

function renderWorkoutPreview() {
  const plan = state.plan;
  if (!plan) return "";
  const assumptions = plan.assumptions || [];
  return `
    ${assumptions.length ? `
      <section class="notice assumption">
        <strong>초안의 전제</strong>
        <span>${escapeHtml(assumptions[0])}</span>
      </section>
    ` : ""}
    <section class="content-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">프로그램</span>
          <h2>${plan.exercises.length}개 근력${(plan.cardio || []).length ? ` · ${(plan.cardio || []).length}개 유산소` : ""}</h2>
        </div>
        <span class="status-text">RPE 기준</span>
      </div>
      <div class="preview-list">
        ${plan.exercises.map((exercise, index) => `
          <div class="preview-row">
            <span class="preview-index">${String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>${escapeHtml(exercise.name)}</strong>
              <span>${escapeHtml(exercise.muscleGroup)} · ${exercise.targetSets} ×
                ${exercise.repRange.join("-")} · ${exerciseStartingLoad(exercise) ? `${escapeHtml(exerciseStartingLoad(exercise))} · ` : ""}RPE ${exercise.targetRpe}</span>
              ${exerciseWarmupText(exercise) ? `<small class="preview-warmup">웜업 ${escapeHtml(exerciseWarmupText(exercise))}</small>` : ""}
            </div>
            <span class="rest-label">${Math.round(exercise.restSeconds / 30) * 0.5}분</span>
          </div>
        `).join("")}
        ${(plan.cardio || []).map((cardio, index) => `
          <div class="preview-row cardio-preview-row">
            <span class="preview-index">${String(plan.exercises.length + index + 1).padStart(2, "0")}</span>
            <div>
              <strong>${escapeHtml(cardio.name)}</strong>
              <span>유산소 · ${cardio.targetMinutes}분 · RPE ${cardio.rpeRange.join("-")}</span>
            </div>
            <span class="rest-label">기록</span>
          </div>
        `).join("")}
      </div>
    </section>
    <div class="primary-action">
      <button class="primary-button" data-action="start-workout">운동 시작</button>
    </div>
  `;
}

function renderActiveWorkout(session: WorkoutSession): string {
  return `
    <section class="content-section workout-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">작업 세트 · 유산소</span>
          <h2>운동 기록</h2>
        </div>
        <span class="status-text">자동 저장</span>
      </div>
      <div class="exercise-list">
        ${session.exercises.map(renderExercise).join("")}
        ${(session.cardio || []).map(renderCardio).join("")}
      </div>
    </section>
    <section class="coach-notes">
      <details>
        <summary>오늘의 코칭 메모</summary>
        <ul>
          ${(state.plan?.coachNotes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
        </ul>
      </details>
    </section>
    <div class="primary-action">
      <button class="primary-button" data-action="open-finish">운동 완료</button>
    </div>
  `;
}

function renderCardio(cardio: SessionCardio): string {
  const progress = cardio.completed ? 1 : 0;
  return `
    <article class="exercise-card cardio-card ${cardio.completed ? "is-complete" : ""}"
      style="--exercise-progress:${progress * 100}%">
      <header class="exercise-header">
        <div>
          <span class="exercise-muscle">유산소</span>
          <h3>${escapeHtml(cardio.name)}</h3>
        </div>
        <div class="exercise-target">
          <strong>${cardio.targetMinutes}분</strong>
          <span>RPE ${cardio.rpeRange.join("-")}</span>
        </div>
      </header>
      <div class="exercise-progress" aria-label="${cardio.completed ? "유산소 완료" : "유산소 미완료"}">
        <span style="width:var(--exercise-progress)"></span>
      </div>
      ${cardio.cue ? `<p class="exercise-cue">${escapeHtml(cardio.cue)}</p>` : ""}
      <div class="cardio-grid cardio-labels" aria-hidden="true">
        <span>시간</span><span>거리</span><span>평균 심박</span><span>RPE</span><span>완료</span>
      </div>
      <div class="cardio-grid cardio-row ${cardio.completed ? "completed" : ""}">
        <label>
          <span class="sr-only">${cardio.name} 시간(분)</span>
          <input inputmode="decimal" value="${escapeHtml(cardio.durationMinutes)}"
            data-cardio="${cardio.id}" data-cardio-field="durationMinutes"
            min="1" max="600" placeholder="${cardio.targetMinutes}" />
          <small>분</small>
        </label>
        <label>
          <span class="sr-only">${cardio.name} 거리(km)</span>
          <input inputmode="decimal" value="${escapeHtml(cardio.distanceKm)}"
            data-cardio="${cardio.id}" data-cardio-field="distanceKm"
            min="0" step="0.1" placeholder="선택" />
          <small>km</small>
        </label>
        <label>
          <span class="sr-only">${cardio.name} 평균 심박수</span>
          <input inputmode="numeric" value="${escapeHtml(cardio.averageHeartRate)}"
            data-cardio="${cardio.id}" data-cardio-field="averageHeartRate"
            min="20" max="250" placeholder="선택" />
          <small>bpm</small>
        </label>
        <label>
          <span class="sr-only">${cardio.name} RPE</span>
          <input inputmode="decimal" value="${escapeHtml(cardio.rpe)}"
            data-cardio="${cardio.id}" data-cardio-field="rpe"
            min="1" max="10" step="0.5" placeholder="${cardio.rpeRange.join("-")}" />
          <small>1–10</small>
        </label>
        <button class="check-button" data-action="toggle-cardio" data-cardio="${cardio.id}"
          aria-label="${cardio.completed ? "유산소 완료 취소" : "유산소 완료"}"
          aria-pressed="${cardio.completed}" title="${cardio.completed ? "완료 취소" : "완료"}">✓</button>
      </div>
      ${cardio.substitutions?.length ? `
        <footer class="exercise-footer cardio-footer">
          <details class="substitution">
            <summary>대체 유산소</summary>
            <span>${cardio.substitutions.map(escapeHtml).join(" · ")}</span>
          </details>
        </footer>
      ` : ""}
    </article>
  `;
}

function previousSetText(set: WorkoutSet): string {
  if (numberOrNull(set.previousReps) === null) return "이전 -";
  const pounds = numberOrNull(set.previousWeightLb);
  if (pounds !== null) return `이전 ${pounds}lb×${set.previousReps}`;
  const weight = numberOrNull(set.previousWeightKg);
  return weight === null ? `이전 ×${set.previousReps}` : `이전 ${weight}kg×${set.previousReps}`;
}

function renderExercise(exercise: SessionExercise): string {
  const completedCount = exercise.sets.filter((set) => set.completed).length;
  const nextSet = exercise.sets.find((set) => !set.completed);
  const progress = exercise.sets.length ? completedCount / exercise.sets.length : 0;
  const weightUnit = exerciseWeightUnit(exercise);
  const weightField: "weightKg" | "weightLb" = weightUnit === "lb" ? "weightLb" : "weightKg";
  return `
    <article class="exercise-card ${progress === 1 ? "is-complete" : ""}"
      style="--exercise-progress:${Math.round(progress * 100)}%">
      <header class="exercise-header">
        <div>
          <span class="exercise-muscle">${escapeHtml(exercise.muscleGroup)}</span>
          <h3>${escapeHtml(exercise.name)}</h3>
        </div>
        <div class="exercise-target">
          <strong>${exercise.targetSets} × ${exercise.repRange.join("-")}</strong>
          <span>${exerciseStartingLoad(exercise) ? `${escapeHtml(exerciseStartingLoad(exercise))} · ` : ""}RPE ${exercise.targetRpe} · ${exercise.restSeconds}초</span>
        </div>
      </header>
      <div class="exercise-progress" aria-label="${completedCount} / ${exercise.sets.length}세트 완료">
        <span style="width:var(--exercise-progress)"></span>
      </div>
      <div class="exercise-progress-copy">
        <span>${nextSet ? `${nextSet.setNumber}세트 입력 차례` : "모든 세트 완료"}</span>
        <strong>${completedCount}/${exercise.sets.length}</strong>
      </div>
      ${exercise.cue ? `<p class="exercise-cue">${escapeHtml(exercise.cue)}</p>` : ""}
      ${exerciseWarmupText(exercise) ? `
        <p class="warmup-prescription">
          <strong>웜업</strong>
          <span>${escapeHtml(exerciseWarmupText(exercise))}</span>
        </p>
      ` : ""}
      <div class="set-grid set-labels" aria-hidden="true">
        <span>세트</span><span>${weightUnit}</span><span>횟수</span><span>RPE</span><span>완료</span>
      </div>
      <div class="sets">
        ${exercise.sets.map((set) => `
          <div class="set-grid set-row ${set.completed ? "completed" : ""} ${nextSet?.id === set.id ? "current" : ""}">
            <div class="set-identity">
              <strong>${set.setNumber}</strong>
              <span>${previousSetText(set)}</span>
            </div>
            <label>
              <span class="sr-only">${exercise.name} ${set.setNumber}세트 중량</span>
              <input inputmode="decimal" value="${escapeHtml(set[weightField])}"
                data-exercise="${exercise.id}" data-set="${set.id}" data-field="${weightField}"
                placeholder="0" />
            </label>
            <label>
              <span class="sr-only">${exercise.name} ${set.setNumber}세트 반복수</span>
              <input inputmode="numeric" value="${escapeHtml(set.reps)}"
                data-exercise="${exercise.id}" data-set="${set.id}" data-field="reps"
                min="1" placeholder="${exercise.repRange.join("-")}" />
            </label>
            <label>
              <span class="sr-only">${exercise.name} ${set.setNumber}세트 RPE</span>
              <input inputmode="decimal" value="${escapeHtml(set.rpe)}"
                data-exercise="${exercise.id}" data-set="${set.id}" data-field="rpe"
                min="1" max="10" step="0.5" placeholder="${exercise.targetRpe}" />
            </label>
            <button class="check-button" data-action="toggle-set" data-exercise="${exercise.id}"
              data-set="${set.id}" aria-label="${set.completed ? "세트 완료 취소" : "세트 완료"}"
              aria-pressed="${set.completed}" title="${set.completed ? "완료 취소" : "완료"}">✓</button>
          </div>
        `).join("")}
      </div>
      <footer class="exercise-footer">
        <button class="text-button" data-action="add-set" data-exercise="${exercise.id}">
          <span aria-hidden="true">＋</span> 세트 추가
        </button>
        ${exercise.substitutions?.length ? `
          <details class="substitution">
            <summary>대체 운동</summary>
            <span>${exercise.substitutions.map(escapeHtml).join(" · ")}</span>
          </details>
        ` : ""}
      </footer>
    </article>
  `;
}

function renderFinishedWorkout(session: WorkoutSession): string {
  const cardio = completedCardio(session);
  const cardioMinutes = cardio.reduce(
    (sum, item) => sum + (numberOrNull(item.durationMinutes) || 0),
    0
  );
  const durationMinutes = Math.max(
    1,
    Math.round((Date.parse(session.finishedAt || "") - Date.parse(session.startedAt || "")) / 60_000)
  );

  return `
    ${renderPlanHeader(session)}
    <section class="completion-hero">
      <div class="completion-mark" aria-hidden="true">✓</div>
      <h2>오늘 운동 완료</h2>
      <p>${completedSets(session).length}세트${cardioMinutes ? ` · 유산소 ${cardioMinutes}분` : ""} · ${durationMinutes}분 · 세션 RPE
        ${session.sessionRpe ?? "-"}</p>
    </section>
    <section class="content-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">요약</span>
          <h2>수행 기록</h2>
        </div>
        <span class="status-text">${formatShortDate(session.date)}</span>
      </div>
      <div class="summary-list">
        ${session.exercises.map((exercise) => {
          const sets = exercise.sets.filter((set) => set.completed);
          return `
            <div class="summary-row">
              <div>
                <strong>${escapeHtml(exercise.name)}</strong>
                <span>${escapeHtml(exercise.muscleGroup)}</span>
              </div>
              <span>${sets.map((set) => {
                const type = set.setType === "warmup" ? "워밍업 " : "";
                return `${type}${workoutSetLoadText(set)} × ${set.reps}`;
              }).join(" · ") || "기록 없음"}</span>
            </div>
          `;
        }).join("")}
        ${cardio.map((item) => `
          <div class="summary-row">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <span>유산소</span>
            </div>
            <span>${formatCardioSummary(item)}</span>
          </div>
        `).join("")}
      </div>
    </section>
    <div class="secondary-action">
      <button class="secondary-button" data-action="reopen" data-session="${session.id}">기록 수정</button>
    </div>
  `;
}

function completedWorkingSetsForExercise(exercise: SessionExercise): WorkoutSet[] {
  return (exercise.sets || []).filter((set) => (
    set.completed && set.setType !== "warmup"
  ));
}

function completedWarmupSetsForExercise(exercise: SessionExercise): WorkoutSet[] {
  return (exercise.sets || []).filter((set) => (
    set.completed && set.setType === "warmup"
  ));
}

function sessionWorkingSets(session: WorkoutSession): WorkoutSet[] {
  return (session.exercises || []).flatMap(completedWorkingSetsForExercise);
}

function setTonnage(set: WorkoutSet): number {
  const weight = workoutSetWeightKg(set);
  const reps = numberOrNull(set.reps);
  return weight === null || reps === null ? 0 : weight * reps;
}

function setsTonnage(sets: WorkoutSet[]): number {
  return sets.reduce((total, set) => total + setTonnage(set), 0);
}

function formatTonnage(value: number): string {
  if (!value) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}t`;
  return `${Math.round(value)}kg`;
}

function averageRpe(sets: WorkoutSet[]): number | null {
  const values = sets.map((set) => numberOrNull(set.rpe)).filter((value) => value !== null);
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatRpe(value: number | null): string {
  if (value === null) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatCardioSummary(cardio: SessionCardio): string {
  const duration = numberOrNull(cardio.durationMinutes);
  const distance = numberOrNull(cardio.distanceKm);
  const heartRate = numberOrNull(cardio.averageHeartRate);
  const rpe = numberOrNull(cardio.rpe);
  return [
    duration === null ? null : `${duration}분`,
    distance === null ? null : `${distance}km`,
    heartRate === null ? null : `평균 ${heartRate}bpm`,
    rpe === null ? null : `RPE ${formatRpe(rpe)}`
  ].filter(Boolean).join(" · ") || "기록 없음";
}

function sessionDurationLabel(session: WorkoutSession): string {
  if (session.timingRecorded === false || !session.startedAt || !session.finishedAt) return "-";
  const minutes = Math.round((Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? `${minutes}분` : "-";
}

function rpeZone(rpe: number | null): string {
  const value = numberOrNull(rpe);
  if (value === null) return "none";
  if (value <= 6) return "easy";
  if (value <= 8) return "target";
  return "hard";
}

function muscleColor(muscleGroup: string): string {
  if (["하체", "대퇴사두"].includes(muscleGroup)) return "#ff9f0a";
  if (muscleGroup === "햄스트링") return "#ff375f";
  if (muscleGroup === "가슴") return "#0a84ff";
  if (muscleGroup === "등") return "#30d158";
  if (muscleGroup === "어깨") return "#bf5af2";
  if (["팔", "이두", "삼두"].includes(muscleGroup)) return "#64d2ff";
  return "#8e8e93";
}

function renderMuscleDistribution(session: WorkoutSession): string {
  const counts = new Map();
  for (const exercise of session.exercises || []) {
    const count = completedWorkingSetsForExercise(exercise).length;
    if (!count) continue;
    counts.set(exercise.muscleGroup, (counts.get(exercise.muscleGroup) || 0) + count);
  }
  if (!counts.size) return "";

  return `
    <div class="muscle-distribution" aria-label="운동 부위별 작업 세트 분포">
      ${[...counts.entries()].map(([muscle, count]) => `
        <span style="flex-grow:${count};--muscle-color:${muscleColor(muscle)}"
          title="${escapeHtml(muscle)} ${count}세트">
          <span class="sr-only">${escapeHtml(muscle)} ${count}세트</span>
        </span>
      `).join("")}
    </div>
  `;
}

function renderHistorySet(set: WorkoutSet, index: number): string {
  const { value: weight } = workoutSetRawWeight(set);
  const rpe = numberOrNull(set.rpe);
  return `
    <div class="history-set-row ${set.setType === "warmup" ? "warmup" : ""}">
      <span>${set.setType === "warmup" ? `W${index + 1}` : index + 1}</span>
      <strong>${weight === null ? "BW" : weight}</strong>
      <strong>${escapeHtml(set.reps)}</strong>
      <span class="history-rpe" data-zone="${rpeZone(rpe)}">
        <i aria-hidden="true"></i>${formatRpe(rpe)}
      </span>
    </div>
  `;
}

function renderHistoryExercise(exercise: SessionExercise): string {
  const workingSets = completedWorkingSetsForExercise(exercise);
  const warmupSets = completedWarmupSetsForExercise(exercise);
  const allSets = [...warmupSets, ...workingSets];
  const weightUnit = exerciseWeightUnit(exercise);
  if (!allSets.length) return "";

  return `
    <section class="history-exercise">
      <header>
        <div>
          <span style="--muscle-color:${muscleColor(exercise.muscleGroup)}"></span>
          <div>
            <strong>${escapeHtml(exercise.name)}</strong>
            <small>${escapeHtml(exercise.muscleGroup)} · 작업 ${workingSets.length}세트</small>
          </div>
        </div>
        <span>${formatTonnage(setsTonnage(workingSets))}</span>
      </header>
      <div class="history-set-table">
        <div class="history-set-labels" aria-hidden="true">
          <span>세트</span><span>${weightUnit}</span><span>횟수</span><span>RPE</span>
        </div>
        ${allSets.map(renderHistorySet).join("")}
      </div>
    </section>
  `;
}

function renderHistoryCardio(cardio: SessionCardio): string {
  if (!cardio.completed) return "";
  return `
    <section class="history-exercise history-cardio">
      <header>
        <div>
          <span style="--muscle-color:#30b0c7"></span>
          <div>
            <strong>${escapeHtml(cardio.name)}</strong>
            <small>유산소 · 목표 ${cardio.targetMinutes}분</small>
          </div>
        </div>
        <span>${numberOrNull(cardio.durationMinutes) || 0}분</span>
      </header>
      <div class="history-cardio-detail">${formatCardioSummary(cardio)}</div>
    </section>
  `;
}

function renderHistory() {
  const sessions = state.sessions;
  const allWorkingSets = sessions.flatMap(sessionWorkingSets);
  const totalTonnage = setsTonnage(allWorkingSets);
  const totalCardioMinutes = completedCardio(sessions).reduce(
    (sum, item) => sum + (numberOrNull(item.durationMinutes) || 0),
    0
  );
  return `
    <header class="page-header">
      <span class="date-line">Training log</span>
      <h1>운동 기록</h1>
      <p>수행량과 실제 강도를 세션별로 비교합니다.</p>
    </header>
    <section class="history-overview" aria-label="전체 운동 기록 요약">
      <div>
        <span>전체 세션</span>
        <strong>${sessions.length}</strong>
        <small>회</small>
      </div>
      <div>
        <span>작업 세트</span>
        <strong>${allWorkingSets.length}</strong>
        <small>세트</small>
      </div>
      <div>
        <span>누적 볼륨</span>
        <strong>${formatTonnage(totalTonnage)}</strong>
        <small>중량 × 횟수</small>
      </div>
      <div>
        <span>유산소</span>
        <strong>${totalCardioMinutes}분</strong>
        <small>완료 시간</small>
      </div>
    </section>
    <section class="content-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">최근 순</span>
          <h2>세션 타임라인</h2>
        </div>
      </div>
      <div class="history-list">
        ${sessions.length ? sessions.map((session, sessionIndex) => {
          const workingSets = sessionWorkingSets(session);
          const tonnage = setsTonnage(workingSets);
          const setRpe = averageRpe(workingSets);
          const cardio = completedCardio(session);
          const cardioMinutes = cardio.reduce(
            (sum, item) => sum + (numberOrNull(item.durationMinutes) || 0),
            0
          );
          const completedExercises = (session.exercises || []).filter((exercise) => (
            completedWorkingSetsForExercise(exercise).length
          ));
          const sessionDate = new Date(`${session.date}T12:00:00`);
          return `
            <details class="history-item ${sessionIndex === 0 ? "latest" : ""}">
              <summary>
                <div class="history-date">
                  <strong>${sessionDate.getDate()}</strong>
                  <span>${new Intl.DateTimeFormat("ko-KR", { month: "short" }).format(sessionDate)}</span>
                  <small>${new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(sessionDate)}</small>
                </div>
                <div class="history-main">
                  <div class="history-title">
                    <strong>${escapeHtml(session.title || "운동")}</strong>
                    <span>${escapeHtml(session.gymName || "장소 미기록")} · ${readinessLabel(session.readiness || "normal")}</span>
                  </div>
                  <div class="history-metrics">
                    <span><strong>${workingSets.length}</strong><small>작업 세트</small></span>
                    <span><strong>${formatTonnage(tonnage)}</strong><small>볼륨</small></span>
                    <span><strong>${cardioMinutes ? `${cardioMinutes}분` : formatRpe(setRpe)}</strong><small>${cardioMinutes ? "유산소" : "평균 RPE"}</small></span>
                  </div>
                  ${renderMuscleDistribution(session)}
                </div>
                <span class="disclosure" aria-hidden="true">›</span>
              </summary>
              <div class="history-detail">
                <div class="history-session-stats">
                  <span><small>운동</small><strong>${completedExercises.length}개</strong></span>
                  <span><small>유산소</small><strong>${cardioMinutes ? `${cardioMinutes}분` : "-"}</strong></span>
                  <span><small>소요 시간</small><strong>${sessionDurationLabel(session)}</strong></span>
                  <span><small>세션 RPE</small><strong>${session.sessionRpe ?? "-"}</strong></span>
                </div>
                <div class="history-exercises">
                  ${(session.exercises || []).map(renderHistoryExercise).join("")}
                  ${cardio.map(renderHistoryCardio).join("")}
                </div>
                ${session.notes ? `
                  <div class="history-note">
                    <strong>세션 메모</strong>
                    <p>${escapeHtml(session.notes)}</p>
                  </div>
                ` : ""}
              </div>
            </details>
          `;
        }).join("") : `
          <div class="empty-inline">첫 운동을 완료하면 날짜별 기록이 쌓입니다.</div>
        `}
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Progress view. Three decisions, in the order they recur:
//   1. Is this week's training on track? (rolling 7 days vs prior 3 weeks)
//   2. Is each exercise progressing? (protocol-based status per exercise id)
//   3. Is body composition moving? (several InBody measurements, real units)
// Charts are inline SVG + HTML so they follow the CSS color tokens in both
// light and dark mode and need no redraw on resize or theme change.
// ---------------------------------------------------------------------------

interface BodyMetricSetting {
  key: InBodyKey;
  label: string;
  unit: string;
  /** Smallest y-axis span, roughly measurement noise, so noise reads as flat. */
  minSpan: number;
}

const BODY_METRICS: BodyMetricSetting[] = [
  { key: "weightKg", label: "체중", unit: "kg", minSpan: 2 },
  { key: "skeletalMuscleKg", label: "골격근량", unit: "kg", minSpan: 1 },
  { key: "bodyFatKg", label: "체지방량", unit: "kg", minSpan: 1.5 },
  { key: "bodyFatPercent", label: "체지방률", unit: "%", minSpan: 2 }
];

const STATUS_LABELS: Record<ProgressionStatus, string> = {
  "load-up": "증량",
  "reps-up": "반복 증가",
  "reps-down": "반복 감소",
  holding: "유지",
  stalled: "정체",
  "load-down": "감량",
  baseline: "기준선"
};

const INBODY_GAP_DAYS = 120;

function trimNumber(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)));
}

function formatSigned(value: number | null, digits = 1, suffix = ""): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `±0${suffix}`;
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(digits)}${suffix}`;
}

function formatAverage(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return trimNumber(value, 1);
}

/** "11.25" within the reference year, "25.07.10" otherwise. */
function formatCompactDate(date: string, referenceYear = todayIso().slice(0, 4)): string {
  if (!date) return "-";
  const [year, month, day] = date.split("-");
  return year === referenceYear ? `${month}.${day}` : `${year.slice(2)}.${month}.${day}`;
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
}

function formatSpan(days: number): string {
  if (days >= 14) return `${Math.round(days / 7)}주`;
  return `${days}일`;
}

function formatLiftSets(point: ExerciseSessionPoint, unit: WeightUnit): string {
  const load = point.topLoad === null ? "맨몸" : `${trimNumber(point.topLoad)}${unit}`;
  const lighter = point.lighterSets ? ` 외 ${point.lighterSets}세트` : "";
  return `${load} × ${point.topReps.join("/")}${lighter}`;
}

interface SparkValue {
  date: string;
  value: number;
}

/**
 * Sparkline: SVG strokes stretch with the box (non-scaling stroke) while
 * dots are HTML so they stay round at any width.
 */
function renderSpark(
  values: SparkValue[],
  { minSpan, label, gapDays = Infinity, className = "", scaleDigits = null }: {
    minSpan: number;
    label: string;
    gapDays?: number;
    className?: string;
    /** When set, the y-domain endpoints are labelled with this many decimals. */
    scaleDigits?: number | null;
  }
): string {
  if (!values.length) return "";
  const times = values.map((item) => Date.parse(`${item.date}T12:00:00Z`));
  const tMin = Math.min(...times);
  const tSpan = Math.max(...times) - tMin;
  const vMin = Math.min(...values.map((item) => item.value));
  const vMax = Math.max(...values.map((item) => item.value));
  const span = Math.max(vMax - vMin, minSpan);
  const low = (vMin + vMax) / 2 - span / 2;
  const coordinates = values.map((item, index) => ({
    x: tSpan ? ((times[index] - tMin) / tSpan) * 100 : 50,
    y: 100 - ((item.value - low) / span) * 100
  }));
  let solid = "";
  let gaps = "";
  coordinates.forEach((point, index) => {
    if (!index) return;
    const previous = coordinates[index - 1];
    const segment = `M${previous.x.toFixed(2)} ${previous.y.toFixed(2)}L${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    if (daysBetween(values[index - 1].date, values[index].date) > gapDays) gaps += segment;
    else solid += segment;
  });

  return `
    <div class="spark ${className}" role="img" aria-label="${escapeHtml(label)}">
      <div class="spark-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${solid ? `<path class="spark-line" d="${solid}" />` : ""}
          ${gaps ? `<path class="spark-gap" d="${gaps}" />` : ""}
        </svg>
        ${coordinates.map((point, index) => `
          <i class="${index === coordinates.length - 1 ? "latest" : ""}"
            style="left:${point.x.toFixed(2)}%;top:${point.y.toFixed(2)}%"></i>
        `).join("")}
        ${scaleDigits === null ? "" : `
          <span class="spark-scale" style="top:0" aria-hidden="true">${(low + span).toFixed(scaleDigits)}</span>
          <span class="spark-scale" style="top:100%" aria-hidden="true">${low.toFixed(scaleDigits)}</span>
        `}
      </div>
    </div>
  `;
}

function renderWeekStrip(today: string): string {
  const { endDate, recent, priorWeeklyAverage: prior } = rollingTrainingSummary(state.sessions, today);
  const hasHistory = state.sessions.some((session) => (
    isSettledSession(session, today) && (completedSets(session).length || completedCardio(session).length)
  ));
  const cells: Array<[string, string, string]> = [
    ["세션", `${recent.sessions}`, prior ? `평균 ${formatAverage(prior.sessions)}` : ""],
    ["작업 세트", `${recent.workingSets}`, prior ? `평균 ${formatAverage(prior.workingSets)}` : ""],
    [
      "수행률",
      recent.adherence === null ? "-" : `${Math.round(recent.adherence * 100)}%`,
      prior?.adherence === null || !prior ? "" : `이전 ${Math.round(prior.adherence * 100)}%`
    ],
    ["유산소", `${Math.round(recent.cardioMinutes)}분`, prior ? `평균 ${Math.round(prior.cardioMinutes)}분` : ""]
  ];

  if (!hasHistory) {
    return `
      <section class="content-section" aria-labelledby="week-heading">
        <div class="section-heading">
          <div>
            <span class="section-kicker">최근 7일</span>
            <h2 id="week-heading">훈련량</h2>
          </div>
        </div>
        <div class="empty-inline keep-words">운동을 완료하면 최근 7일 세트 수와 부위별 볼륨이 표시됩니다.</div>
      </section>
    `;
  }

  return `
    <section class="content-section week-section" aria-labelledby="week-heading">
      <div class="section-heading">
        <div>
          <span class="section-kicker">최근 7일</span>
          <h2 id="week-heading">훈련량</h2>
        </div>
        <span class="status-text">${formatCompactDate(shiftIsoDate(endDate, -6))}–${formatCompactDate(endDate)}</span>
      </div>
      <div class="week-strip">
        ${cells.map(([label, value, comparison]) => `
          <div>
            <span>${label}</span>
            <strong>${value}</strong>
            ${comparison ? `<small>${comparison}</small>` : ""}
          </div>
        `).join("")}
      </div>
      <p class="section-note">${prior
        ? "평균·이전은 그 전 3주의 주당 값입니다."
        : "이전 기록이 1주 이상 쌓이면 주당 평균과 비교합니다."}</p>
      ${renderMuscleVolume(today)}
    </section>
  `;
}

function renderMuscleVolume(today: string): string {
  const rows = muscleVolume(state.sessions, today);
  const [targetLow, targetHigh] = WEEKLY_SET_TARGET;
  const scaleMax = Math.max(
    targetHigh + 4,
    ...rows.map((row) => Math.max(row.recentSets, row.priorWeeklyAverage || 0) + 1)
  );
  const percent = (value: number) => `${((value / scaleMax) * 100).toFixed(2)}%`;
  const hasPrior = rows.some((row) => row.priorWeeklyAverage !== null);

  return `
    <div class="volume-block" role="group" aria-labelledby="volume-heading">
      <div class="subsection-heading">
        <h3 id="volume-heading">부위별 작업 세트</h3>
        <span>목표 ${targetLow}–${targetHigh}세트</span>
      </div>
      ${rows.length ? `
        <div class="volume-legend" aria-hidden="true">
          <span><i class="key-bar"></i>최근 7일</span>
          ${hasPrior ? `<span><i class="key-avg"></i>이전 3주 평균</span>` : ""}
          <span><i class="key-band"></i>목표 범위</span>
        </div>
        <ul class="volume-list">
          ${rows.map((row) => `
            <li class="volume-row">
              <span class="volume-name">${escapeHtml(row.muscleGroup)}</span>
              <span class="volume-track" aria-hidden="true">
                <span class="volume-band" style="left:${percent(targetLow)};width:${percent(targetHigh - targetLow)}"></span>
                <span class="volume-bar" style="width:${percent(row.recentSets)}"></span>
                ${row.priorWeeklyAverage !== null ? `
                  <span class="volume-avg" style="left:${percent(row.priorWeeklyAverage)}"></span>
                ` : ""}
              </span>
              <span class="volume-value">
                <strong>${row.recentSets}</strong>
                <small>${row.priorWeeklyAverage === null ? "" : row.priorWeeklyAverage.toFixed(1)}</small>
              </span>
              <span class="sr-only">
                최근 7일 ${row.recentSets}세트${row.priorWeeklyAverage === null ? "" : `, 이전 3주 주당 평균 ${formatAverage(row.priorWeeklyAverage)}세트`}
              </span>
            </li>
          `).join("")}
        </ul>
        <p class="section-note">워밍업을 뺀 직접 세트입니다. 복합 운동은 기록된 주 부위 하나로 셉니다.</p>
      ` : `
        <div class="empty-inline keep-words">최근 4주에 완료한 작업 세트가 없습니다.</div>
      `}
    </div>
  `;
}

function liftComparisonText(item: ExerciseProgression): string {
  if (!item.previous) return "첫 기록 · 다음 수행부터 비교";
  if (item.status === "stalled" || (item.status !== "reps-down" && item.holdStreak >= 2)) {
    return `같은 중량에서 ${item.holdStreak}회 연속 반복 그대로`;
  }
  return `이전 ${formatLiftSets(item.previous, item.unit)}`;
}

function renderLiftRow(item: ExerciseProgression): string {
  const first = item.points[0];
  const spanDays = daysBetween(first.date, item.latest.date);
  const e1rmValues = item.points
    .filter((point) => point.bestE1rmKg !== null)
    .map((point) => ({ date: point.date, value: point.bestE1rmKg! }));
  const maxE1rm = Math.max(0, ...e1rmValues.map((point) => point.value));
  const change = item.e1rmChange === null
    ? ""
    : `${formatSigned(item.e1rmChange * 100, 1, "%")} · ${formatSpan(spanDays)}`;
  const statusLabel = STATUS_LABELS[item.status];

  return `
    <li class="lift-row">
      <div class="lift-main">
        <strong class="lift-name">${escapeHtml(item.name)}</strong>
        <span class="lift-latest">${formatLiftSets(item.latest, item.unit)}</span>
        <span class="lift-compare">${escapeHtml(liftComparisonText(item))}</span>
      </div>
      <div class="lift-trend">
        <span class="lift-status" data-status="${item.status}">${statusLabel}</span>
        ${e1rmValues.length > 1 ? renderSpark(e1rmValues, {
          minSpan: maxE1rm * 0.06,
          className: "lift-spark",
          label: `추정 1RM ${e1rmValues.length}회 기록, ${change}`
        }) : `<span class="lift-spark-empty" aria-hidden="true"></span>`}
        ${change ? `<span class="lift-change">${change}</span>` : ""}
      </div>
    </li>
  `;
}

function renderLiftProgress(today: string): string {
  const progressions = exerciseProgressions(state.sessions, today);
  const counts = progressions.reduce<Record<string, number>>((result, item) => {
    const group = item.status === "load-up" || item.status === "reps-up"
      ? "up"
      : item.status === "load-down" || item.status === "reps-down" ? "down" : item.status;
    result[group] = (result[group] || 0) + 1;
    return result;
  }, {});
  const groups: Array<{ sessionId: string; date: string; title: string; items: ExerciseProgression[] }> = [];
  for (const item of progressions) {
    let group = groups.find((entry) => entry.sessionId === item.latest.sessionId);
    if (!group) {
      const session = state.sessions.find((entry) => entry.id === item.latest.sessionId);
      group = {
        sessionId: item.latest.sessionId,
        date: item.latest.date,
        title: session?.title || "",
        items: []
      };
      groups.push(group);
    }
    group.items.push(item);
  }
  const summary: Array<[string, string, number]> = [
    ["up", "진행", counts.up || 0],
    ["holding", "유지", counts.holding || 0],
    ["down", "감소", counts.down || 0],
    ["stalled", "정체", counts.stalled || 0],
    ["baseline", "기준선", counts.baseline || 0]
  ];

  return `
    <section class="content-section" aria-labelledby="lift-heading">
      <div class="section-heading">
        <div>
          <span class="section-kicker">최근 4주 수행 종목</span>
          <h2 id="lift-heading">종목별 진행</h2>
        </div>
      </div>
      ${progressions.length ? `
        <div class="lift-summary">
          ${summary.filter(([, , count]) => count).map(([status, label, count]) => `
            <span data-status="${status}"><strong>${count}</strong>${label}</span>
          `).join("")}
        </div>
        ${groups.map((group) => `
          <div class="lift-group">
            <h3 class="lift-group-heading">
              <span>${formatCompactDate(group.date)}</span>
              <span>${escapeHtml(group.title)}</span>
            </h3>
            <ul class="lift-list">${group.items.map(renderLiftRow).join("")}</ul>
          </div>
        `).join("")}
        <p class="section-note">
          상태는 직전 수행과 비교합니다. 같은 중량에서 반복이 3회 연속 늘지 않으면 정체입니다.
          그래프와 변화율은 최근 6주 추정 1RM이며, lb 기구도 kg으로 환산해 비교합니다.
        </p>
      ` : `
        <div class="empty-inline keep-words">최근 4주에 완료한 작업 세트가 없습니다. 운동을 완료하면 종목별 증량과 반복 변화가 표시됩니다.</div>
      `}
    </section>
  `;
}

function renderBodyRow(setting: BodyMetricSetting, rows: InBodyRow[]): string {
  const trend = inBodyMetricTrend(rows, setting.key);
  if (!trend.latest) return "";
  const values = rows
    .map((row) => ({ date: row.date, value: numberOrNull(row[setting.key]) }))
    .filter((row): row is SparkValue => row.value !== null);
  const runText = trend.runDirection
    ? `최근 ${trend.runLength}회 연속 ${trend.runDirection === "up" ? "증가" : "감소"}`
    : "";

  return `
    <li class="body-row">
      <div class="body-meta">
        <span class="body-label">${setting.label}</span>
        <strong>${trend.latest.value.toFixed(1)}<small>${setting.unit}</small></strong>
        <span class="body-delta">직전 ${formatSigned(trend.previousDelta)}</span>
        ${trend.first && trend.count > 2 ? `
          <span class="body-delta">${formatCompactDate(trend.first.date)} 대비 ${formatSigned(trend.rangeDelta)}</span>
        ` : ""}
        ${runText ? `<span class="body-run">${runText}</span>` : ""}
      </div>
      ${values.length > 1 ? renderSpark(values, {
        minSpan: setting.minSpan,
        gapDays: INBODY_GAP_DAYS,
        className: "body-spark",
        scaleDigits: 1,
        label: `${setting.label} ${values.length}회 측정, ${formatCompactDate(values[0].date)} ${values[0].value.toFixed(1)}${setting.unit}에서 ${formatCompactDate(trend.latest.date)} ${trend.latest.value.toFixed(1)}${setting.unit}`
      }) : `<div class="body-spark empty">추세는 2회 측정부터</div>`}
    </li>
  `;
}

function renderBodyComposition(): string {
  const rangeWindow = inBodyWindow(state.inBody, state.inBodyRange);
  const rows = rangeWindow.rows;
  const latest = rows.at(-1);
  const first = rows[0];
  const ranges: Array<[InBodyRange, string]> = [["6m", "6개월"], ["1y", "1년"], ["all", "전체"]];
  const hasGap = rows.some((row, index) => (
    index > 0 && daysBetween(rows[index - 1].date, row.date) > INBODY_GAP_DAYS
  ));

  return `
    <section class="content-section" aria-labelledby="body-heading">
      <div class="section-heading">
        <div>
          <span class="section-kicker">InBody</span>
          <h2 id="body-heading">체성분</h2>
        </div>
        ${latest ? `<span class="status-text">${rows.length}회 측정</span>` : ""}
      </div>
      ${state.inBody.length ? `
        <div class="range-selector" role="group" aria-label="InBody 기간">
          ${ranges.map(([value, label]) => `
            <button type="button" data-inbody-range="${value}"
              class="${state.inBodyRange === value ? "selected" : ""}"
              aria-pressed="${state.inBodyRange === value}">${label}</button>
          `).join("")}
        </div>
        <ul class="body-list">
          ${BODY_METRICS.map((setting) => renderBodyRow(setting, rows)).join("")}
        </ul>
        ${rows.length > 1 && first && latest ? `
          <div class="body-axis" aria-hidden="true">
            <span>${formatCompactDate(first.date)}</span>
            ${hasGap ? `<span class="body-axis-gap">점선: ${INBODY_GAP_DAYS}일 넘는 측정 공백</span>` : ""}
            <span>${formatCompactDate(latest.date)}</span>
          </div>
        ` : ""}
        <p class="section-note">
          측정 시각, 식사, 운동 전후에 따라 수치가 흔들립니다.
          한 번의 차이보다 같은 조건에서 3회 이상 같은 방향인지 봅니다.
        </p>
        <details class="body-table">
          <summary>측정값 ${rows.length}회</summary>
          <table>
            <thead>
              <tr><th scope="col">날짜</th>${BODY_METRICS.map((setting) => `
                <th scope="col">${setting.label}<small>${setting.unit}</small></th>
              `).join("")}</tr>
            </thead>
            <tbody>
              ${[...rows].reverse().map((row) => `
                <tr>
                  <th scope="row">${formatShortDate(row.date)}</th>
                  ${BODY_METRICS.map((setting) => {
                    const value = numberOrNull(row[setting.key]);
                    return `<td>${value === null ? "-" : value.toFixed(1)}</td>`;
                  }).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </details>
      ` : `
        <div class="empty-inline keep-words">InBody 측정이 없습니다. 설정에서 CSV를 가져오면 추세가 표시됩니다.</div>
      `}
    </section>
  `;
}

function renderProgress() {
  const today = todayIso();
  const inProgress = state.sessions.some((session) => (
    session.date === today && !isSettledSession(session, today)
  ));

  return `
    <header class="page-header">
      <span class="date-line">Progress</span>
      <h1>변화</h1>
      <p>증량, 부위별 세트, 체성분이 실제로 움직이는지 봅니다.</p>
      ${inProgress ? `<p class="page-header-note">오늘 진행 중인 운동은 완료하면 반영됩니다.</p>` : ""}
    </header>
    ${renderWeekStrip(today)}
    ${renderLiftProgress(today)}
    ${renderBodyComposition()}
  `;
}

function equipmentStatusOptions(selected: EquipmentItem["status"]): string {
  return [
    ["unknown", "미확인"],
    ["available", "사용 가능"],
    ["limited", "제한 있음"],
    ["unavailable", "사용 불가"]
  ].map(([value, label]) => (
    `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`
  )).join("");
}

function renderSettings() {
  const profile = state.profile;
  const gym = state.gym;
  return `
    <header class="page-header">
      <span class="date-line">Configuration</span>
      <h1>설정</h1>
      <p>Codex가 프로그램을 만들 때 읽는 조건입니다.</p>
    </header>
    <section class="settings-group">
      <div class="settings-heading">
        <div><span class="section-kicker">Profile</span><h2>훈련 프로필</h2></div>
      </div>
      <form id="profile-form">
        <label class="form-row">
          <span>목표</span>
          <select name="goal">
            <option value="recomposition" ${profile.goal === "recomposition" ? "selected" : ""}>근육 증가 중심 리컴포지션</option>
            <option value="hypertrophy" ${profile.goal === "hypertrophy" ? "selected" : ""}>근비대</option>
            <option value="strength" ${profile.goal === "strength" ? "selected" : ""}>근력</option>
            <option value="fat-loss" ${profile.goal === "fat-loss" ? "selected" : ""}>감량 중 근력 유지</option>
          </select>
        </label>
        <label class="form-row">
          <span>주당 운동일</span>
          <input name="trainingDaysPerWeek" type="number" inputmode="numeric" min="1" max="7"
            value="${profile.trainingDaysPerWeek}" />
        </label>
        <label class="form-row">
          <span>세션 시간</span>
          <div class="input-suffix"><input name="sessionMinutes" type="number" inputmode="numeric"
            min="20" max="180" value="${profile.sessionMinutes}" /><span>분</span></div>
        </label>
        <label class="form-stack">
          <span>통증 · 부상 · 제한</span>
          <textarea name="painOrInjuryNotes" rows="3" placeholder="없으면 비워두세요">${escapeHtml(profile.painOrInjuryNotes)}</textarea>
        </label>
        <label class="form-stack">
          <span>일정 메모</span>
          <textarea name="scheduleNotes" rows="2" placeholder="예: 화·목은 50분만 가능">${escapeHtml(profile.scheduleNotes)}</textarea>
        </label>
        <div class="form-action"><button class="primary-button compact" type="submit">프로필 저장</button></div>
      </form>
    </section>
    <section class="settings-group">
      <div class="settings-heading">
        <div><span class="section-kicker">Gym</span><h2>체육관 장비</h2></div>
        <button class="text-button" data-action="new-gym">새 체육관</button>
      </div>
      <form id="gym-form">
        <label class="form-row">
          <span>이름</span>
          <input name="gymName" value="${escapeHtml(gym.name)}" />
        </label>
        <label class="form-stack">
          <span>체육관 메모</span>
          <textarea name="gymNotes" rows="2">${escapeHtml(gym.notes)}</textarea>
        </label>
        <div class="equipment-list">
          ${(gym.equipment || []).map((item) => `
            <div class="equipment-row" data-equipment-row data-id="${item.id}">
              <div class="equipment-main">
                <strong>${escapeHtml(item.name)}</strong>
                <input data-equipment-note value="${escapeHtml(item.notes)}" placeholder="중량 단위·상태 메모" />
              </div>
              <select data-equipment-status aria-label="${item.name} 상태">
                ${equipmentStatusOptions(item.status)}
              </select>
              <button class="icon-button subtle" type="button" data-action="remove-equipment"
                data-id="${item.id}" aria-label="${item.name} 삭제" title="삭제">−</button>
            </div>
          `).join("")}
        </div>
        <div class="add-equipment">
          <input id="equipment-name" placeholder="장비 이름" />
          <button class="secondary-button compact" type="button" data-action="add-equipment">추가</button>
        </div>
        <div class="form-action"><button class="primary-button compact" type="submit">체육관 저장</button></div>
      </form>
    </section>
    <section class="settings-group">
      <div class="settings-heading">
        <div><span class="section-kicker">Data</span><h2>데이터</h2></div>
      </div>
      <div class="settings-actions">
        <label class="secondary-button file-button">
          InBody CSV 추가
          <input class="sr-only" type="file" accept=".csv,text/csv" data-action="inbody-file" />
        </label>
        <button class="secondary-button" data-action="export">JSON 내보내기</button>
        <button class="secondary-button" data-action="refresh">프로그램 새로고침</button>
      </div>
      <div class="sync-detail">
        <span class="sync-dot" data-status="${state.sync.status}"></span>
        <div>
          <strong>${syncLabel()}</strong>
          <span>${state.sync.serverAvailable ? "workout 디렉토리와 동기화 중" : "서버 연결 시 파일로 동기화"}</span>
        </div>
      </div>
    </section>
  `;
}

function renderFinishSheet() {
  if (!state.finishSheetOpen) return "";
  const session = activeSession();
  return `
    <div class="sheet-backdrop" data-action="cancel-finish">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="finish-title">
        <div class="sheet-handle" aria-hidden="true"></div>
        <h2 id="finish-title">운동 완료</h2>
        <p>오늘 세션 전체의 체감 난이도를 남깁니다.</p>
        <label class="form-row">
          <span>세션 RPE</span>
          <input id="session-rpe" type="number" inputmode="decimal" min="1" max="10" step="0.5"
            value="${session?.sessionRpe || 8}" />
        </label>
        <label class="form-stack">
          <span>메모</span>
          <textarea id="session-notes" rows="3" placeholder="통증, 머신 상태, 다음에 바꿀 점">${escapeHtml(session?.notes)}</textarea>
        </label>
        <div class="sheet-actions">
          <button class="secondary-button" data-action="cancel-finish">취소</button>
          <button class="primary-button" data-action="confirm-finish">완료 저장</button>
        </div>
      </section>
    </div>
  `;
}

function tabButton(id: TabId, label: string, symbol: string): string {
  return `
    <button class="tab-button ${state.activeTab === id ? "active" : ""}" data-tab="${id}"
      aria-current="${state.activeTab === id ? "page" : "false"}">
      <span aria-hidden="true">${symbol}</span>
      <strong>${label}</strong>
    </button>
  `;
}

function render() {
  const app = document.querySelector<HTMLInputElement>("#app");
  if (!app) throw new Error("App root not found.");
  const view = {
    today: renderToday,
    history: renderHistory,
    progress: renderProgress,
    settings: renderSettings
  }[state.activeTab] || renderToday;

  app.innerHTML = `
    <main class="app-shell">
      <header class="app-bar">
        <button class="brand-button" data-tab="today" aria-label="오늘 운동으로 이동">Workout</button>
        <button id="sync-status" class="sync-badge" data-status="${state.sync.status}"
          data-action="refresh" title="데이터 새로고침">
          <span class="sync-dot" aria-hidden="true"></span>
          <span>${syncLabel()}</span>
        </button>
      </header>
      <div class="app-content">${view()}</div>
      <div id="rest-timer" class="rest-timer" hidden></div>
      <nav class="tab-bar" aria-label="주요 화면">
        ${tabButton("today", "오늘", "●")}
        ${tabButton("history", "기록", "≡")}
        ${tabButton("progress", "변화", "↗")}
        ${tabButton("settings", "설정", "···")}
      </nav>
      <div id="toast" class="toast" role="status" aria-live="polite">${escapeHtml(state.toast)}</div>
      ${renderFinishSheet()}
    </main>
  `;

  bindEvents();
  renderTimerBar();
}

function bindEvents() {
  document.querySelectorAll<HTMLInputElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab as TabId | undefined;
      if (!tab) return;
      state.activeTab = tab;
      saveLocalState();
      render();
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-action='refresh']").forEach((button) => {
    button.addEventListener("click", async () => {
      await loadBootstrap();
      render();
      if (state.sync.serverAvailable) await syncAllSessions();
    });
  });

  document.querySelector<HTMLInputElement>("[data-action='start-workout']")?.addEventListener("click", startWorkout);

  document.querySelectorAll<HTMLInputElement>("[data-readiness]").forEach((button) => {
    button.addEventListener("click", () => {
      const readiness = button.dataset.readiness as Readiness | undefined;
      if (readiness) updateReadiness(readiness);
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const { exercise, set, field } = input.dataset;
      if (exercise && set && field) updateSet(exercise, set, field as SetField, input.value);
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-cardio-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const { cardio, cardioField } = input.dataset;
      if (cardio && cardioField) updateCardio(cardio, cardioField as CardioField, input.value);
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-action='toggle-set']").forEach((button) => {
    button.addEventListener("click", () => {
      const { exercise, set } = button.dataset;
      if (exercise && set) toggleSet(exercise, set);
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-action='toggle-cardio']").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.cardio) toggleCardio(button.dataset.cardio);
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-action='add-set']").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.exercise) addSet(button.dataset.exercise);
    });
  });

  document.querySelector<HTMLInputElement>("[data-action='open-finish']")?.addEventListener("click", openFinishSheet);
  document.querySelector<HTMLInputElement>("[data-action='confirm-finish']")?.addEventListener("click", finishWorkout);
  document.querySelectorAll<HTMLInputElement>("[data-action='cancel-finish']").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target !== element && element.classList.contains("sheet-backdrop")) return;
      state.finishSheetOpen = false;
      render();
    });
  });

  document.querySelector<HTMLInputElement>("[data-action='reopen']")?.addEventListener("click", (event) => {
    const sessionId = (event.currentTarget as HTMLElement).dataset.session;
    if (sessionId) reopenWorkout(sessionId);
  });

  document.querySelectorAll<HTMLInputElement>("[data-inbody-range]").forEach((button) => {
    button.addEventListener("click", () => {
      const range = button.dataset.inbodyRange as InBodyRange | undefined;
      if (!range) return;
      state.inBodyRange = range;
      saveLocalState();
      render();
    });
  });

  document.querySelector<HTMLFormElement>("#profile-form")?.addEventListener("submit", saveProfile);
  document.querySelector<HTMLFormElement>("#gym-form")?.addEventListener("submit", saveGym);
  document.querySelector<HTMLInputElement>("[data-action='add-equipment']")?.addEventListener("click", addEquipment);
  document.querySelectorAll<HTMLInputElement>("[data-action='remove-equipment']").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.id) removeEquipment(button.dataset.id);
    });
  });
  document.querySelector<HTMLInputElement>("[data-action='new-gym']")?.addEventListener("click", newGym);

  document.querySelector<HTMLInputElement>("[data-action='inbody-file']")?.addEventListener("change", (event) => {
    importInBodyFile((event.target as HTMLInputElement).files?.[0]);
  });
  document.querySelector<HTMLInputElement>("[data-action='export']")?.addEventListener("click", exportData);

  bindTimerEvents();
}

function bindTimerEvents() {
  document.querySelector<HTMLInputElement>("[data-action='timer-pause']")?.addEventListener("click", pauseTimer);
  document.querySelector<HTMLInputElement>("[data-action='timer-resume']")?.addEventListener("click", resumeTimer);
  document.querySelector<HTMLInputElement>("[data-action='timer-dismiss']")?.addEventListener("click", dismissTimer);
}

async function saveProfile(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const goalLabels: Record<string, string> = {
    recomposition: "근육 증가 중심 리컴포지션",
    hypertrophy: "근비대",
    strength: "근력",
    "fat-loss": "감량 중 근력 유지"
  };
  const goal = String(form.get("goal"));
  state.profile = {
    ...state.profile,
    goal,
    goalLabel: goalLabels[goal] || goal,
    trainingDaysPerWeek: Number(form.get("trainingDaysPerWeek")),
    sessionMinutes: Number(form.get("sessionMinutes")),
    painOrInjuryNotes: String(form.get("painOrInjuryNotes") || "").trim(),
    scheduleNotes: String(form.get("scheduleNotes") || "").trim(),
    updatedAt: new Date().toISOString()
  };
  saveLocalState();
  setSyncStatus("syncing");

  try {
    const result = await postJson<{ profile: Profile }>("/api/profile", "PUT", state.profile);
    state.profile = result.profile;
    state.sync.serverAvailable = true;
    setSyncStatus("synced");
    showToast("프로필을 파일에 저장했습니다.");
  } catch {
    state.sync.serverAvailable = false;
    setSyncStatus("local");
    showToast("프로필을 이 기기에 저장했습니다.");
  }
  saveLocalState();
}

function gymFromForm(formElement: HTMLFormElement): Gym {
  const form = new FormData(formElement);
  const equipment: EquipmentItem[] = [...document.querySelectorAll<HTMLElement>("[data-equipment-row]")].flatMap((row) => {
    const existing = state.gym.equipment.find((item) => item.id === row.dataset.id) || {};
    const id = row.dataset.id;
    const status = row.querySelector<HTMLSelectElement>("[data-equipment-status]")?.value as EquipmentItem["status"] | undefined;
    const notes = row.querySelector<HTMLInputElement>("[data-equipment-note]")?.value.trim() || "";
    if (!id || !status) return [];
    return [{
      ...existing,
      id,
      status,
      notes
    }];
  });
  return {
    ...state.gym,
    name: String(form.get("gymName") || "현재 체육관").trim(),
    notes: String(form.get("gymNotes") || "").trim(),
    equipment,
    updatedAt: new Date().toISOString()
  };
}

async function saveGym(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  state.gym = gymFromForm(event.currentTarget as HTMLFormElement);
  saveLocalState();
  setSyncStatus("syncing");

  try {
    const result = await postJson<{ gym: Gym }>("/api/gym", "PUT", state.gym);
    state.gym = result.gym;
    state.sync.serverAvailable = true;
    setSyncStatus("synced");
    showToast("체육관 정보를 파일에 저장했습니다.");
  } catch {
    state.sync.serverAvailable = false;
    setSyncStatus("local");
    showToast("체육관 정보를 이 기기에 저장했습니다.");
  }
  saveLocalState();
}

function addEquipment() {
  const input = document.querySelector<HTMLInputElement>("#equipment-name");
  const name = input?.value.trim();
  if (!name) {
    input?.focus();
    return;
  }
  state.gym.equipment.push({
    id: uid("equipment"),
    name,
    status: "unknown",
    notes: ""
  });
  state.gym.updatedAt = new Date().toISOString();
  saveLocalState();
  render();
}

function removeEquipment(id: string): void {
  state.gym.equipment = state.gym.equipment.filter((item) => item.id !== id);
  state.gym.updatedAt = new Date().toISOString();
  saveLocalState();
  render();
}

function newGym() {
  state.gym = {
    ...state.gym,
    id: uid("gym"),
    name: "새 체육관",
    notes: "",
    updatedAt: new Date().toISOString(),
    equipment: state.gym.equipment.map((item) => ({
      ...item,
      status: "unknown",
      notes: ""
    }))
  };
  saveLocalState();
  render();
  document.querySelector<HTMLInputElement>("[name='gymName']")?.select();
}

async function importInBodyFile(file: File | undefined): Promise<void> {
  if (!file) return;
  const content = await file.text();
  const rows = parseInBodyCsv(content);
  if (!rows.length) {
    showToast("인바디 CSV 형식을 확인해 주세요.");
    return;
  }

  state.inBody = mergeInBodyRows(state.inBody, rows);
  saveLocalState();
  setSyncStatus("syncing");

  try {
    await postJson("/api/inbody-import", "POST", {
      filename: file.name,
      content
    });
    state.sync.serverAvailable = true;
    setSyncStatus("synced");
    showToast(`${rows.length}개 측정을 파일에 추가했습니다.`);
  } catch {
    state.sync.serverAvailable = false;
    setSyncStatus("local");
    showToast(`${rows.length}개 측정을 이 기기에 추가했습니다.`);
  }
  render();
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    gym: state.gym,
    plan: state.plan,
    sessions: state.sessions,
    inBody: state.inBody
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `workout-os-${todayIso()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function showToast(message: string): void {
  state.toast = message;
  const toast = document.querySelector<HTMLInputElement>("#toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("visible");
  }
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    state.toast = "";
    document.querySelector<HTMLInputElement>("#toast")?.classList.remove("visible");
  }, 2600);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

window.addEventListener("online", syncAllSessions);

loadLocalState();
await loadBootstrap();
if (state.sync.serverAvailable) await syncAllSessions();
render();
startTimerInterval();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
