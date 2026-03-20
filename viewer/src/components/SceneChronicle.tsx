import { useState, useEffect, useRef } from "react";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { FeedEntry, AgentName } from "../types";

// ─── Agent colors ────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<AgentName, string> = {
  hans: "#e8c87a", ida: "#f4b8d4", konrad: "#a8d48a", ulrich: "#c8a84a",
  bertram: "#d4a870", gerda: "#d4d4a0", anselm: "#f0d890", volker: "#c84c4c",
  wulf: "#a07040", liesel: "#d878a8", sybille: "#80c8d8", friedrich: "#80a850",
  otto: "#a8a0c8", pater_markus: "#c8c8e8", dieter: "#909090", magda: "#e8b090",
  bertha: "#c8b0a0", heinrich: "#d8c060", elke: "#e878b8", rupert: "#b0b0b0", player: "#ffd700",
};

// ─── Filter types ─────────────────────────────────────────────────────────────

type FilterKey = "speak" | "trade" | "move" | "production" | "do" | "thought";

const FILTERS: { key: FilterKey; label: string; icon: string; defaultOn: boolean }[] = [
  { key: "speak",      label: "Speech",   icon: "💬", defaultOn: true  },
  { key: "trade",      label: "Trades",   icon: "💰", defaultOn: true  },
  { key: "move",       label: "Moves",    icon: "👣", defaultOn: true  },
  { key: "production", label: "Crafting", icon: "⚒",  defaultOn: true  },
  { key: "do",         label: "Actions",  icon: "🔧", defaultOn: false },
  { key: "thought",    label: "Thoughts", icon: "💭", defaultOn: false },
];

// ─── Entry rendering ──────────────────────────────────────────────────────────

function EntryRow({ entry, onClick }: { entry: FeedEntry; onClick: () => void }) {
  const agentColor = AGENT_COLORS[entry.agent] ?? "#c8a060";
  const agentShort = AGENT_DISPLAY[entry.agent]?.split(" ")[0] ?? entry.agent;

  if (entry.type === "trade") {
    return (
      <div
        onClick={onClick}
        style={{
          padding: "5px 10px",
          background: "rgba(50,35,5,0.45)",
          borderLeft: "3px solid #f0c040",
          borderBottom: "1px solid rgba(60,40,5,0.3)",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 11, color: "#f0c040", fontFamily: "Georgia" }}>
          💰 {entry.text.length > 80 ? entry.text.slice(0, 77) + "…" : entry.text}
        </span>
      </div>
    );
  }

  if (entry.type === "speak") {
    return (
      <div
        onClick={onClick}
        style={{
          padding: "4px 10px",
          borderLeft: `2px solid ${agentColor}`,
          borderBottom: "1px solid rgba(60,40,5,0.2)",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 10, fontWeight: "bold", color: agentColor, fontFamily: "Georgia" }}>
          {agentShort}:
        </span>
        <span style={{ fontSize: 11, color: "#e8d890", fontFamily: "Georgia, serif", lineHeight: 1.4, marginLeft: 5 }}>
          &ldquo;{entry.text.length > 100 ? entry.text.slice(0, 97) + "…" : entry.text}&rdquo;
        </span>
      </div>
    );
  }

  if (entry.type === "move") {
    return (
      <div
        onClick={onClick}
        style={{
          padding: "3px 10px",
          borderBottom: "1px solid rgba(60,40,5,0.15)",
          cursor: "pointer",
          display: "flex", alignItems: "center", gap: 5,
        }}
      >
        <span style={{ fontSize: 9, color: "#60a8d8" }}>👣</span>
        <span style={{ fontSize: 10, color: "#7090b0", fontFamily: "Georgia", fontStyle: "italic" }}>
          {entry.text.length > 70 ? entry.text.slice(0, 67) + "…" : entry.text}
        </span>
      </div>
    );
  }

  if (entry.type === "production") {
    return (
      <div
        onClick={onClick}
        style={{
          padding: "3px 10px",
          borderBottom: "1px solid rgba(60,40,5,0.15)",
          cursor: "pointer",
          display: "flex", alignItems: "center", gap: 5,
        }}
      >
        <span style={{ fontSize: 9, color: "#80c8ff" }}>⚒</span>
        <span style={{ fontSize: 10, color: "#70a0c0", fontFamily: "Georgia" }}>
          {entry.text.length > 70 ? entry.text.slice(0, 67) + "…" : entry.text}
        </span>
      </div>
    );
  }

  // do / thought / system
  return (
    <div
      onClick={onClick}
      style={{
        padding: "3px 10px",
        borderBottom: "1px solid rgba(60,40,5,0.1)",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 9, color: "#5a4830", fontFamily: "Georgia, serif", fontStyle: entry.type === "thought" ? "italic" : "normal" }}>
        {entry.type === "thought" ? "💭 " : entry.type === "do" ? "🔧 " : ""}
        <span style={{ color: agentColor }}>{agentShort}</span>
        {" "}
        {entry.text.length > 80 ? entry.text.slice(0, 77) + "…" : entry.text}
      </span>
    </div>
  );
}

// ─── Scene card ───────────────────────────────────────────────────────────────

