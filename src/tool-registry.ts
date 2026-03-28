import type { AgentAction, AgentName, ItemType, ResolvedAction, WorldState, SimTime } from "./types.js";
import type { LocationContext, NegotiationOffer } from "./location-context.js";
import { readAgentMemory } from "./memory.js";
import { getInventoryQty, removeFromInventory, addToInventory, feedbackToAgent } from "./inventory.js";
import { getDisplayName, getAgentVillage, getVillages, getVillageForLocation, getLocationType } from "./world-registry.js";
import { getAgentMarketplace } from "./marketplace.js";
import { resolveAction, type ResolveContext } from "./tools.js";
import { getProducibleItems, MULTI_FARM_ITEMS } from "./production.js";
import { emitSSE } from "./events.js";
import { getSounds } from "./sounds.js";

// ─── Types ───────────────────────────────────────────────────

export interface ToolResult {
  text: string;
  isInteraction: boolean; // true → harness yields so co-located agents can react
  pendingMove?: string;
  executedAction?: ResolvedAction;
}

export interface HarnessToolConfig {
  agentId: AgentName;
  worldState: WorldState;
  locationCtx: LocationContext;
  time: SimTime;
  movedThisTick: Set<AgentName>;
  executedActions: ResolvedAction[]; // mutated by handlers
  lastTickActions: Record<AgentName, ResolvedAction[]>;
}

export interface ToolDef {
  name: string;
  description: string;
  argsHint: string; // shown in LLM prompt
}

// ─── Helpers ─────────────────────────────────────────────────

function currentLocation(config: HarnessToolConfig): string {
  return config.worldState.agent_locations[config.agentId] ?? "unknown";
}

function makeContext(config: HarnessToolConfig): ResolveContext {
  return {
    agent: config.agentId,
    agentLocation: currentLocation(config),
    state: config.worldState,
    time: config.time,
    movedThisTick: config.movedThisTick,
  };
}

// ─── Observation tool handlers ────────────────────────────────

function handleLookAround(_args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const { agentId, worldState, locationCtx, lastTickActions } = config;
  const loc = currentLocation(config);

  const presentAgents = Object.entries(worldState.agent_locations)
    .filter(([a, l]) => a !== agentId && l === loc)
    .map(([a]) => `${getDisplayName(a)} (${worldState.economics[a]?.skill ?? "unknown"})`);

  const lines: string[] = [];
  lines.push(presentAgents.length > 0
    ? `People here: ${presentAgents.join(", ")}`
    : "You are alone here.");

  if (locationCtx.speechLog.length > 0) {
    lines.push("Recent speech:");
    for (const entry of locationCtx.speechLog.slice(-6)) {
      lines.push(`  ${entry.name}: "${entry.text}"`);
    }
  }

  if (locationCtx.visibleActions.length > 0) {
    lines.push("Visible:");
    for (const a of locationCtx.visibleActions.slice(-4)) {
      lines.push(`  ${a.name} is ${a.summary}`);
    }
  }

  if (locationCtx.negotiationOffers.length > 0) {
    lines.push("Active offers:");
    for (const o of locationCtx.negotiationOffers) {
      lines.push(`  ${o.fromName} offers ${o.qty}x ${o.item} @ ${o.price}c to ${getDisplayName(o.to)}`);
    }
  }

  // Sounds from adjacent locations (last tick's actions)
  const sounds = getSounds(agentId, loc, lastTickActions, worldState.agent_locations);
  if (sounds.length > 0) lines.push("Sounds: " + sounds.join(" "));

  // Objects at this location (notices, letters, notes)
  const objects = (worldState.objects ?? []).filter(o =>
    o.location === loc &&
    (o.visibility === "shared" || o.recipient === agentId || o.discovered_by.includes(agentId))
  );
  if (objects.length > 0) {
    lines.push("Objects here:");
    for (const obj of objects.slice(0, 3)) {
      lines.push(`  [${obj.type}] ${obj.label}: ${obj.content.slice(0, 60)}`);
    }
  }

  // Sell orders visible at marketplace locations
  const isMarket = loc === "Village Square" || loc === "Marketplace" || loc.endsWith(":Village Square");
  if (isMarket) {
    const mkt = getAgentMarketplace(agentId, worldState);
    const topOrders = mkt.orders
      .filter(o => o.type === "sell" && o.agentId !== agentId)
      .sort((a, b) => a.price - b.price)
      .slice(0, 5);
    if (topOrders.length > 0) {
      lines.push("Sell orders here:");
      for (const o of topOrders) lines.push(`  ${o.quantity}x ${o.item} @ ${o.price}c`);
    }
  }

  return { text: lines.join("\n"), isInteraction: false };
}

