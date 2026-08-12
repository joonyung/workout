import {
  bestLifts,
  completedSets,
  createSessionFromPlan,
  inBodyWindow,
  mergeInBodyRows,
  mergeSessions,
  normalizeSeries,
  numberOrNull,
  parseInBodyCsv,
  planNeedsRefresh,
  previousSessionForPlan,
  sessionProgress,
  todayIso,
  uid,
  weeklyStats
} from "./core.js";

const QA_MODE = new URLSearchParams(window.location.search).get("qa") === "1";
const STORAGE_KEY = QA_MODE ? "workout-os-state-v2-qa" : "workout-os-state-v2";
const LEGACY_STORAGE_KEY = "workout-os-state-v1";
const PROGRESS_CHART_HEIGHT = 270;
const PROGRESS_CHART_PADDING = { top: 16, right: 8, bottom: 28, left: 38 };

const fallbackProfile = {
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

const fallbackGym = {
  schemaVersion: 1,
  id: "current-gym",
  name: "현재 체육관",
  updatedAt: "1970-01-01T00:00:00.000Z",
  notes: "",
  equipment: []
};

let state = {
  activeTab: "today",
  profile: fallbackProfile,
  gym: fallbackGym,
  plan: null,
  sessions: [],
  inBody: [],
  inBodyRange: "1y",
  activeInBodySeries: null,
  chartSelectedDate: null,
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

let syncTimeout = null;
let timerInterval = null;
let toastTimeout = null;

function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
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
        !completedSets(session).length
      ));
      if (!["1y", "2y", "all"].includes(state.inBodyRange)) {
        state.inBodyRange = "1y";
      }
      if (![null, "weight", "muscle", "fat"].includes(state.activeInBodySeries)) {
        state.activeInBodySeries = null;
      }
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacyRaw) return;

  try {
    const legacy = JSON.parse(legacyRaw);
    state.sessions = (legacy.sessions || [])
      .filter((session) => (
        session.finishedAt ||
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
    activeInBodySeries: state.activeInBodySeries,
    preReadiness: state.preReadiness,
    timer: state.timer
  }));
}

