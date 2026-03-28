import type { AgentName, ItemType, Marketplace, Order, Trade, WorldState, SimTime } from "./types.js";
import { getAgentVillage, isRoadLocation, getVillageForLocation } from "./world-registry.js";
import { addToInventory, removeFromInventory, unreserveInventory, feedbackToAgent } from "./inventory.js";
import { emitSSE } from "./events.js";

// ─── Per-village marketplace access ──────────────────────────

export function getAgentMarketplace(agent: string, state: WorldState): Marketplace {
  const currentLoc = state.agent_locations?.[agent as keyof typeof state.agent_locations];
  let vid: string;
  if (currentLoc && !isRoadLocation(currentLoc)) {
    vid = getVillageForLocation(currentLoc) ?? state.economics[agent]?.villageId ?? getAgentVillage(agent);
  } else {
    vid = state.economics[agent]?.villageId ?? getAgentVillage(agent);
  }
  if (state.marketplaces) return state.marketplaces[vid] ?? state.marketplace;
  return state.marketplace;
}

let _tradeIdCounter = 1;

function generateTradeId(): string {
  return `trade_${Date.now()}_${_tradeIdCounter++}`;
}

export function generateOrderId(): string {
  return `order_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export function addOrder(marketplace: Marketplace, order: Order): void {
  marketplace.orders.push(order);
}

export function removeOrder(marketplace: Marketplace, orderId: string): void {
  marketplace.orders = marketplace.orders.filter(o => o.id !== orderId);
}

export function updatePriceIndex(marketplace: Marketplace, item: ItemType, price: number): void {
  if (!marketplace.priceHistory[item]) marketplace.priceHistory[item] = [];
  marketplace.priceHistory[item].push({ tick: Date.now(), price });
  // Keep last 10 trades
  if (marketplace.priceHistory[item].length > 10) {
    marketplace.priceHistory[item].shift();
  }
  // Rolling average
  const history = marketplace.priceHistory[item];
  marketplace.priceIndex[item] = Math.round(
    history.reduce((s, e) => s + e.price, 0) / history.length
  );
}

export function executeTrade(
  buyer: AgentName,
  seller: AgentName,
  item: ItemType,
  quantity: number,
  pricePerUnit: number,
  state: WorldState,
  time: SimTime,
): Trade {
  const total = pricePerUnit * quantity;

  // Transfer coins
  state.economics[buyer].wallet -= total;
  state.economics[seller].wallet += total;

  // Transfer items: remove from seller (un-reserve first), add to buyer
  unreserveInventory(seller, item, quantity, state);
  removeFromInventory(state.economics[seller].inventory, item, quantity);
  addToInventory(state.economics[buyer].inventory, item, quantity, time.tick);

  // If buyer received iron_tools and has no equipped tool, auto-equip
  if (item === "iron_tools") {
    const eco = state.economics[buyer];
    if (!eco.tool || eco.tool.durability === 0) {
      removeFromInventory(eco.inventory, "iron_tools", 1);
      eco.tool = { type: "iron_tools", durability: 100 };
      feedbackToAgent(buyer, state, "You equipped a fresh set of iron tools.");
    }
  }

  // Update price index for the seller's village marketplace
  const mkt = getAgentMarketplace(seller, state);
  updatePriceIndex(mkt, item, pricePerUnit);

  const trade: Trade = {
    id: generateTradeId(),
    tick: time.tick,
    buyer,
    seller,
    item,
    quantity,
    pricePerUnit,
    total,
  };

  mkt.history.push(trade);
  if (mkt.history.length > 100) {
    mkt.history.shift();
  }

  return trade;
}

// Returns orders most relevant to this agent (their own + items they produce or need)
export function getRelevantOrders(agent: AgentName, state: WorldState): Order[] {
  const mkt = getAgentMarketplace(agent, state);
  const orders = mkt.orders.filter(o => o.expiresAtTick > state.current_tick);

  // Show: own orders + buy orders for items they produce + sell orders for items they need
  return orders.filter(o =>
    o.agentId === agent ||
    o.type === "sell" ||    // buyers always want to see what's for sale
    o.type === "buy"        // sellers always want to see demand
  ).slice(0, 12);           // cap at 12 lines in perception
}

export function expireOrders(state: WorldState, time: SimTime): void {
  // Expire orders in all marketplaces (single-village or multi-village)
  const marketplaces = state.marketplaces
    ? Object.values(state.marketplaces)
    : [state.marketplace];

  for (const mkt of marketplaces) {
    const expired = mkt.orders.filter(o => o.expiresAtTick <= time.tick);
    for (const order of expired) {
      if (order.type === "sell") {
        unreserveInventory(order.agentId, order.item, order.quantity, state);
        feedbackToAgent(order.agentId, state, `Your sell order for ${order.quantity} ${order.item} expired.`);
      }
      emitSSE("order:expired", { orderId: order.id, agentId: order.agentId, orderType: order.type, item: order.item, quantity: order.quantity, price: order.price });
    }
    mkt.orders = mkt.orders.filter(o => o.expiresAtTick > time.tick);
  }
}

export function getAgentOrders(agent: AgentName, marketplace: Marketplace): Order[] {
  return marketplace.orders.filter(o => o.agentId === agent);
}
