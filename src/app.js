import {
  ACTION_NAMES,
  bestActionIndex,
  clamp,
  createDemoStats,
  createTrainingState,
  makeStateKey,
  runPolicyDemoBatch,
  runTrainingBatch,
} from "./learning.js";

const PACE_CONFIGS = [
  {
    name: "Guided",
    note: "Guided: lesson pauses",
    stepsPerTick: 1,
    tickMs: 120,
    holdMs: 2200,
    rehearsalSteps: 1200,
  },
  {
    name: "Steady",
    note: "Steady: readable",
    stepsPerTick: 1,
    tickMs: 55,
    holdMs: 1400,
    rehearsalSteps: 1800,
  },
  {
    name: "Practice",
    note: "Practice: fewer pauses",
    stepsPerTick: 4,
    tickMs: 35,
    holdMs: 650,
    rehearsalSteps: 2600,
  },
  {
    name: "Fast train",
    note: "Fast: learn quickly",
    stepsPerTick: 18,
    tickMs: 16,
    holdMs: 150,
    rehearsalSteps: 4200,
  },
];
const DEFAULT_RUN_SECONDS = 60;
const DEMO_STEPS_PER_TICK = 6;
const COLORS = {
  background: "#090c0d",
  court: "#1d2425",
  line: "rgba(246,242,232,0.18)",
  text: "#f6f2e8",
  muted: "rgba(246,242,232,0.62)",
  green: "#9bd85f",
  agent: "#9bd85f",
  mentor: "#ff705f",
  ball: "#ffd166",
  cyan: "#66d9e8",
};

let training = createTrainingState();
let demoStats = createDemoStats();
let appMode = "training";
let running = false;
let speedIndex = 0;
let epsilonScale = 1;
let experiment = createExperiment(DEFAULT_RUN_SECONDS);
let nextTrainingAt = 0;
let lessonHoldUntil = 0;
let lastLessonCount = 0;
let focusedLessonStep = null;
let introIndex = 0;
let activePrediction = null;

const gameCanvas = document.querySelector("#gameCanvas");
const gameCtx = gameCanvas.getContext("2d");
const policyCanvas = document.querySelector("#policyCanvas");
const policyCtx = policyCanvas.getContext("2d");
const rewardCanvas = document.querySelector("#rewardCanvas");
const rewardCtx = rewardCanvas.getContext("2d");

const els = {
  introOverlay: document.querySelector("#introOverlay"),
  introBack: document.querySelector("#introBack"),
  introSkip: document.querySelector("#introSkip"),
  introNext: document.querySelector("#introNext"),
  introScreens: [...document.querySelectorAll("[data-intro-screen]")],
  introDots: [...document.querySelectorAll("[data-intro-dot]")],
  navButtons: [...document.querySelectorAll("[data-scroll-target]")],
  toggleRun: document.querySelector("#toggleRun"),
  nextLesson: document.querySelector("#nextLesson"),
  restartRun: document.querySelector("#restartRun"),
  durationControl: document.querySelector("#durationControl"),
  speedControl: document.querySelector("#speedControl"),
  paceLabel: document.querySelector("#paceLabel"),
  exploreControl: document.querySelector("#exploreControl"),
  runPulse: document.querySelector("#runPulse"),
  runState: document.querySelector("#runState"),
  runProgress: document.querySelector("#runProgress"),
  timeElapsed: document.querySelector("#timeElapsed"),
  timeRemaining: document.querySelector("#timeRemaining"),
  phaseName: document.querySelector("#phaseName"),
  phaseText: document.querySelector("#phaseText"),
  demoStatus: document.querySelector("#demoStatus"),
  demoText: document.querySelector("#demoText"),
  demoHitRate: document.querySelector("#demoHitRate"),
  demoRallies: document.querySelector("#demoRallies"),
  demoLearningState: document.querySelector("#demoLearningState"),
  agentScore: document.querySelector("#agentScore"),
  mentorScore: document.querySelector("#mentorScore"),
  episodes: document.querySelector("#episodes"),
  hitRate: document.querySelector("#hitRate"),
  epsilon: document.querySelector("#epsilon"),
  states: document.querySelector("#states"),
  startHitRate: document.querySelector("#startHitRate"),
  nowHitRate: document.querySelector("#nowHitRate"),
  hitRateChange: document.querySelector("#hitRateChange"),
  improvementLabel: document.querySelector("#improvementLabel"),
  qValues: document.querySelector("#qValues"),
  policyAction: document.querySelector("#policyAction"),
  rewardNow: document.querySelector("#rewardNow"),
  observeText: document.querySelector("#observeText"),
  actText: document.querySelector("#actText"),
  rewardText: document.querySelector("#rewardText"),
  updateText: document.querySelector("#updateText"),
  eventLog: document.querySelector("#eventLog"),
  lessonType: document.querySelector("#lessonType"),
  lessonHeadline: document.querySelector("#lessonHeadline"),
  lessonBefore: document.querySelector("#lessonBefore"),
  lessonDirection: document.querySelector("#lessonDirection"),
  lessonAfter: document.querySelector("#lessonAfter"),
  lessonReason: document.querySelector("#lessonReason"),
  lessonPanel: document.querySelector(".lesson-panel"),
  masteryLevel: document.querySelector("#masteryLevel"),
  masteryText: document.querySelector("#masteryText"),
  masterySteps: [...document.querySelectorAll(".mastery-step")],
  predictionMode: document.querySelector("#predictionMode"),
  predictionPrompt: document.querySelector("#predictionPrompt"),
  predictionFeedback: document.querySelector("#predictionFeedback"),
  predictionButtons: [...document.querySelectorAll("[data-predict-action]")],
  predictionConfidence: document.querySelector("#predictionConfidence"),
  reflectionPanel: document.querySelector(".reflection-panel"),
  memorySummary: document.querySelector("#memorySummary"),
  memoryTiles: document.querySelector("#memoryTiles"),
};

