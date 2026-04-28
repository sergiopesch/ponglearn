export const ACTIONS = [-1, 0, 1];
export const ACTION_NAMES = ["Up", "Hold", "Down"];

const STATE_BINS = {
  ballX: 12,
  ballY: 10,
  paddleY: 10,
  deltaY: 9,
  velocityY: 5,
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class SeededRandom {
  constructor(seed = 123456789) {
    this.seed = seed >>> 0;
  }

  next() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }
}

export class PongEnvironment {
  constructor(options = {}) {
    this.width = options.width ?? 960;
    this.height = options.height ?? 540;
    this.paddleWidth = 14;
    this.paddleHeight = 128;
    this.paddleMargin = 34;
    this.paddleSpeed = 14;
    this.mentorSpeed = 8.2;
    this.ballRadius = 7;
    this.baseBallSpeed = 6;
    this.maxBallSpeed = 14;
    this.rng = options.rng ?? Math.random;
    this.agentScore = 0;
    this.mentorScore = 0;
    this.reset({ serveToAgent: true });
  }

  reset(options = {}) {
    const serveToAgent = options.serveToAgent ?? this.rng() < 0.55;
    const angle = (this.rng() * 0.72 - 0.36) * Math.PI;
    const direction = serveToAgent ? -1 : 1;

    this.agentY = this.height / 2;
    this.mentorY = this.height / 2;
    this.ball = {
      x: this.width / 2,
      y: this.height * (0.32 + this.rng() * 0.36),
      vx: Math.cos(angle) * this.baseBallSpeed * direction,
      vy: Math.sin(angle) * this.baseBallSpeed,
      speed: this.baseBallSpeed,
    };
    this.steps = 0;
    return this.getObservation();
  }

  getObservation() {
    return {
      ballX: this.ball.x,
      ballY: this.ball.y,
      ballVx: this.ball.vx,
      ballVy: this.ball.vy,
      agentY: this.agentY,
      mentorY: this.mentorY,
      width: this.width,
      height: this.height,
    };
  }

  getDiscreteState() {
    return discretizeObservation(this.getObservation());
  }

  step(action, options = {}) {
    const opponentSkill = options.opponentSkill ?? 0.78;
    const oldX = this.ball.x;
    const oldY = this.ball.y;
    const actionDirection = clamp(action, -1, 1);
    let reward = -0.002;
    let done = false;
    let event = "rally";

    this.agentY = clamp(
      this.agentY + actionDirection * this.paddleSpeed,
      this.paddleHeight / 2,
      this.height - this.paddleHeight / 2,
    );

    const mentorTarget = this.ball.vx > 0 ? this.ball.y : this.height / 2;
    const mentorError = (1 - opponentSkill) * 74 * Math.sin(this.steps * 0.09);
    const mentorDelta = mentorTarget + mentorError - this.mentorY;
    this.mentorY = clamp(
      this.mentorY + clamp(mentorDelta, -this.mentorSpeed, this.mentorSpeed),
      this.paddleHeight / 2,
      this.height - this.paddleHeight / 2,
    );

    if (this.ball.vx < 0) {
      const trackingDistance = Math.abs(this.ball.y - this.agentY);
      reward += 0.014 * (1 - clamp(trackingDistance / (this.paddleHeight * 1.4), 0, 1));
    }

    this.ball.x += this.ball.vx;
    this.ball.y += this.ball.vy;
    this.steps += 1;

    if (this.ball.y - this.ballRadius <= 0 || this.ball.y + this.ballRadius >= this.height) {
      this.ball.y = clamp(this.ball.y, this.ballRadius, this.height - this.ballRadius);
      this.ball.vy *= -1;
      reward += 0.01;
    }

    const agentX = this.paddleMargin;
    const mentorX = this.width - this.paddleMargin;
    const hitAgentPlane =
      oldX - this.ballRadius >= agentX + this.paddleWidth / 2 &&
      this.ball.x - this.ballRadius <= agentX + this.paddleWidth / 2;
    const hitMentorPlane =
      oldX + this.ballRadius <= mentorX - this.paddleWidth / 2 &&
      this.ball.x + this.ballRadius >= mentorX - this.paddleWidth / 2;

    if (this.ball.vx < 0 && hitAgentPlane && this.intersectsPaddle(this.agentY, oldY, this.ball.y)) {
      this.reflectFromPaddle(this.agentY, 1);
      this.ball.x = agentX + this.paddleWidth / 2 + this.ballRadius;
      const centerHit = 1 - Math.abs(this.ball.y - this.agentY) / (this.paddleHeight / 2);
      reward += 2.4 + Math.max(0, centerHit) * 0.7;
      event = "agent-hit";
    }

    if (this.ball.vx > 0 && hitMentorPlane && this.intersectsPaddle(this.mentorY, oldY, this.ball.y)) {
      this.reflectFromPaddle(this.mentorY, -1);
      this.ball.x = mentorX - this.paddleWidth / 2 - this.ballRadius;
      reward += 0.1;
      event = "mentor-hit";
    }

    if (this.ball.x + this.ballRadius < 0) {
      const missDistance = Math.abs(this.ball.y - this.agentY);
      reward -= 3.8 + clamp(missDistance / this.height, 0, 1.2);
      this.mentorScore += 1;
      done = true;
      event = "agent-miss";
    } else if (this.ball.x - this.ballRadius > this.width) {
      reward += 3.4;
      this.agentScore += 1;
      done = true;
      event = "mentor-miss";
    }

    return {
      observation: this.getObservation(),
      state: this.getDiscreteState(),
      reward,
      done,
      event,
    };
  }

