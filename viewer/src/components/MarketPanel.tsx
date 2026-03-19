import { useState, useEffect, useRef } from "react";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { ItemType } from "../types";
import type { OrderFeedEntry } from "../store";

// ─── Constants ──────────────────────────────────────────────────────────────

const ITEM_DISPLAY: Record<string, string> = {
  wheat: "Wheat", flour: "Flour", bread: "Bread", meat: "Meat", milk: "Milk",
  eggs: "Eggs", vegetables: "Veg.", herbs: "Herbs", medicine: "Medicine",
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

const ITEMS = Object.keys(ITEM_DISPLAY) as ItemType[];

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({ data, width, height, color }: { data: number[]; width: number; height: number; color: string }) {
  if (data.length < 2) return <span style={{ color: "#4a3020", fontSize: 9 }}>—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <polygon points={area} fill={`${color}28`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

// ─── Trade Ticker Tape ───────────────────────────────────────────────────────

function TradeTape() {
  const orderFeed = useVillageStore((s) => s.orderFeed);
  const fills = orderFeed.filter((e) => e.kind === "filled").slice(0, 30);

  if (fills.length === 0) {
    return (
      <div style={{ height: 24, background: "#060300", borderBottom: "1px solid #3a2810", display: "flex", alignItems: "center", padding: "0 10px" }}>
        <span style={{ fontSize: 9, color: "#4a3020", fontFamily: "monospace" }}>Awaiting market activity…</span>
      </div>
    );
  }

  const content = fills
    .map((e) => `${ITEM_EMOJI[e.item!] ?? "📦"} ${e.quantity}×${e.item}@${e.price}¢`)
    .join("   ·   ");

  const duration = Math.max(12, content.length * 0.1);

  return (
    <div style={{ height: 24, background: "#060300", borderBottom: "1px solid #3a2810", overflow: "hidden", position: "relative", flexShrink: 0 }}>
      <div
        key={fills[0]?.id}
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: "100%",
          animation: `tradeTape ${duration}s linear infinite`,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontSize: 10, color: "#c89030", fontFamily: "monospace", paddingRight: 80 }}>{content}</span>
        <span style={{ fontSize: 10, color: "#c89030", fontFamily: "monospace", paddingRight: 80 }}>{content}</span>
      </div>
      <style>{`@keyframes tradeTape { to { transform: translateX(-50%); } }`}</style>
    </div>
  );
}

// ─── Order Book (per-item accordion) ─────────────────────────────────────────

function OrderBook({ item }: { item: string }) {
  const world = useVillageStore((s) => s.world);
  if (!world) return null;

  const asks = world.marketplace.orders
    .filter((o) => o.type === "sell" && o.item === item)
    .sort((a, b) => a.price - b.price);
  const bids = world.marketplace.orders
    .filter((o) => o.type === "buy" && o.item === item)
    .sort((a, b) => b.price - a.price);

  const bestAsk = asks[0]?.price ?? null;
  const bestBid = bids[0]?.price ?? null;
  const spread = bestAsk != null && bestBid != null ? bestAsk - bestBid : null;

  const maxQty = Math.max(...[...asks, ...bids].map((o) => o.quantity), 1);

  const Row = ({ o, side }: { o: (typeof asks)[0]; side: "ask" | "bid" }) => {
    const color = side === "ask" ? "#e88040" : "#40a8e0";
    const pct = (o.quantity / maxQty) * 100;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 0", fontSize: 10, fontFamily: "monospace", position: "relative" }}>
        <div style={{
          position: "absolute", right: 0, top: 0, bottom: 0,
          width: `${pct}%`, background: `${color}18`, borderRadius: 2,
          zIndex: 0,
        }} />
        <span style={{ color, width: 26, textAlign: "right", fontWeight: "bold", zIndex: 1 }}>{o.price}¢</span>
        <span style={{ color: "#d0c080", width: 22, textAlign: "right", zIndex: 1 }}>{o.quantity}</span>
        <span style={{ color: "#7a6040", flex: 1, zIndex: 1 }}>{AGENT_DISPLAY[o.agentId]}</span>
      </div>
    );
  };

  return (
    <div style={{ padding: "6px 10px 8px", background: "rgba(6,4,0,0.8)", borderBottom: "1px solid #3a2810" }}>
      <div style={{ display: "flex", gap: 16 }}>

        {/* Asks */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: "#e88040", marginBottom: 3, textTransform: "uppercase", letterSpacing: 1 }}>Asks</div>
          {asks.length === 0
            ? <div style={{ fontSize: 9, color: "#4a3020" }}>no sell orders</div>
            : asks.slice(0, 5).map((o) => <Row key={o.id} o={o} side="ask" />)
          }
        </div>

        {/* Bids */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: "#40a8e0", marginBottom: 3, textTransform: "uppercase", letterSpacing: 1 }}>Bids</div>
          {bids.length === 0
            ? <div style={{ fontSize: 9, color: "#4a3020" }}>no buy orders</div>
            : bids.slice(0, 5).map((o) => <Row key={o.id} o={o} side="bid" />)
          }
        </div>
      </div>

      {spread != null && (
        <div style={{ fontSize: 9, color: "#6a5030", marginTop: 4, textAlign: "center", fontFamily: "monospace" }}>
          spread: {spread}¢
        </div>
      )}
    </div>
  );
}