document.body.classList.add("intro-open");

els.introBack.addEventListener("click", () => {
  introIndex = Math.max(0, introIndex - 1);
  updateIntro();
});

els.introSkip.addEventListener("click", () => {
  closeIntroAndStart();
});

els.introNext.addEventListener("click", () => {
  if (introIndex >= els.introScreens.length - 1) {
    closeIntroAndStart();
    return;
  }

  introIndex += 1;
  updateIntro();
});

els.navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    document.getElementById(button.dataset.scrollTarget)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
});

els.toggleRun.addEventListener("click", () => {
  if (experiment.completed && appMode !== "demo") {
    restartExperiment();
    return;
  }

  setRunning(!running);
});

els.restartRun.addEventListener("click", () => {
  restartExperiment();
});

els.nextLesson.addEventListener("click", () => {
  jumpToNextLesson();
});

els.durationControl.addEventListener("change", () => {
  restartExperiment(Number(els.durationControl.value));
});

els.speedControl.addEventListener("input", () => {
  speedIndex = Number(els.speedControl.value) - 1;
  els.paceLabel.textContent = PACE_CONFIGS[speedIndex].note;
});

els.paceLabel.textContent = PACE_CONFIGS[speedIndex].note;
els.runPulse.classList.add("paused");
updateIntro();
if (new URLSearchParams(window.location.search).get("intro") === "0") {
  closeIntroAndStart();
}

els.exploreControl.addEventListener("input", () => {
  epsilonScale = Number(els.exploreControl.value) / 100;
  syncExploration();
});

els.predictionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!activePrediction) {
      return;
    }

    activePrediction.selectedAction = Number(button.dataset.predictAction);
    renderPredictionFeedback();
  });
});

function syncExploration() {
  training.agent.epsilon = Math.max(training.agent.minEpsilon, epsilonScale);
}

function frame(now = performance.now()) {
  updateExperimentClock();

  advanceTrainingIfReady(now);

  drawGame();
  drawPolicyMap();
  drawRewards();
  updateReadouts();
  requestAnimationFrame(frame);
}

function updateIntro() {
  els.introScreens.forEach((screen, index) => {
    screen.classList.toggle("active", index === introIndex);
  });
  els.introDots.forEach((dot, index) => {
    dot.classList.toggle("active", index === introIndex);
  });
  els.introBack.disabled = introIndex === 0;
  els.introNext.textContent = introIndex === els.introScreens.length - 1 ? "Start experiment" : "Next";
}

function closeIntroAndStart() {
  els.introOverlay.classList.add("hidden");
  document.body.classList.remove("intro-open");
  setRunning(true);
}

function advanceTrainingIfReady(now) {
  if (!running || experiment.completed || now < nextTrainingAt) {
    if (running && appMode === "demo" && now >= nextTrainingAt) {
      runPolicyDemoBatch(training, demoStats, DEMO_STEPS_PER_TICK, { opponentSkill: 0.76 });
      nextTrainingAt = now + 32;
    }
    return;
  }

  const pace = PACE_CONFIGS[speedIndex];
  training.agent.epsilon = Math.min(training.agent.epsilon, Math.max(training.agent.minEpsilon, epsilonScale));

  if (now < lessonHoldUntil) {
    runTrainingBatch(training, pace.rehearsalSteps, { opponentSkill: 0.58 });
    nextTrainingAt = now + pace.tickMs;
    return;
  }

  runTrainingBatch(training, pace.stepsPerTick);
  runTrainingBatch(training, pace.rehearsalSteps, { opponentSkill: 0.66 });
  nextTrainingAt = now + pace.tickMs;

  if (training.stats.lessonCount > lastLessonCount) {
    lastLessonCount = training.stats.lessonCount;
    focusedLessonStep = training.stats.lastStep;
    lessonHoldUntil = now + pace.holdMs;
  }
}

