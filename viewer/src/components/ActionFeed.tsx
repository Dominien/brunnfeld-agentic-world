import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { AgentName, FeedEntry } from "../types";
import { useRef, useEffect } from "react";

const ENTRY_COLORS: Record<FeedEntry["type"], string> = {
  speak: "#f0e8b0",
  do: "#b8d8b0",
  move: "#90b8e0",
  trade: "#f0c060",
  production: "#90d8f0",
  thought: "#a0a0c0",
  system: "#f08040",
};

const ENTRY_PREFIX: Record<FeedEntry["type"], string> = {
  speak: "💬",
  do: "🔧",
  move: "👣",
  trade: "💰",
  production: "⚒",
  thought: "💭",
  system: "⚡",
};

const AGENT_COLORS: Record<AgentName, string> = {
  hans: "#e8c87a", ida: "#f4b8d4", konrad: "#a8d48a", ulrich: "#c8a84a",
  bertram: "#d4a870", gerda: "#d4d4a0", anselm: "#f0d890", volker: "#c84c4c",
  wulf: "#a07040", liesel: "#d878a8", sybille: "#80c8d8", friedrich: "#80a850",
  otto: "#a8a0c8", pater_markus: "#c8c8e8", dieter: "#909090", magda: "#e8b090",
  bertha: "#c8b0a0", heinrich: "#d8c060", elke: "#e878b8", rupert: "#b0b0b0",
};

function FeedRow({ entry, onClick }: { entry: FeedEntry; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "4px 10px",
        cursor: "pointer",
        borderBottom: "1px solid rgba(80,50,10,0.25)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(80,50,10,0.25)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 1 }}>
        <span style={{ fontSize: 10, color: ENTRY_COLORS[entry.type], minWidth: 14 }}>
          {ENTRY_PREFIX[entry.type]}
        </span>
        <span style={{ fontSize: 10, fontWeight: "bold", color: AGENT_COLORS[entry.agent] ?? "#ccc", fontFamily: "Georgia" }}>
          {AGENT_DISPLAY[entry.agent]}
        </span>
        {entry.location && (
          <span style={{ fontSize: 9, color: "#6a5030" }}>@ {entry.location}</span>
        )}
        <span style={{ fontSize: 9, color: "#4a3020", marginLeft: "auto" }}>t{entry.tick}</span>
      </div>
      <div style={{
        fontSize: 11, color: ENTRY_COLORS[entry.type],
        fontFamily: "Georgia, serif", lineHeight: 1.4,
        paddingLeft: 20, opacity: 0.9,
      }}>
        {entry.text.length > 180 ? entry.text.slice(0, 177) + "…" : entry.text}
      </div>
    </div>
  );
}

export default function ActionFeed() {
  const mode = useVillageStore((s) => s.mode);
  const liveFeed = useVillageStore((s) => s.feed);
  const historyFeed = useVillageStore((s) => s.historyFeed);
  const historyLoading = useVillageStore((s) => s.historyLoading);
  const historyTickId = useVillageStore((s) => s.historyTickId);
  const selectAgent = useVillageStore((s) => s.selectAgent);

  const feed = mode === "history" ? historyFeed : liveFeed;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === "live" && listRef.current) listRef.current.scrollTop = 0;
  }, [liveFeed.length > 0 ? liveFeed[0]?.id : null]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: "rgba(12,8,3,0.95)",
      border: "1px solid #4a3010",
      borderRadius: 6,
      height: "100%",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "6px 12px",
        borderBottom: "1px solid #4a3010",
        color: "#c8a060", fontSize: 11, fontFamily: "Georgia",
        fontWeight: "bold", letterSpacing: 1, textTransform: "uppercase",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>
          {mode === "history" ? `Tick ${historyTickId?.replace("tick_0*", "").replace(/^tick_0+/, "t")} Chronicle` : "Village Chronicle"}
        </span>
        <span style={{ color: "#6a5030", fontWeight: "normal" }}>
          {historyLoading ? "loading…" : `${feed.length}`}
        </span>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {historyLoading && (
          <div style={{ padding: "20px", textAlign: "center", color: "#6a5030", fontSize: 12, fontFamily: "Georgia" }}>
            Loading tick…
          </div>
        )}
        {!historyLoading && feed.map((entry) => (
          <FeedRow key={entry.id} entry={entry} onClick={() => selectAgent(entry.agent)} />
        ))}
        {!historyLoading && feed.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center", color: "#4a3020", fontFamily: "Georgia", fontSize: 12 }}>
            {mode === "live" ? "Awaiting village activity…" : "No entries for this tick"}
          </div>
        )}
      </div>
    </div>
  );
}