function handleCheckInventory(_args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const eco = config.worldState.economics[config.agentId];
  if (!eco) return { text: "No economic data.", isInteraction: false };

  const lines = [`Wallet: ${eco.wallet} coin`];
  if (eco.inventory.items.length === 0) {
    lines.push("Inventory: empty");
  } else {
    lines.push("Inventory:");
    for (const item of eco.inventory.items) {
      const avail = item.quantity - (item.reserved ?? 0);
      const res = (item.reserved ?? 0) > 0 ? ` (${item.reserved} reserved)` : "";
      const spoil = item.spoilsAtTick ? ` [spoils t${item.spoilsAtTick}]` : "";
      lines.push(`  ${item.type}: ${item.quantity} (${avail} free)${res}${spoil}`);
    }
  }
  if (eco.tool) lines.push(`Tool: ${eco.tool.type} ${eco.tool.durability}%`);
  if (eco.hiredBy) lines.push(`Employed by: ${getDisplayName(eco.hiredBy)} (until tick ${eco.hiredUntilTick ?? "?"})`);

  return { text: lines.join("\n"), isInteraction: false };
}

function handleCheckPrices(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const item = args.item as string | undefined;
  if (!item) return { text: 'Specify item. Example: {"item": "flour"}', isInteraction: false };

  const mkt = getAgentMarketplace(config.agentId, config.worldState);
  const acquaintances = config.worldState.acquaintances[config.agentId] ?? [];
  const priceIdx = mkt.priceIndex[item as ItemType];

  const lines = [`${item} prices:`];
  if (priceIdx) lines.push(`  Index: ${priceIdx} coin`);

  const sells = mkt.orders
    .filter(o => o.type === "sell" && o.item === item && o.agentId !== config.agentId)
    .sort((a, b) => a.price - b.price);

  if (sells.length > 0) {
    lines.push("  Sell orders:");
    for (const o of sells.slice(0, 3)) {
      const name = acquaintances.includes(o.agentId) ? getDisplayName(o.agentId) : "someone";
      lines.push(`    ${o.quantity}x @ ${o.price}c (from ${name})`);
    }
  } else {
    lines.push("  No sell orders.");
  }

  const recent = (mkt.history ?? []).filter(t => t.item === item).slice(-3);
  if (recent.length > 0) {
    const avg = Math.round(recent.reduce((s, t) => s + t.pricePerUnit, 0) / recent.length);
    lines.push(`  Recent avg: ${avg}c`);
  }

  return { text: lines.join("\n"), isInteraction: false };
}

function handleCheckBody(_args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const body = config.worldState.body[config.agentId];
  if (!body) return { text: "No body data.", isInteraction: false };

  const hungerLabels = ["full", "satisfied", "peckish", "hungry", "very hungry", "starving"];
  const energyLabel = body.energy >= 8 ? "great" : body.energy >= 5 ? "good" : body.energy >= 3 ? "tired" : "exhausted";

  const lines = [
    `Hunger: ${body.hunger}/5 — ${hungerLabels[body.hunger] ?? "unknown"}`,
    `Energy: ${body.energy}/10 — ${energyLabel}`,
    `Sleep: ${body.sleep_quality}`,
  ];
  if (body.sickness) lines.push(`Sick (severity ${body.sickness})`);
  if (body.injury) lines.push(`Injured (severity ${body.injury})`);

  return { text: lines.join("\n"), isInteraction: false };
}

function handleRecall(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const topic = ((args.topic as string) ?? "").toLowerCase().trim();
  if (!topic) return { text: 'Specify topic. Example: {"topic": "wheat"}', isInteraction: false };

  let memory: string;
  try { memory = readAgentMemory(config.agentId); } catch {
    return { text: "No memory found.", isInteraction: false };
  }

  const relevant = memory.split("\n")
    .filter(l => l.toLowerCase().includes(topic))
    .slice(0, 8);

  if (relevant.length === 0) return { text: `Nothing in memory about "${topic}".`, isInteraction: false };
  return { text: `Memory (${topic}):\n${relevant.join("\n")}`, isInteraction: false };
}