function createExperiment(durationSeconds) {
  return {
    durationMs: durationSeconds * 1000,
    startedAt: performance.now(),
    elapsedMs: 0,
    completed: false,
    startHitRate: getHitRate(training.stats),
  };
}

function restartExperiment(durationSeconds = Number(els.durationControl.value)) {
  training = createTrainingState();
  demoStats = createDemoStats();
  appMode = "training";
  syncExploration();
  experiment = createExperiment(durationSeconds);
  nextTrainingAt = 0;
  lessonHoldUntil = 0;
  lastLessonCount = 0;
  focusedLessonStep = null;
  setRunning(true);
}

function jumpToNextLesson() {
  if (appMode === "demo") {
    const startingRallies = demoStats.rallies;
    let steps = 0;
    while (demoStats.rallies === startingRallies && steps < 2200) {
      runPolicyDemoBatch(training, demoStats, 1, { opponentSkill: 0.76 });
      steps += 1;
    }
    setRunning(false);
    return;
  }

  if (experiment.completed) {
    restartExperiment();
  }

  const startingLessonCount = training.stats.lessonCount;
  const maxSteps = 1800;
  let steps = 0;

  while (training.stats.lessonCount === startingLessonCount && steps < maxSteps) {
    training.agent.epsilon = Math.min(training.agent.epsilon, Math.max(training.agent.minEpsilon, epsilonScale));
    runTrainingBatch(training, 1);
    steps += 1;
  }

  lastLessonCount = training.stats.lessonCount;
  focusedLessonStep = training.stats.lastStep;
  lessonHoldUntil = performance.now() + 5000;
  experiment.elapsedMs = getElapsedMs();
  setRunning(false);
}

function setRunning(nextRunning) {
  if (nextRunning) {
    experiment.startedAt = performance.now() - experiment.elapsedMs;
  } else {
    experiment.elapsedMs = getElapsedMs();
  }
  running = nextRunning;
  if (appMode === "demo") {
    els.toggleRun.textContent = running ? "Pause Demo" : "Resume Demo";
  } else {
    els.toggleRun.textContent = running ? "Pause" : "Resume";
  }
  els.runPulse.classList.toggle("paused", !running);
}

function updateExperimentClock() {
  experiment.elapsedMs = getElapsedMs();

  if (experiment.elapsedMs >= experiment.durationMs && !experiment.completed) {
    experiment.elapsedMs = experiment.durationMs;
    experiment.completed = true;
    startPolicyDemo();
  }
}

function startPolicyDemo() {
  appMode = "demo";
  demoStats = createDemoStats();
  demoStats.active = true;
  training.env.agentScore = 0;
  training.env.mentorScore = 0;
  training.env.reset({ serveToAgent: true });
  training.agent.epsilon = 0;
  focusedLessonStep = null;
  lessonHoldUntil = 0;
  nextTrainingAt = 0;
  runPolicyDemoBatch(training, demoStats, 6000, { opponentSkill: 0.72 });
  setRunning(true);
}

function getElapsedMs() {
  if (!running || experiment.completed) {
    return experiment.elapsedMs;
  }
  return Math.min(experiment.durationMs, performance.now() - experiment.startedAt);
}

function drawGame() {
  const env = training.env;
  const scaleX = gameCanvas.width / env.width;
  const scaleY = gameCanvas.height / env.height;

  gameCtx.fillStyle = COLORS.background;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  gameCtx.strokeStyle = COLORS.line;
  gameCtx.lineWidth = 2;
  gameCtx.setLineDash([12, 14]);
  gameCtx.beginPath();
  gameCtx.moveTo(gameCanvas.width / 2, 24);
  gameCtx.lineTo(gameCanvas.width / 2, gameCanvas.height - 24);
  gameCtx.stroke();
  gameCtx.setLineDash([]);

  const leftX = env.paddleMargin * scaleX;
  const rightX = (env.width - env.paddleMargin) * scaleX;
  drawPaddle(leftX, env.agentY * scaleY, env.paddleWidth * scaleX, env.paddleHeight * scaleY, COLORS.agent);
  drawPaddle(rightX, env.mentorY * scaleY, env.paddleWidth * scaleX, env.paddleHeight * scaleY, COLORS.mentor);

  gameCtx.fillStyle = COLORS.ball;
  gameCtx.beginPath();
  gameCtx.arc(env.ball.x * scaleX, env.ball.y * scaleY, env.ballRadius * scaleX, 0, Math.PI * 2);
  gameCtx.fill();

  drawTrajectory(env, scaleX, scaleY);
  drawTeachingOverlay(env, scaleX, scaleY);
}

