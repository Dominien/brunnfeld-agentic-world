import type { AgentAction, AgentName, AgentTurnResult, ItemType, WorldState, SimTime } from "./types.js";
import { AGENT_DISPLAY_NAMES, AGENT_NAMES } from "./types.js";
import { callClaudeJSON } from "./llm.js";
import { emitSSE } from "./events.js";
import { readAgentProfile, readAgentMemory } from "./memory.js";
import { getInventoryQty, getReserved } from "./inventory.js";
import { getRelevantOrders } from "./marketplace.js";
import { getToolPerception } from "./tools-degradation.js";
import { bodyPerception } from "./body.js";
import { ACTION_SCHEMA_PROMPT, resolveAction, type ResolveContext } from "./tools.js";
import { LOCATIONS } from "./village-map.js";
import { RECIPES, MULTI_FARM_ITEMS } from "./production.js";

// ─── Hunger food hint ─────────────────────────────────────────

const EDIBLE_ITEMS = new Set<string>(["bread", "meal", "meat", "vegetables", "eggs", "milk"]);

// Static food specialist knowledge — every villager knows these people have food
const FOOD_SPECIALISTS: { agent: AgentName; items: string[]; location: string; hours: string }[] = [
  { agent: "anselm",  items: ["bread"],        location: "Bakery",  hours: "6–13" },
  { agent: "liesel",  items: ["ale", "meal"],  location: "Tavern",  hours: "10–21" },
  { agent: "konrad",  items: ["milk", "meat"], location: "Farm 2",  hours: "6–15" },
];

function getHungryNoFoodHint(agent: AgentName, state: WorldState): string {
  const body = state.body[agent];
  if (body.hunger < 2) return "";

  const eco = state.economics[agent];
  const hasFood = eco.inventory.items.some(
    i => EDIBLE_ITEMS.has(i.type) && (i.quantity - (i.reserved ?? 0)) > 0
  );
  if (hasFood) return "";

  // Check for raw grain that can't be eaten directly
  const rawGrainHints: string[] = [];
  const wheatQty = eco.inventory.items.find(i => i.type === "wheat")?.quantity ?? 0;
  const flourQty = eco.inventory.items.find(i => i.type === "flour")?.quantity ?? 0;
  if (wheatQty > 0) rawGrainHints.push("wheat (needs milling → baking before it's edible)");
  if (flourQty > 0) rawGrainHints.push("flour (needs baking before it's edible)");
  const rawGrainNote = rawGrainHints.length > 0
    ? `You have ${rawGrainHints.join(" and ")} — not edible raw. Buy bread instead.\n `
    : "";

  const foodOrders = state.marketplace.orders
    .filter(o => o.type === "sell" && EDIBLE_ITEMS.has(o.item) && o.quantity > 0)
    .sort((a, b) => a.price - b.price);

  if (foodOrders.length > 0) {
    const cheapest = foodOrders[0]!;
    const seller = AGENT_DISPLAY_NAMES[cheapest.agentId as AgentName] ?? cheapest.agentId;
    const canAfford = eco.wallet >= cheapest.price;
    const affordNote = canAfford
      ? ""
      : ` (you have ${eco.wallet}c — short by ${cheapest.price - eco.wallet}c)`;
    return `(${rawGrainNote}No food in inventory — you need to eat soon.\n Buy ${cheapest.item} at Village Square: ${cheapest.price}c from ${seller}. Use: buy_item.${affordNote})`;
  }

  // No market food — inject specialist knowledge
  const specialistLines = FOOD_SPECIALISTS
    .filter(s => s.agent !== agent)
    .map(s => {
      const currentLoc = state.agent_locations[s.agent];
      const locNote = currentLoc === s.location
        ? `currently at ${s.location}`
        : `away at ${currentLoc}`;
      return ` • ${AGENT_DISPLAY_NAMES[s.agent]} (${s.items.join(", ")}) — ${s.location} ${s.hours}, ${locNote}`;
    });

  return `(${rawGrainNote}No food in inventory and nothing at the marketplace. Known food sources:\n${specialistLines.join("\n")}\n Go there or use send_message to request they post a sell order.)`;
}