function newerRecord(localValue, remoteValue, field = "updatedAt") {
  if (!localValue) return remoteValue;
  if (!remoteValue) return localValue;
  const localTime = Date.parse(localValue[field] || 0);
  const remoteTime = Date.parse(remoteValue[field] || 0);
  return remoteTime >= localTime ? remoteValue : localValue;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function loadInBodyFiles(files) {
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
    const data = await fetchJson("/api/bootstrap");
    state.profile = newerRecord(state.profile, data.profile);
    state.gym = newerRecord(state.gym, data.gym);
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

function setSyncStatus(status) {
  state.sync.status = status;
  const badge = document.querySelector("#sync-status");
  if (badge) {
    badge.dataset.status = status;
    badge.querySelector("span:last-child").textContent = syncLabel();
  }
}

async function postJson(url, method, value) {
  return fetchJson(url, {
    method,
    body: JSON.stringify(value)
  });
}

async function syncSession(session) {
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

function scheduleSessionSync(session) {
  clearTimeout(syncTimeout);
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

function activeSession() {
  return state.sessions.find((session) => (
    session.date === todayIso() && !session.finishedAt
  )) || null;
}

function latestTodaySession() {
  return state.sessions.find((session) => session.date === todayIso()) || null;
}

function touchSession(session) {
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

function updateReadiness(value) {
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

function updateSet(exerciseId, setId, field, value) {
  const session = activeSession();
  const exercise = session?.exercises?.find((item) => item.id === exerciseId);
  const set = exercise?.sets?.find((item) => item.id === setId);
  if (!set) return;

  set[field] = value;
  touchSession(session);
}

function toggleSet(exerciseId, setId) {
  const session = activeSession();
  const exercise = session?.exercises?.find((item) => item.id === exerciseId);
  const set = exercise?.sets?.find((item) => item.id === setId);
  if (!set) return;

  if (!set.completed && numberOrNull(set.reps) === null) {
    document.querySelector(
      `[data-exercise="${exerciseId}"][data-set="${setId}"][data-field="reps"]`
    )?.focus();
    showToast("반복수를 먼저 입력하세요.");
    return;
  }

  if (!set.completed && numberOrNull(set.rpe) === null) {
    document.querySelector(
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

function addSet(exerciseId) {
  const session = activeSession();
  const exercise = session?.exercises?.find((item) => item.id === exerciseId);
  if (!exercise) return;

  const previousSet = exercise.sets.at(-1);
  exercise.sets.push({
    id: uid("set"),
    setNumber: exercise.sets.length + 1,
    setType: "working",
    weightKg: previousSet?.weightKg || "",
    reps: "",
    rpe: "",
    completed: false,
    completedAt: null,
    previousWeightKg: null,
    previousReps: null
  });
  touchSession(session);
  render();
}

function openFinishSheet() {
  const session = activeSession();
  if (!session || !completedSets(session).length) {
    showToast("완료한 세트가 아직 없습니다.");
    return;
  }
  state.finishSheetOpen = true;
  render();
}

function finishWorkout() {
  const session = activeSession();
  if (!session) return;
  const rpeInput = document.querySelector("#session-rpe");
  const notesInput = document.querySelector("#session-notes");
  session.sessionRpe = numberOrNull(rpeInput?.value);
  session.notes = notesInput?.value?.trim() || session.notes || "";
  session.finishedAt = new Date().toISOString();
  state.finishSheetOpen = false;
  touchSession(session);
  dismissTimer();
  render();
}

function reopenWorkout(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session || session.date !== todayIso()) return;
  session.finishedAt = null;
  touchSession(session);
  render();
}

function timerRemaining() {
  if (!state.timer.running || !state.timer.endsAt) return state.timer.remaining || 0;
  return Math.max(0, Math.ceil((state.timer.endsAt - Date.now()) / 1000));
}

function startTimer(seconds, exerciseName = "") {
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
  clearInterval(timerInterval);
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
      clearInterval(timerInterval);
      showToast("휴식이 끝났습니다.");
    }
  }, 500);
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function renderTimerBar() {
  const container = document.querySelector("#rest-timer");
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

function formatDateKorean(dateString) {
  if (!dateString) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(`${dateString}T12:00:00`));
}

function formatShortDate(dateString) {
  if (!dateString) return "-";
  return dateString.replaceAll("-", ".");
}

function formatChartMonth(timestamp) {
  if (!Number.isFinite(timestamp)) return "-";
  const date = new Date(timestamp);
  return (
    date.getUTCFullYear() + "." +
    String(date.getUTCMonth() + 1).padStart(2, "0")
  );
}

function formatNumber(value, digits = 1, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function formatDelta(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "이전 측정 없음";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}${suffix}`;
}

function planSetCount(plan = state.plan) {
  return (plan?.exercises || []).reduce((sum, exercise) => sum + exercise.targetSets, 0);
}

function exerciseStartingLoad(exercise) {
  if (numberOrNull(exercise.startingWeightKg) !== null) {
    return `${exercise.startingWeightKg}kg`;
  }
  return exercise.startingLoad || "";
}

function exerciseWarmupText(exercise) {
  return (exercise.warmupSets || []).map((set) => {
    if (set.load) return `${set.load} × ${set.reps}`;
    const weight = numberOrNull(set.weightKg);
    const load = weight === null ? "체중" : `${weight}kg`;
    return `${load} × ${set.reps}`;
  }).join(" · ");
}

function readinessLabel(value) {
  return { good: "좋음", normal: "보통", tired: "피곤" }[value] || "보통";
}

function readinessGuidance(value) {
  return state.plan?.readinessRules?.[value] || "목표 RPE를 우선해 수행합니다.";
}

function renderReadiness(selected) {
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

function renderPlanHeader(session = null) {
  const plan = state.plan;
  const isRecoveryPlan = plan?.status === "recovery";
  const progress = session ? sessionProgress(session) : { completed: 0, total: planSetCount(plan), ratio: 0 };
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
            aria-label="${progress.completed} / ${progress.total} 세트 완료">
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
  const actions = state.plan.recoveryActions || [];
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
      <p class="recovery-guidance">${escapeHtml(state.plan.recoveryGuidance || "")}</p>
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
          ${(state.plan.coachNotes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
        </ul>
      </details>
    </section>
  `;
}

function renderWorkoutPreview() {
  const assumptions = state.plan.assumptions || [];
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
          <h2>${state.plan.exercises.length}개 운동</h2>
        </div>
        <span class="status-text">RPE 기준</span>
      </div>
      <div class="preview-list">
        ${state.plan.exercises.map((exercise, index) => `
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
      </div>
    </section>
    <div class="primary-action">
      <button class="primary-button" data-action="start-workout">운동 시작</button>
    </div>
  `;
}

function renderActiveWorkout(session) {
  return `
    <section class="content-section workout-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">작업 세트</span>
          <h2>세트 기록</h2>
        </div>
        <span class="status-text">자동 저장</span>
      </div>
      <div class="exercise-list">
        ${session.exercises.map(renderExercise).join("")}
      </div>
    </section>
    <section class="coach-notes">
      <details>
        <summary>오늘의 코칭 메모</summary>
        <ul>
          ${(state.plan.coachNotes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
        </ul>
      </details>
    </section>
    <div class="primary-action">
      <button class="primary-button" data-action="open-finish">운동 완료</button>
    </div>
  `;
}

function previousSetText(set) {
  if (numberOrNull(set.previousReps) === null) return "이전 -";
  const weight = numberOrNull(set.previousWeightKg);
  return weight === null ? `이전 ×${set.previousReps}` : `이전 ${weight}×${set.previousReps}`;
}

function renderExercise(exercise) {
  const completedCount = exercise.sets.filter((set) => set.completed).length;
  const nextSet = exercise.sets.find((set) => !set.completed);
  const progress = exercise.sets.length ? completedCount / exercise.sets.length : 0;
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
        <span>세트</span><span>kg</span><span>횟수</span><span>RPE</span><span>완료</span>
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
              <input inputmode="decimal" value="${escapeHtml(set.weightKg)}"
                data-exercise="${exercise.id}" data-set="${set.id}" data-field="weightKg"
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

function renderFinishedWorkout(session) {
  const progress = sessionProgress(session);
  const durationMinutes = Math.max(
    1,
    Math.round((Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 60_000)
  );

  return `
    ${renderPlanHeader(session)}
    <section class="completion-hero">
      <div class="completion-mark" aria-hidden="true">✓</div>
      <h2>오늘 운동 완료</h2>
      <p>${progress.completed}세트 · ${durationMinutes}분 · 세션 RPE
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
                const weight = numberOrNull(set.weightKg);
                const type = set.setType === "warmup" ? "워밍업 " : "";
                return `${type}${weight === null ? "BW" : `${weight}kg`} × ${set.reps}`;
              }).join(" · ") || "기록 없음"}</span>
            </div>
          `;
        }).join("")}
      </div>
    </section>
    <div class="secondary-action">
      <button class="secondary-button" data-action="reopen" data-session="${session.id}">기록 수정</button>
    </div>
  `;
}

function completedWorkingSetsForExercise(exercise) {
  return (exercise.sets || []).filter((set) => (
    set.completed && set.setType !== "warmup"
  ));
}

function completedWarmupSetsForExercise(exercise) {
  return (exercise.sets || []).filter((set) => (
    set.completed && set.setType === "warmup"
  ));
}

function sessionWorkingSets(session) {
  return (session.exercises || []).flatMap(completedWorkingSetsForExercise);
}

function sessionWarmupSets(session) {
  return (session.exercises || []).flatMap(completedWarmupSetsForExercise);
}

function setTonnage(set) {
  const weight = numberOrNull(set.weightKg);
  const reps = numberOrNull(set.reps);
  return weight === null || reps === null ? 0 : weight * reps;
}

function setsTonnage(sets) {
  return sets.reduce((total, set) => total + setTonnage(set), 0);
}

function formatTonnage(value) {
  if (!value) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}t`;
  return `${Math.round(value)}kg`;
}

function averageRpe(sets) {
  const values = sets.map((set) => numberOrNull(set.rpe)).filter((value) => value !== null);
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatRpe(value) {
  if (value === null) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function sessionDurationLabel(session) {
  if (session.timingRecorded === false || !session.startedAt || !session.finishedAt) return "-";
  const minutes = Math.round((Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? `${minutes}분` : "-";
}

function rpeZone(rpe) {
  const value = numberOrNull(rpe);
  if (value === null) return "none";
  if (value <= 6) return "easy";
  if (value <= 8) return "target";
  return "hard";
}

function muscleColor(muscleGroup) {
  if (["하체", "대퇴사두"].includes(muscleGroup)) return "#ff9f0a";
  if (muscleGroup === "햄스트링") return "#ff375f";
  if (muscleGroup === "가슴") return "#0a84ff";
  if (muscleGroup === "등") return "#30d158";
  if (muscleGroup === "어깨") return "#bf5af2";
  if (["팔", "이두", "삼두"].includes(muscleGroup)) return "#64d2ff";
  return "#8e8e93";
}

function renderMuscleDistribution(session) {
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

function renderHistorySet(set, index) {
  const weight = numberOrNull(set.weightKg);
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

function renderHistoryExercise(exercise) {
  const workingSets = completedWorkingSetsForExercise(exercise);
  const warmupSets = completedWarmupSetsForExercise(exercise);
  const allSets = [...warmupSets, ...workingSets];
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
          <span>세트</span><span>kg</span><span>횟수</span><span>RPE</span>
        </div>
        ${allSets.map(renderHistorySet).join("")}
      </div>
    </section>
  `;
}

function renderHistory() {
  const sessions = state.sessions;
  const allWorkingSets = sessions.flatMap(sessionWorkingSets);
  const totalTonnage = setsTonnage(allWorkingSets);
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
          const warmupSets = sessionWarmupSets(session);
          const tonnage = setsTonnage(workingSets);
          const setRpe = averageRpe(workingSets);
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
                    <span>${escapeHtml(session.gymName || "장소 미기록")} · ${readinessLabel(session.readiness)}</span>
                  </div>
                  <div class="history-metrics">
                    <span><strong>${workingSets.length}</strong><small>작업 세트</small></span>
                    <span><strong>${formatTonnage(tonnage)}</strong><small>볼륨</small></span>
                    <span><strong>${formatRpe(setRpe)}</strong><small>평균 RPE</small></span>
                  </div>
                  ${renderMuscleDistribution(session)}
                </div>
                <span class="disclosure" aria-hidden="true">›</span>
              </summary>
              <div class="history-detail">
                <div class="history-session-stats">
                  <span><small>운동</small><strong>${completedExercises.length}개</strong></span>
                  <span><small>웜업</small><strong>${warmupSets.length}세트</strong></span>
                  <span><small>소요 시간</small><strong>${sessionDurationLabel(session)}</strong></span>
                  <span><small>세션 RPE</small><strong>${session.sessionRpe ?? "-"}</strong></span>
                </div>
                <div class="history-exercises">
                  ${(session.exercises || []).map(renderHistoryExercise).join("")}
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

function inBodyDelta(key) {
  const latest = state.inBody.at(-1);
  const previous = state.inBody.at(-2);
  if (!latest || !previous || latest[key] === null || previous[key] === null) return null;
  return latest[key] - previous[key];
}

function inBodySeriesSettings(dark = false) {
  return [
    {
      id: "weight",
      key: "weightKg",
      label: "체중",
      suffix: "kg",
      color: dark ? "#2997ff" : "#0071e3"
    },
    {
      id: "muscle",
      key: "skeletalMuscleKg",
      label: "골격근량",
      suffix: "kg",
      color: dark ? "#30d158" : "#248a3d"
    },
    {
      id: "fat",
      key: "bodyFatPercent",
      label: "체지방률",
      suffix: "%",
      color: dark ? "#ff9f0a" : "#c93400"
    }
  ];
}

function formatNormalizedDelta(value) {
  if (!Number.isFinite(value)) return "-";
  const delta = value - 100;
  const sign = delta > 0 ? "+" : "";
  return sign + delta.toFixed(1) + "%";
}

function selectedInBodyMeasurement(rangeWindow) {
  return (
    rangeWindow.rows.find((row) => row.date === state.chartSelectedDate) ||
    rangeWindow.rows.at(-1) ||
    null
  );
}

function chartDetailHtml(row) {
  if (!row) return `<div class="empty-inline">표시할 측정이 없습니다.</div>`;
  return `
    <div class="chart-detail-heading">
      <strong>${formatShortDate(row.date)}</strong>
      <span>실측값</span>
    </div>
    <div class="chart-detail-values">
      <div><span>체중</span><strong>${formatNumber(row.weightKg, 1, "kg")}</strong></div>
      <div><span>골격근량</span><strong>${formatNumber(row.skeletalMuscleKg, 1, "kg")}</strong></div>
      <div><span>체지방률</span><strong>${formatNumber(row.bodyFatPercent, 1, "%")}</strong></div>
    </div>
  `;
}

function progressSignals() {
  const stats = weeklyStats(state.sessions);
  const signals = [];

  if (!stats.completed) {
    signals.push("이번 주 수행 데이터가 없습니다. 다음 리뷰의 우선순위는 기록 누락을 줄이는 것입니다.");
  } else if (stats.adherence >= 0.85) {
    signals.push("이번 주 계획 세트의 85% 이상을 완료했습니다. 다음 조정은 주요 운동의 반복 또는 중량 추세를 봅니다.");
  } else {
    signals.push("이번 주 수행률이 85%보다 낮습니다. 볼륨을 늘리기 전에 세션 길이와 일정 적합성을 점검합니다.");
  }

  if (state.inBody.length >= 2) {
    signals.push("InBody는 최근 두 측정의 차이보다 3회 이상 누적 방향을 우선해 해석합니다.");
  }

  return signals;
}

function renderProgress() {
  const latest = state.inBody.at(-1);
  const rangeWindow = inBodyWindow(state.inBody, state.inBodyRange);
  const selectedMeasurement = selectedInBodyMeasurement(rangeWindow);
  const normalizedMetrics = inBodySeriesSettings().map((item) => {
    const points = normalizeSeries(rangeWindow.rows, item.key);
    return { ...item, change: points.at(-1)?.normalizedValue };
  });
  const stats = weeklyStats(state.sessions);
  const best = bestLifts(state.sessions).slice(0, 4);
  const metrics = [
    ["weightKg", "체중", latest?.weightKg, "kg"],
    ["skeletalMuscleKg", "골격근량", latest?.skeletalMuscleKg, "kg"],
    ["bodyFatPercent", "체지방률", latest?.bodyFatPercent, "%"]
  ];

  return `
    <header class="page-header">
      <span class="date-line">Progress</span>
      <h1>변화</h1>
      <p>운동 수행과 체성분의 장기 추세를 함께 봅니다.</p>
    </header>
    <section class="metric-strip">
      ${metrics.map(([key, label, value, suffix]) => `
        <div>
          <span>${label}</span>
          <strong>${formatNumber(value, 1, suffix)}</strong>
          <small>${formatDelta(inBodyDelta(key), suffix)}</small>
        </div>
      `).join("")}
    </section>
    <section class="content-section chart-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">InBody</span>
          <h2>${formatShortDate(latest?.date)} 측정</h2>
        </div>
        <span class="status-text">${rangeWindow.rows.length}/${state.inBody.length}회</span>
      </div>
      <div class="range-selector" role="group" aria-label="인바디 날짜 범위">
        ${[
          ["1y", "1년"],
          ["2y", "2년"],
          ["all", "전체"]
        ].map(([value, label]) => `
          <button data-inbody-range="${value}"
            class="${state.inBodyRange === value ? "selected" : ""}"
            aria-pressed="${state.inBodyRange === value}">${label}</button>
        `).join("")}
      </div>
      <div class="chart-scale-note">
        <span>선택 기간 첫 측정 = 100</span>
        <span>기간 변화</span>
      </div>
      <div class="normalized-legend">
        ${normalizedMetrics.map((item) => `
          <button type="button"
            class="legend-item ${state.activeInBodySeries === item.id ? "selected" : ""} ${state.activeInBodySeries && state.activeInBodySeries !== item.id ? "muted" : ""}"
            data-series="${item.id}"
            data-inbody-series="${item.id}"
            aria-pressed="${state.activeInBodySeries === item.id}"
            aria-label="${item.label}만 차트에 표시, 기간 변화 ${formatNormalizedDelta(item.change)}"
            title="${state.activeInBodySeries === item.id ? "다시 누르면 전체 시리즈 표시" : `${item.label}만 표시`}">
            <span class="legend-dot" aria-hidden="true"></span>
            <span>${item.label}</span>
            <strong>${formatNormalizedDelta(item.change)}</strong>
          </button>
        `).join("")}
      </div>
      <div class="chart-wrap">
        <canvas id="progress-chart"
          tabindex="0"
          aria-label="선택 기간의 첫 측정을 100으로 정규화한 체중, 골격근량, 체지방률 추세. 좌우 화살표로 측정일을 선택할 수 있습니다."></canvas>
      </div>
      <div id="chart-detail" class="chart-detail">
        ${chartDetailHtml(selectedMeasurement)}
      </div>
    </section>
    <section class="content-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">이번 주</span>
          <h2>수행 지표</h2>
        </div>
        <span class="status-text">${Math.round(stats.adherence * 100)}%</span>
      </div>
      <div class="stat-list">
        <div><span>완료 세트</span><strong>${stats.completed} / ${stats.targetSets}</strong></div>
        <div><span>완료 세션</span><strong>${stats.sessions}</strong></div>
        <div><span>기록 볼륨</span><strong>${Math.round(stats.tonnage).toLocaleString()}kg</strong></div>
      </div>
    </section>
    <section class="content-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">주요 기록</span>
          <h2>추정 1RM</h2>
        </div>
      </div>
      <div class="summary-list">
        ${best.length ? best.map((item) => `
          <div class="summary-row">
            <div><strong>${escapeHtml(item.exerciseName)}</strong><span>${formatShortDate(item.date)}</span></div>
            <span>${formatNumber(item.e1rm, 1, "kg")}</span>
          </div>
        `).join("") : `<div class="empty-inline">중량과 반복 기록이 쌓이면 표시됩니다.</div>`}
      </div>
    </section>
    <section class="signal-list">
      ${progressSignals().map((signal) => `<p>${escapeHtml(signal)}</p>`).join("")}
    </section>
  `;
}

function equipmentStatusOptions(selected) {
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

function tabButton(id, label, symbol) {
  return `
    <button class="tab-button ${state.activeTab === id ? "active" : ""}" data-tab="${id}"
      aria-current="${state.activeTab === id ? "page" : "false"}">
      <span aria-hidden="true">${symbol}</span>
      <strong>${label}</strong>
    </button>
  `;
}

function render() {
  const app = document.querySelector("#app");
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
  if (state.activeTab === "progress") drawProgressChart();
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      saveLocalState();
      render();
    });
  });

  document.querySelectorAll("[data-action='refresh']").forEach((button) => {
    button.addEventListener("click", async () => {
      await loadBootstrap();
      render();
      if (state.sync.serverAvailable) await syncAllSessions();
    });
  });

  document.querySelector("[data-action='start-workout']")?.addEventListener("click", startWorkout);

  document.querySelectorAll("[data-readiness]").forEach((button) => {
    button.addEventListener("click", () => updateReadiness(button.dataset.readiness));
  });

  document.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      updateSet(input.dataset.exercise, input.dataset.set, input.dataset.field, input.value);
    });
  });

  document.querySelectorAll("[data-action='toggle-set']").forEach((button) => {
    button.addEventListener("click", () => toggleSet(button.dataset.exercise, button.dataset.set));
  });

  document.querySelectorAll("[data-action='add-set']").forEach((button) => {
    button.addEventListener("click", () => addSet(button.dataset.exercise));
  });

  document.querySelector("[data-action='open-finish']")?.addEventListener("click", openFinishSheet);
  document.querySelector("[data-action='confirm-finish']")?.addEventListener("click", finishWorkout);
  document.querySelectorAll("[data-action='cancel-finish']").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target !== element && element.classList.contains("sheet-backdrop")) return;
      state.finishSheetOpen = false;
      render();
    });
  });

  document.querySelector("[data-action='reopen']")?.addEventListener("click", (event) => {
    reopenWorkout(event.currentTarget.dataset.session);
  });

  document.querySelectorAll("[data-inbody-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.inBodyRange = button.dataset.inbodyRange;
      state.chartSelectedDate = null;
      saveLocalState();
      render();
    });
  });

  document.querySelectorAll("[data-inbody-series]").forEach((button) => {
    button.addEventListener("click", () => {
      const seriesId = button.dataset.inbodySeries;
      state.activeInBodySeries = state.activeInBodySeries === seriesId ? null : seriesId;
      saveLocalState();
      render();
    });
  });

  const progressChart = document.querySelector("#progress-chart");
  progressChart?.addEventListener("click", selectChartDate);
  progressChart?.addEventListener("keydown", moveChartSelection);

  document.querySelector("#profile-form")?.addEventListener("submit", saveProfile);
  document.querySelector("#gym-form")?.addEventListener("submit", saveGym);
  document.querySelector("[data-action='add-equipment']")?.addEventListener("click", addEquipment);
  document.querySelectorAll("[data-action='remove-equipment']").forEach((button) => {
    button.addEventListener("click", () => removeEquipment(button.dataset.id));
  });
  document.querySelector("[data-action='new-gym']")?.addEventListener("click", newGym);

  document.querySelector("[data-action='inbody-file']")?.addEventListener("change", (event) => {
    importInBodyFile(event.target.files?.[0]);
  });
  document.querySelector("[data-action='export']")?.addEventListener("click", exportData);

  bindTimerEvents();
}

function bindTimerEvents() {
  document.querySelector("[data-action='timer-pause']")?.addEventListener("click", pauseTimer);
  document.querySelector("[data-action='timer-resume']")?.addEventListener("click", resumeTimer);
  document.querySelector("[data-action='timer-dismiss']")?.addEventListener("click", dismissTimer);
}

async function saveProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const goalLabels = {
    recomposition: "근육 증가 중심 리컴포지션",
    hypertrophy: "근비대",
    strength: "근력",
    "fat-loss": "감량 중 근력 유지"
  };
  const goal = String(form.get("goal"));
  state.profile = {
    ...state.profile,
    goal,
    goalLabel: goalLabels[goal],
    trainingDaysPerWeek: Number(form.get("trainingDaysPerWeek")),
    sessionMinutes: Number(form.get("sessionMinutes")),
    painOrInjuryNotes: String(form.get("painOrInjuryNotes") || "").trim(),
    scheduleNotes: String(form.get("scheduleNotes") || "").trim(),
    updatedAt: new Date().toISOString()
  };
  saveLocalState();
  setSyncStatus("syncing");

  try {
    const result = await postJson("/api/profile", "PUT", state.profile);
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

function gymFromForm(formElement) {
  const form = new FormData(formElement);
  const equipment = [...document.querySelectorAll("[data-equipment-row]")].map((row) => {
    const existing = state.gym.equipment.find((item) => item.id === row.dataset.id) || {};
    return {
      ...existing,
      id: row.dataset.id,
      status: row.querySelector("[data-equipment-status]").value,
      notes: row.querySelector("[data-equipment-note]").value.trim()
    };
  });
  return {
    ...state.gym,
    name: String(form.get("gymName") || "현재 체육관").trim(),
    notes: String(form.get("gymNotes") || "").trim(),
    equipment,
    updatedAt: new Date().toISOString()
  };
}

async function saveGym(event) {
  event.preventDefault();
  state.gym = gymFromForm(event.currentTarget);
  saveLocalState();
  setSyncStatus("syncing");

  try {
    const result = await postJson("/api/gym", "PUT", state.gym);
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
  const input = document.querySelector("#equipment-name");
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

function removeEquipment(id) {
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
  document.querySelector("[name='gymName']")?.select();
}

async function importInBodyFile(file) {
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

function setChartSelection(date) {
  const rangeWindow = inBodyWindow(state.inBody, state.inBodyRange);
  const row = rangeWindow.rows.find((item) => item.date === date);
  if (!row) return;
  state.chartSelectedDate = row.date;
  const detail = document.querySelector("#chart-detail");
  if (detail) detail.innerHTML = chartDetailHtml(row);
  drawProgressChart();
}

function selectChartDate(event) {
  const rangeWindow = inBodyWindow(state.inBody, state.inBodyRange);
  if (!rangeWindow.rows.length) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const plotWidth = rect.width -
    PROGRESS_CHART_PADDING.left -
    PROGRESS_CHART_PADDING.right;
  const x = Math.min(
    plotWidth,
    Math.max(0, event.clientX - rect.left - PROGRESS_CHART_PADDING.left)
  );
  const ratio = plotWidth ? x / plotWidth : 1;
  const targetMs = rangeWindow.startMs +
    (rangeWindow.endMs - rangeWindow.startMs) * ratio;
  const nearest = rangeWindow.rows.reduce((best, row) => {
    const distance = Math.abs(
      Date.parse(row.date + "T12:00:00Z") - targetMs
    );
    return !best || distance < best.distance ? { row, distance } : best;
  }, null);
  if (nearest) setChartSelection(nearest.row.date);
}

function moveChartSelection(event) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const rangeWindow = inBodyWindow(state.inBody, state.inBodyRange);
  if (!rangeWindow.rows.length) return;
  const current = selectedInBodyMeasurement(rangeWindow);
  const currentIndex = Math.max(
    0,
    rangeWindow.rows.findIndex((row) => row.date === current?.date)
  );
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const nextIndex = Math.min(
    rangeWindow.rows.length - 1,
    Math.max(0, currentIndex + direction)
  );
  setChartSelection(rangeWindow.rows[nextIndex].date);
}

function drawProgressChart() {
  const canvas = document.querySelector("#progress-chart");
  if (!canvas || !state.inBody.length) return;

  const rangeWindow = inBodyWindow(state.inBody, state.inBodyRange);
  if (!rangeWindow.rows.length) return;

  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const configuredSeries = inBodySeriesSettings(dark).filter((item) => (
    !state.activeInBodySeries || item.id === state.activeInBodySeries
  ));
  const series = configuredSeries.map((item) => ({
    ...item,
    points: normalizeSeries(rangeWindow.rows, item.key)
  })).filter((item) => item.points.length);
  if (!series.length) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(280, rect.width);
  const height = PROGRESS_CHART_HEIGHT;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const context = canvas.getContext("2d");
  context.scale(dpr, dpr);

  const colors = {
    background: dark ? "#1c1c1e" : "#ffffff",
    grid: dark ? "rgba(84,84,88,.48)" : "rgba(60,60,67,.12)",
    baseline: dark ? "rgba(245,245,247,.5)" : "rgba(29,29,31,.35)",
    selected: dark ? "rgba(174,174,178,.55)" : "rgba(110,110,115,.4)",
    text: dark ? "#aeaeb2" : "#6e6e73"
  };
  const padding = PROGRESS_CHART_PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const rangeDuration = Math.max(1, rangeWindow.endMs - rangeWindow.startMs);
  const xForDate = (date) => {
    const timestamp = Date.parse(date + "T12:00:00Z");
    const ratio = Math.min(
      1,
      Math.max(0, (timestamp - rangeWindow.startMs) / rangeDuration)
    );
    return padding.left + plotWidth * ratio;
  };

  const normalizedValues = series.flatMap((item) => (
    item.points.map((point) => point.normalizedValue)
  ));
  const rawMin = Math.min(100, ...normalizedValues);
  const rawMax = Math.max(100, ...normalizedValues);
  const spread = Math.max(4, rawMax - rawMin);
  const domainPadding = Math.max(1, spread * 0.2);
  const min = Math.floor((rawMin - domainPadding) * 2) / 2;
  const max = Math.ceil((rawMax + domainPadding) * 2) / 2;
  const yForValue = (value) => (
    padding.top + plotHeight - ((value - min) / (max - min)) * plotHeight
  );

  context.clearRect(0, 0, width, height);
  context.font = "10px -apple-system, system-ui, sans-serif";
  context.fillStyle = colors.text;

  for (let guideIndex = 0; guideIndex <= 4; guideIndex += 1) {
    const ratio = guideIndex / 4;
    const x = padding.left + plotWidth * ratio;
    const y = padding.top + plotHeight * ratio;
    const value = max - (max - min) * ratio;

    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, padding.top + plotHeight);
    context.stroke();

    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();

    if (Math.abs(value - 100) > 0.45) {
      const label = value.toFixed(1);
      context.fillText(
        label,
        padding.left - context.measureText(label).width - 6,
        y + 3
      );
    }
  }

  const baselineY = yForValue(100);
  context.strokeStyle = colors.baseline;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(padding.left, baselineY);
  context.lineTo(width - padding.right, baselineY);
  context.stroke();
  context.fillStyle = colors.text;
  context.font = "600 10px -apple-system, system-ui, sans-serif";
  context.fillText("100", 5, baselineY + 3);

  const selectedMeasurement = selectedInBodyMeasurement(rangeWindow);
  if (selectedMeasurement) {
    const selectedX = xForDate(selectedMeasurement.date);
    context.strokeStyle = colors.selected;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(selectedX, padding.top);
    context.lineTo(selectedX, padding.top + plotHeight);
    context.stroke();
  }

  series.forEach((item) => {
    context.strokeStyle = item.color;
    context.lineWidth = 2.5;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();

    item.points.forEach((point, index) => {
      const x = xForDate(point.date);
      const y = yForValue(point.normalizedValue);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    item.points.forEach((point) => {
      const selected = point.date === selectedMeasurement?.date;
      const x = xForDate(point.date);
      const y = yForValue(point.normalizedValue);
      context.fillStyle = selected ? item.color : colors.background;
      context.strokeStyle = item.color;
      context.lineWidth = selected ? 2 : 1.5;
      context.beginPath();
      context.arc(x, y, selected ? 4.5 : 2.7, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
  });

  context.fillStyle = colors.text;
  context.font = "11px -apple-system, system-ui, sans-serif";
  const startLabel = formatChartMonth(rangeWindow.startMs);
  const middleLabel = formatChartMonth(
    rangeWindow.startMs + rangeDuration / 2
  );
  const endLabel = formatChartMonth(rangeWindow.endMs);
  context.fillText(startLabel, padding.left, height - 8);
  context.fillText(
    middleLabel,
    width / 2 - context.measureText(middleLabel).width / 2,
    height - 8
  );
  context.fillText(
    endLabel,
    width - padding.right - context.measureText(endLabel).width,
    height - 8
  );
}

function showToast(message) {
  state.toast = message;
  const toast = document.querySelector("#toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("visible");
  }
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    state.toast = "";
    document.querySelector("#toast")?.classList.remove("visible");
  }, 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

window.addEventListener("online", syncAllSessions);
window.addEventListener("resize", () => {
  if (state.activeTab === "progress") drawProgressChart();
});

loadLocalState();
await loadBootstrap();
if (state.sync.serverAvailable) await syncAllSessions();
render();
startTimerInterval();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
