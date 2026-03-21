import { useState, useEffect } from "react";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { AgentName } from "../types";
import SceneChronicle from "./SceneChronicle";

const AGENT_COLORS: Record<AgentName, string> = {
  hans: "#e8c87a", ida: "#f4b8d4", konrad: "#a8d48a", ulrich: "#c8a84a",
  bertram: "#d4a870", gerda: "#d4d4a0", anselm: "#f0d890", volker: "#c84c4c",
  wulf: "#a07040", liesel: "#d878a8", sybille: "#80c8d8", friedrich: "#80a850",
  otto: "#a8a0c8", pater_markus: "#c8c8e8", dieter: "#909090", magda: "#e8b090",
  heinrich: "#d8c060", elke: "#e878b8", rupert: "#b0b0b0", player: "#ffd700",
};

const EXPANDED_HEIGHT = 260;
const INITIAL_EXPANDED_MS = 30_000;

export default function ActivityDrawer() {
  const [expanded, setExpanded] = useState(true);
  const streaming = useVillageStore((s) => s.streaming);
  const mode = useVillageStore((s) => s.mode);
  const historyTickId = useVillageStore((s) => s.historyTickId);

  useEffect(() => {
    const timer = setTimeout(() => setExpanded(false), INITIAL_EXPANDED_MS);
    return () => clearTimeout(timer);
  }, []);

  const streamEntries = Object.values(streaming);

  const headerLabel = mode === "history" && historyTickId
    ? `Tick ${parseInt(historyTickId.replace("tick_", ""))} Chronicle`
    : "Chronicle";

  return (
    <div style={{
      height: expanded ? EXPANDED_HEIGHT : 32,
      transition: "height 0.2s ease",
      borderTop: "1px solid #3a2810",
      background: "rgba(8,5,0,0.97)",
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          height: 32, minHeight: 32,
          padding: "0 12px",
          display: "flex", alignItems: "center", gap: 8,
          cursor: "pointer", flexShrink: 0, userSelect: "none",
          borderBottom: expanded ? "1px solid #2a1c08" : "none",
        }}
      >
        <span style={{ fontSize: 10, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, textTransform: "uppercase", fontFamily: "Georgia" }}>
          {headerLabel}
        </span>
        <span style={{ fontSize: 10, color: expanded ? "#c8a060" : "#4a3020" }}>
          {expanded ? "▲" : "▼"}
        </span>

        {/* Thinking dots — one per agent currently streaming */}
        {streamEntries.length > 0 && (
          <div style={{ display: "flex", gap: 3, marginLeft: 4 }}>
            {streamEntries.map((entry) => (
              <div
                key={entry.agent}
                title={`${AGENT_DISPLAY[entry.agent]}: …${entry.text.slice(-40)}`}
                style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: AGENT_COLORS[entry.agent] ?? "#c8a060",
                  boxShadow: `0 0 4px ${AGENT_COLORS[entry.agent] ?? "#c8a060"}`,
                  animation: "activityPulse 0.9s infinite",
                  flexShrink: 0,
                }}
              />
            ))}
            <span style={{ fontSize: 8, color: "#6a5030", marginLeft: 2 }}>
              {streamEntries.length === 1
                ? `${AGENT_DISPLAY[streamEntries[0]!.agent].split(" ")[0]} thinking…`
                : `${streamEntries.length} agents thinking…`}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
        <SceneChronicle />
      </div>

      <style>{`
        @keyframes activityPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}
