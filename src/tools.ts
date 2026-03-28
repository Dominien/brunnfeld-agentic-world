import type { AgentAction, AgentName, ItemType, Loan, ResolvedAction, WorldState, SimTime, StealRecord } from "./types.js";
import { getAgentNames, getDisplayName, getAgentVillage, isValidLocation, getLocationHours, isLocationOpenByRegistry, getVillageLocations, getVillages, resolveAgentLocation, isRoadLocation, getRoads, getVillageForLocation } from "./world-registry.js";
import { getAgentMarketplace } from "./marketplace.js";
import { getHourIndex } from "./time.js";
import { lockDoor, unlockDoor, resolveKnock } from "./doors.js";
import { queueMessage } from "./messages.js";
import { resolveEat } from "./body.js";
import { feedbackToAgent, addToInventory, removeFromInventory, getInventoryQty, reserveInventory, unreserveInventory } from "./inventory.js";
import { executeTrade, removeOrder, addOrder, generateOrderId } from "./marketplace.js";
import { emitSSE } from "./events.js";
import { isLocationBlockedByEvent } from "./god-mode.js";

const CORE_ACTION_SCHEMA = `IMPORTANT: Your wallet and inventory shown above are exact. Do not claim to have coin or goods you have not received. Verbal agreements do not transfer goods — only post_order and buy_item create actual trades.

Your livelihood depends on producing goods and trading them. Producing and trading is your primary activity each turn.

Respond ONLY with a JSON object:
{
  "actions": [
    { "type": "think", "text": "..." },
    { "type": "speak", "text": "..." }
  ]
}

Available actions:
- think: Inner thought. Fields: text. Max 10 words. Nobody else hears it.
- speak: Say something aloud. Fields: text. Max 1 sentence, 15 words. Only if others are present.
- move_to: Go somewhere. Fields: location. Use exact location names.
- produce: Craft or gather an item. Fields: item. Must be at the right location with skill and inputs. Once per turn.
- eat: Eat food from your inventory. Fields: item, quantity.
- post_order: Post a buy or sell order. Fields: side ("sell"|"buy"), item, quantity, price (per unit).
- buy_item: Buy from the marketplace. Fields: item, max_price, quantity (optional, defaults to full order quantity). Fills the cheapest matching sell order regardless of seller. To trade with a specific person, they must post a sell order and your price must match. Must be at Village Square.
- cancel_order: Cancel your marketplace order. Fields: order_id.
- send_message: Send a written message. Fields: to (first name), text.
- give_coin: Give coin (payment, repayment, gift). Fields: to (first name), amount.
- steal: Steal from someone here. Fields: target (first name), item. You may be caught.

Only use actions that make sense for your current situation. Only reference things you have perceived or remember.`;

export function buildActionSchema(
  agent: AgentName,
  hasConcerns: boolean,
  atMeeting = false,
): string {
  let schema = CORE_ACTION_SCHEMA;
  if (atMeeting) {
    schema += `\n- propose_rule: Propose a rule for the vote. Fields: text (the rule), value? (number, e.g. 0.15 for tax rate).`;
    schema += `\n- vote: Cast your vote. Fields: side ("agree"|"disagree").`;
  } else if (agent === "otto" && hasConcerns) {
    schema += `\n- call_meeting: Call a village meeting for next dawn. Fields: agenda_type ("tax_change"|"marketplace_hours"|"banishment"|"general_rule"), text (the agenda), target? (first name, banishment only).`;
  } else if (agent !== "otto" && hasConcerns) {
    schema += `\n- petition_meeting: Ask Otto to call a village meeting. Fields: text (what it should address).`;
  }
  return schema;
}

// Keep exporting a static version for meeting perception (propose_rule / vote injected separately)
export const ACTION_SCHEMA_PROMPT = CORE_ACTION_SCHEMA;

// ─── Resolve Context ──────────────────────────────────────────

export interface ResolveContext {
  agent: AgentName;
  agentLocation: string;
  state: WorldState;
  time: SimTime;
  movedThisTick?: Set<AgentName>;
}

// ─── Resolve Action ───────────────────────────────────────────