function drawPaddle(centerX, centerY, width, height, color) {
  gameCtx.fillStyle = color;
  gameCtx.fillRect(centerX - width / 2, centerY - height / 2, width, height);
}

function drawTrajectory(env, scaleX, scaleY) {
  if (env.ball.vx >= 0) {
    return;
  }

  const targetX = env.paddleMargin + env.paddleWidth / 2;
  const frames = Math.max(1, (env.ball.x - targetX) / Math.abs(env.ball.vx));
  let projectedY = env.ball.y + env.ball.vy * frames;
  const period = env.height * 2;
  projectedY = ((projectedY % period) + period) % period;
  if (projectedY > env.height) {
    projectedY = period - projectedY;
  }

  gameCtx.strokeStyle = "rgba(102, 217, 232, 0.34)";
  gameCtx.lineWidth = 2;
  gameCtx.beginPath();
  gameCtx.moveTo(env.ball.x * scaleX, env.ball.y * scaleY);
  gameCtx.lineTo(targetX * scaleX, projectedY * scaleY);
  gameCtx.stroke();
}

function drawTeachingOverlay(env, scaleX, scaleY) {
  const step = getVisibleStep();
  const paddleX = env.paddleMargin * scaleX;
  const paddleY = env.agentY * scaleY;
  const ballX = env.ball.x * scaleX;
  const ballY = env.ball.y * scaleY;
  const targetY = projectIncomingY(env) * scaleY;

  gameCtx.strokeStyle = "rgba(155, 216, 95, 0.24)";
  gameCtx.lineWidth = 2;
  gameCtx.beginPath();
  gameCtx.moveTo(paddleX + 18, paddleY);
  gameCtx.lineTo(ballX, ballY);
  gameCtx.stroke();

  gameCtx.strokeStyle = "rgba(255, 209, 102, 0.48)";
  gameCtx.setLineDash([7, 7]);
  gameCtx.beginPath();
  gameCtx.moveTo(paddleX - 24, targetY);
  gameCtx.lineTo(paddleX + 34, targetY);
  gameCtx.stroke();
  gameCtx.setLineDash([]);

  const actionIndex = step?.actionIndex ?? 1;
  drawActionArrow(paddleX + 36, paddleY, actionIndex);
  drawBadge(22, 62, "Sight line", "green");
  drawBadge(Math.max(120, paddleX + 48), clamp(targetY - 18, 72, gameCanvas.height - 44), "aim here", "amber");

  if (step) {
    const label =
      step.actionMode === "frozen-policy"
        ? "trained policy"
        : step.actionMode === "explore"
          ? "trying a move"
          : "using memory";
    drawBadge(paddleX + 54, clamp(paddleY + 40, 86, gameCanvas.height - 42), label, "cyan");
  }
}

function projectIncomingY(env) {
  if (env.ball.vx >= 0) {
    return env.agentY;
  }

  const targetX = env.paddleMargin + env.paddleWidth / 2;
  const frames = Math.max(1, (env.ball.x - targetX) / Math.abs(env.ball.vx));
  let projectedY = env.ball.y + env.ball.vy * frames;
  const period = env.height * 2;
  projectedY = ((projectedY % period) + period) % period;
  return projectedY > env.height ? period - projectedY : projectedY;
}

function drawActionArrow(x, y, actionIndex) {
  gameCtx.strokeStyle = COLORS.text;
  gameCtx.fillStyle = COLORS.text;
  gameCtx.lineWidth = 3;

  if (actionIndex === 1) {
    gameCtx.beginPath();
    gameCtx.moveTo(x - 13, y);
    gameCtx.lineTo(x + 13, y);
    gameCtx.stroke();
    return;
  }

  const direction = actionIndex === 0 ? -1 : 1;
  gameCtx.beginPath();
  gameCtx.moveTo(x, y + 20 * direction);
  gameCtx.lineTo(x, y - 20 * direction);
  gameCtx.stroke();
  gameCtx.beginPath();
  gameCtx.moveTo(x, y - 20 * direction);
  gameCtx.lineTo(x - 7, y - 9 * direction);
  gameCtx.lineTo(x + 7, y - 9 * direction);
  gameCtx.closePath();
  gameCtx.fill();
}

