import type { AgentName, EconomySnapshot, ItemType, WorldState, SimTime } from "./types.js";
import { AGENT_NAMES, ALL_ITEMS } from "./types.js";
import { calcInventoryValue } from "./inventory.js";

export function takeEconomySnapshot(state: WorldState, time: SimTime): void {
  // Only snapshot once per day (at dawn)
  if (!time.isFirstTickOfDay) return;

  const wallets = AGENT_NAMES.map(a => state.economics[a].wallet);
  const totalWealth = wallets.reduce((a, b) => a + b, 0);

  // Gini coefficient
  const sorted = [...wallets].sort((a, b) => a - b);
  const n = sorted.length;
  const gini = totalWealth > 0
    ? sorted.reduce((acc, val, i) => acc + (2 * (i + 1) - n - 1) * val, 0) / (n * totalWealth)
    : 0;

  // GDP: total trade volume since last snapshot
  const yesterdayStart = time.tick - 16;
  const gdp = state.marketplace.history
    .filter(t => t.tick >= yesterdayStart && t.total > 0)
    .reduce((a, t) => a + t.total, 0);

  // Scarcity alerts: items where total village supply < 5
  const scarcityAlerts: ItemType[] = [];
  for (const item of ALL_ITEMS) {
    const totalSupply = AGENT_NAMES.reduce((sum, a) => {
      return sum + (state.economics[a].inventory.items.find(i => i.type === item)?.quantity ?? 0);
    }, 0);
    if (totalSupply < 5 && ["bread", "meat", "milk", "medicine"].includes(item)) {
      scarcityAlerts.push(item);
    }
  }

  const snapshot: EconomySnapshot = {
    tick: time.tick,
    day: time.dayNumber,
    season: state.season,
    totalWealth,
    giniCoefficient: Math.round(gini * 100) / 100,
    gdp,
    priceIndex: { ...state.marketplace.priceIndex },
    scarcityAlerts,
    wealthDistribution: AGENT_NAMES.map(a => ({
      agent: a,
      wallet: state.economics[a].wallet,
      inventoryValue: calcInventoryValue(state.economics[a].inventory, state.marketplace.priceIndex),
    })),
  };

  state.economy_snapshots.push(snapshot);
  if (state.economy_snapshots.length > 28) {
    state.economy_snapshots.shift();
  }

  // Clear daily production log
  state.production_log = state.production_log.filter(e => e.tick >= yesterdayStart);

  if (scarcityAlerts.length > 0) {
    console.log(`  ⚠  Scarcity alert: ${scarcityAlerts.join(", ")}`);
  }
}

export function getEconomySummary(state: WorldState): string {
  const last = state.economy_snapshots[state.economy_snapshots.length - 1];
  if (!last) return "";
  return `Economy — Wealth: ${last.totalWealth}c | Gini: ${last.giniCoefficient} | GDP: ${last.gdp}c/day${last.scarcityAlerts.length > 0 ? ` | SCARCE: ${last.scarcityAlerts.join(",")}` : ""}`;
}