function handleAssessPerson(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const name = ((args.name as string) ?? "").toLowerCase().trim();
  if (!name) return { text: 'Specify name. Example: {"name": "Anselm"}', isInteraction: false };

  const acquaintances = config.worldState.acquaintances[config.agentId] ?? [];
  const all = Object.keys(config.worldState.economics);
  const target = all.find(
    a => getDisplayName(a).toLowerCase() === name || a.toLowerCase() === name
  );

  if (!target) return { text: `Don't know anyone named "${name}".`, isInteraction: false };
  if (!acquaintances.includes(target)) {
    return { text: `Haven't met ${getDisplayName(target)} yet.`, isInteraction: false };
  }

  const eco = config.worldState.economics[target];
  const lines = [
    `${getDisplayName(target)}:`,
    `  Skill: ${eco?.skill ?? "unknown"} | Works at: ${eco?.workLocation ?? "unknown"}`,
  ];

  try {
    const mem = readAgentMemory(config.agentId);
    const peopleSection = mem.split("## People")[1]?.split("##")[0] ?? "";
    const personLines = peopleSection.split("\n")
      .filter(l => l.toLowerCase().includes(name) || l.toLowerCase().includes(getDisplayName(target).toLowerCase()))
      .slice(0, 3);
    if (personLines.length > 0) {
      lines.push("  From memory:");
      personLines.forEach(l => lines.push(`  ${l.trim()}`));
    }
  } catch { /* no memory */ }

  return { text: lines.join("\n"), isInteraction: false };
}

// ─── Interaction tool handlers ────────────────────────────────

function handleSpeak(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const text = ((args.text as string) ?? "").trim();
  if (!text) return { text: "[Can't speak] No text provided.", isInteraction: false };

  const resolved = resolveAction({ type: "speak", text }, makeContext(config));

  if (resolved.visible) {
    // Update shared location context so co-located harnesses see this speech via look_around()
    config.locationCtx.speechLog.push({
      agentId: config.agentId,
      name: getDisplayName(config.agentId),
      text,
    });
    // SSE emission is handled post-tick by the engine (same as current behavior)
  }

  config.executedActions.push(resolved);
  return { text: resolved.result || "[Spoke]", isInteraction: true, executedAction: resolved };
}

