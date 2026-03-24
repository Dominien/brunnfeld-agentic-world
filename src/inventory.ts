import type { AgentName, Inventory, InventoryItem, ItemType, WorldState, SimTime } from "./types.js";
import { getAgentNames } from "./world-registry.js";
import { emitSSE } from "./events.js";

// Spoilage durations in ticks (1 day = 16 ticks)
const SPOIL_TICKS: Partial<Record<ItemType, number>> = {
  milk: 32,   // 2 days
  meat: 48,   // 3 days
};

export function getInventoryQty(inventory: Inventory, item: ItemType): number {
  const found = inventory.items.find(i => i.type === item);
  if (!found) return 0;
  const reserved = found.reserved ?? 0;
  return Math.max(0, found.quantity - reserved);
}

export function getReserved(inventory: Inventory, item: ItemType): number {
  return inventory.items.find(i => i.type === item)?.reserved ?? 0;
}

export function getTotalQty(inventory: Inventory, item: ItemType): number {
  return inventory.items.find(i => i.type === item)?.quantity ?? 0;
}

export function addToInventory(
  inventory: Inventory,
  item: ItemType,
  qty: number,
  currentTick?: number,
): void {
  const existing = inventory.items.find(i => i.type === item);
  if (existing) {
    existing.quantity += qty;
    // Refresh spoil timer if adding fresh stock
    if (currentTick && SPOIL_TICKS[item]) {
      existing.spoilsAtTick = currentTick + SPOIL_TICKS[item]!;
    }
  } else {
    const entry: InventoryItem = { type: item, quantity: qty };
    if (currentTick && SPOIL_TICKS[item]) {
      entry.spoilsAtTick = currentTick + SPOIL_TICKS[item]!;
    }
    inventory.items.push(entry);
  }
}

export function removeFromInventory(inventory: Inventory, item: ItemType, qty: number): void {
  const found = inventory.items.find(i => i.type === item);
  if (!found) return;
  found.quantity = Math.max(0, found.quantity - qty);
  if (found.quantity === 0) {
    inventory.items = inventory.items.filter(i => i.type !== item);
  }
}

export function reserveInventory(
  agent: AgentName,
  item: ItemType,
  qty: number,
  state: WorldState,
): void {
  const inv = state.economics[agent].inventory;
  const found = inv.items.find(i => i.type === item);
  if (!found) return;
  found.reserved = (found.reserved ?? 0) + qty;
}

export function unreserveInventory(
  agent: AgentName,
  item: ItemType,
  qty: number,
  state: WorldState,
): void {
  const inv = state.economics[agent].inventory;
  const found = inv.items.find(i => i.type === item);
  if (!found) return;
  found.reserved = Math.max(0, (found.reserved ?? 0) - qty);
}

// Called at dawn — removes spoiled items, cancels orphaned sell orders, and gives feedback
export function checkSpoilage(state: WorldState, time: SimTime): void {
  for (const agent of getAgentNames()) {
    const inv = state.economics[agent].inventory;
    const spoiled: string[] = [];
    const spoiledTypes: ItemType[] = [];
    inv.items = inv.items.filter(item => {
      if (item.spoilsAtTick && time.tick > item.spoilsAtTick) {
        spoiled.push(`${item.quantity} ${item.type}`);
        spoiledTypes.push(item.type);
        return false;
      }
      return true;
    });
    if (spoiled.length > 0) {
      feedbackToAgent(agent, state, `Your ${spoiled.join(", ")} spoiled overnight.`);
      // Cancel any sell orders for spoiled items — their inventory entries are now gone
      for (const itemType of spoiledTypes) {
        const cancelledOrders = state.marketplace.orders.filter(
          o => o.agentId === agent && o.item === itemType && o.type === "sell"
        );
        if (cancelledOrders.length > 0) {
          state.marketplace.orders = state.marketplace.orders.filter(
            o => !(o.agentId === agent && o.item === itemType && o.type === "sell")
          );
          feedbackToAgent(agent, state, `Your sell order for ${itemType} was cancelled (spoiled).`);
          for (const order of cancelledOrders) {
            emitSSE("order:cancelled", { orderId: order.id, agentId: agent, orderType: "sell", item: order.item, quantity: order.quantity, price: order.price });
          }
        }
      }
    }
  }
}

export function clampReservations(state: WorldState): void {
  for (const agent of getAgentNames()) {
    for (const item of state.economics[agent].inventory.items) {
      if ((item.reserved ?? 0) > item.quantity) {
        item.reserved = item.quantity;
      }
    }
  }
}

export function calcInventoryValue(inventory: Inventory, priceIndex: Record<ItemType, number>): number {
  return inventory.items.reduce((sum, item) => {
    return sum + item.quantity * (priceIndex[item.type] ?? 0);
  }, 0);
}

// Circular dependency helper — imported by other modules
export function feedbackToAgent(agent: AgentName, state: WorldState, msg: string): void {
  if (!state.action_feedback[agent]) state.action_feedback[agent] = [];
  state.action_feedback[agent].push(msg);
}
