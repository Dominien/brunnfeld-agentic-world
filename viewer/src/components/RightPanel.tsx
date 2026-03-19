import { useState, useEffect } from "react";
import { useVillageStore } from "../store";
import AgentPanel from "./AgentPanel";
import MarketPanel from "./MarketPanel";
import StockMarketPanel from "./StockMarketPanel";

type TabId = "Agent" | "Market" | "Economy";

export default function RightPanel() {
  const [tab, setTab] = useState<TabId>("Market");
  const selectedAgent = useVillageStore((s) => s.selectedAgent);

  // Auto-switch to Agent tab when an agent is selected
  useEffect(() => {
    if (selectedAgent !== null) setTab("Agent");
  }, [selectedAgent]);

  return (
    <div style={{
      width: 320, flexShrink: 0,
      display: "flex", flexDirection: "column",
      background: "#0a0600",
      borderLeft: "1px solid #3a2810",
    }}>
      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #3a2810", flexShrink: 0 }}>
        {(["Agent", "Market", "Economy"] as TabId[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: "9px 4px",
              background: "transparent",
              border: "none",
              borderBottom: tab === t ? "2px solid #f0c040" : "2px solid transparent",
              color: tab === t ? "#f0c040" : "#6a5030",
              fontSize: 11, fontWeight: "bold", letterSpacing: 1,
              textTransform: "uppercase", cursor: "pointer",
              fontFamily: "Georgia, serif",
              transition: "color 0.15s",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden", padding: "8px" }}>
        {tab === "Agent" && <AgentPanel />}
        {tab === "Market" && <MarketPanel />}
        {tab === "Economy" && <StockMarketPanel />}
      </div>
    </div>
  );
}