// ─── Location keeper note ─────────────────────────────────────

const SPECIALIST_SKILLS = new Set<string>(["miller", "baker", "tavern", "blacksmith", "carpenter", "healer", "seamstress"]);

function getLocationKeeperNote(agent: AgentName, state: WorldState): string {
  const location = state.agent_locations[agent];
  for (const a of AGENT_NAMES) {
    if (a === agent) continue;
    const aEco = state.economics[a];
    if (aEco.workLocation !== location) continue;
    if (!SPECIALIST_SKILLS.has(aEco.skill)) continue;
    // This is a specialist's work location
    if (state.agent_locations[a] !== location) {
      const keeperName = AGENT_DISPLAY_NAMES[a];
      const keeperLoc = state.agent_locations[a];
      return `(This is ${keeperName}'s ${location}. ${keeperName} is currently at ${keeperLoc}. Use send_message to ${keeperName} to arrange a purchase, or check the Village Square marketplace.)`;
    }
    return ""; // Keeper is present — already listed in "Others here"
  }
  return "";
}

// ─── Surplus food hint ────────────────────────────────────────

function getSurplusFoodHint(agent: AgentName, state: WorldState): string {
  const eco = state.economics[agent];
  const surplusItems: string[] = [];

  for (const inv of eco.inventory.items) {
    if (!EDIBLE_ITEMS.has(inv.type)) continue;
    const available = inv.quantity - (inv.reserved ?? 0);
    if (available <= 2) continue;
    const hasOrder = state.marketplace.orders.some(
      o => o.agentId === agent && o.type === "sell" && o.item === inv.type
    );
    if (!hasOrder) surplusItems.push(`${available} ${inv.type}`);
  }

  if (surplusItems.length === 0) return "";

  const hungryNames = AGENT_NAMES
    .filter(a => a !== agent && state.body[a].hunger >= 3 && (state.body[a].starvation_ticks ?? 0) < 999)
    .slice(0, 2)
    .map(a => AGENT_DISPLAY_NAMES[a]);

  const hungryNote = hungryNames.length > 0
    ? ` ${hungryNames.join(" and ")} ${hungryNames.length === 1 ? "appears" : "appear"} to be hungry.`
    : "";

  return `(Surplus: ${surplusItems.join(", ")} with no sell order. Post a sell order at Village Square to earn coin.${hungryNote})`;
}

// ─── Loan perception ──────────────────────────────────────────

function getLoanPerception(agent: AgentName, state: WorldState): string {
  if (!state.loans || state.loans.length === 0) return "";

  const activeLoans = state.loans.filter(l => !l.repaid);
  const owed = activeLoans.filter(l => l.creditor === agent);
  const owes = activeLoans.filter(l => l.debtor === agent);

  if (owed.length === 0 && owes.length === 0) return "";

  const parts: string[] = [];
  for (const loan of owed) {
    const dueDay = Math.ceil(loan.dueTick / 16);
    parts.push(`You are owed ${loan.amount}c by ${AGENT_DISPLAY_NAMES[loan.debtor]} (due day ${dueDay}).`);
  }
  for (const loan of owes) {
    const dueDay = Math.ceil(loan.dueTick / 16);
    parts.push(`You owe ${loan.amount}c to ${AGENT_DISPLAY_NAMES[loan.creditor]} (due day ${dueDay}).`);
  }

  return `\nLoans: ${parts.join(" ")}`;
}

// ─── Perception builder ──────────────────────────────────────

function buildInventoryLines(agent: AgentName, state: WorldState): string {
  const eco = state.economics[agent];
  const lines = eco.inventory.items
    .filter(i => i.quantity > 0)
    .map(i => {
      const available = i.quantity - (i.reserved ?? 0);
      const reservedNote = (i.reserved ?? 0) > 0 ? ` (${i.reserved} reserved)` : "";
      const spoilNote = i.spoilsAtTick && i.spoilsAtTick - state.current_tick < 32 ? " [spoils soon]" : "";
      return `${i.type} ×${available}${reservedNote}${spoilNote}`;
    });
  return lines.length > 0 ? lines.join(", ") : "empty";
}

