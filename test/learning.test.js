import assert from "node:assert/strict";
import test from "node:test";

import {
  QLearningAgent,
  PongEnvironment,
  SeededRandom,
  bestActionIndex,
  chooseDemoAction,
  createDemoStats,
  discretizeObservation,
  runPolicyDemoBatch,
  runTrainingBatch,
} from "../src/learning.js";

test("Q-learning update moves an action value toward observed reward", () => {
  const agent = new QLearningAgent({ alpha: 0.5, gamma: 0.9, epsilon: 0, rng: () => 0 });

  agent.learn("state", 2, 2, "next", false);

  assert.equal(agent.getActionValues("state")[2], 1);
  assert.equal(agent.totalUpdates, 1);
  assert.equal(agent.lastUpdate.actionIndex, 2);
});

test("peekActionValues reads without creating table entries", () => {
  const agent = new QLearningAgent({ rng: () => 0 });

  assert.equal(agent.peekActionValues("missing"), null);
  assert.equal(agent.qTable.size, 0);

  agent.getActionValues("missing");

  assert.deepEqual(agent.peekActionValues("missing"), [0, 0, 0]);
  assert.equal(agent.qTable.size, 1);
});

test("bestActionIndex resolves ties with the provided random source", () => {
  assert.equal(bestActionIndex([1, 4, 4], () => 0), 1);
  assert.equal(bestActionIndex([1, 4, 4], () => 0.99), 2);
});

test("discretizeObservation returns stable bounded state keys", () => {
  const state = discretizeObservation({
    ballX: 9999,
    ballY: -100,
    ballVx: -1,
    ballVy: 100,
    agentY: 270,
    mentorY: 270,
    width: 960,
    height: 540,
  });

  assert.equal(state.key, "11:0:0:4:5:0");
});

test("environment ends an episode with negative reward when the agent misses", () => {
  const env = new PongEnvironment({ rng: () => 0.5 });
  env.ball.x = -10;
  env.ball.y = 30;
  env.ball.vx = -8;
  env.ball.vy = 0;
  env.agentY = 500;

  const result = env.step(0);

  assert.equal(result.done, true);
  assert.equal(result.event, "agent-miss");
  assert.ok(result.reward < -3);
});

test("training batch creates state entries and completes episodes", () => {
  const rng = new SeededRandom(7);
  const random = () => rng.next();
  const training = {
    env: new PongEnvironment({ rng: random }),
    agent: new QLearningAgent({ rng: random, epsilon: 1, epsilonDecay: 0.98 }),
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

  runTrainingBatch(training, 900);

  assert.ok(training.agent.qTable.size > 0);
  assert.ok(training.agent.totalUpdates >= 900);
  assert.ok(training.stats.episodes > 0);
  assert.ok(training.stats.lastStep);
  assert.ok(training.stats.events.length > 0);
  assert.ok(training.stats.lessonCount > 0);
});

test("policy demo runs without adding new learning updates", () => {
  const rng = new SeededRandom(11);
  const random = () => rng.next();
  const training = {
    env: new PongEnvironment({ rng: random }),
    agent: new QLearningAgent({ rng: random, epsilon: 0.2 }),
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

  runTrainingBatch(training, 500);
  const updatesBefore = training.agent.totalUpdates;
  const tableSizeBefore = training.agent.qTable.size;
  const demoStats = createDemoStats();

  runPolicyDemoBatch(training, demoStats, 500);

  assert.equal(training.agent.totalUpdates, updatesBefore);
  assert.equal(training.agent.qTable.size, tableSizeBefore);
  assert.ok(demoStats.lastStep);
});

test("demo policy falls back to tracking for unfamiliar states", () => {
  assert.equal(chooseDemoAction({ deltaY: 2 }, [0, 0, 0]), 0);
  assert.equal(chooseDemoAction({ deltaY: 6 }, [0, 0, 0]), 2);
  assert.equal(chooseDemoAction({ deltaY: 4 }, [0, 0, 0]), 1);
  assert.equal(chooseDemoAction({ deltaY: 6 }, [0.1, 0.2, 0.05]), 1);
});