function drawBadge(x, y, text, tone) {
  gameCtx.font = "700 15px system-ui, sans-serif";
  const width = gameCtx.measureText(text).width + 22;
  const palette = {
    green: "rgba(155, 216, 95, 0.18)",
    amber: "rgba(255, 209, 102, 0.18)",
    cyan: "rgba(102, 217, 232, 0.18)",
  };
  gameCtx.fillStyle = palette[tone] ?? "rgba(246, 242, 232, 0.14)";
  gameCtx.strokeStyle = "rgba(246, 242, 232, 0.22)";
  gameCtx.lineWidth = 1;
  gameCtx.fillRect(x, y, width, 30);
  gameCtx.strokeRect(x, y, width, 30);
  gameCtx.fillStyle = COLORS.text;
  gameCtx.fillText(text, x + 11, y + 20);
}

function drawPolicyMap() {
  const { env, agent } = training;
  const state = env.getDiscreteState();
  const cellW = policyCanvas.width / 9;
  const cellH = policyCanvas.height / 10;

  policyCtx.fillStyle = COLORS.background;
  policyCtx.fillRect(0, 0, policyCanvas.width, policyCanvas.height);

  for (let y = 0; y < 10; y += 1) {
    for (let delta = 0; delta < 9; delta += 1) {
      const key = makeStateKey({
        ballX: 1,
        ballY: y,
        velocityX: 0,
        velocityY: state.velocityY,
        paddleY: state.paddleY,
        deltaY: delta,
      });
      const values = agent.peekActionValues(key);
      if (!values) {
        policyCtx.fillStyle = "rgba(246,242,232,0.035)";
        policyCtx.fillRect(delta * cellW + 1, y * cellH + 1, cellW - 2, cellH - 2);
        continue;
      }
      const action = bestActionIndex(values, () => 0);
      const confidence = Math.min(1, Math.max(...values.map(Math.abs)) / 2.4);
      policyCtx.fillStyle = actionColor(action, confidence);
      policyCtx.fillRect(delta * cellW + 1, y * cellH + 1, cellW - 2, cellH - 2);
    }
  }

  policyCtx.strokeStyle = "rgba(246,242,232,0.18)";
  policyCtx.lineWidth = 1;
  for (let x = 1; x < 9; x += 1) {
    policyCtx.beginPath();
    policyCtx.moveTo(x * cellW, 0);
    policyCtx.lineTo(x * cellW, policyCanvas.height);
    policyCtx.stroke();
  }
}

function actionColor(action, confidence) {
  const alpha = 0.18 + confidence * 0.72;
  if (action === 0) {
    return `rgba(155, 216, 95, ${alpha})`;
  }
  if (action === 1) {
    return `rgba(255, 209, 102, ${alpha})`;
  }
  return `rgba(102, 217, 232, ${alpha})`;
}

function drawRewards() {
  const values = training.stats.rewardWindow;
  rewardCtx.fillStyle = COLORS.background;
  rewardCtx.fillRect(0, 0, rewardCanvas.width, rewardCanvas.height);

  rewardCtx.strokeStyle = "rgba(246,242,232,0.16)";
  rewardCtx.beginPath();
  rewardCtx.moveTo(0, rewardCanvas.height / 2);
  rewardCtx.lineTo(rewardCanvas.width, rewardCanvas.height / 2);
  rewardCtx.stroke();

  if (values.length < 2) {
    return;
  }

  const min = Math.min(-8, ...values);
  const max = Math.max(8, ...values);
  const range = max - min || 1;

  rewardCtx.strokeStyle = COLORS.green;
  rewardCtx.lineWidth = 2.5;
  rewardCtx.beginPath();
  values.forEach((value, index) => {
    const x = (index / (values.length - 1)) * rewardCanvas.width;
    const y = rewardCanvas.height - ((value - min) / range) * rewardCanvas.height;
    if (index === 0) {
      rewardCtx.moveTo(x, y);
    } else {
      rewardCtx.lineTo(x, y);
    }
  });
  rewardCtx.stroke();
}