function handleNegotiate(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const targetName = ((args.agent as string) ?? "").toLowerCase();
  const item = (args.item as string) ?? "";
  const price = Number(args.price ?? 0);
  const qty = Number(args.qty ?? args.quantity ?? 1);

  const all = Object.keys(config.worldState.economics);
  const target = all.find(
    a => getDisplayName(a).toLowerCase() === targetName || a.toLowerCase() === targetName
  ) as AgentName | undefined;

  if (!target) {
    return { text: `[Can't negotiate] No agent named "${args.agent}".`, isInteraction: false };
  }

  // Check if a matching counter-offer from target already exists — if so, execute the trade
  const matchIdx = config.locationCtx.negotiationOffers.findIndex(o =>
    o.from === target &&
    o.to === config.agentId &&
    o.item === item &&
    o.qty === qty
  );

  if (matchIdx !== -1) {
    const matched = config.locationCtx.negotiationOffers[matchIdx]!;
    const tradePrice = matched.price; // settle at original offer price
    const agentEco = config.worldState.economics[config.agentId];
    const targetEco = config.worldState.economics[target];
    const agentHas = getInventoryQty(agentEco.inventory, item as ItemType) >= qty;
    const targetHas = getInventoryQty(targetEco.inventory, item as ItemType) >= qty;

    let seller: AgentName, sellerEco: typeof agentEco, buyerEco: typeof agentEco;
    if (targetHas) {
      seller = target; sellerEco = targetEco; buyerEco = agentEco;
    } else if (agentHas) {
      seller = config.agentId; sellerEco = agentEco; buyerEco = targetEco;
    } else {
      config.locationCtx.negotiationOffers.splice(matchIdx, 1);
      return { text: `[Negotiate] Deal agreed but neither party has ${qty}x ${item}.`, isInteraction: true };
    }
    const buyer = seller === target ? config.agentId : target;
    const totalCost = tradePrice * qty;

    if (buyerEco.wallet < totalCost) {
      config.locationCtx.negotiationOffers.splice(matchIdx, 1);
      return { text: `[Negotiate] Deal agreed but ${getDisplayName(buyer)} can't afford ${totalCost}c.`, isInteraction: true };
    }

    removeFromInventory(sellerEco.inventory, item as ItemType, qty);
    addToInventory(buyerEco.inventory, item as ItemType, qty, config.time.tick);
    sellerEco.wallet += totalCost;
    buyerEco.wallet -= totalCost;
    config.locationCtx.negotiationOffers.splice(matchIdx, 1);

    feedbackToAgent(seller, config.worldState, `Sold ${qty} ${item} to ${getDisplayName(buyer)} for ${totalCost}c (negotiated).`);
    feedbackToAgent(buyer, config.worldState, `Bought ${qty} ${item} from ${getDisplayName(seller)} for ${totalCost}c (negotiated).`);

    const text = `Deal done: ${getDisplayName(seller)} → ${qty}x ${item} → ${getDisplayName(buyer)} for ${totalCost}c.`;
    emitSSE("trade", { seller, buyer, item, qty, price: tradePrice, source: "negotiate" });
    const resolved: ResolvedAction = { type: "speak", text: `[Deal] ${qty}x ${item} @ ${tradePrice}c`, result: text, visible: true };
    config.executedActions.push(resolved);
    return { text, isInteraction: true, executedAction: resolved };
  }

  // No match yet — post the offer so the other party can see and respond
  const offer: NegotiationOffer = {
    from: config.agentId,
    fromName: getDisplayName(config.agentId),
    to: target,
    item,
    price,
    qty,
  };
  config.locationCtx.negotiationOffers.push(offer);
  config.locationCtx.visibleActions.push({
    agentId: config.agentId,
    name: getDisplayName(config.agentId),
    type: "negotiate",
    summary: `offering ${qty}x ${item} @ ${price}c to ${getDisplayName(target)}`,
  });

  const resultText = `${getDisplayName(config.agentId)} offers ${qty}x ${item} @ ${price}c to ${getDisplayName(target)}.`;
  emitSSE("agent:action", {
    agent: config.agentId,
    actionType: "negotiate",
    text: `${qty}x ${item} @ ${price}c → ${getDisplayName(target)}`,
    result: resultText,
    location: currentLocation(config),
  });

  const resolved: ResolvedAction = { type: "speak", text: `[Negotiate] ${qty}x ${item} @ ${price}c to ${getDisplayName(target)}`, result: resultText, visible: true };
  config.executedActions.push(resolved);
  return { text: resultText, isInteraction: true, executedAction: resolved };
}

function handleProduce(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const item = ((args.item as string) ?? "").trim();
  const eco = config.worldState.economics[config.agentId];
  const ownSkill = eco?.skill ?? "none";
  // Hired laborers borrow their employer's skill for production
  const employer = eco?.hiredBy ? config.worldState.economics[eco.hiredBy] : null;
  const skill = (ownSkill === "none" && employer) ? (employer.skill ?? "none") : ownSkill;

  // Block if already moved this tick — resolveProduction checks post-move location
  const alreadyMoved = config.executedActions.some(a => a.type === "move_to");
  if (alreadyMoved) {
    return { text: `[Can't produce] You moved this tick. Return to your work location next tick.`, isInteraction: false };
  }

  // Block duplicate produce — one production per turn
  const alreadyProduced = config.executedActions.some(a => a.type === "produce");
  if (alreadyProduced) {
    return { text: `[Can't produce] Already produced this tick. One production per turn.`, isInteraction: false };
  }

  // Validate item name against known recipes for this skill
  const producible = getProducibleItems(skill);
  if (producible.length === 0) {
    return { text: `[Can't produce] You have no skill. Find an employer — use hire_laborer if someone is willing to hire you, or ask them to hire you.`, isInteraction: false };
  }
  const match = producible.find(p => p.item === item);
  if (!match) {
    const list = producible.map(p => {
      const inp = Object.entries(p.inputs).map(([k, v]) => `${v}x ${k}`).join(", ");
      return inp ? `${p.item} (needs: ${inp})` : p.item;
    }).join(", ");
    return { text: `[Can't produce] No recipe for "${item}". You can make: ${list}`, isInteraction: false };
  }

  // Check ingredients are available before calling resolveAction
  for (const [inputItem, qty] of Object.entries(match.inputs)) {
    const have = getInventoryQty(eco.inventory, inputItem as ItemType);
    if (have < qty) {
      return {
        text: `[Can't produce] Need ${qty}x ${inputItem} to make ${item}, but you only have ${have}. Go buy or gather more.`,
        isInteraction: false,
      };
    }
  }

  // Check location is valid for this recipe
  const agentLoc = currentLocation(config);
  const validLocations = MULTI_FARM_ITEMS[item] ?? [match.location];
  const agentLocType = getLocationType(agentLoc);
  const atValidLocation = validLocations.includes(agentLoc) ||
    (agentLocType != null && validLocations.some(vl => getLocationType(vl) === agentLocType));
  if (!atValidLocation) {
    const where = validLocations.length === 1 ? validLocations[0]! : validLocations.join(" or ");
    return {
      text: `[Can't produce] ${item} must be produced at ${where}. You are at ${agentLoc} — move there first.`,
      isInteraction: false,
    };
  }

  const resolved = resolveAction({ type: "produce", item } as AgentAction, makeContext(config));

  if (resolved.visible) {
    config.locationCtx.visibleActions.push({
      agentId: config.agentId,
      name: getDisplayName(config.agentId),
      type: "produce",
      summary: `working on ${item}`,
    });
  }

  config.executedActions.push(resolved);
  return { text: resolved.result || `[Working on ${item}]`, isInteraction: true, executedAction: resolved };
}

