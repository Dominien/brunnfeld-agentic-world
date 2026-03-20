import { useState } from "react";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { AgentName } from "../types";

// ─── Locations for move dropdown ──────────────────────────────

const ALL_LOCATIONS = [
  "Village Square", "Bakery", "Tavern", "Forge", "Carpenter Shop", "Mill", "Church",
  "Elder's House", "Cottage 1", "Cottage 2", "Cottage 3", "Cottage 4", "Cottage 5",
  "Cottage 6", "Cottage 7", "Cottage 8", "Cottage 9", "Seamstress Cottage",
  "Healer's Hut", "Farm 1", "Farm 2", "Farm 3", "Forest", "Mine", "Merchant Camp",
];

// ─── Produceable items by skill ───────────────────────────────

const SKILL_ITEMS: Record<string, string[]> = {
  farmer:     ["wheat", "vegetables", "eggs"],
  baker:      ["bread"],
  miner:      ["iron_ore", "coal"],
  carpenter:  ["furniture"],
  blacksmith: ["iron_tools"],
  merchant:   [],
  none:       [],
};

// ─── Mini bar component ───────────────────────────────────────

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: "#907050", marginRight: 4 }}>{label}</span>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} style={{
          display: "inline-block",
          width: 9, height: 9,
          marginRight: 1,
          background: i < value ? color : "rgba(60,40,20,0.6)",
          borderRadius: 2,
          border: "1px solid rgba(100,70,30,0.4)",
        }} />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────

