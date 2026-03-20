import type { ActiveEvent, AgentName, ItemType, WorldState } from "./types.js";
import { readAgentProfile, readAgentMemory } from "./memory.js";
import { AGENT_DISPLAY_NAMES, AGENT_NAMES } from "./types.js";
import { queueMessage } from "./messages.js";
import { addToInventory, removeFromInventory, feedbackToAgent } from "./inventory.js";
import { callClaude } from "./llm.js";
import { emitSSE } from "./events.js";

// ─── Farm item set ────────────────────────────────────────────

export const FARM_ITEMS = new Set<ItemType>([
  "wheat", "vegetables", "eggs", "milk", "meat", "herbs",
]);

const FARMER_AGENTS: AgentName[] = ["hans", "ulrich", "bertram", "konrad", "heinrich"];
const MINER_AGENTS: AgentName[] = ["dieter", "rupert"];

// ─── Production multiplier ────────────────────────────────────

export function getEventProductionMultiplier(
  item: ItemType,
  activeEvents: ActiveEvent[],
): number {
  let m = 1.0;
  for (const ev of activeEvents) {
    if (ev.type === "drought")        { if (FARM_ITEMS.has(item)) m *= 0.5; }
    if (ev.type === "mine_collapse")  { if (item === "iron_ore" || item === "coal") return 0; }
    if (ev.type === "double_harvest") { if (FARM_ITEMS.has(item)) m *= 2.0; }
  }
  return m;
}

// ─── Caravan cleanup ──────────────────────────────────────────

function cleanupCaravanStock(state: WorldState): void {
  const ottoInv = state.economics["otto"].inventory;
  const caravanItems: ItemType[] = ["wheat", "bread", "vegetables", "medicine", "cloth"];
  for (const item of caravanItems) {
    const entry = ottoInv.items.find(i => i.type === item);
    if (entry) {
      const unsold = entry.quantity - (entry.reserved ?? 0);
      if (unsold > 0) removeFromInventory(ottoInv, item, unsold);
    }
  }
  // Cancel open sell orders from otto for caravan items
  state.marketplace.orders = state.marketplace.orders.filter(
    o => !(o.agentId === "otto" && caravanItems.includes(o.item)),
  );
  // Move otto back to the village square
  state.agent_locations["otto"] = "Village Square";
}

// ─── Bandit theft ─────────────────────────────────────────────

const lastBanditTheftTick: Record<AgentName, number> = {} as Record<AgentName, number>;

function applyBanditTheft(state: WorldState, time: { tick: number }): void {
  if (Math.random() > 0.05) return; // 5% chance per tick

  for (const agent of AGENT_NAMES) {
    const lastTick = lastBanditTheftTick[agent] ?? -999;
    if (time.tick - lastTick < 8) continue; // once per 8 ticks per agent

    const eco = state.economics[agent];
    const items = eco.inventory.items.filter(i => i.quantity > (i.reserved ?? 0));
    if (items.length === 0) continue;

    if (Math.random() < 0.15) { // 15% chance per agent when bandits are active
      const target = items[Math.floor(Math.random() * items.length)]!;
      const stolen = Math.max(1, Math.floor((target.quantity - (target.reserved ?? 0)) * 0.3));
      target.quantity -= stolen;
      if (target.quantity <= 0) eco.inventory.items = eco.inventory.items.filter(i => i !== target);

      lastBanditTheftTick[agent] = time.tick;
      state.action_feedback[agent] ??= [];
      state.action_feedback[agent]!.push(`Bandits stole ${stolen} ${target.type} from you!`);
      break; // only one theft per tick total
    }
  }
}

// ─── Location-aware event feedback ───────────────────────────