function updateReadouts() {
  const { env, agent, stats } = training;
  const state = env.getDiscreteState();
  const values = agent.getActionValues(state.key);
  const action = bestActionIndex(values, () => 0);
  const hitRate = getHitRate(stats);
  const demoHitRate = getHitRate(demoStats);
  const progress = experiment.elapsedMs / experiment.durationMs;
  const remainingMs = Math.max(0, experiment.durationMs - experiment.elapsedMs);
  const phase = getPhase(progress, experiment.completed);
  const readingLesson = isReadingLesson();
  const hitRateChange = hitRate - experiment.startHitRate;
  const visibleStep = getVisibleStep();
  const predictionStep = visibleStep ?? { state, actionIndex: action, actionMode: "policy", reward: stats.lastReward };
  const predictionValues =
    predictionStep.actionMode === "frozen-policy"
      ? predictionStep.values ?? agent.peekActionValues(predictionStep.state.key) ?? [0, 0, 0]
      : agent.peekActionValues(predictionStep.state.key) ?? values;

  els.agentScore.textContent = env.agentScore.toString();
  els.mentorScore.textContent = env.mentorScore.toString();
  els.episodes.textContent = stats.episodes.toLocaleString();
  els.hitRate.textContent = formatPercent(hitRate);
  els.epsilon.textContent = `${Math.round(agent.epsilon * 100)}%`;
  els.states.textContent = agent.qTable.size.toLocaleString();
  els.startHitRate.textContent = formatPercent(experiment.startHitRate);
  els.nowHitRate.textContent = formatPercent(hitRate);
  els.hitRateChange.textContent = formatSignedPercent(hitRateChange);
  els.improvementLabel.textContent = experiment.completed ? "final result" : "live delta";
  els.runProgress.style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
  els.timeElapsed.textContent = `${(experiment.elapsedMs / 1000).toFixed(1)}s`;
  els.timeRemaining.textContent =
    appMode === "demo" ? "training complete" : `${(remainingMs / 1000).toFixed(1)}s remaining`;
  els.phaseName.textContent = appMode === "demo" ? "Policy demo" : readingLesson ? "Reading lesson" : phase.name;
  els.phaseText.textContent =
    appMode === "demo"
      ? "Memory is locked. Watch what it learned."
      : readingLesson
        ? "Paused on one memory update."
        : phase.text;
  els.runState.textContent = getRunStateLabel(readingLesson ? "Reading lesson" : phase.name);
  els.policyAction.textContent = ACTION_NAMES[action];
  els.rewardNow.textContent = stats.lastReward.toFixed(2);
  els.runPulse.classList.toggle("paused", !running);
  els.demoStatus.textContent = appMode === "demo" ? "policy playing" : "waiting for training";
  els.demoText.textContent =
    appMode === "demo"
      ? "Memory locked. No guessing. No updates."
      : "After training, memory locks. Then we test it.";
  els.demoHitRate.textContent = formatPercent(demoHitRate);
  els.demoRallies.textContent = (demoStats.hits + demoStats.misses).toLocaleString();
  els.demoLearningState.textContent = appMode === "demo" ? "off" : "on";

  els.qValues.replaceChildren(
    ...values.map((value, index) => {
      const card = document.createElement("div");
      card.className = `q-card${index === action ? " best" : ""}`;
      card.innerHTML = `<span>${ACTION_NAMES[index]}</span><strong>${formatQ(value)}</strong>`;
      return card;
    }),
  );

  updateLearningLoop(visibleStep);
  updateLesson(visibleStep);
  updatePredictionCheck(predictionStep, predictionValues);
  updateMastery(hitRate, agent.epsilon, agent.qTable.size);
  updateMemoryTiles(agent);
  updateEventLog(stats.events);
}

frame();

function getHitRate(stats) {
  return stats.hitWindow.length
    ? stats.hitWindow.reduce((sum, value) => sum + value, 0) / stats.hitWindow.length
    : 0;
}

function getPhase(progress, completed) {
  if (completed) {
    return {
      name: "Review",
      text: "Training finished. Compare start and now.",
    };
  }
  if (progress < 0.25) {
    return {
      name: "Exploring",
      text: "Early on, the paddle guesses a lot.",
    };
  }
  if (progress < 0.7) {
    return {
      name: "Updating",
      text: "Hits raise values. Misses lower them.",
    };
  }
  return {
    name: "Exploiting",
    text: "The paddle trusts memory more now.",
  };
}

function getRunStateLabel(phaseName) {
  if (appMode === "demo") {
    return running ? "Frozen policy demo" : "Demo paused";
  }
  if (experiment.completed) {
    return "Timed run complete";
  }
  if (isReadingLesson()) {
    return "Holding on a lesson";
  }
  if (!running) {
    return "Paused";
  }
  return `${Math.round(experiment.durationMs / 1000)}s run: ${phaseName}`;
}

function isReadingLesson() {
  return running && !experiment.completed && performance.now() < lessonHoldUntil;
}

function updateLearningLoop(step) {
  if (!step) {
    return;
  }

  const ballDirection = step.state.velocityX === 0 ? "incoming" : "leaving";
  const verticalOffset = step.state.deltaY < 4 ? "above" : step.state.deltaY > 4 ? "below" : "level";
  const actionName = ACTION_NAMES[step.actionIndex].toLowerCase();
  const mode =
    step.actionMode === "frozen-policy"
      ? "locked policy"
      : step.actionMode === "explore"
        ? "guess"
        : "memory";

  els.observeText.textContent = `${ballDirection}; ball ${verticalOffset}.`;
  els.actText.textContent = `${ACTION_NAMES[step.actionIndex]} (${mode}).`;
  els.rewardText.textContent = `Reward ${formatSignedNumber(step.reward)}.`;
  if (step.actionMode === "frozen-policy") {
    els.updateText.textContent = `No update.`;
  } else {
    els.updateText.textContent = `${formatQ(step.update.oldValue)} -> ${formatQ(step.update.updatedValue)}.`;
  }
}