function buildMarketboardLines(agent: AgentName, state: WorldState): string {
  const orders = getRelevantOrders(agent, state);
  if (orders.length === 0) return "  (no current orders)";
  return orders
    .map(o => o.type === "sell"
      ? `  SELL: ${o.item} ×${o.quantity} at ${o.price}c (by ${AGENT_DISPLAY_NAMES[o.agentId as AgentName] || o.agentId}, expires in ${o.expiresAtTick - state.current_tick} ticks)`
      : `  WANT: ${o.item} ×${o.quantity}, paying up to ${o.price}c (${AGENT_DISPLAY_NAMES[o.agentId as AgentName] || o.agentId})`
    )
    .join("\n");
}

function getProducibleBlock(agent: AgentName, state: WorldState): string {
  const eco = state.economics[agent];
  const location = state.agent_locations[agent];
  const lines: string[] = [];

  for (const [itemKey, recipe] of Object.entries(RECIPES)) {
    if (recipe.skill !== eco.skill) continue;
    const validLocations = MULTI_FARM_ITEMS[itemKey] ?? [recipe.location];
    if (!validLocations.includes(location)) continue;

    const outputStr = Object.entries(recipe.output).map(([k, v]) => `${v} ${k}`).join(", ");

    if (recipe.tool && (!eco.tool || eco.tool.durability <= 0)) {
      lines.push(`- produce "${itemKey}" → ${outputStr} [needs tools — yours are broken or missing]`);
      continue;
    }

    const missing: string[] = [];
    for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
      const have = getInventoryQty(eco.inventory, inputItem as ItemType);
      if (have < qty) missing.push(`${inputItem} (need ${qty}, have ${have})`);
    }

    if (missing.length === 0) {
      lines.push(`- produce "${itemKey}" → ${outputStr} [ready now]`);
    } else {
      lines.push(`- produce "${itemKey}" → ${outputStr} [missing: ${missing.join(", ")}]`);
    }
  }

  if (lines.length === 0) return "";
  return `\nYou can produce here:\n${lines.join("\n")}`;
}

export function buildPerception(
  agent: AgentName,
  state: WorldState,
  time: SimTime,
  conversationSoFar: string,
  otherAgentsPresent: string[],
  pendingMessages: string,
  sounds: string[],
): string {
  const eco = state.economics[agent];
  const body = state.body[agent];
  const location = state.agent_locations[agent];

  const bodyNote = bodyPerception(body);
  const hungryHint = getHungryNoFoodHint(agent, state);
  const surplusHint = getSurplusFoodHint(agent, state);
  const keeperNote = getLocationKeeperNote(agent, state);
  const loanPerception = getLoanPerception(agent, state);
  const inventoryLines = buildInventoryLines(agent, state);
  const toolLine = getToolPerception(agent, state);
  const producibleBlock = getProducibleBlock(agent, state);
  const marketboardLines = buildMarketboardLines(agent, state);

  const othersStr = otherAgentsPresent.length > 0
    ? `Others here: ${otherAgentsPresent.join(", ")}.`
    : "You are alone here.";

  const soundsStr = sounds.length > 0
    ? `Sounds: ${sounds.join(" ")}`
    : "";

  const hiredNote = eco.hiredBy
    ? `\nYou are hired by ${AGENT_DISPLAY_NAMES[eco.hiredBy as AgentName]} today. Produce goods for them.`
    : "";

  const laborerNote = (() => {
    for (const a of AGENT_NAMES) {
      if (state.economics[a].hiredBy === agent) {
        return `\n${AGENT_DISPLAY_NAMES[a]} is working for you today.`;
      }
    }
    return "";
  })();

  const feedback = (state.action_feedback[agent] ?? []).join("\n");

  const activeEvents = state.active_events.length > 0
    ? `\nVillage events: ${state.active_events.map(e => e.description).join("; ")}`
    : "";

  return `You are ${AGENT_DISPLAY_NAMES[agent]}.
Location: ${location}. ${time.timeLabel}. ${time.season.charAt(0).toUpperCase() + time.season.slice(1)}, day ${time.seasonDay}/7.
Weather: ${state.weather}${activeEvents}

${othersStr}${soundsStr ? "\n" + soundsStr : ""}${keeperNote ? "\n" + keeperNote : ""}
${bodyNote ? bodyNote + "\n" : ""}${hungryHint ? hungryHint + "\n" : ""}
Inventory: ${inventoryLines}
${surplusHint ? surplusHint + "\n" : ""}Wallet: ${eco.wallet} coin${loanPerception}
Tools: ${toolLine}${hiredNote}${laborerNote}${producibleBlock}

Marketplace board:
${marketboardLines}

${pendingMessages ? `Messages:\n${pendingMessages}\n` : ""}${feedback ? `Last tick feedback:\n${feedback}\n` : ""}${conversationSoFar ? `\nConversation so far:\n${conversationSoFar}\n` : ""}`.trim();
}