// ─── Price Board ─────────────────────────────────────────────────────────────

function PriceBoard() {
  const world = useVillageStore((s) => s.world);
  const priceFlashes = useVillageStore((s) => s.priceFlashes);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  // Force re-render every second to clear stale flashes
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!world) return null;

  const prices = world.marketplace.priceIndex;
  const now = Date.now();

  return (
    <div>
      {ITEMS.map((item) => {
        const price = prices[item] ?? 0;
        const history = (world.marketplace.priceHistory[item] ?? []).slice(-20);
        const priceData = history.map((h) => h.price);
        const prev = priceData.length >= 2 ? priceData[priceData.length - 2] : null;
        const trend = prev == null ? null : price > prev ? "up" : price < prev ? "down" : null;
        const trendColor = trend === "up" ? "#e84030" : trend === "down" ? "#40d060" : "#6a5030";

        const flash = priceFlashes[item];
        const isFlashing = flash && (now - flash.at) < 1200;
        const flashColor = flash?.dir === "up" ? "rgba(240,60,40,0.2)" : "rgba(60,200,80,0.2)";

        const isOpen = expandedItem === item;

        return (
          <div key={item} style={{ borderBottom: "1px solid rgba(60,40,10,0.3)" }}>
            <div
              onClick={() => setExpandedItem(isOpen ? null : item)}
              style={{
                height: 28, display: "flex", alignItems: "center", gap: 5,
                padding: "0 8px", cursor: "pointer", position: "relative",
                background: isOpen ? "rgba(50,30,5,0.4)" : "transparent",
              }}
            >
              {/* Flash overlay */}
              {isFlashing && (
                <div
                  key={flash.at}
                  style={{
                    position: "absolute", inset: 0,
                    background: flashColor,
                    animation: "priceFlash 1.2s ease-out forwards",
                    pointerEvents: "none",
                  }}
                />
              )}

              <span style={{ fontSize: 12, width: 16, flexShrink: 0, zIndex: 1 }}>{ITEM_EMOJI[item]}</span>
              <span style={{
                fontSize: 10, color: "#d0c080", width: 56, fontFamily: "monospace",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", zIndex: 1,
              }}>
                {ITEM_DISPLAY[item]}
              </span>
              <span style={{ fontSize: 11, color: "#f0d840", fontWeight: "bold", fontFamily: "monospace", width: 28, textAlign: "right", flexShrink: 0, zIndex: 1 }}>
                {price}¢
              </span>
              <div style={{ flex: 1, zIndex: 1 }}>
                <Sparkline data={priceData} width={60} height={18} color={trendColor} />
              </div>
              <span style={{ fontSize: 9, color: trendColor, width: 10, textAlign: "center", flexShrink: 0, fontWeight: "bold", zIndex: 1 }}>
                {trend === "up" ? "↑" : trend === "down" ? "↓" : "—"}
              </span>
            </div>

            {isOpen && <OrderBook item={item} />}
          </div>
        );
      })}

      <style>{`
        @keyframes priceFlash {
          0%   { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Order Activity Feed ──────────────────────────────────────────────────────

const KIND_ICON: Record<OrderFeedEntry["kind"], string> = {
  posted: "📋",
  filled: "✓",
  cancelled: "✗",
  expired: "⏱",
};

const KIND_COLOR: Record<OrderFeedEntry["kind"], string> = {
  posted: "#c8a060",
  filled: "#40d060",
  cancelled: "#a06040",
  expired: "#705040",
};

const SIDE_COLOR: Record<string, string> = {
  sell: "#e88040",
  buy: "#40a8e0",
};

function ActivityRow({ entry }: { entry: OrderFeedEntry }) {
  const color = KIND_COLOR[entry.kind];
  const ago = Math.round((Date.now() - entry.at) / 1000);
  const agoStr = ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`;

  return (
    <div style={{
      padding: "3px 10px",
      borderBottom: "1px solid rgba(60,40,10,0.2)",
      display: "flex", alignItems: "center", gap: 5,
      fontFamily: "monospace", fontSize: 10,
    }}>
      <span style={{ color, width: 14, flexShrink: 0, fontWeight: "bold" }}>{KIND_ICON[entry.kind]}</span>

      {entry.kind === "posted" && (
        <>
          <span style={{ color: SIDE_COLOR[entry.side ?? "sell"] ?? "#c8a060", width: 26, flexShrink: 0 }}>
            {(entry.side ?? "—").toUpperCase()}
          </span>
          <span style={{ color: "#f0d840", flexShrink: 0 }}>{entry.quantity}×{entry.item}</span>
          <span style={{ color: "#c8a060", flexShrink: 0 }}>@{entry.price}¢</span>
          <span style={{ color: "#a09060", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{AGENT_DISPLAY[entry.agent]}</span>
        </>
      )}

      {entry.kind === "filled" && (
        <>
          <span style={{ color: "#40d060", flexShrink: 0 }}>{entry.quantity}×{entry.item}</span>
          <span style={{ color: "#c8a060", flexShrink: 0 }}>@{entry.price}¢</span>
          <span style={{ color: "#a09060", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
            {AGENT_DISPLAY[entry.agent]}←{AGENT_DISPLAY[entry.counterAgent!]}
          </span>
        </>
      )}

      {(entry.kind === "cancelled" || entry.kind === "expired") && (
        <>
          <span style={{ color: "#705040", flexShrink: 0 }}>
            {entry.kind === "expired" ? "XPIR" : "CNCL"}
          </span>
          {entry.item && <span style={{ color: "#906040", flexShrink: 0 }}>{entry.quantity}×{entry.item}</span>}
          <span style={{ color: "#7a6040", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{AGENT_DISPLAY[entry.agent]}</span>
        </>
      )}

      <span style={{ color: "#4a3020", flexShrink: 0, width: 24, textAlign: "right" }}>{agoStr}</span>
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function MarketHeader() {
  const latestEconomy = useVillageStore((s) => s.latestEconomy);
  const world = useVillageStore((s) => s.world);
  const orderFeed = useVillageStore((s) => s.orderFeed);
  const activeOrders = world?.marketplace.orders.length ?? 0;

  return (
    <div style={{
      padding: "6px 10px", borderBottom: "1px solid #3a2810",
      display: "flex", gap: 10, alignItems: "center", flexShrink: 0,
      background: "rgba(6,4,0,0.6)",
    }}>
      <span style={{ fontSize: 11, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, textTransform: "uppercase", fontFamily: "Georgia" }}>
        Market
      </span>
      <span style={{ fontSize: 9, color: "#6a5030" }}>
        {activeOrders} <span style={{ color: "#a09050" }}>orders</span>
      </span>
      {latestEconomy && (
        <>
          <span style={{ fontSize: 9, color: "#6a5030" }}>
            GDP <span style={{ color: "#f0c040" }}>{latestEconomy.gdp}</span>
          </span>
          <span style={{ fontSize: 9, color: "#6a5030" }}>
            Gini <span style={{ color: "#c0d080" }}>{latestEconomy.giniCoefficient.toFixed(2)}</span>
          </span>
          {latestEconomy.scarcityAlerts.length > 0 && (
            <span style={{ fontSize: 9, color: "#ff6040", marginLeft: "auto" }}>
              ⚠ {latestEconomy.scarcityAlerts.slice(0, 2).join(", ")}
            </span>
          )}
        </>
      )}
      <span style={{ fontSize: 9, color: "#4a3020", marginLeft: "auto" }}>
        {orderFeed.length > 0 ? `${orderFeed.length} events` : ""}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MarketPanel() {
  const world = useVillageStore((s) => s.world);
  const orderFeed = useVillageStore((s) => s.orderFeed);
  const activityRef = useRef<HTMLDivElement>(null);

  // Auto-scroll activity feed to top on new entry
  useEffect(() => {
    if (activityRef.current) activityRef.current.scrollTop = 0;
  }, [orderFeed[0]?.id]);

  if (!world) {
    return (
      <div style={{
        background: "rgba(12,8,3,0.95)", border: "1px solid #4a3010",
        borderRadius: 6, height: "100%", display: "flex", alignItems: "center",
        justifyContent: "center", color: "#4a3020", fontFamily: "Georgia", fontSize: 12,
      }}>
        Loading market…
      </div>
    );
  }

  return (
    <div style={{
      background: "rgba(8,5,0,0.98)", border: "1px solid #4a3010",
      borderRadius: 6, height: "100%",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <MarketHeader />
      <TradeTape />

      {/* Price board — fixed section with internal scroll */}
      <div style={{ maxHeight: 260, overflowY: "auto", flexShrink: 0, borderBottom: "1px solid #3a2810" }}>
        <PriceBoard />
      </div>

      {/* Activity feed — fills remaining space */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <div style={{
          padding: "4px 10px", borderBottom: "1px solid rgba(60,40,10,0.25)",
          fontSize: 9, color: "#6a5030", textTransform: "uppercase", letterSpacing: 1,
          flexShrink: 0, fontFamily: "monospace",
          display: "flex", justifyContent: "space-between",
        }}>
          <span>Order Activity</span>
          <span style={{ color: "#4a3020" }}>live</span>
        </div>

        <div ref={activityRef} style={{ flex: 1, overflowY: "auto" }}>
          {orderFeed.length === 0 ? (
            <div style={{ padding: 16, textAlign: "center", color: "#4a3020", fontSize: 11, fontFamily: "Georgia" }}>
              Awaiting market events…
            </div>
          ) : (
            orderFeed.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
          )}
        </div>
      </div>
    </div>
  );
}