function updateLesson(step) {
  if (!step) {
    return;
  }

  const actionName = ACTION_NAMES[step.actionIndex];
  const tone = lessonToneForEvent(step.event, step.actionMode);
  els.lessonPanel.classList.remove("lesson-success", "lesson-mistake", "lesson-demo", "lesson-neutral");
  els.lessonPanel.classList.add(tone);

  if (step.actionMode === "frozen-policy") {
    const value = step.values?.[step.actionIndex] ?? 0;
    els.lessonType.textContent = "demo";
    els.lessonHeadline.textContent = `Memory chose ${actionName}.`;
    els.lessonBefore.textContent = formatQ(value);
    els.lessonAfter.textContent = formatQ(value);
    els.lessonDirection.textContent = "locked";
    els.lessonDirection.className = "positive";
    els.lessonReason.textContent =
      "Learning is off. This is the test.";
    return;
  }

  const change = step.update.updatedValue - step.update.oldValue;
  const positive = change >= 0;
  const eventCopy = lessonCopyForEvent(step.event, actionName, step.actionMode);

  els.lessonType.textContent = eventCopy.type;
  els.lessonHeadline.textContent = eventCopy.headline;
  els.lessonBefore.textContent = formatQ(step.update.oldValue);
  els.lessonAfter.textContent = formatQ(step.update.updatedValue);
  els.lessonDirection.textContent = positive ? "trust up" : "trust down";
  els.lessonDirection.className = positive ? "positive" : "negative";
  els.lessonReason.textContent = eventCopy.reason;
}

function lessonToneForEvent(event, actionMode) {
  if (actionMode === "frozen-policy") {
    return "lesson-demo";
  }
  if (event === "agent-hit" || event === "mentor-miss") {
    return "lesson-success";
  }
  if (event === "agent-miss") {
    return "lesson-mistake";
  }
  return "lesson-neutral";
}

function updatePredictionCheck(step, values) {
  if (!step) {
    return;
  }

  const targetAction = bestActionIndex(values, () => 0);
  const confidence = confidenceFromValues(values);
  const samePrompt = activePrediction?.stateKey === step.state.key && activePrediction?.targetAction === targetAction;

  if (!samePrompt) {
    activePrediction = {
      stateKey: step.state.key,
      targetAction,
      selectedAction: null,
      confidence,
      actionMode: step.actionMode,
      relativePosition: relativeBallPosition(step.state.deltaY),
    };
  } else {
    activePrediction.confidence = confidence;
    activePrediction.actionMode = step.actionMode;
    activePrediction.relativePosition = relativeBallPosition(step.state.deltaY);
  }

  els.predictionMode.textContent = step.actionMode === "frozen-policy" ? "demo policy" : "memory check";
  els.predictionPrompt.textContent = `Ball ${activePrediction.relativePosition}. What should memory choose?`;
  els.predictionConfidence.style.width = `${Math.round(confidence * 100)}%`;
  els.reflectionPanel.classList.toggle("high-confidence", confidence >= 0.55);

  renderPredictionFeedback();
}

function renderPredictionFeedback() {
  if (!activePrediction) {
    return;
  }

  const targetName = ACTION_NAMES[activePrediction.targetAction];
  const selected = activePrediction.selectedAction;
  const confidenceLabel =
    activePrediction.confidence >= 0.55
      ? "strong"
      : activePrediction.confidence >= 0.25
        ? "emerging"
        : "weak";

  els.predictionButtons.forEach((button) => {
    const action = Number(button.dataset.predictAction);
    button.classList.toggle("selected", action === selected);
    button.classList.toggle("correct", selected !== null && action === activePrediction.targetAction);
    button.classList.toggle("missed", selected === action && selected !== activePrediction.targetAction);
  });

  if (selected === null) {
    els.predictionFeedback.textContent = `Confidence: ${confidenceLabel}. Pick one.`;
    return;
  }

  if (selected === activePrediction.targetAction) {
    els.predictionFeedback.textContent = `Correct: ${targetName}. Confidence: ${confidenceLabel}.`;
  } else {
    els.predictionFeedback.textContent = `Memory says ${targetName}.`;
  }
}

function confidenceFromValues(values) {
  const sorted = [...values].sort((a, b) => b - a);
  const margin = Math.abs(sorted[0] - sorted[1]);
  const strength = Math.max(...values.map(Math.abs));
  return clamp((margin + strength * 0.35) / 2.4, 0, 1);
}

function relativeBallPosition(deltaY) {
  if (deltaY < 3) {
    return "well above";
  }
  if (deltaY < 4) {
    return "slightly above";
  }
  if (deltaY > 5) {
    return "well below";
  }
  if (deltaY > 4) {
    return "slightly below";
  }
  return "level with";
}

