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
        const quantity = action.quantity != null ? Number(action.quantity) : undefined;
        const price = action.price != null ? Number(action.price) : undefined;

        if (!side || (side !== "sell" && side !== "buy") || !item || !quantity || !price || quantity <= 0 || price <= 0) {
          feedbackToAgent(agent, state, "[Can't do that] post_order requires side (\"sell\" or \"buy\"), item, quantity, price.");
          continue;
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
            continue;
          }
          reserveInventory(agent, item, quantity, state);
        }

        if (orderSide === "buy") {
          const needed = price * quantity;
          if (state.economics[agent].wallet < needed) {
            feedbackToAgent(agent, state, `[Can't do that] You need ${needed} coin to reserve this buy order but have ${state.economics[agent].wallet}.`);
            continue;
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
          expiresAtTick: time.tick + 16,  // 1 simulated day
        };
        addOrder(state.marketplace, newOrder);
        emitSSE("order:posted", { orderId: newOrder.id, agentId: agent, orderType: orderSide, item, quantity, price });

        feedbackToAgent(agent, state, `Posted ${orderSide} order: ${quantity} ${item} at ${price} coin each.`);
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
