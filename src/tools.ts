import type { AgentAction, AgentName, ItemType, Loan, ResolvedAction, WorldState, SimTime } from "./types.js";
import { AGENT_DISPLAY_NAMES, AGENT_NAMES } from "./types.js";
import { LOCATIONS, isValidLocation, isLocationOpen } from "./village-map.js";
import { getHourIndex } from "./time.js";
import { lockDoor, unlockDoor, resolveKnock } from "./doors.js";
import { queueMessage } from "./messages.js";
import { resolveEat } from "./body.js";
import { feedbackToAgent } from "./inventory.js";
import { executeTrade, removeOrder } from "./marketplace.js";
import { isLocationBlockedByEvent } from "./god-mode.js";

export const ACTION_SCHEMA_PROMPT = `IMPORTANT: Your wallet and inventory shown above are exact. Do not claim to have coin or goods you have not received. Verbal agreements do not transfer goods — only post_order and buy_item create actual trades.

Your livelihood depends on producing goods and trading them. If you can produce something at your current location, you should — it is your primary activity each turn.

Respond ONLY with a JSON object:
{
  "actions": [
    { "type": "think", "text": "..." },
    { "type": "speak", "text": "..." }
  ]
}

Available actions:
- think: Inner thought. Fields: text. Max 10 words. Nobody else hears it.
- speak: Say something aloud. Fields: text. Max 1 sentence, 15 words. Only if others are present. Does NOT transfer goods or coin.
- do: Describe a physical action. Fields: text. Max 8 words.
- wait: Do nothing. No fields.
- move_to: Go somewhere. Fields: location. Use exact location names.
- knock_door: Knock on someone's home door. Fields: target (first name).
- lock_door: Lock your home door. No fields.
- unlock_door: Unlock your home door. No fields.
- send_message: Send a message via courier. Fields: to (first name), text.
- leave_note: Leave a written note. Fields: location, text.
- produce: Craft or gather an item. Fields: item. You must be at the right location with the right skill and inputs. Only submit ONCE per turn — one production per hour.
- eat: Eat food from your inventory. Fields: item, quantity.
- post_order: Post a buy or sell order on the marketplace board. Fields: side ("sell"|"buy"), item, quantity, price (per unit).
- buy_item: Buy the cheapest available sell order. Fields: item, max_price. Must be at Village Square.
- cancel_order: Cancel one of your marketplace orders. Fields: order_id.
- hire: Hire a laborer for the day. Fields: target (first name), wage (coins), task (description).
- lend_coin: Give coin to someone now as a loan they owe back. Fields: to (first name), amount (coins), description (optional note).
- give_coin: Give coin directly with no loan record (repayment, wages, gifts). Fields: to (first name), amount (coins).

Keep actions concise. Only reference things you have directly perceived or remember. Do not invent people or events.`;

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
  const name = AGENT_DISPLAY_NAMES[agent];

  switch (action.type) {
    case "speak": {
      const othersHere = AGENT_NAMES.filter(
        a => a !== agent && state.agent_locations[a] === agentLocation
      );
      if (othersHere.length === 0) {
        feedbackToAgent(agent, state, `[Can't speak] No one else is here to hear you. Use think or do instead.`);
        return { ...action, result: "", visible: false };
      }
      return { ...action, result: `${name} says: "${action.text}"`, visible: true };
    }

    case "think":
      return { ...action, result: `[Thought] ${action.text}`, visible: false };

    case "do":
      return { ...action, result: `${name} ${action.text}`, visible: true };

    case "wait":
      return { ...action, result: "", visible: false };

    case "move_to": {
      const targetLoc = action.location ?? "";
      const valid = isValidLocation(targetLoc);
      if (!valid) {
        return { ...action, result: `[Can't do that] "${targetLoc}" is not a valid location. Available: ${[...LOCATIONS].join(", ")}`, visible: false };
      }
      const eventBlock = isLocationBlockedByEvent(targetLoc, state.active_events);
      if (eventBlock) {
        return { ...action, result: eventBlock, visible: false };
      }
      const hourIdx = getHourIndex(time);
      if (!isLocationOpen(targetLoc, hourIdx)) {
        return { ...action, result: `[Can't do that] ${targetLoc} is closed right now.`, visible: false };
      }
      if (context.movedThisTick?.has(agent)) {
        feedbackToAgent(agent, state, `[Can't move] Already moved this hour. One move per hour.`);
        return { ...action, result: "", visible: false };
      }
      state.agent_locations[agent] = targetLoc;
      context.movedThisTick?.add(agent);
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
      const targetAgent = AGENT_NAMES.find(
        a => AGENT_DISPLAY_NAMES[a].toLowerCase() === targetName
      );
      if (!targetAgent) {
        return { ...action, result: `[Can't do that] Nobody named "${action.to ?? action.target}" lives in the village.`, visible: false };
      }
      const msgText = action.text ?? "(no message)";
      queueMessage(state, agent, targetAgent, msgText, time.tick);
      return { ...action, result: `Message sent to ${AGENT_DISPLAY_NAMES[targetAgent]}.`, visible: false };
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

    // Production/order actions pass through to dedicated resolvers
    case "produce":
    case "post_order":
    case "cancel_order":
      return { ...action, result: "(pending economic resolution)", visible: false };

    // buy_item resolves immediately so the agent can eat in the same turn
    case "buy_item": {
      const item = action.item as ItemType | undefined;
      const maxPrice = action.max_price;
      if (!item || maxPrice == null) {
        return { ...action, result: "[Can't do that] buy_item requires item and max_price.", visible: false };
      }
      const currentLoc = state.agent_locations[agent];
      if (currentLoc !== "Village Square" && currentLoc !== "Marketplace") {
        return { ...action, result: "[Can't do that] You must be at the Village Square to buy.", visible: false };
      }
      const matches = state.marketplace.orders
        .filter(o => o.type === "sell" && o.item === item && o.price <= maxPrice && o.agentId !== agent)
        .sort((a, b) => a.price - b.price);
      if (matches.length === 0) {
        const allOrders = state.marketplace.orders
          .filter(o => o.type === "sell" && o.item === item && o.agentId !== agent)
          .sort((a, b) => a.price - b.price);
        const cheapestNote = allOrders.length > 0
          ? ` Cheapest available: ${allOrders[0]!.price}c from ${AGENT_DISPLAY_NAMES[allOrders[0]!.agentId as AgentName] ?? allOrders[0]!.agentId}. Raise your max_price.`
          : " No sell orders exist for this item.";
        return { ...action, result: `[No match] No sell orders for ${item} at or below ${maxPrice} coin.${cheapestNote}`, visible: false };
      }
      const order = matches[0]!;
      const cost = order.price * order.quantity;
      if (state.economics[agent].wallet < cost) {
        return { ...action, result: `[Can't afford] Need ${cost} coin but have ${state.economics[agent].wallet}.`, visible: false };
      }
      const trade = executeTrade(agent, order.agentId, item, order.quantity, order.price, state, time);
      removeOrder(state.marketplace, order.id);
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
      const targetAgent = AGENT_NAMES.find(
        a => AGENT_DISPLAY_NAMES[a].toLowerCase() === targetName
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
        return { ...action, result: `[Can't do that] ${AGENT_DISPLAY_NAMES[targetAgent]} is already hired by someone.`, visible: false };
      }
      targetEco.hiredBy = agent;
      targetEco.hiredUntilTick = time.tick + 16;
      // Wage paid at end of day in engine
      feedbackToAgent(targetAgent, state, `${name} hired you for the day (${wage} coin). Task: ${action.task ?? "help with work"}.`);
      return { ...action, result: `${name} hired ${AGENT_DISPLAY_NAMES[targetAgent]} for ${wage} coin.`, visible: true };
    }

    case "lend_coin": {
      const targetName = (action.to ?? "").toLowerCase();
      const targetAgent = AGENT_NAMES.find(a => AGENT_DISPLAY_NAMES[a].toLowerCase() === targetName);
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
      return { ...action, result: `${name} lent ${amount} coin to ${AGENT_DISPLAY_NAMES[targetAgent]}. Loan recorded (id: ${loan.id}).`, visible: true };
    }

    case "give_coin": {
      const targetName = (action.to ?? "").toLowerCase();
      const targetAgent = AGENT_NAMES.find(a => AGENT_DISPLAY_NAMES[a].toLowerCase() === targetName);
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
      return { ...action, result: `${name} gave ${amount} coin to ${AGENT_DISPLAY_NAMES[targetAgent]}.`, visible: true };
    }

    default:
      return { ...action, result: `Unknown action type.`, visible: false };
  }
}