function SceneCard({
  location, entries, defaultOpen, selectAgent,
}: {
  location: string;
  entries: FeedEntry[];
  defaultOpen: boolean;
  selectAgent: (a: AgentName) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Open automatically when new entries arrive at this location
  const prevLenRef = useRef(entries.length);
  useEffect(() => {
    if (entries.length > prevLenRef.current) setOpen(true);
    prevLenRef.current = entries.length;
  }, [entries.length]);

  const tradeCount = entries.filter((e) => e.type === "trade").length;
  const speakCount = entries.filter((e) => e.type === "speak").length;

  // Unique agents present in this scene
  const agents = [...new Set(entries.map((e) => e.agent))];

  return (
    <div style={{
      border: "1px solid #3a2810",
      borderRadius: 5,
      marginBottom: 4,
      overflow: "hidden",
      background: "rgba(10,6,2,0.6)",
    }}>
      {/* Card header */}
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "5px 10px",
          display: "flex", alignItems: "center", gap: 7,
          cursor: "pointer",
          background: open ? "rgba(40,25,5,0.5)" : "rgba(20,12,3,0.5)",
          borderBottom: open ? "1px solid #3a2810" : "none",
        }}
      >
        <span style={{ fontSize: 11, color: "#c8a060", fontWeight: "bold", fontFamily: "Georgia", flex: 1 }}>
          {location}
        </span>

        {/* Agent dots */}
        <div style={{ display: "flex", gap: 2 }}>
          {agents.slice(0, 6).map((a) => (
            <div
              key={a}
              title={AGENT_DISPLAY[a]}
              style={{
                width: 7, height: 7, borderRadius: "50%",
                background: AGENT_COLORS[a] ?? "#6a5030",
              }}
            />
          ))}
          {agents.length > 6 && (
            <span style={{ fontSize: 8, color: "#6a5030" }}>+{agents.length - 6}</span>
          )}
        </div>

        {/* Badges */}
        {tradeCount > 0 && (
          <span style={{
            fontSize: 9, color: "#f0c040", background: "rgba(60,40,5,0.6)",
            border: "1px solid #6a4010", borderRadius: 3, padding: "1px 4px",
          }}>
            💰{tradeCount}
          </span>
        )}
        {speakCount > 0 && (
          <span style={{ fontSize: 9, color: "#a09060" }}>
            💬{speakCount}
          </span>
        )}

        <span style={{ fontSize: 9, color: open ? "#c8a060" : "#4a3020" }}>
          {open ? "▲" : "▼"}
        </span>
      </div>

      {/* Entries */}
      {open && (
        <div>
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} onClick={() => selectAgent(e.agent)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SceneChronicle() {
  const liveFeed = useVillageStore((s) => s.feed);
  const historyFeed = useVillageStore((s) => s.historyFeed);
  const historyLoading = useVillageStore((s) => s.historyLoading);
  const mode = useVillageStore((s) => s.mode);
  const selectAgent = useVillageStore((s) => s.selectAgent);

  const [filters, setFilters] = useState<Set<FilterKey>>(
    () => new Set(FILTERS.filter((f) => f.defaultOn).map((f) => f.key))
  );

  const rawFeed = mode === "history" ? historyFeed : liveFeed;

  const toggleFilter = (key: FilterKey) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const feed = rawFeed.filter((e) => filters.has(e.type as FilterKey));

  // Group by location
  const byLocation: Record<string, FeedEntry[]> = {};
  for (const entry of feed) {
    const loc = entry.location
      ?? (entry.type === "trade" || entry.type === "production" ? "Market" : "Village");
    if (!byLocation[loc]) byLocation[loc] = [];
    byLocation[loc]!.push(entry);
  }

  // Sort scenes: most entries first
  const scenes = Object.entries(byLocation)
    .sort(([, a], [, b]) => b.length - a.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Filter pills */}
      <div style={{
        display: "flex", gap: 4, padding: "5px 8px",
        flexWrap: "wrap", flexShrink: 0,
        borderBottom: "1px solid #2a1c08",
        background: "rgba(6,4,0,0.8)",
      }}>
        {FILTERS.map((f) => {
          const on = filters.has(f.key);
          return (
            <button
              key={f.key}
              onClick={() => toggleFilter(f.key)}
              style={{
                padding: "2px 7px",
                border: `1px solid ${on ? "#6a4a10" : "#2a1c08"}`,
                borderRadius: 10,
                background: on ? "rgba(80,55,10,0.5)" : "rgba(15,10,2,0.5)",
                color: on ? "#d4a850" : "#4a3020",
                fontSize: 9, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 3,
                fontFamily: "Georgia",
                transition: "all 0.1s",
              }}
            >
              <span>{f.icon}</span>
              <span>{f.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scene cards */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 6px 4px" }}>
        {historyLoading && (
          <div style={{ padding: 16, textAlign: "center", color: "#6a5030", fontFamily: "Georgia", fontSize: 11 }}>
            Loading tick…
          </div>
        )}

        {!historyLoading && scenes.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", color: "#3a2810", fontFamily: "Georgia", fontSize: 11 }}>
            {mode === "live" ? "Awaiting village activity…" : "No entries match the current filters"}
          </div>
        )}

        {!historyLoading && scenes.map(([loc, entries], idx) => (
          <SceneCard
            key={loc}
            location={loc}
            entries={entries}
            defaultOpen={idx === 0}
            selectAgent={selectAgent}
          />
        ))}
      </div>
    </div>
  );
}
