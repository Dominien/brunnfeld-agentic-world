import { useState } from "react";
import { useVillageStore } from "../store";
import type { ItemType } from "../types";

const ITEM_DISPLAY: Record<string, string> = {
  wheat: "Wheat", flour: "Flour", bread: "Bread", meat: "Meat", milk: "Milk",
  eggs: "Eggs", vegetables: "Veg", herbs: "Herbs", medicine: "Medicine",
  iron_ore: "Iron Ore", coal: "Coal", iron_tools: "Tools",
  timber: "Timber", firewood: "Firewood", furniture: "Furniture",
  ale: "Ale", meal: "Meal", cloth: "Cloth",
};

const ITEM_EMOJI: Record<string, string> = {
  wheat: "🌾", flour: "⚪", bread: "🍞", meat: "🥩", milk: "🥛",
  eggs: "🥚", vegetables: "🥦", herbs: "🌿", medicine: "💊",
  iron_ore: "🪨", coal: "⬛", iron_tools: "⚒",
  timber: "🪵", firewood: "🔥", furniture: "🪑",
  ale: "🍺", meal: "🍲", cloth: "🧵",
};

function Sparkline({ data, width, height, color }: { data: number[]; width: number; height: number; color: string }) {
  if (data.length < 2) return <span style={{ fontSize: 10, color: "#6a5030" }}>—</span>;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyLine = pts.join(" ");
  const areaPoly = `0,${height} ${polyLine} ${width},${height}`;

  return (
    <svg width={width} height={height} style={{ overflow: "visible", display: "block" }}>
      <polygon points={areaPoly} fill={`${color}33`} />
      <polyline points={polyLine} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

type SubView = "prices" | "economy";

function PricesView() {
  const world = useVillageStore((s) => s.world);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!world) return null;

  const items = Object.keys(ITEM_DISPLAY) as ItemType[];
  const prices = world.marketplace.priceIndex;

  return (
    <div>
      {items.map((item) => {
        const price = prices[item] ?? 0;
        const history = (world.marketplace.priceHistory[item] ?? []).slice(-50);
        const priceData = history.map((h) => h.price);
        const prev = priceData.length >= 2 ? priceData[priceData.length - 2] : null;
        const firstPrice = priceData.length > 0 ? priceData[0] : null;
        const trendPct = firstPrice && firstPrice > 0 && price !== firstPrice
          ? ((price - firstPrice) / firstPrice * 100)
          : null;
        const trend = prev == null ? "–" : price > prev ? "↑" : price < prev ? "↓" : "–";
        const trendColor = trend === "↑" ? "#e84030" : trend === "↓" ? "#40d060" : "#c8a060";
        const sparkColor = trend === "↑" ? "#e84030" : trend === "↓" ? "#40d060" : "#c8a060";
        const isExpanded = expanded === item;

        return (
          <div key={item} style={{ borderBottom: "1px solid rgba(80,50,10,0.2)" }}>
            <div
              onClick={() => setExpanded(isExpanded ? null : item)}
              style={{
                height: 28, display: "flex", alignItems: "center", gap: 6,
                padding: "0 8px", cursor: "pointer",
                background: isExpanded ? "rgba(60,40,10,0.3)" : "transparent",
              }}
            >
              <span style={{ fontSize: 12, width: 16, flexShrink: 0 }}>{ITEM_EMOJI[item]}</span>
              <span style={{ fontSize: 10, color: "#d0c080", flex: 1, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {ITEM_DISPLAY[item] ?? item}
              </span>
              <span style={{ fontSize: 10, color: "#f0d840", fontFamily: "monospace", width: 26, textAlign: "right", flexShrink: 0 }}>
                {price}c
              </span>
              <div style={{ width: 80, flexShrink: 0 }}>
                <Sparkline data={priceData} width={80} height={18} color={sparkColor} />
              </div>
              <span style={{ fontSize: 9, color: trendColor, width: 38, textAlign: "right", fontFamily: "monospace", flexShrink: 0 }}>
                {trendPct != null ? `${trendPct > 0 ? "+" : ""}${trendPct.toFixed(0)}%` : trend}
              </span>
            </div>
            {isExpanded && priceData.length > 0 && (
              <div style={{ padding: "8px 8px 10px", background: "rgba(20,12,4,0.5)" }}>
                <div style={{ fontSize: 9, color: "#6a5030", marginBottom: 4 }}>
                  Price history ({priceData.length} ticks)
                </div>
                <Sparkline data={priceData} width={268} height={50} color={sparkColor} />
                <div style={{ fontSize: 9, color: "#6a5030", marginTop: 4, display: "flex", gap: 12 }}>
                  <span>Min: <span style={{ color: "#40d060" }}>{Math.min(...priceData)}c</span></span>
                  <span>Max: <span style={{ color: "#e84030" }}>{Math.max(...priceData)}c</span></span>
                  <span>Now: <span style={{ color: "#f0d840" }}>{price}c</span></span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EconomyView() {
  const world = useVillageStore((s) => s.world);
  const latestEconomy = useVillageStore((s) => s.latestEconomy);

  if (!world) return null;

  const snapshots = (world.economy_snapshots ?? []).slice(-100);
  const wealthData = snapshots.map((s) => s.totalWealth);
  const gdpData = snapshots.map((s) => s.gdp);
  const giniData = snapshots.map((s) => s.giniCoefficient);

  // Compute live values directly from world state — always available
  const agents = Object.values(world.economics);
  const liveWealth = agents.reduce((s, e) => s + e.wallet, 0);
  const liveWallets = agents.map(e => e.wallet).sort((a, b) => a - b);
  const n = liveWallets.length;
  const liveGini = liveWealth > 0
    ? Math.round(liveWallets.reduce((acc, v, i) => acc + (2 * (i + 1) - n - 1) * v, 0) / (n * liveWealth) * 100) / 100
    : 0;
  const liveGdp = world.marketplace.history
    .filter(t => t.tick >= world.current_tick - 16)
    .reduce((s, t) => s + t.total, 0);

  // Wealth distribution: prefer latestEconomy, fall back to live wallet data
  const wealthDist = latestEconomy?.wealthDistribution
    ?? Object.entries(world.economics).map(([agent, eco]) => ({ agent, wallet: eco.wallet, inventoryValue: 0 }));
  const sorted = [...wealthDist].sort((a, b) => (b.wallet + b.inventoryValue) - (a.wallet + a.inventoryValue));
  const maxTotal = sorted.reduce((m, e) => Math.max(m, e.wallet + e.inventoryValue), 1);

  function StatRow({ label, value, color, data, sparkColor }: {
    label: string; value: string; color: string;
    data: number[]; sparkColor: string;
  }) {
    return (
      <div style={{ marginBottom: 14, padding: "0 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div style={{ fontSize: 9, color: "#c8a060", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
          <div style={{ fontSize: 13, color, fontWeight: "bold", fontFamily: "monospace" }}>{value}</div>
        </div>
        {data.length >= 2
          ? <Sparkline data={data} width={268} height={48} color={sparkColor} />
          : <div style={{ fontSize: 9, color: "#4a3020", fontStyle: "italic" }}>collecting history…</div>
        }
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      <StatRow label="Total Wealth" value={`${liveWealth}c`} color="#f0c040" data={wealthData} sparkColor="#f0c040" />
      <StatRow label="GDP (last day)" value={`${liveGdp}c`} color="#80c8ff" data={gdpData} sparkColor="#80c8ff" />
      <StatRow
        label="Gini Coefficient (lower = more equal)"
        value={liveGini.toFixed(2)}
        color={liveGini > 0.5 ? "#e84030" : liveGini > 0.35 ? "#e8b830" : "#80e080"}
        data={giniData}
        sparkColor="#80e080"
      />

      <div style={{ padding: "0 8px" }}>
        <div style={{ fontSize: 9, color: "#6a5030", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
          Wealth Distribution
        </div>
        {sorted.map((entry) => {
          const total = entry.wallet + entry.inventoryValue;
          const pct = (total / maxTotal) * 100;
          return (
            <div key={entry.agent} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 9, color: "#d0c080", width: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.agent}
              </span>
              <div style={{ flex: 1, height: 5, background: "#2a1c08", borderRadius: 2 }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "#d0a030", borderRadius: 2, transition: "width 0.5s" }} />
              </div>
              <span style={{ fontSize: 9, color: "#f0d840", width: 28, textAlign: "right", fontFamily: "monospace" }}>{total}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StockMarketPanel() {
  const [subView, setSubView] = useState<SubView>("prices");

  return (
    <div style={{
      background: "rgba(10,8,0,0.95)", border: "1px solid #4a3010",
      borderRadius: 6, height: "100%",
      display: "flex", flexDirection: "column", overflow: "hidden",
      fontFamily: "monospace",
    }}>
      {/* Segmented control */}
      <div style={{ display: "flex", borderBottom: "1px solid #4a3010", flexShrink: 0 }}>
        {(["prices", "economy"] as SubView[]).map((v) => (
          <button
            key={v}
            onClick={() => setSubView(v)}
            style={{
              flex: 1, padding: "6px",
              background: subView === v ? "rgba(60,40,10,0.4)" : "transparent",
              border: "none",
              borderBottom: subView === v ? "2px solid #f0c040" : "2px solid transparent",
              color: subView === v ? "#f0c040" : "#6a5030",
              fontSize: 10, fontWeight: "bold", letterSpacing: 1,
              textTransform: "uppercase", cursor: "pointer",
            }}
          >
            {v === "prices" ? "Prices" : "Economy"}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {subView === "prices" ? <PricesView /> : <EconomyView />}
      </div>
    </div>
  );
}