function handleMoveTo(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const location = (args.location as string) ?? "";

  // Cross-village guard: block direct teleport across villages without using the road
  const currentLoc = currentLocation(config);
  const agentLocVillage = getVillageForLocation(currentLoc);
  const destVillage = getVillageForLocation(location);
  const destIsRoad = location.startsWith("Road:");
  const currentIsRoad = currentLoc.startsWith("Road:");
  if (!destIsRoad && !currentIsRoad && agentLocVillage && destVillage && agentLocVillage !== destVillage) {
    const agentVillageName = getVillages().find(v => v.id === agentLocVillage)?.name ?? "";
    const bareDest = location.includes(":") ? location.split(":").slice(1).join(":") : location;
    const localEquiv = agentVillageName ? `${agentVillageName}:${bareDest}` : bareDest;
    const localExists = !!getVillageForLocation(localEquiv);
    const hint = localExists
      ? ` Your local equivalent is "${localEquiv}" — go there instead.`
      : ` You are in ${agentVillageName}.`;
    return {
      text: `[Can't go there] "${location}" is in another village.${hint}`,
      isInteraction: false,
    };
  }

  const preMoveLocation = currentLoc;
  const resolved = resolveAction({ type: "move_to", location }, makeContext(config));

  let pendingMove: string | undefined;
  if (resolved.visible) {
    pendingMove = resolved.location ?? location;
    // Emit immediately for map animation (engine skips move_to in post-tick emission)
    emitSSE("agent:action", {
      agent: config.agentId,
      actionType: "move_to",
      location: pendingMove,
      result: resolved.result,
    });
  }

  config.executedActions.push(resolved);
  return { text: resolved.result || `[Moving to ${location}]`, isInteraction: true, pendingMove, executedAction: resolved };
}

function handlePostOrder(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "post_order",
    side: args.side as "sell" | "buy",
    item: args.item as string,
    quantity: Number(args.qty ?? args.quantity ?? 1),
    price: Number(args.price ?? 0),
  } as AgentAction, makeContext(config));

  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: true, executedAction: resolved };
}

function handleBuyItem(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "buy_item",
    item: args.item as string,
    max_price: Number(args.max_price ?? 0),
    quantity: args.qty != null ? Number(args.qty) : undefined,
  } as AgentAction, makeContext(config));

  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: true, executedAction: resolved };
}

function handleEat(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "eat",
    item: args.item as string,
    quantity: Number(args.qty ?? args.quantity ?? 1),
  } as AgentAction, makeContext(config));

  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: false, executedAction: resolved };
}

// ─── Hire/labor tool handlers ────────────────────────────────