  intersectsPaddle(paddleY, oldBallY, newBallY) {
    const top = paddleY - this.paddleHeight / 2 - this.ballRadius;
    const bottom = paddleY + this.paddleHeight / 2 + this.ballRadius;
    const minY = Math.min(oldBallY, newBallY);
    const maxY = Math.max(oldBallY, newBallY);
    return maxY >= top && minY <= bottom;
  }

  reflectFromPaddle(paddleY, direction) {
    const offset = clamp((this.ball.y - paddleY) / (this.paddleHeight / 2), -1, 1);
    const speed = Math.min(this.maxBallSpeed, this.ball.speed + 0.18);
    const angle = offset * 0.92;

    this.ball.speed = speed;
    this.ball.vx = Math.cos(angle) * speed * direction;
    this.ball.vy = Math.sin(angle) * speed;
  }
}

export class QLearningAgent {
  constructor(options = {}) {
    this.alpha = options.alpha ?? 0.2;
    this.gamma = options.gamma ?? 0.94;
    this.epsilon = options.epsilon ?? 1;
    this.minEpsilon = options.minEpsilon ?? 0.02;
    this.epsilonDecay = options.epsilonDecay ?? 0.985;
    this.rng = options.rng ?? Math.random;
    this.qTable = new Map();
    this.totalUpdates = 0;
    this.lastUpdate = null;
  }

  getActionValues(stateKey) {
    if (!this.qTable.has(stateKey)) {
      this.qTable.set(stateKey, [0, 0, 0]);
    }
    return this.qTable.get(stateKey);
  }

  peekActionValues(stateKey) {
    return this.qTable.get(stateKey) ?? null;
  }

  chooseAction(stateKey) {
    return this.chooseActionDecision(stateKey).actionIndex;
  }

  chooseActionDecision(stateKey) {
    if (this.rng() < this.epsilon) {
      return {
        actionIndex: Math.floor(this.rng() * ACTIONS.length),
        mode: "explore",
      };
    }

    return {
      actionIndex: bestActionIndex(this.getActionValues(stateKey), this.rng),
      mode: "policy",
    };
  }

  learn(stateKey, actionIndex, reward, nextStateKey, done) {
    const values = this.getActionValues(stateKey);
    const nextValues = this.getActionValues(nextStateKey);
    const oldValue = values[actionIndex];
    const futureValue = done ? 0 : Math.max(...nextValues);
    const target = reward + this.gamma * futureValue;
    const updatedValue = oldValue + this.alpha * (target - oldValue);

    values[actionIndex] = updatedValue;
    this.totalUpdates += 1;
    this.lastUpdate = {
      stateKey,
      actionIndex,
      reward,
      oldValue,
      updatedValue,
      tdError: target - oldValue,
    };

    return this.lastUpdate;
  }

  endEpisode() {
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);
  }
}

export function createTrainingState() {
  const rng = new SeededRandom(42);
  const random = () => rng.next();

  return {
    env: new PongEnvironment({ rng: random }),
    agent: new QLearningAgent({ rng: random }),
    stats: {
      episodes: 0,
      hits: 0,
      misses: 0,
      agentWins: 0,
      rewardWindow: [],
      hitWindow: [],
      events: [],
      lessonCount: 0,
      currentEpisodeReward: 0,
      lastReward: 0,
      lastStep: null,
    },
  };
}