function getVisibleStep() {
  return appMode === "demo" ? demoStats.lastStep ?? focusedLessonStep : focusedLessonStep;
}

function lessonCopyForEvent(event, actionName, actionMode) {
  const modeText = actionMode === "explore" ? "guessed" : "remembered";

  if (event === "agent-hit") {
    return {
      type: "hit",
      headline: `${actionName} worked.`,
      reason: `Reward raised this memory.`,
    };
  }
  if (event === "agent-miss") {
    return {
      type: "miss",
      headline: `${actionName} missed.`,
      reason: `Reward lowered this memory.`,
    };
  }
  if (event === "mentor-miss") {
    return {
      type: "point",
      headline: `${actionName} helped win.`,
      reason: `This path was useful.`,
    };
  }
  return {
    type: actionMode === "explore" ? "guessing" : "using memory",
    headline: `${actionName} was ${modeText}.`,
    reason: `Small score. Small update.`,
  };
}

function updateMastery(hitRate, epsilon, learnedStates) {
  const level = getMasteryLevel(hitRate, epsilon, learnedStates);

  els.masteryLevel.textContent = level.label;
  els.masteryText.textContent = level.text;
  els.masterySteps.forEach((step, index) => {
    step.classList.toggle("active", index < level.step);
  });
}

function getMasteryLevel(hitRate, epsilon, learnedStates) {
  if (hitRate >= 0.7 && epsilon <= 0.25) {
    return {
      step: 4,
      label: "stable habit",
      text: "Mostly memory now.",
    };
  }
  if (hitRate >= 0.45 || learnedStates > 550) {
    return {
      step: 3,
      label: "forming preferences",
      text: "Some moves stand out.",
    };
  }
  if (learnedStates > 120 || hitRate >= 0.2) {
    return {
      step: 2,
      label: "noticing patterns",
      text: "Useful moves are emerging.",
    };
  }
  return {
    step: 1,
    label: "new learner",
    text: "Mostly guessing.",
  };
}

function updateMemoryTiles(agent) {
  const entries = [...agent.qTable.values()];
  const filled = Math.min(32, entries.length);
  const maxStrength = Math.max(0.01, ...entries.map((values) => Math.max(...values.map(Math.abs))));
  const tiles = [];

  for (let index = 0; index < 32; index += 1) {
    const tile = document.createElement("span");
    tile.className = "memory-tile";

    if (index >= filled) {
      tile.classList.add("empty");
      tiles.push(tile);
      continue;
    }

    const values = entries[Math.floor((index / Math.max(1, filled - 1)) * (entries.length - 1))];
    const action = bestActionIndex(values, () => 0);
    const strength = clamp(Math.max(...values.map(Math.abs)) / maxStrength, 0, 1);
    tile.style.background = actionColor(action, strength);
    tile.title = `${ACTION_NAMES[action]} memory, strength ${Math.round(strength * 100)}%`;
    tiles.push(tile);
  }

  els.memorySummary.textContent = `${agent.qTable.size.toLocaleString()} situations`;
  els.memoryTiles.replaceChildren(...tiles);
}

function updateEventLog(events) {
  if (!events.length) {
    els.eventLog.replaceChildren(emptyEvent());
    return;
  }

  els.eventLog.replaceChildren(
    ...events.map((event) => {
      const item = document.createElement("li");
      const actionName = ACTION_NAMES[event.actionIndex];
      item.innerHTML = `
        <span>Episode ${event.episode}</span>
        <p><strong>${eventLabel(event.event)}</strong> ${actionName}. ${formatSignedNumber(event.reward)} | ${formatQ(event.oldValue)} -> ${formatQ(event.updatedValue)}</p>
      `;
      return item;
    }),
  );
}

function emptyEvent() {
  const item = document.createElement("li");
  item.innerHTML = "<span>Episode 0</span><p>Waiting for first lesson.</p>";
  return item;
}

function eventLabel(event) {
  if (event === "agent-hit") {
    return "Good hit";
  }
  if (event === "agent-miss") {
    return "Missed ball";
  }
  if (event === "mentor-miss") {
    return "Won rally";
  }
  if (event === "mentor-hit") {
    return "Rally continued";
  }
  return "Value update";
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value) {
  const rounded = Math.round(value * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded} pts`;
}

function formatSignedNumber(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatQ(value) {
  if (Math.abs(value) < 0.00005) {
    return "0.000";
  }
  if (Math.abs(value) < 0.01) {
    return value.toFixed(4);
  }
  if (Math.abs(value) < 0.1) {
    return value.toFixed(3);
  }
  return value.toFixed(2);
}