function handleHireLaborer(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const targetName = ((args.agent as string) ?? "").toLowerCase();
  const wage = Math.max(0, Number(args.wage ?? 5));

  const all = Object.keys(config.worldState.economics);
  const target = all.find(
    a => getDisplayName(a).toLowerCase() === targetName || a.toLowerCase() === targetName
  ) as AgentName | undefined;

  if (!target) return { text: `[Can't hire] No agent named "${args.agent}".`, isInteraction: false };

  const loc = config.worldState.agent_locations[config.agentId];
  if (config.worldState.agent_locations[target] !== loc) {
    return { text: `[Can't hire] ${getDisplayName(target)} is not here.`, isInteraction: false };
  }

  const eco = config.worldState.economics[config.agentId];
  if (eco.wallet < wage) {
    return { text: `[Can't hire] You need ${wage}c but only have ${eco.wallet}c.`, isInteraction: false };
  }

  const targetEco = config.worldState.economics[target];
  if (targetEco.hiredBy) {
    return { text: `[Can't hire] ${getDisplayName(target)} is already employed by ${getDisplayName(targetEco.hiredBy)}.`, isInteraction: false };
  }

  eco.wallet -= wage;
  targetEco.wallet += wage;
  targetEco.hiredBy = config.agentId;
  targetEco.hiredUntilTick = config.time.tick + 16;

  feedbackToAgent(target, config.worldState, `${getDisplayName(config.agentId)} hired you for the day (${wage}c). Follow them and assist with their work.`);

  const text = `${getDisplayName(config.agentId)} hired ${getDisplayName(target)} for ${wage}c.`;
  const resolved: ResolvedAction = { type: "speak", text: `[Hired] ${getDisplayName(target)} for ${wage}c`, result: text, visible: true };
  config.executedActions.push(resolved);
  return { text, isInteraction: true, executedAction: resolved };
}

function handleQuitJob(_args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const eco = config.worldState.economics[config.agentId];
  if (!eco.hiredBy) return { text: "[Not hired] You have no current employer.", isInteraction: false };
  const employerName = getDisplayName(eco.hiredBy);
  feedbackToAgent(eco.hiredBy, config.worldState, `${getDisplayName(config.agentId)} has quit their job.`);
  eco.hiredBy = undefined;
  eco.hiredUntilTick = undefined;
  return { text: `You quit your job with ${employerName}.`, isInteraction: false };
}

// ─── Planning tool handlers ───────────────────────────────────

function handleThink(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const text = ((args.text as string) ?? "").trim();
  const displayName = getDisplayName(config.agentId);

  const resolved: ResolvedAction = { type: "think", text, result: `[Thought] ${text}`, visible: false };
  config.executedActions.push(resolved);

  // Stream the think text to viewer
  emitSSE("agent:thinking", { agent: config.agentId, name: displayName });
  emitSSE("agent:stream", { agent: config.agentId, name: displayName, chunk: text });
  emitSSE("agent:stream", { agent: config.agentId, name: displayName, chunk: "" });

  return { text: `[Thought] ${text}`, isInteraction: false, executedAction: resolved };
}

function handlePlan(args: Record<string, unknown>, _config: HarnessToolConfig): ToolResult {
  const steps = args.steps;
  const text = Array.isArray(steps) ? steps.join(" → ") : String(steps ?? "");
  return { text: `[Planned] ${text}`, isInteraction: false };
}

// ─── Tool registry ────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>, config: HarnessToolConfig) => ToolResult;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  look_around:    handleLookAround,
  check_inventory: handleCheckInventory,
  check_prices:   handleCheckPrices,
  check_body:     handleCheckBody,
  recall:         handleRecall,
  assess_person:  handleAssessPerson,
  speak:          handleSpeak,
  negotiate:      handleNegotiate,
  produce:        handleProduce,
  move_to:        handleMoveTo,
  post_order:     handlePostOrder,
  buy_item:       handleBuyItem,
  eat:            handleEat,
  hire_laborer:   handleHireLaborer,
  quit_job:       handleQuitJob,
  think:          handleThink,
  plan:           handlePlan,
  done:           () => ({ text: "Turn ended.", isInteraction: false }),
};