export default function PlayerHUD() {
  const world = useVillageStore(s => s.world);
  const playerName = useVillageStore(s => s.playerName);

  const [moveLoc, setMoveLoc] = useState("Village Square");
  const [produceItem, setProduceItem] = useState("");
  const [buyItem, setBuyItem] = useState("bread");
  const [sellItem, setSellItem] = useState("");
  const [sellQty, setSellQty] = useState(1);
  const [sellPrice, setSellPrice] = useState(5);
  const [statusMsg, setStatusMsg] = useState("");

  if (!world) return null;

  const playerEco = world.economics["player"];
  const playerBody = world.body["player"];
  const playerLoc = world.agent_locations["player"] ?? "Unknown";

  if (!playerEco) return null;

  const skill = playerEco.skill ?? "none";
  const produceOptions = SKILL_ITEMS[skill] ?? [];
  const currentProduceItem = produceItem || produceOptions[0] || "";

  const inventoryItems = playerEco.inventory?.items ?? [];
  const foodItems = inventoryItems.filter(it =>
    ["bread", "meal", "meat", "vegetables", "eggs", "milk", "ale"].includes(it.type) && it.quantity > 0
  );

  const hasFood = foodItems.length > 0;
  const firstFood = foodItems[0];

  // Sell orders at current location
  const sellOrders = (world.marketplace?.orders ?? [])
    .filter(o => o.type === "sell" && o.agentId !== "player")
    .map(o => o.item)
    .filter((v, i, a) => a.indexOf(v) === i);

  // Leaderboard
  const agents = Object.entries(world.economics) as [AgentName, typeof world.economics[AgentName]][];
  const leaderboard = agents
    .map(([agent, eco]) => ({
      agent,
      name: AGENT_DISPLAY[agent] ?? agent,
      total: (eco?.wallet ?? 0) + (eco?.inventory?.items ?? []).reduce((s, it) => s + it.quantity, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const playerRank = leaderboard.findIndex(e => e.agent === "player");

  async function doAction(action: object) {
    try {
      const res = await fetch("/api/player/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!data.ok) setStatusMsg(data.error ?? "Action failed.");
      else setStatusMsg("");
    } catch {
      setStatusMsg("Server unreachable.");
    }
  }

  const hudBg: React.CSSProperties = {
    width: 200,
    flexShrink: 0,
    height: "100%",
    background: "rgba(8,5,2,0.93)",
    borderRight: "1px solid #3a2008",
    overflowY: "auto",
    fontFamily: "Georgia, serif",
    fontSize: 12,
    color: "#c8a870",
    display: "flex",
    flexDirection: "column",
  };

  const section: React.CSSProperties = {
    padding: "8px 10px",
    borderBottom: "1px solid rgba(80,50,15,0.4)",
  };

  const sectionHeader: React.CSSProperties = {
    fontSize: 10,
    color: "#705030",
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: "uppercase",
  };

  const btn: React.CSSProperties = {
    background: "rgba(80,50,15,0.7)",
    border: "1px solid #6a4010",
    borderRadius: 3,
    color: "#d0a060",
    fontFamily: "Georgia, serif",
    fontSize: 11,
    padding: "3px 8px",
    cursor: "pointer",
    flexShrink: 0,
  };

  const sel: React.CSSProperties = {
    background: "rgba(20,12,4,0.9)",
    border: "1px solid #5a3810",
    borderRadius: 3,
    color: "#c8a060",
    fontFamily: "Georgia, serif",
    fontSize: 11,
    padding: "3px 4px",
    flex: 1,
    minWidth: 0,
  };

  const inp: React.CSSProperties = {
    ...sel,
    width: 44,
    flex: "none",
  };

  const row: React.CSSProperties = {
    display: "flex",
    gap: 4,
    alignItems: "center",
    marginBottom: 5,
  };

  return (
    <div style={hudBg}>
      {/* Player Identity */}
      <div style={{ ...section, paddingTop: 12 }}>
        <div style={{ fontWeight: "bold", color: "#f0c040", fontSize: 14 }}>
          {playerName || "You"}
        </div>
        <div style={{ color: "#907040", fontSize: 11, marginTop: 2 }}>
          {skill.charAt(0).toUpperCase() + skill.slice(1)} · {playerLoc}
        </div>
        <div style={{ color: "#f0c040", fontWeight: "bold", marginTop: 6, fontSize: 13 }}>
          {playerEco.wallet}c
        </div>
        <div style={{ marginTop: 8 }}>
          <StatBar label="Hunger" value={playerBody?.hunger ?? 0} max={5} color="#e05020" />
          <StatBar label="Energy" value={playerBody?.energy ?? 0} max={10} color="#40c060" />
        </div>
      </div>

      {/* Action Queue */}
      <div style={section}>
        <div style={sectionHeader}>Queue an Action</div>

        {/* Move To */}
        <div style={row}>
          <select style={sel} value={moveLoc} onChange={e => setMoveLoc(e.target.value)}>
            {ALL_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <button style={btn} onClick={() => doAction({ type: "move_to", location: moveLoc })}>
            Move
          </button>
        </div>

        {/* Produce */}
        {produceOptions.length > 0 && (
          <div style={row}>
            <select style={sel} value={currentProduceItem} onChange={e => setProduceItem(e.target.value)}>
              {produceOptions.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <button style={btn} onClick={() => doAction({ type: "produce", item: currentProduceItem })}>
              Produce
            </button>
          </div>
        )}

        {/* Buy Item */}
        <div style={row}>
          <select style={sel} value={buyItem} onChange={e => setBuyItem(e.target.value)}>
            {(sellOrders.length > 0 ? sellOrders : ["bread", "wheat", "meat", "ale", "vegetables"]).map(i => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
          <button style={btn} onClick={() => doAction({ type: "buy_item", item: buyItem, max_price: 9999 })}>
            Buy
          </button>
        </div>

        {/* Sell Order */}
        <div style={{ marginBottom: 5 }}>
          <div style={{ ...sectionHeader, marginBottom: 3 }}>Post Sell Order</div>
          <div style={row}>
            <select style={sel} value={sellItem} onChange={e => setSellItem(e.target.value)}>
              <option value="">item…</option>
              {inventoryItems.filter(it => it.quantity > 0).map(it => (
                <option key={it.type} value={it.type}>{it.type} ×{it.quantity}</option>
              ))}
            </select>
          </div>
          <div style={row}>
            <input style={inp} type="number" value={sellQty} min={1}
              onChange={e => setSellQty(Math.max(1, parseInt(e.target.value) || 1))} />
            <span style={{ color: "#705030", fontSize: 10 }}>qty</span>
            <input style={inp} type="number" value={sellPrice} min={1}
              onChange={e => setSellPrice(Math.max(1, parseInt(e.target.value) || 1))} />
            <span style={{ color: "#705030", fontSize: 10 }}>c</span>
            <button style={btn} disabled={!sellItem} onClick={() => {
              if (!sellItem) return;
              doAction({ type: "post_order", side: "sell", item: sellItem, quantity: sellQty, price: sellPrice });
            }}>Post</button>
          </div>
        </div>

        {/* Eat */}
        <div style={row}>
          <button
            style={{ ...btn, opacity: hasFood ? 1 : 0.4 }}
            disabled={!hasFood}
            onClick={() => {
              if (!firstFood) return;
              doAction({ type: "eat", item: firstFood.type, quantity: 1 });
            }}
          >
            Eat {hasFood ? `(${firstFood!.type})` : "(none)"}
          </button>
          <button style={btn} onClick={() => doAction({ type: "wait" })}>Rest</button>
        </div>

        {statusMsg && <div style={{ color: "#e06030", fontSize: 10, marginTop: 2 }}>{statusMsg}</div>}
      </div>

      {/* Inventory */}
      <div style={section}>
        <div style={sectionHeader}>Inventory</div>
        {inventoryItems.length === 0
          ? <span style={{ color: "#504030", fontSize: 11 }}>empty</span>
          : inventoryItems.filter(it => it.quantity > 0).map(it => (
              <div key={it.type} style={{ fontSize: 11, color: "#c8a060" }}>
                {it.type} ×{it.quantity}
              </div>
            ))
        }
      </div>

      {/* Leaderboard */}
      <div style={{ ...section, flex: 1 }}>
        <div style={sectionHeader}>Leaderboard</div>
        {leaderboard.map((e, i) => {
          const isPlayer = e.agent === "player";
          return (
            <div key={e.agent} style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: isPlayer ? "#ffd700" : "#9a7840",
              fontWeight: isPlayer ? "bold" : "normal",
              marginBottom: 2,
              padding: isPlayer ? "1px 3px" : "1px 3px",
              background: isPlayer ? "rgba(255,200,0,0.08)" : "transparent",
              borderRadius: 2,
            }}>
              <span>{i + 1}. {e.name}{i === playerRank ? " ←" : ""}</span>
              <span>{e.total}c</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