function injectLocationEventFeedback(state: WorldState, time: { tick: number }): void {
  for (const ev of state.active_events) {
    if (ev.startTick !== time.tick) continue; // only on the first tick of the event

    const agentsAt = (loc: string): AgentName[] =>
      AGENT_NAMES.filter(a => state.agent_locations[a] === loc);

    switch (ev.type) {
      case "drought":
        for (const farm of ["Farm 1", "Farm 2", "Farm 3"]) {
          for (const a of agentsAt(farm)) {
            feedbackToAgent(a, state, "The fields are parched — drought has cut yields in half. Consider finding other work until it passes.");
          }
        }
        break;
      case "double_harvest":
        for (const farm of ["Farm 1", "Farm 2", "Farm 3"]) {
          for (const a of agentsAt(farm)) {
            feedbackToAgent(a, state, "The fields are bursting with life! A miraculous double harvest — your yields are doubled today.");
          }
        }
        break;
      case "mine_collapse":
        for (const a of agentsAt("Mine")) {
          feedbackToAgent(a, state, "The mine just collapsed around you! Get out immediately and find other work while it is shored up.");
        }
        break;
      case "caravan":
        for (const a of agentsAt("Village Square")) {
          feedbackToAgent(a, state, "A merchant caravan has arrived right here in the square! Cheap goods are available — spread the word.");
        }
        break;
      // plague_rumor and bandit_threat already broadcast via queueMessage to all agents from trigger functions
    }
  }
}

// ─── Tick lifecycle ───────────────────────────────────────────

export function tickGodModeEvents(state: WorldState, time: { tick: number }): void {
  if (state.active_events.length === 0) return;
  const stillActive: ActiveEvent[] = [];
  for (const ev of state.active_events) {
    if (ev.endTick <= time.tick) {
      if (ev.type === "caravan") cleanupCaravanStock(state);
      emitSSE("event:expired", { eventType: ev.type });
    } else {
      stillActive.push(ev);
    }
  }
  state.active_events = stillActive;

  if (state.active_events.some(e => e.type === "bandit_threat")) {
    applyBanditTheft(state, time);
  }

  injectLocationEventFeedback(state, time);
}

// ─── Event triggers ───────────────────────────────────────────

export function triggerDrought(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "drought",
    description: "A severe drought has struck Brunnfeld. Farm yields are halved.",
    startTick: tick,
    endTick: tick + 48,
  };
  state.active_events.push(ev);

  for (const a of FARMER_AGENTS) {
    queueMessage(state, "otto", a, "The fields are parched. The drought will halve our harvest for the next three days.", tick);
  }
  return ev;
}

export function triggerCaravan(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "caravan",
    description: "A merchant caravan has arrived with cheap goods for one day.",
    startTick: tick,
    endTick: tick + 16,
  };
  state.active_events.push(ev);

  const priceIndex = state.marketplace.priceIndex;
  const PRICE_FLOORS: Partial<Record<ItemType, number>> = {
    wheat: 3, bread: 5, vegetables: 2, medicine: 8, cloth: 6,
  };

  const caravanGoods: { item: ItemType; qty: number }[] = [
    { item: "wheat",      qty: 8 },
    { item: "bread",      qty: 6 },
    { item: "vegetables", qty: 5 },
    { item: "medicine",   qty: 2 },
    { item: "cloth",      qty: 2 },
  ];

  const ottoInv = state.economics["otto"].inventory;

  for (const { item, qty } of caravanGoods) {
    addToInventory(ottoInv, item, qty, tick);
    const basePrice = priceIndex[item] ?? PRICE_FLOORS[item] ?? 5;
    const price = Math.max(1, Math.floor(basePrice * 0.7));

    state.marketplace.orders.push({
      id: `caravan_${item}_${tick}`,
      agentId: "otto",
      type: "sell",
      item,
      quantity: qty,
      price,
      postedTick: tick,
      expiresAtTick: tick + 16,
    });
  }

  // Move otto to the merchant camp for the duration
  state.agent_locations["otto"] = "Merchant Camp";

  queueMessage(state, "otto", "liesel", "A merchant caravan has set up camp near the village square! Go tell the villagers of the cheap goods available today.", tick);
  return ev;
}

