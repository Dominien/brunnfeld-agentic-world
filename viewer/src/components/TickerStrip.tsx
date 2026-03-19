import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { FeedEntry, AgentName } from "../types";

const AGENT_COLORS: Record<AgentName, string> = {
  hans: "#e8c87a", ida: "#f4b8d4", konrad: "#a8d48a", ulrich: "#c8a84a",
  bertram: "#d4a870", gerda: "#d4d4a0", anselm: "#f0d890", volker: "#c84c4c",
  wulf: "#a07040", liesel: "#d878a8", sybille: "#80c8d8", friedrich: "#80a850",
  otto: "#a8a0c8", pater_markus: "#c8c8e8", dieter: "#909090", magda: "#e8b090",
  bertha: "#c8b0a0", heinrich: "#d8c060", elke: "#e878b8", rupert: "#b0b0b0",
};

const TYPE_COLOR: Record<FeedEntry["type"], string> = {
  speak: "#f0d870",
  trade: "#50d870",
  move: "#60b0e8",
  production: "#80c8ff",
  do: "#c0a870",
  thought: "#9090b0",
  system: "#ff8040",
};

function formatEntry(e: FeedEntry): string {
  const name = AGENT_DISPLAY[e.agent]?.split(" ")[0] ?? e.agent;
  switch (e.type) {
    case "speak":     return `💬 ${name}: "${e.text.slice(0, 45)}${e.text.length > 45 ? "…" : ""}"`;
    case "trade":     return `💰 ${e.text.slice(0, 50)}`;
    case "move":      return `👣 ${e.text}`;
    case "production":return `⚒ ${e.text}`;
    case "system":    return `⚡ ${e.text.slice(0, 50)}`;
    default:          return "";
  }
}

interface Segment {
  text: string;
  color: string;
  id: number;
}

function buildSegments(feed: FeedEntry[]): Segment[] {
  return feed
    .filter((e) => ["speak", "trade", "move", "production", "system"].includes(e.type))
    .slice(0, 30)
    .map((e) => ({
      text: formatEntry(e),
      color: TYPE_COLOR[e.type] ?? "#c8a060",
      id: e.id,
    }))
    .filter((s) => s.text.length > 0);
}

function TickerContent({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((seg, i) => (
        <span key={seg.id}>
          <span style={{ color: seg.color, fontFamily: "monospace", fontSize: 10 }}>{seg.text}</span>
          {i < segments.length - 1 && (
            <span style={{ color: "#3a2810", padding: "0 14px" }}>·</span>
          )}
        </span>
      ))}
    </>
  );
}

export default function TickerStrip() {
  const feed = useVillageStore((s) => s.feed);
  const segments = buildSegments(feed);

  if (segments.length === 0) {
    return (
      <div style={{
        height: 22, background: "#050300", borderBottom: "1px solid #2a1c08",
        display: "flex", alignItems: "center", padding: "0 12px",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, color: "#3a2810", fontFamily: "monospace" }}>
          Village Chronicle — awaiting events…
        </span>
      </div>
    );
  }

  // Estimate content length for duration
  const charCount = segments.reduce((n, s) => n + s.text.length + 16, 0);
  const duration = Math.max(18, charCount * 0.085);

  return (
    <div style={{
      height: 22, background: "#050300", borderBottom: "1px solid #2a1c08",
      overflow: "hidden", flexShrink: 0, position: "relative",
    }}>
      <div
        key={segments[0]?.id}
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: "100%",
          animation: `villageTickerScroll ${duration}s linear infinite`,
          whiteSpace: "nowrap",
        }}
      >
        <TickerContent segments={segments} />
        <span style={{ color: "#3a2810", padding: "0 20px" }}>·</span>
        <TickerContent segments={segments} />
      </div>

      <style>{`
        @keyframes villageTickerScroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