// ─── Prompt builder ───────────────────────────────────────────

function buildPrompt(agent: AgentName, perception: string): string {
  const name = AGENT_DISPLAY_NAMES[agent];
  const profile = readAgentProfile(agent);
  const memory = readAgentMemory(agent);

  return `You are ${name}.

${profile}

Locations in the village: ${[...LOCATIONS].join(", ")}

${memory}

---

${perception}

${ACTION_SCHEMA_PROMPT}`;
}

// ─── Run single agent turn ────────────────────────────────────

export async function runAgentTurn(
  agent: AgentName,
  perception: string,
  context: ResolveContext,
): Promise<AgentTurnResult> {
  const model = process.env.CHARACTER_MODEL || "haiku";
  const prompt = buildPrompt(agent, perception);
  const name = AGENT_DISPLAY_NAMES[agent];

  // Emit "agent is thinking" to frontend
  emitSSE("agent:thinking", { agent, name });
  process.stdout.write(`\n  ✦ ${name}: `);

  let response: { actions: AgentAction[] };
  try {
    response = await callClaudeJSON<{ actions: AgentAction[] }>(prompt, {
      model,
      onChunk: (chunk) => {
        process.stdout.write(chunk);
        emitSSE("agent:stream", { agent, name, chunk });
      },
    });
  } catch (err) {
    process.stdout.write("\n");
    emitSSE("agent:stream", { agent, name, chunk: "" });  // clear stream
    console.error(`  LLM error for ${agent}: ${err}. Defaulting to wait.`);
    return { agent, actions: [{ type: "wait", result: "", visible: false }], pendingMove: undefined };
  }
  process.stdout.write("\n");
  emitSSE("agent:stream", { agent, name, chunk: "" });  // signal stream done

  const actions = (response.actions || []).map(action => resolveAction(action, context));
  if (actions.length === 0) actions.push(resolveAction({ type: "wait" }, context));

  // Emit move actions immediately so the map animates in real-time
  for (const action of actions) {
    if (action.type === "move_to" && action.visible && action.result) {
      emitSSE("agent:action", { agent, name, actionType: action.type, text: action.text, result: action.result, location: action.location });
    }
  }

  const pendingMove = actions.find(a => a.type === "move_to")?.location;
  return { agent, actions, pendingMove };
}

// ─── Batched parallel execution ────────────────────────────────

export async function runBatchedAgents(
  agents: AgentName[],
  perceptions: Record<AgentName, string>,
  state: WorldState,
  time: SimTime,
  batchSize = 5,
  movedThisTick?: Set<AgentName>,
): Promise<AgentTurnResult[]> {
  const results: AgentTurnResult[] = [];

  for (let i = 0; i < agents.length; i += batchSize) {
    const batch = agents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(agent => {
        const context: ResolveContext = {
          agent,
          agentLocation: state.agent_locations[agent],
          state,
          time,
          movedThisTick,
        };
        return runAgentTurn(agent, perceptions[agent]!, context);
      })
    );
    results.push(...batchResults);
  }

  return results;
}
