import type { AgentName, AgentTurnResult, ItemType, WorldState, SimTime } from "./types.js";
import { getInventoryQty, reserveInventory, feedbackToAgent } from "./inventory.js";
import {
  addOrder, removeOrder, executeTrade, generateOrderId, expireOrders, getAgentOrders,
} from "./marketplace.js";
import { emitSSE } from "./events.js";

export function resolveMarketplace(
  results: AgentTurnResult[],
  state: WorldState,
  time: SimTime,
): void {
  // Expire stale orders first
  expireOrders(state, time);

  for (const result of results) {
    for (const action of result.actions) {
      const agent = result.agent;

      // ─── post_order ──────────────────────────────────────
      if (action.type === "post_order") {
        const side = action.side;
        const item = action.item as ItemType | undefined;
        const quantity = action.quantity;
        const price = action.price;

        if (!side || !item || !quantity || !price || quantity <= 0 || price <= 0) {
          feedbackToAgent(agent, state, "[Can't do that] post_order requires side, item, quantity, price.");
          continue;
        }

        if (side === "sell") {
          const available = getInventoryQty(state.economics[agent].inventory, item);
          if (available < quantity) {
            feedbackToAgent(agent, state, `[Can't do that] You only have ${available} ${item} available (not reserved).`);
            continue;
          }
          reserveInventory(agent, item, quantity, state);
        }

        if (side === "buy") {
          const needed = price * quantity;
          if (state.economics[agent].wallet < needed) {
            feedbackToAgent(agent, state, `[Can't do that] You need ${needed} coin to reserve this buy order but have ${state.economics[agent].wallet}.`);
            continue;
          }
        }

        const newOrder = {
          id: generateOrderId(),
          agentId: agent,
          type: side,
          item,
          quantity,
          price,
          postedTick: time.tick,
          expiresAtTick: time.tick + 16,  // 1 simulated day
        };
        addOrder(state.marketplace, newOrder);
        emitSSE("order:posted", { orderId: newOrder.id, agentId: agent, orderType: side, item, quantity, price });

        feedbackToAgent(agent, state, `Posted ${side} order: ${quantity} ${item} at ${price} coin each.`);
      }

      // buy_item is now resolved inline in resolveAction (tools.ts) so the agent
      // can eat in the same turn. No double-processing here.

      // ─── cancel_order ─────────────────────────────────────
      if (action.type === "cancel_order") {
        const orderId = action.order_id;
        if (!orderId) {
          feedbackToAgent(agent, state, "[Can't do that] cancel_order requires order_id.");
          continue;
        }

        const order = state.marketplace.orders.find(o => o.id === orderId && o.agentId === agent);
        if (!order) {
          feedbackToAgent(agent, state, `[Can't do that] No order ${orderId} found for you.`);
          continue;
        }

        if (order.type === "sell") {
          // Un-reserve the items
          const inv = state.economics[agent].inventory;
          const found = inv.items.find(i => i.type === order.item);
          if (found) found.reserved = Math.max(0, (found.reserved ?? 0) - order.quantity);
        }

        removeOrder(state.marketplace, orderId);
        emitSSE("order:cancelled", { orderId, agentId: agent, orderType: order.type, item: order.item, quantity: order.quantity, price: order.price });
        feedbackToAgent(agent, state, `Cancelled order ${orderId}.`);
      }
    }
  }
}