export function resolveAction(
  action: AgentAction,
  context: ResolveContext,
): ResolvedAction {
  const { agent, agentLocation, state, time } = context;
  const name = getDisplayName(agent);

  switch (action.type) {
    case "speak": {
      const othersHere = Object.keys(state.agent_locations).filter(
        a => a !== agent && state.agent_locations[a] === agentLocation
      );
      if (othersHere.length === 0) {
        feedbackToAgent(agent, state, `[Can't speak] No one else is here to hear you. Use think instead.`);
        return { ...action, result: "", visible: false };
      }
      return { ...action, result: `${name} says: "${action.text}"`, visible: true };
    }

    case "think":
      return { ...action, result: action.text ? `[Thought] ${action.text}` : "", visible: false };

    case "wait":
      return { ...action, result: "", visible: false };

    case "move_to": {
      const rawLoc = action.location || action.text || "";
      // Resolve bare location names using the agent's current village, not home village
      const currentVid = isRoadLocation(agentLocation)
        ? undefined
        : getVillageForLocation(agentLocation);
      const targetLoc = resolveAgentLocation(agent, rawLoc, currentVid);
      const valid = isValidLocation(targetLoc);
      if (!valid) {
        const vid = currentVid ?? getAgentVillage(agent);
        const vName = getVillages().find(v => v.id === vid)?.name ?? "";
        const localLocs = getVillageLocations(vid).map(l =>
          vName && l.startsWith(`${vName}:`) ? l.slice(vName.length + 1) : l
        );
        return { ...action, result: `[Can't do that] "${rawLoc}" is not a valid location. Try: ${localLocs.join(", ")}`, visible: false };
      }
      const eventBlock = isLocationBlockedByEvent(targetLoc, state.active_events);
      if (eventBlock) {
        return { ...action, result: eventBlock, visible: false };
      }
      const hourIdx = getHourIndex(time);
      if (!isLocationOpenByRegistry(targetLoc, hourIdx)) {
        const hrs = getLocationHours(targetLoc);
        const opensStr = hrs != null ? ` (opens at ${String(6 + hrs.open).padStart(2, "0")}:00)` : "";
        const msg = `[Can't move] ${targetLoc} is closed right now${opensStr}.`;
        feedbackToAgent(agent, state, msg);
        return { ...action, result: msg, visible: false };
      }
      if (context.movedThisTick?.has(agent)) {
        feedbackToAgent(agent, state, `[Can't move] Already moved this hour. One move per hour.`);
        return { ...action, result: "", visible: false };
      }
      const wasOnRoad = isRoadLocation(agentLocation);
      state.agent_locations[agent] = targetLoc;
      context.movedThisTick?.add(agent);

      // Arriving at a road: apply hunger cost + travel feedback
      if (isRoadLocation(targetLoc)) {
        state.body[agent].hunger = Math.min(5, (state.body[agent].hunger ?? 0) + 1);
        const road = getRoads().find(r => r.name === targetLoc);
        const destVid = road?.connectsVillages.find(v => v !== currentVid);
        const destName = getVillages().find(v => v.id === destVid)?.name ?? destVid ?? "the next village";
        feedbackToAgent(agent, state, `[Travelling] You are on the road to ${destName}. You will arrive next tick. (+1 hunger)`);
        return { ...action, location: targetLoc, result: `${name} sets out on the road to ${destName}.`, visible: true };
      }

      // Arriving at a village from a road
      if (wasOnRoad) {
        const arrivedVid = getVillageForLocation(targetLoc);
        const arrivedName = getVillages().find(v => v.id === arrivedVid)?.name ?? targetLoc;
        feedbackToAgent(agent, state, `[Arrived] You have arrived in ${arrivedName}.`);
      }

      return { ...action, location: targetLoc, result: `${name} goes to ${targetLoc}.`, visible: true };
    }

    case "knock_door": {
      const knockResult = resolveKnock(state, agent, action.target ?? "");
      return { ...action, result: knockResult.result, visible: true };
    }

    case "lock_door":
      return { ...action, result: lockDoor(state, agent), visible: false };

    case "unlock_door":
      return { ...action, result: unlockDoor(state, agent), visible: false };

    case "send_message": {
      const targetName = (action.to ?? action.target ?? "").toLowerCase();
      const targetAgent = getAgentNames().find(
        a => getDisplayName(a).toLowerCase() === targetName
      );
      if (!targetAgent) {
        return { ...action, result: `[Can't do that] Nobody named "${action.to ?? action.target}" lives in the village.`, visible: false };
      }
      const msgText = action.text ?? "(no message)";
      queueMessage(state, agent, targetAgent, msgText, time.tick);
      return { ...action, result: `Message sent to ${getDisplayName(targetAgent)}.`, visible: false };
    }

    case "leave_note": {
      const noteLocation = action.location ?? agentLocation;
      state.objects.push({
        id: `note_${agent}_${time.tick}`,
        type: "note",
        label: `Note from ${name}: "${(action.text ?? "").substring(0, 50)}..."`,
        location: noteLocation,
        content: action.text ?? "",
        placed_day: time.dayNumber,
        discovered_by: [],
        read_by: [agent],
        visibility: "shared",
        duration_days: 3,
      });
      return { ...action, result: `Note left at ${noteLocation}.`, visible: true };
    }

    case "read": {
      const obj = state.objects.find(o => o.id === action.object_id);
      if (!obj) return { ...action, result: "That object doesn't exist.", visible: false };
      if (!obj.read_by.includes(agent)) obj.read_by.push(agent);
      return { ...action, result: obj.content || obj.label, visible: false };
    }

    // produce passes through to dedicated resolver
    case "produce":
      return { ...action, result: `${name} starts work on ${action.item ?? "goods"}. Output added at end of tick — do not post a sell order for it yet.`, visible: true };

    case "post_order": {
      const side = action.side;
      const item = action.item as ItemType | undefined;
      const quantity = action.quantity != null ? Number(action.quantity) : undefined;
      const price = action.price != null ? Number(action.price) : undefined;

      if (!side || (side !== "sell" && side !== "buy") || !item || !quantity || !price || quantity <= 0 || price <= 0) {
        feedbackToAgent(agent, state, `[Can't do that] post_order requires side ("sell" or "buy"), item, quantity, price.`);
        return { ...action, result: `[Can't do that] post_order requires side ("sell" or "buy"), item, quantity, price.`, visible: false };
      }

      const orderSide = side as "sell" | "buy";

      if (orderSide === "sell") {
        const inv = state.economics[agent].inventory;
        const invItem = inv.items.find(i => i.type === item);
        const totalQty = invItem?.quantity ?? 0;
        const alreadyReserved = invItem?.reserved ?? 0;
        const available = Math.max(0, totalQty - alreadyReserved);
        if (quantity > available) {
          feedbackToAgent(agent, state, `[Can't post] You only have ${available} ${item} available (${alreadyReserved} reserved in other orders).`);
          return { ...action, result: `[Can't post] You only have ${available} ${item} available (${alreadyReserved} reserved in other orders).`, visible: false };
        }
        reserveInventory(agent, item, quantity, state);
      }

      if (orderSide === "buy") {
        const needed = price * quantity;
        if (state.economics[agent].wallet < needed) {
          feedbackToAgent(agent, state, `[Can't do that] You need ${needed} coin to reserve this buy order but have ${state.economics[agent].wallet}.`);
          return { ...action, result: `[Can't do that] You need ${needed} coin to reserve this buy order but have ${state.economics[agent].wallet}.`, visible: false };
        }
      }

      const newOrder = {
        id: generateOrderId(),
        agentId: agent,
        type: orderSide,
        item,
        quantity,
        price,
        postedTick: time.tick,
        expiresAtTick: time.tick + 16,
      };
      addOrder(getAgentMarketplace(agent, state), newOrder);
      emitSSE("order:posted", { orderId: newOrder.id, agentId: agent, orderType: orderSide, item, quantity, price });
      feedbackToAgent(agent, state, `Posted ${orderSide.toUpperCase()} order: ${quantity} ${item} at ${price} coin each. Order ID: ${newOrder.id} (expires in 16 ticks). Use cancel_order with this ID to cancel it.`);
      return { ...action, result: `Posted ${orderSide.toUpperCase()} order: ${quantity} ${item} at ${price} coin each. Order ID: ${newOrder.id}.`, visible: false };
    }

    case "cancel_order": {
      const orderId = action.order_id;
      if (!orderId) {
        feedbackToAgent(agent, state, "[Can't do that] cancel_order requires order_id.");
        return { ...action, result: "[Can't do that] cancel_order requires order_id.", visible: false };
      }

      const agentMkt = getAgentMarketplace(agent, state);
      const order = agentMkt.orders.find(o => o.id === orderId && o.agentId === agent);
      if (!order) {
        feedbackToAgent(agent, state, `[Can't do that] No order ${orderId} found for you.`);
        return { ...action, result: `[Can't do that] No order ${orderId} found for you.`, visible: false };
      }

      if (order.type === "sell") {
        const inv = state.economics[agent].inventory;
        const found = inv.items.find(i => i.type === order.item);
        if (found) found.reserved = Math.max(0, (found.reserved ?? 0) - order.quantity);
      }

      removeOrder(agentMkt, orderId);
      emitSSE("order:cancelled", { orderId, agentId: agent, orderType: order.type, item: order.item, quantity: order.quantity, price: order.price });
      feedbackToAgent(agent, state, `Cancelled ${order.type.toUpperCase()} order for ${order.item} x${order.quantity} at ${order.price}c (id: ${orderId}).`);
      return { ...action, result: `Cancelled ${order.type.toUpperCase()} order for ${order.item} x${order.quantity} at ${order.price}c.`, visible: false };
    }

    // buy_item resolves immediately so the agent can eat in the same turn
    case "buy_item": {
      const item = action.item as ItemType | undefined;
      const maxPrice = action.max_price != null ? Number(action.max_price) : undefined;
      if (!item || maxPrice == null) {
        return { ...action, result: "[Can't do that] buy_item requires item and max_price.", visible: false };
      }
      const currentLoc = state.agent_locations[agent];
      // Allow buying at any "square"-type location (covers "Village Square", "Norddorf:Village Square", etc.)
      const atSquare = currentLoc === "Village Square" || currentLoc === "Marketplace" || currentLoc.endsWith(":Village Square");
      if (!atSquare) {
        return { ...action, result: "[Can't do that] You must be at the Village Square to buy.", visible: false };
      }
      const buyMkt = getAgentMarketplace(agent, state);
      const matches = buyMkt.orders
        .filter(o => o.type === "sell" && o.item === item && o.price <= maxPrice && o.agentId !== agent)
        .sort((a, b) => a.price - b.price);
      if (matches.length === 0) {
        const allOrders = buyMkt.orders
          .filter(o => o.type === "sell" && o.item === item && o.agentId !== agent)
          .sort((a, b) => a.price - b.price);
        const cheapestNote = allOrders.length > 0
          ? ` Cheapest available: ${allOrders[0]!.price}c from ${getDisplayName(allOrders[0]!.agentId)}. Raise your max_price.`
          : " No sell orders exist for this item.";
        return { ...action, result: `[No match] No sell orders for ${item} at or below ${maxPrice} coin.${cheapestNote}`, visible: false };
      }
      const order = matches[0]!;
      const buyQuantity = Math.min(action.quantity ?? order.quantity, order.quantity);
      const cost = order.price * buyQuantity;
      if (state.economics[agent].wallet < cost) {
        return { ...action, result: `[Can't afford] Need ${cost} coin but have ${state.economics[agent].wallet}.`, visible: false };
      }
      const trade = executeTrade(agent, order.agentId, item, buyQuantity, order.price, state, time);
      if (buyQuantity < order.quantity) {
        order.quantity -= buyQuantity;
      } else {
        removeOrder(buyMkt, order.id);
      }
      feedbackToAgent(order.agentId, state, `Sold ${trade.quantity} ${trade.item} to ${name} for ${trade.total} coin.`);
      return { ...action, result: `${name} bought ${trade.quantity} ${trade.item} for ${trade.total} coin.`, visible: true };
    }

    case "eat": {
      const item = action.item as ItemType | undefined;
      const qty = action.quantity ?? 1;
      if (!item) return { ...action, result: "[Can't eat] No item specified.", visible: false };
      const result = resolveEat(agent, item, qty, state);
      return { ...action, result, visible: result.startsWith("[") ? false : true };
    }

    case "hire": {
      const targetName = (action.target ?? "").toLowerCase();
      const targetAgent = getAgentNames().find(
        a => getDisplayName(a).toLowerCase() === targetName
      );
      if (!targetAgent) {
        return { ...action, result: `[Can't do that] Nobody named "${action.target}" is available.`, visible: false };
      }
      const wage = action.wage ?? 5;
      const eco = state.economics[agent];
      if (eco.wallet < wage) {
        return { ...action, result: `[Can't afford] You need ${wage} coin but have ${eco.wallet}.`, visible: false };
      }
      const targetEco = state.economics[targetAgent];
      if (targetEco.hiredBy) {
        return { ...action, result: `[Can't do that] ${getDisplayName(targetAgent)} is already hired by someone.`, visible: false };
      }
      targetEco.hiredBy = agent;
      targetEco.hiredUntilTick = time.tick + 16;
      // Wage paid at end of day in engine
      feedbackToAgent(targetAgent, state, `${name} hired you for the day (${wage} coin). Task: ${action.task ?? "help with work"}.`);
      return { ...action, result: `${name} hired ${getDisplayName(targetAgent)} for ${wage} coin.`, visible: true };
    }

    case "lend_coin": {
      const targetName = (action.to ?? "").toLowerCase();
      const targetAgent = getAgentNames().find(a => getDisplayName(a).toLowerCase() === targetName);
      if (!targetAgent) {
        return { ...action, result: `[Can't do that] Nobody named "${action.to}" in the village.`, visible: false };
      }
      const amount = action.amount ?? 0;
      if (amount <= 0) {
        return { ...action, result: `[Can't do that] Amount must be positive.`, visible: false };
      }
      const eco = state.economics[agent];
      if (eco.wallet < amount) {
        return { ...action, result: `[Can't afford] You have ${eco.wallet} coin, need ${amount}.`, visible: false };
      }
      eco.wallet -= amount;
      state.economics[targetAgent].wallet += amount;
      const loan: Loan = {
        id: `loan_${agent}_${targetAgent}_${time.tick}`,
        creditor: agent,
        debtor: targetAgent,
        amount,
        issuedTick: time.tick,
        dueTick: time.tick + 112,
        description: action.description ?? action.text ?? "",
        repaid: false,
      };
      state.loans.push(loan);
      feedbackToAgent(targetAgent, state, `${name} lent you ${amount} coin (loan id: ${loan.id}, due in 7 days).`);
      return { ...action, result: `${name} lent ${amount} coin to ${getDisplayName(targetAgent)}. Loan recorded (id: ${loan.id}).`, visible: true };
    }

    case "give_coin": {
      const targetName = (action.to ?? "").toLowerCase();
      const targetAgent = getAgentNames().find(a => getDisplayName(a).toLowerCase() === targetName);
      if (!targetAgent) {
        return { ...action, result: `[Can't do that] Nobody named "${action.to}" in the village.`, visible: false };
      }
      const amount = action.amount ?? 0;
      if (amount <= 0) {
        return { ...action, result: `[Can't do that] Amount must be positive.`, visible: false };
      }
      const eco = state.economics[agent];
      if (eco.wallet < amount) {
        return { ...action, result: `[Can't afford] You have ${eco.wallet} coin, need ${amount}.`, visible: false };
      }
      eco.wallet -= amount;
      state.economics[targetAgent].wallet += amount;
      feedbackToAgent(targetAgent, state, `${name} gave you ${amount} coin.`);
      return { ...action, result: `${name} gave ${amount} coin to ${getDisplayName(targetAgent)}.`, visible: true };
    }

    case "steal": {
      const targetName = (action.target ?? "").toLowerCase();
      const targetAgent = getAgentNames().find(
        a => getDisplayName(a).toLowerCase() === targetName
      );
      if (!targetAgent) {
        return { ...action, result: `[Can't do that] Nobody named "${action.target}" is here.`, visible: false };
      }
      if (state.agent_locations[targetAgent] !== agentLocation) {
        return { ...action, result: `[Can't do that] ${getDisplayName(targetAgent)} is not here.`, visible: false };
      }
      const stealItem = action.item as ItemType | undefined;
      if (!stealItem) {
        return { ...action, result: `[Can't do that] steal requires an item field.`, visible: false };
      }
      const victimInv = state.economics[targetAgent].inventory;
      const available = getInventoryQty(victimInv, stealItem);
      if (available < 1) {
        return { ...action, result: `[Can't do that] ${getDisplayName(targetAgent)} does not have any ${stealItem}.`, visible: false };
      }

      // Count witnesses (everyone at location except thief and target)
      const witnesses = Object.keys(state.agent_locations).filter(
        a => a !== agent && a !== targetAgent && state.agent_locations[a] === agentLocation
      ).length;

      // 50% base, each witness multiplies remaining chance by 0.6
      let successChance = 0.5;
      for (let i = 0; i < witnesses; i++) successChance *= 0.6;
      const success = Math.random() < successChance;

      if (!state.caughtStealing) state.caughtStealing = {};

      const victimDisplayName = getDisplayName(targetAgent);

      if (success) {
        unreserveInventory(targetAgent, stealItem, 1, state);
        removeFromInventory(victimInv, stealItem, 1);
        addToInventory(state.economics[agent].inventory, stealItem, 1, time.tick);
        feedbackToAgent(
          targetAgent, state,
          `You reach for your ${stealItem} and find it missing — someone must have taken it while you weren't looking.`
        );
        return { ...action, result: `${name} slips the ${stealItem} away from ${victimDisplayName} unnoticed.`, visible: false };
      } else {
        if (!state.caughtStealing[agent]) state.caughtStealing[agent] = [];
        state.caughtStealing[agent]!.push({ from: targetAgent, item: stealItem });
        feedbackToAgent(
          targetAgent, state,
          `You catch ${name} trying to steal your ${stealItem}!`
        );
        return { ...action, result: `${name} reached for ${victimDisplayName}'s ${stealItem} but was caught in the act.`, visible: false };
      }
    }

    case "call_meeting": {
      if (agent !== "otto") {
        return { ...action, result: `[Can't do that] Only Otto can call a village meeting.`, visible: false };
      }
      if (state.pending_meeting) {
        return { ...action, result: `[Can't do that] A meeting is already scheduled for tick ${state.pending_meeting.scheduledTick}.`, visible: false };
      }
      const agendaType = action.agenda_type;
      if (!agendaType) {
        return { ...action, result: `[Can't do that] call_meeting requires agenda_type.`, visible: false };
      }
      const ticksIntoCurrent = (time.tick - 1) % 16;
      const nextDawnTick = ticksIntoCurrent === 0
        ? time.tick + 16
        : time.tick + (16 - ticksIntoCurrent);
      const agendaDesc = action.text ?? action.description ?? agendaType.replace("_", " ");
      state.pending_meeting = {
        scheduledTick: nextDawnTick,
        agendaType,
        description: agendaDesc,
        target: action.target as AgentName | undefined,
        calledAtTick: time.tick,
      };
      const noticeText = `Otto has called a village meeting: "${agendaDesc}". It will be held at the Town Hall at dawn on day ${Math.ceil(nextDawnTick / 16)}. Attend if you wish to participate.`;
      for (const a of getAgentNames()) {
        feedbackToAgent(a, state, noticeText);
      }
      return { ...action, result: `Otto calls a village meeting on "${agendaDesc}" — scheduled for dawn of day ${Math.ceil(nextDawnTick / 16)} at the Town Hall.`, visible: true };
    }

    case "petition_meeting": {
      if (agent === "otto") {
        return { ...action, result: `[Can't do that] Otto calls meetings directly with call_meeting.`, visible: false };
      }
      const topic = action.text;
      if (!topic) {
        return { ...action, result: `[Can't do that] petition_meeting requires text describing the topic.`, visible: false };
      }
      state.pending_petitions ??= [];
      // Replace any existing petition from this agent (one petition per agent at a time)
      state.pending_petitions = state.pending_petitions.filter(p => p.agent !== agent);
      state.pending_petitions.push({ agent, topic, tick: time.tick });
      return { ...action, result: `${name} petitions Otto to call a village meeting: "${topic.substring(0, 80)}"`, visible: true };
    }

    case "propose_rule": {
      if (agentLocation !== "Town Hall") {
        return { ...action, result: `[Can't do that] propose_rule is only valid at the Town Hall during a meeting.`, visible: false };
      }
      if (!state.pending_meeting) {
        return { ...action, result: `[Can't do that] No meeting is in progress.`, visible: false };
      }
      if (!action.text) {
        return { ...action, result: `[Can't do that] propose_rule requires a text description.`, visible: false };
      }
      return { ...action, result: `${name} proposes: "${action.text}"`, visible: true };
    }

    case "vote": {
      if (agentLocation !== "Town Hall") {
        return { ...action, result: `[Can't do that] vote is only valid at the Town Hall during a meeting.`, visible: false };
      }
      if (!state.pending_meeting) {
        return { ...action, result: `[Can't do that] No vote is in progress.`, visible: false };
      }
      if (action.side !== "agree" && action.side !== "disagree") {
        return { ...action, result: `[Can't do that] vote requires side: "agree" or "disagree".`, visible: false };
      }
      return { ...action, result: `${name} votes ${action.side}.`, visible: true };
    }

    default:
      return { ...action, result: `Unknown action type.`, visible: false };
  }
}
