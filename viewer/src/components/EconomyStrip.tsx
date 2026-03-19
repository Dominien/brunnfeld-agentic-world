import { useVillageStore } from "../store";

const STRIP_ITEMS = [
  "wheat", "flour", "bread", "meat", "timber", "coal", "iron_tools", "ale", "cloth", "medicine",
] as const;

const ITEM_EMOJI: Record<string, string> = {
  wheat: "🌾", flour: "⚪", bread: "🍞", meat: "🥩", milk: "🥛",
  eggs: "🥚", vegetables: "🥦", herbs: "🌿", medicine: "💊",
  iron_ore: "🪨", coal: "⬛", iron_tools: "⚒",
  timber: "🪵", firewood: "🔥", furniture: "🪑",
  ale: "🍺", meal: "🍲", cloth: "🧵",
};

export default function EconomyStrip() {
  const world = useVillageStore((s) => s.world);
  const latestEconomy = useVillageStore((s) => s.latestEconomy);
  const orderFeed = useVillageStore((s) => s.orderFeed);

  const prices = world?.marketplace.priceIndex ?? {};
  const history = world?.marketplace.priceHistory ?? {};

  const tradeCount = orderFeed.filter((e) => e.kind === "filled").length;
  const agentCount = world ? Object.keys(world.agent_locations).length : 0;
  const activeOrders = world?.marketplace.orders.length ?? 0;

  return (
    <div style={{
      height: 32,
      background: "linear-gradient(to top, #060300, #0a0600)",
      borderTop: "1px solid #2a1a06",
      display: "flex",
      alignItems: "center",
      flexShrink: 0,
      overflow: "hidden",
      fontFamily: "monospace",
    }}>
      {/* Commodity prices */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", overflow: "hidden" }}>
        {STRIP_ITEMS.map((item) => {
          const price = prices[item] ?? 0;
          const hist = (history[item] ?? []).slice(-3);
          const prev = hist.length >= 2 ? hist[hist.length - 2]?.price : null;
          const dir = prev == null ? null : price > prev ? "up" : price < prev ? "down" : null;
          const priceColor = dir === "up" ? "#e84030" : dir === "down" ? "#40d060" : "#d0b050";

          return (
            <div
              key={item}
              style={{
                display: "flex", alignItems: "center", gap: 3,
                padding: "0 8px", height: "100%",
                borderRight: "1px solid #1a1006",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 11 }}>{ITEM_EMOJI[item]}</span>
              <span style={{ fontSize: 10, color: priceColor, fontWeight: "bold" }}>
                {price > 0 ? `${price}¢` : "—"}
              </span>
              {dir && (
                <span style={{ fontSize: 8, color: priceColor, lineHeight: 1 }}>
                  {dir === "up" ? "↑" : "↓"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Right stats */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "0 12px", flexShrink: 0,
        borderLeft: "1px solid #1a1006",
      }}>
        {latestEconomy && (
          <>
            <span style={{ fontSize: 9, color: "#7a6030" }}>
              GDP <span style={{ color: "#f0c040" }}>{latestEconomy.gdp}</span>
            </span>
            <span style={{ fontSize: 9, color: "#7a6030" }}>
              Gini <span style={{ color: "#c0d080" }}>{latestEconomy.giniCoefficient.toFixed(2)}</span>
            </span>
          </>
        )}
        <span style={{ fontSize: 9, color: "#7a6030" }}>
          <span style={{ color: "#50d870" }}>{tradeCount}</span>
          {" "}trades
        </span>
        <span style={{ fontSize: 9, color: "#7a6030" }}>
          <span style={{ color: "#c8a060" }}>{activeOrders}</span>
          {" "}orders
        </span>
        <span style={{ fontSize: 9, color: "#7a6030" }}>
          <span style={{ color: "#80b8e0" }}>{agentCount}</span>
          {" "}agents
        </span>
      </div>
    </div>
  );
}
