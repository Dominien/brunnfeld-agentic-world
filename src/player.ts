import type { AgentAction, AgentTurnResult, SimTime, Skill, WorldState } from "./types.js";
import { emitSSE } from "./events.js";
import { resolveAction } from "./tools.js";
import { updateBodyState } from "./body.js";

// ─── Skill configs ────────────────────────────────────────────

interface SkillConfig {
  skill: Skill;
  workLocation: string;
  startCoin: number;
  hasTool: boolean;
}

const PLAYER_SKILLS: Record<string, SkillConfig> = {
  farmer:     { skill: "farmer",     workLocation: "Farm 1",        startCoin: 20, hasTool: true  },
  baker:      { skill: "baker",      workLocation: "Bakery",        startCoin: 20, hasTool: false },
  miner:      { skill: "miner",      workLocation: "Mine",          startCoin: 20, hasTool: true  },
  carpenter:  { skill: "carpenter",  workLocation: "Carpenter Shop", startCoin: 20, hasTool: true  },
  blacksmith: { skill: "blacksmith", workLocation: "Forge",         startCoin: 20, hasTool: false },
  merchant:   { skill: "merchant",   workLocation: "Village Square", startCoin: 30, hasTool: false },
};

export function getPlayerSkillConfigs(): Record<string, SkillConfig> {
  return PLAYER_SKILLS;
}

// ─── Init ─────────────────────────────────────────────────────

export function initPlayer(
  state: WorldState,
  name: string,
  skillId: string,
  startLocation: string,
): void {
  const cfg = PLAYER_SKILLS[skillId];
  if (!cfg) throw new Error(`Unknown skill: ${skillId}`);

  state.agent_locations["player"] = startLocation;
  state.body["player"] = { hunger: 0, energy: 8, sleep_quality: "good" };
  state.economics["player"] = {
    wallet: cfg.startCoin,
    inventory: { items: [] },
    tool: cfg.hasTool ? { type: "iron_tools", durability: 100 } : null,
    skill: cfg.skill,
    homeLocation: startLocation,
    workLocation: cfg.workLocation,
    workSchedule: { open: 6, close: 21 },
  };
  state.action_feedback["player"] = [];
  state.acquaintances["player"] = [];
  state.player_created = true;

  emitSSE("player:created", {
    agent: "player",
    name,
    location: startLocation,
    wallet: cfg.startCoin,
    skill: cfg.skill,
  });
}

// ─── Process player turn ──────────────────────────────────────

export function processPlayerTurn(
  state: WorldState,
  time: SimTime,
): AgentTurnResult | null {
  if (!state.player_created || state.pending_player_actions.length === 0) return null;

  // Take first action only (fair vs NPCs)
  const action = state.pending_player_actions.shift() as AgentAction;

  const ctx = {
    agent: "player" as const,
    agentLocation: state.agent_locations["player"] ?? "Village Square",
    state,
    time,
    movedThisTick: new Set<"player">(),
  };

  const resolved = resolveAction(action, ctx);

  return {
    agent: "player",
    actions: [resolved],
    pendingMove: undefined,
  };
}

// ─── Body update ──────────────────────────────────────────────

export function updatePlayerBody(state: WorldState, time: SimTime): void {
  if (!state.player_created || !state.body["player"]) return;
  updateBodyState(state.body["player"], time);
}

// ─── Revive check ─────────────────────────────────────────────

export function checkPlayerRevive(state: WorldState, _tick: number): void {
  if (!state.player_created) return;
  const body = state.body["player"];
  if (!body) return;

  const starvation = body.starvation_ticks ?? 0;
  if (starvation >= 3) {
    const eco = state.economics["player"];
    const deduction = Math.min(10, eco?.wallet ?? 0);
    if (eco) eco.wallet = Math.max(0, eco.wallet - deduction);

    state.body["player"] = {
      hunger: 0,
      energy: 5,
      sleep_quality: "fair",
      starvation_ticks: 0,
    };
    state.agent_locations["player"] = "Healer's Hut";

    if (!state.action_feedback["player"]) state.action_feedback["player"] = [];
    state.action_feedback["player"].push(
      `You collapsed from hunger. Pater Markus nursed you back to health (-${deduction} coin).`
    );

    emitSSE("player:revived", {
      agent: "player",
      newWallet: eco?.wallet ?? 0,
    });
  }
}