export function runTrainingBatch(trainingState, steps, options = {}) {
  const { env, agent, stats } = trainingState;
  const opponentSkill = options.opponentSkill ?? 0.78;

  for (let i = 0; i < steps; i += 1) {
    const state = env.getDiscreteState();
    const decision = agent.chooseActionDecision(state.key);
    const result = env.step(ACTIONS[decision.actionIndex], { opponentSkill });

    const update = agent.learn(state.key, decision.actionIndex, result.reward, result.state.key, result.done);
    stats.currentEpisodeReward += result.reward;
    stats.lastReward = result.reward;
    stats.lastStep = {
      state,
      nextState: result.state,
      actionIndex: decision.actionIndex,
      actionMode: decision.mode,
      reward: result.reward,
      event: result.event,
      update,
    };

    if (result.event === "agent-hit") {
      stats.hits += 1;
      stats.hitWindow.push(1);
    } else if (result.event === "agent-miss") {
      stats.misses += 1;
      stats.hitWindow.push(0);
    }

    if (stats.hitWindow.length > 160) {
      stats.hitWindow.shift();
    }

    if ((result.event !== "rally" && result.event !== "mentor-hit") || Math.abs(update.tdError) > 0.45) {
      stats.events.unshift({
        episode: stats.episodes + 1,
        actionIndex: decision.actionIndex,
        actionMode: decision.mode,
        event: result.event,
        reward: result.reward,
        tdError: update.tdError,
        oldValue: update.oldValue,
        updatedValue: update.updatedValue,
      });
      if (stats.events.length > 8) {
        stats.events.pop();
      }
      stats.lessonCount += 1;
    }

    if (result.done) {
      if (result.event === "mentor-miss") {
        stats.agentWins += 1;
      }
      stats.episodes += 1;
      stats.rewardWindow.push(stats.currentEpisodeReward);
      if (stats.rewardWindow.length > 90) {
        stats.rewardWindow.shift();
      }
      stats.currentEpisodeReward = 0;
      agent.endEpisode();
      env.reset({ serveToAgent: true });
    }
  }
}

export function createDemoStats() {
  return {
    active: false,
    rallies: 0,
    hits: 0,
    misses: 0,
    agentWins: 0,
    hitWindow: [],
    lastStep: null,
  };
}

export function runPolicyDemoBatch(trainingState, demoStats, steps, options = {}) {
  const { env, agent } = trainingState;
  const opponentSkill = options.opponentSkill ?? 0.74;

  for (let i = 0; i < steps; i += 1) {
    const state = env.getDiscreteState();
    const values = agent.peekActionValues(state.key) ?? [0, 0, 0];
    const actionIndex = chooseDemoAction(state, values);
    const result = env.step(ACTIONS[actionIndex], { opponentSkill });

    demoStats.lastStep = {
      state,
      nextState: result.state,
      actionIndex,
      actionMode: "frozen-policy",
      reward: result.reward,
      event: result.event,
      values: [...values],
    };

    if (result.event === "agent-hit") {
      demoStats.hits += 1;
      demoStats.hitWindow.push(1);
    } else if (result.event === "agent-miss") {
      demoStats.misses += 1;
      demoStats.hitWindow.push(0);
    }

    if (demoStats.hitWindow.length > 160) {
      demoStats.hitWindow.shift();
    }

    if (result.done) {
      if (result.event === "mentor-miss") {
        demoStats.agentWins += 1;
      }
      demoStats.rallies += 1;
      env.reset({ serveToAgent: true });
    }
  }
}

export function chooseDemoAction(state, values) {
  const confidence = Math.max(...values.map(Math.abs));
  if (confidence > 0.04) {
    return bestActionIndex(values, () => 0);
  }

  if (state.deltaY < 4) {
    return 0;
  }
  if (state.deltaY > 4) {
    return 2;
  }
  return 1;
}

export function discretizeObservation(observation) {
  const ballX = bucket(observation.ballX, 0, observation.width, STATE_BINS.ballX);
  const ballY = bucket(observation.ballY, 0, observation.height, STATE_BINS.ballY);
  const paddleY = bucket(observation.agentY, 0, observation.height, STATE_BINS.paddleY);
  const deltaY = bucket(
    observation.ballY - observation.agentY,
    -observation.height / 2,
    observation.height / 2,
    STATE_BINS.deltaY,
  );
  const velocityX = observation.ballVx < 0 ? 0 : 1;
  const velocityY = bucket(observation.ballVy, -14, 14, STATE_BINS.velocityY);

  return {
    key: [ballX, ballY, velocityX, velocityY, paddleY, deltaY].join(":"),
    ballX,
    ballY,
    velocityX,
    velocityY,
    paddleY,
    deltaY,
  };
}

export function makeStateKey(parts) {
  return [
    parts.ballX,
    parts.ballY,
    parts.velocityX,
    parts.velocityY,
    parts.paddleY,
    parts.deltaY,
  ].join(":");
}

export function bestActionIndex(values, rng = Math.random) {
  const bestValue = Math.max(...values);
  const best = values
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value === bestValue);
  return best[Math.floor(rng() * best.length)].index;
}

function bucket(value, min, max, bins) {
  const ratio = clamp((value - min) / (max - min), 0, 0.999999);
  return Math.floor(ratio * bins);
}