export function triggerMineCollapse(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "mine_collapse",
    description: "The mine has partially collapsed! Ore production is blocked for 2 days.",
    startTick: tick,
    endTick: tick + 32,
  };
  state.active_events.push(ev);

  for (const miner of MINER_AGENTS) {
    queueMessage(state, "otto", miner, "The mine has collapsed! Do not attempt to enter until it is shored up. No ore extraction for two days.", tick);
  }
  return ev;
}

export function triggerDoubleHarvest(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "double_harvest",
    description: "A miraculous double harvest — farm yields are doubled today!",
    startTick: tick,
    endTick: tick + 16,
  };
  state.active_events.push(ev);

  for (const a of FARMER_AGENTS) {
    queueMessage(state, "otto", a, "God has blessed us with a bountiful harvest today! Your yields will be doubled.", tick);
  }
  return ev;
}

export function triggerPlagueRumor(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "plague_rumor",
    description: "Plague rumors spread through the village. Demand for medicine has surged.",
    startTick: tick,
    endTick: tick + 32,
  };
  state.active_events.push(ev);

  for (const agent of AGENT_NAMES) {
    queueMessage(state, "otto", agent, "Word has reached the village: plague spotted in a nearby town. Stock up on medicine if you can.", tick);
  }
  return ev;
}

export function triggerBanditThreat(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "bandit_threat",
    description: "Bandits are reported nearby. There is a risk of theft for 2 days.",
    startTick: tick,
    endTick: tick + 32,
  };
  state.active_events.push(ev);

  for (const agent of AGENT_NAMES) {
    queueMessage(state, "otto", agent, "Bandits have been spotted on the roads near Brunnfeld. Keep your valuables safe.", tick);
  }
  return ev;
}

// ─── Location access blocking ─────────────────────────────────

export function isLocationBlockedByEvent(
  loc: string,
  activeEvents: ActiveEvent[],
): string | null {
  if (loc === "Mine" && activeEvents.some(e => e.type === "mine_collapse")) {
    return `[Can't go there] The mine has collapsed and is unsafe to enter. Wait until it is shored up.`;
  }
  if (loc === "Merchant Camp" && !activeEvents.some(e => e.type === "caravan")) {
    return `[Can't go there] There is no merchant caravan at the camp right now.`;
  }
  return null;
}

// ─── Dispatch by event type ───────────────────────────────────

export function triggerEvent(
  eventType: string,
  state: WorldState,
  tick: number,
): ActiveEvent | null {
  switch (eventType) {
    case "drought":        return triggerDrought(state, tick);
    case "caravan":        return triggerCaravan(state, tick);
    case "mine_collapse":  return triggerMineCollapse(state, tick);
    case "double_harvest": return triggerDoubleHarvest(state, tick);
    case "plague_rumor":   return triggerPlagueRumor(state, tick);
    case "bandit_threat":  return triggerBanditThreat(state, tick);
    default: return null;
  }
}

// ─── Interview ────────────────────────────────────────────────

export async function runInterview(
  agent: AgentName,
  question: string,
  state: WorldState,
  onChunk: (s: string) => void,
): Promise<void> {
  const profile = readAgentProfile(agent);
  const memory = readAgentMemory(agent);
  const eco = state.economics[agent];
  const body = state.body[agent];
  const name = AGENT_DISPLAY_NAMES[agent];

  const prompt = `You are ${name}, a villager in Brunnfeld.
${profile}
${memory}
---
Current situation: ${state.agent_locations[agent]}, wallet: ${eco.wallet} coin,
hunger: ${body.hunger}/5, season: ${state.season} day ${state.day_of_season}/7.
Active village events: ${state.active_events.map(e => e.description).join("; ") || "none"}

A curious visitor asks you: "${question}"
Answer in character as ${name} (2-4 sentences). Do not break character.`;

  await callClaude(prompt, {
    model: process.env.INTERVIEW_MODEL ?? "haiku",
    onChunk,
  });
}
