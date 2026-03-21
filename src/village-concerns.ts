import type { AgentName, WorldState } from "./types.js";
import { AGENT_NAMES, AGENT_DISPLAY_NAMES } from "./types.js";
import { isAgentDead } from "./body.js";

const FOOD_ITEMS = new Set(["bread", "meal", "meat", "vegetables", "eggs", "milk"]);

export function computeVillageConcerns(state: WorldState, currentTick: number): string[] {
  const concerns: string[] = [];
  const alive = AGENT_NAMES.filter(a => !isAgentDead(state.body[a]));

  // ── Broken tools ──────────────────────────────────────────
  const brokenTools = alive.filter(a => state.economics[a].tool?.durability === 0);
  if (brokenTools.length >= 2) {
    const names = brokenTools.map(a => AGENT_DISPLAY_NAMES[a]).join(", ");
    concerns.push(`[Village concern] ${brokenTools.length} villagers have broken tools and cannot produce: ${names}.`);
  }

  // ── Critical tools ────────────────────────────────────────
  const criticalTools = alive.filter(a => {
    const t = state.economics[a].tool;
    return t && t.durability > 0 && t.durability <= 20;
  });
  if (criticalTools.length >= 3) {
    concerns.push(`[Village concern] ${criticalTools.length} villagers have tools at ≤20% durability and will stop working soon.`);
  }

  // ── Hunger ───────────────────────────────────────────────
  const veryHungry = alive.filter(a => state.body[a].hunger >= 4);
  const hungry = alive.filter(a => state.body[a].hunger >= 3);
  if (veryHungry.length >= 2) {
    const names = veryHungry.map(a => AGENT_DISPLAY_NAMES[a]).slice(0, 5).join(", ");
    concerns.push(`[Village concern] ${veryHungry.length} villagers are dangerously hungry and risk starving: ${names}.`);
  } else if (hungry.length >= 3) {
    concerns.push(`[Village concern] ${hungry.length} villagers are going hungry.`);
  }

  // ── No food on market ────────────────────────────────────
  const foodOrders = state.marketplace.orders.filter(o => o.type === "sell" && FOOD_ITEMS.has(o.item) && o.quantity > 0);
  if (foodOrders.length === 0 && hungry.length >= 2) {
    concerns.push(`[Village concern] No food is listed on the marketplace — ${hungry.length} hungry villagers have nowhere to buy.`);
  }

  // ── Poverty ──────────────────────────────────────────────
  const poor = alive.filter(a => a !== "otto" && state.economics[a].wallet < 3);
  if (poor.length >= 3) {
    concerns.push(`[Village concern] ${poor.length} villagers have fewer than 3 coin and cannot afford basic necessities.`);
  }

  // ── Wealth concentration ─────────────────────────────────
  const nonOtto = alive.filter(a => a !== "otto");
  const totalWealth = nonOtto.reduce((s, a) => s + state.economics[a].wallet, 0);
  if (totalWealth > 30 && nonOtto.length > 0) {
    const richest = [...nonOtto].sort((a, b) => state.economics[b].wallet - state.economics[a].wallet)[0]!;
    const richestWallet = state.economics[richest].wallet;
    const pct = Math.round((richestWallet / totalWealth) * 100);
    if (pct >= 30) {
      concerns.push(`[Village concern] ${AGENT_DISPLAY_NAMES[richest]} holds ${pct}% of all village coin (${richestWallet}c of ${totalWealth}c total).`);
    }
  }

  // ── Recent petitions (past 1 in-game day = 16 ticks) ────
  const recentPetitions = (state.pending_petitions ?? []).filter(p => currentTick - p.tick <= 16);
  for (const p of recentPetitions) {
    concerns.push(`[Petition] ${AGENT_DISPLAY_NAMES[p.agent as AgentName]}: "${p.topic}"`);
  }

  return concerns;
}