const ALL_TOOL_DEFS: ToolDef[] = [
  { name: "look_around",    description: "See who is here and what has been said",              argsHint: "{}" },
  { name: "check_inventory",description: "View your inventory and wallet",                      argsHint: "{}" },
  { name: "check_prices",   description: "Check market prices for an item",                     argsHint: '{"item": "flour"}' },
  { name: "check_body",     description: "Check your hunger, energy, health",                   argsHint: "{}" },
  { name: "recall",         description: "Search your memory for a topic",                      argsHint: '{"topic": "wheat trade"}' },
  { name: "assess_person",  description: "What you know about someone (must be acquainted)",    argsHint: '{"name": "Anselm"}' },
  { name: "speak",          description: "Say something aloud — max 15 words, only if others present", argsHint: '{"text": "..."}' },
  { name: "negotiate",      description: "Make a structured trade offer to someone here",       argsHint: '{"agent": "Anselm", "item": "flour", "price": 6, "qty": 3}' },
  { name: "produce",        description: "Craft an item (must be at your work location)",       argsHint: '{"item": "flour"}' },
  { name: "move_to",        description: "Move to a location",                                  argsHint: '{"location": "Village Square"}' },
  { name: "post_order",     description: "Post a market buy or sell order",                     argsHint: '{"side": "sell", "item": "flour", "qty": 3, "price": 6}' },
  { name: "buy_item",       description: "Buy from market — must be at Village Square",         argsHint: '{"item": "bread", "max_price": 5}' },
  { name: "eat",            description: "Eat food from your inventory",                        argsHint: '{"item": "bread", "qty": 1}' },
  { name: "hire_laborer",   description: "Pay someone here to work for you today (output goes to you)", argsHint: '{"agent": "Pabo", "wage": 5}' },
  { name: "quit_job",       description: "Quit your current job and stop working for your employer", argsHint: "{}" },
  { name: "think",          description: "Inner thought — not heard by others, max 10 words",   argsHint: '{"text": "..."}' },
  { name: "done",           description: "End your turn",                                       argsHint: "{}" },
];

export function getToolsForAgent(
  agentId: AgentName,
  worldState: WorldState,
  locationCtx: LocationContext,
): ToolDef[] {
  const acquaintances = worldState.acquaintances[agentId] ?? [];
  const loc = worldState.agent_locations[agentId];
  const presentOthers = Object.entries(worldState.agent_locations)
    .filter(([a, l]) => a !== agentId && l === loc)
    .map(([a]) => a);

  const eco = worldState.economics[agentId];
  const isHired = !!eco?.hiredBy;

  return ALL_TOOL_DEFS.filter(t => {
    if (t.name === "assess_person" && acquaintances.length === 0) return false;
    if (t.name === "negotiate" && presentOthers.length === 0) return false;
    if (t.name === "speak" && presentOthers.length === 0) return false;
    if (t.name === "hire_laborer" && presentOthers.length === 0) return false;
    if (t.name === "quit_job" && !isHired) return false;
    return true;
  });
}

export function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  config: HarnessToolConfig,
): ToolResult {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) return { text: `[Unknown tool: ${toolName}]`, isInteraction: false };
  return handler(args, config);
}

export function formatToolsForPrompt(tools: ToolDef[]): string {
  const obs   = ["look_around", "check_inventory", "check_prices", "check_body", "recall", "assess_person"];
  const act   = ["speak", "negotiate", "produce", "move_to", "post_order", "buy_item", "eat", "hire_laborer", "quit_job"];
  const plan  = ["think", "done"];

  const group = (label: string, names: string[]) => {
    const defs = tools.filter(t => names.includes(t.name));
    if (defs.length === 0) return "";
    return `${label}:\n${defs.map(t => `- ${t.name}: ${t.description}. Args: ${t.argsHint}`).join("\n")}`;
  };

  return [
    group("Observation (read-only)", obs),
    group("Action (affect the world)", act),
    group("Planning (internal)", plan),
  ].filter(Boolean).join("\n\n");
}

export function getToolSummary(toolName: string, args: Record<string, unknown>): string {
  const s: Record<string, (a: Record<string, unknown>) => string> = {
    look_around:    () => "looking around",
    check_inventory:() => "checking inventory",
    check_prices:   a => `checking ${String(a.item ?? "item")} prices`,
    check_body:     () => "checking body",
    recall:         a => `recalling ${String(a.topic ?? "past")}`,
    assess_person:  a => `thinking about ${String(a.name ?? "someone")}`,
    speak:          () => "speaking",
    negotiate:      a => `making offer to ${String(a.agent ?? "someone")}`,
    produce:        a => `working on ${String(a.item ?? "goods")}`,
    move_to:        a => `heading to ${String(a.location ?? "somewhere")}`,
    post_order:     a => `posting ${String(a.side ?? "")} order`,
    buy_item:       a => `buying ${String(a.item ?? "item")}`,
    eat:            a => `eating ${String(a.item ?? "food")}`,
    hire_laborer:   a => `hiring ${String(a.agent ?? "someone")}`,
    quit_job:       () => "quitting job",
    think:          () => "thinking",
    done:           () => "finishing turn",
  };
  return s[toolName]?.(args) ?? toolName;
}
