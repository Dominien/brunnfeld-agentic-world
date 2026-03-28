import { useState, useEffect, useRef, useMemo } from "react";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { AgentName, BodyState, Loan } from "../types";
import { getItemIconUrl } from "../canvas/sprites";

// ─── Shared helpers ───────────────────────────────────────────

function getStatusColor(body: BodyState): string {
  if ((body.starvation_ticks ?? 0) >= 999) return "#3a2010";
  if ((body.starvation_ticks ?? 0) > 0)    return "#e84030";
  if ((body.sickness ?? 0) >= 1 || (body.injury ?? 0) >= 1) return "#e88030";
  if (body.hunger >= 2)                    return "#e8c830";
  return "#60c840";
}

function getStatusBucket(body: BodyState): "dead" | "starving" | "sick" | "hungry" | "ok" {
  if ((body.starvation_ticks ?? 0) >= 999) return "dead";
  if ((body.starvation_ticks ?? 0) > 0)    return "starving";
  if ((body.sickness ?? 0) >= 1 || (body.injury ?? 0) >= 1) return "sick";
  if (body.hunger >= 2)                    return "hungry";
  return "ok";
}

// ─── Skill icons ─────────────────────────────────────────────

const SKILL_ICON: Record<string, string> = {
  farmer: "🌾", cattle: "🐄", miner: "⛏", woodcutter: "🪓",
  miller: "⚙", baker: "🍞", blacksmith: "🔨", carpenter: "🪚",
  tavern: "🍺", healer: "💊", merchant: "📦", seamstress: "🪡",
  none: "👤",
};

// ─── Portrait assignment ──────────────────────────────────────

const AGENT_PORTRAIT: Record<AgentName, number> = {
  hans: 1, ida: 2, konrad: 3, ulrich: 4, bertram: 5,
  gerda: 6, anselm: 7, volker: 8, wulf: 9,
  liesel: 10, sybille: 11, friedrich: 12,
  otto: 13, pater_markus: 14,
  dieter: 15, magda: 16, heinrich: 18,
  elke: 19, rupert: 20,
  player: 0,
};

// ─── Agent bars ───────────────────────────────────────────────

function HungerBar({ value }: { value: number }) {
  const pct = ((5 - value) / 5) * 100;
  const color = value <= 1 ? "#80d860" : value <= 3 ? "#e8b830" : "#e84030";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10, color: "#a09060", width: 48 }}>Hunger</span>
      <div style={{ flex: 1, height: 8, background: "#2a1c08", border: "1px solid #5a3c10", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.5s" }} />
      </div>
      <span style={{ fontSize: 10, color, width: 8 }}>{value}</span>
    </div>
  );
}

function EnergyBar({ value }: { value: number }) {
  const pct = (value / 10) * 100;
  const color = value >= 7 ? "#80c8ff" : value >= 4 ? "#e8b830" : "#c84030";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10, color: "#a09060", width: 48 }}>Energy</span>
      <div style={{ flex: 1, height: 8, background: "#2a1c08", border: "1px solid #5a3c10", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.5s" }} />
      </div>
      <span style={{ fontSize: 10, color, width: 16 }}>{value}</span>
    </div>
  );
}

// ─── Agent List (no agent selected) ──────────────────────────

const STATUS_ORDER = { starving: 0, sick: 1, hungry: 2, ok: 3, dead: 4 };

function AgentList() {
  const world           = useVillageStore((s) => s.world);
  const selectAgent     = useVillageStore((s) => s.selectAgent);
  const playerCreated   = useVillageStore((s) => s.playerCreated);
  const activeVillageId = useVillageStore((s) => s.activeVillageId);
  const villages        = useVillageStore((s) => s.villages);
  const setActiveVillage = useVillageStore((s) => s.setActiveVillageId);
  const [search, setSearch] = useState("");

  if (!world) {
    return (
      <div style={{
        background: "rgba(12,8,3,0.95)", border: "1px solid #4a3010", borderRadius: 6,
        height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 8, color: "#4a3020", fontFamily: "Georgia", fontSize: 13,
      }}>
        <span>Waiting for simulation…</span>
        <span style={{ fontSize: 10, color: "#3a2010" }}>Start the server with npm start</span>
      </div>
    );
  }

  const activeVillageName = villages.find(v => v.id === activeVillageId)?.name ?? "Brunnfeld";

  const agents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (Object.keys(world.economics) as AgentName[])
      .filter(a => {
        if (a === "player" && !playerCreated) return false;
        // Village filter: match by villageId or fallback for brunnfeld
        const eco = world.economics[a];
        const vid = (eco as { villageId?: string }).villageId ?? "brunnfeld";
        if (vid !== activeVillageId) return false;
        // Search filter
        if (q && !AGENT_DISPLAY[a].toLowerCase().includes(q)) return false;
        return true;
      })
      .slice().sort((a, b) => {
        const bodyA = world.body[a];
        const bodyB = world.body[b];
        const sa = bodyA ? STATUS_ORDER[getStatusBucket(bodyA)] : 5;
        const sb = bodyB ? STATUS_ORDER[getStatusBucket(bodyB)] : 5;
        return sa !== sb ? sa - sb : (AGENT_DISPLAY[a] ?? a).localeCompare(AGENT_DISPLAY[b] ?? b);
      });
  }, [world?.economics, world?.body, activeVillageId, search, playerCreated]);

  return (
    <div style={{
      background: "rgba(12,8,3,0.95)", border: "1px solid #4a3010", borderRadius: 6,
      height: "100%", display: "flex", flexDirection: "column", overflow: "hidden",
      fontFamily: "Georgia, serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px", borderBottom: "1px solid #4a3010", flexShrink: 0,
        background: "linear-gradient(to bottom, #1a1008, #100c04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: "#f8e060", letterSpacing: 0.5, flex: 1 }}>
            {activeVillageName}
          </div>
          {villages.length > 1 && (
            <select
              value={activeVillageId}
              onChange={e => setActiveVillage(e.target.value)}
              style={{
                background: "#1a1008", border: "1px solid #4a3010", color: "#c0a040",
                fontSize: 10, borderRadius: 3, padding: "2px 4px", fontFamily: "Georgia, serif",
              }}
            >
              {villages.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          )}
        </div>
        <div style={{ fontSize: 9, color: "#5a3820", marginTop: 2 }}>
          Tick {world.current_tick} · {world.current_time} · {world.season}, day {world.day_of_season}/7
        </div>
      </div>

      {/* Search (shown when many agents) */}
      {agents.length > 12 || search ? (
        <div style={{ padding: "6px 10px", borderBottom: "1px solid #3a2808", flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Search agents…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: "100%", background: "#120e06", border: "1px solid #4a3010",
              color: "#c8a860", fontFamily: "Georgia, serif", fontSize: 11,
              padding: "4px 8px", borderRadius: 3, boxSizing: "border-box",
            }}
          />
        </div>
      ) : null}

      {/* Agent rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {agents.map(a => {
          const body = world.body[a];
          const eco  = world.economics[a];
          const loc  = world.agent_locations[a];
          if (!body || !eco) return null;
          const isDead = (body.starvation_ticks ?? 0) >= 999;
          const color  = getStatusColor(body);
          const hungerPct = ((5 - body.hunger) / 5) * 100;
          const energyPct = (body.energy / 10) * 100;
          const hungerColor = body.hunger <= 1 ? "#80d860" : body.hunger <= 3 ? "#e8b830" : "#e84030";
          const energyColor = body.energy >= 7 ? "#80c8ff" : body.energy >= 4 ? "#e8b830" : "#c84030";

          return (
            <div
              key={a}
              onClick={() => !isDead && selectAgent(a)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 12px",
                borderBottom: "1px solid rgba(60,40,10,0.4)",
                cursor: isDead ? "default" : "pointer",
                opacity: isDead ? 0.35 : 1,
                transition: "background 0.1s",
              }}
              onMouseEnter={e => { if (!isDead) (e.currentTarget as HTMLDivElement).style.background = "rgba(60,40,10,0.4)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {/* Status dot */}
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: color, flexShrink: 0,
                boxShadow: isDead ? "none" : `0 0 4px ${color}88`,
              }} />

              {/* Name + location */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#e8d890", fontWeight: "bold", lineHeight: 1.3 }}>
                  {AGENT_DISPLAY[a].split(" ")[0]}
                  <span style={{ fontSize: 9, color: "#7a5830", fontWeight: "normal", marginLeft: 5 }}>
                    {SKILL_ICON[eco.skill] ?? ""}
                  </span>
                </div>
                <div style={{
                  fontSize: 9, color: "#6a4820",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {loc}
                </div>
              </div>

              {/* Bars */}
              {!isDead && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0, width: 48 }}>
                  <div style={{ height: 4, background: "#1a1008", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${hungerPct}%`, height: "100%", background: hungerColor }} />
                  </div>
                  <div style={{ height: 4, background: "#1a1008", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${energyPct}%`, height: "100%", background: energyColor }} />
                  </div>
                </div>
              )}

              {/* Wallet */}
              <div style={{ fontSize: 10, color: "#c8a040", fontFamily: "monospace", flexShrink: 0, width: 32, textAlign: "right" }}>
                {isDead ? "✝" : `${eco.wallet}c`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Animated merchant avatar ─────────────────────────────────

function MerchantAvatar() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    imgRef.current = img;
    img.onload = () => {
      let frame = 0;
      const tick = () => {
        frame = (frame + 1) % 10;
        ctx.clearRect(0, 0, 56, 56);
        ctx.drawImage(img, frame * 80, 0, 80, 80, 0, 0, 56, 56);
        rafRef.current = requestAnimationFrame(() => setTimeout(() => tick(), 110));
      };
      tick();
    };
    img.src = "/assets/merchant/Gipsy spritesheet.png";
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={56} height={56}
      style={{ borderRadius: 4, border: "2px solid #c89030", flexShrink: 0, imageRendering: "pixelated" }}
    />
  );
}

// ─── Agent Detail Panel ───────────────────────────────────────

export default function AgentPanel() {
  const selectedAgent = useVillageStore((s) => s.selectedAgent);
  const world         = useVillageStore((s) => s.world);
  const selectAgent   = useVillageStore((s) => s.selectAgent);

  const [question, setQuestion]       = useState("");
  const [answer, setAnswer]           = useState("");
  const [interviewing, setInterviewing] = useState(false);
  const [whisper, setWhisper]         = useState("");
  const [whispering, setWhispering]   = useState(false);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuestion("");
    setAnswer("");
    setWhisper("");
  }, [selectedAgent]);

  useEffect(() => {
    if (answerRef.current) answerRef.current.scrollTop = answerRef.current.scrollHeight;
  }, [answer]);

  async function askAgent() {
    if (!selectedAgent || !question.trim()) return;
    setInterviewing(true);
    setAnswer("");
    try {
      const res = await fetch(`/api/interview/${selectedAgent}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setAnswer(prev => prev + dec.decode(value, { stream: true }));
      }
    } finally {
      setInterviewing(false);
    }
  }

  async function whisperRumor() {
    if (!selectedAgent || !whisper.trim()) return;
    setWhispering(true);
    try {
      await fetch(`/api/whisper/${selectedAgent}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: whisper }),
      });
      setWhisper("");
    } finally {
      setWhispering(false);
    }
  }

  if (!selectedAgent || !world) {
    return <AgentList />;
  }

  const eco = world.economics[selectedAgent];
  const body = world.body[selectedAgent];
  const loc = world.agent_locations[selectedAgent];
  const portraitNum = String(AGENT_PORTRAIT[selectedAgent] ?? 1).padStart(2, "0");
  const portraitUrl = `/assets/ui/Human Avatars/Avatars_${portraitNum}.png`;
  const isCaravanActive = world.active_events.some(e => e.type === "caravan");
  const isMerchant = selectedAgent === "otto" && isCaravanActive;
  const caravanOrders = isMerchant
    ? world.marketplace.orders.filter(o => o.agentId === "otto" && o.type === "sell")
    : [];

  return (
    <div style={{
      background: "rgba(12,8,3,0.95)",
      border: isMerchant ? "1px solid #c89030" : "1px solid #4a3010",
      borderRadius: 6,
      height: "100%", display: "flex", flexDirection: "column", overflow: "hidden",
      fontFamily: "Georgia, serif",
    }}>
      {/* Header with portrait */}
      <div style={{
        padding: "10px 12px", borderBottom: isMerchant ? "1px solid #c89030" : "1px solid #4a3010",
        display: "flex", gap: 10, alignItems: "flex-start",
        background: isMerchant
          ? "linear-gradient(to bottom, #2a1a00, #1a1000)"
          : "linear-gradient(to bottom, #1a1008, #100c04)",
      }}>
        {isMerchant ? (
          <MerchantAvatar />
        ) : (
          <img
            src={portraitUrl}
            alt={AGENT_DISPLAY[selectedAgent]}
            style={{ width: 56, height: 56, imageRendering: "pixelated", borderRadius: 4, border: "2px solid #6a4c1a" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: "bold", color: isMerchant ? "#f0c040" : "#f8e060" }}>
            {AGENT_DISPLAY[selectedAgent]}
            {isMerchant && (
              <span style={{
                marginLeft: 8, fontSize: 9, fontWeight: "bold",
                background: "rgba(180,120,10,0.35)", border: "1px solid #c89030",
                color: "#f0c040", borderRadius: 3, padding: "1px 6px",
                verticalAlign: "middle", letterSpacing: 1,
              }}>CARAVAN</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#c09040", marginTop: 2 }}>
            {isMerchant ? "🐪 Travelling Merchant" : `${SKILL_ICON[eco?.skill] ?? "👤"} ${eco?.skill ?? "—"}`}
          </div>
          <div style={{ fontSize: 10, color: "#806030", marginTop: 2 }}>📍 {loc}</div>
        </div>
        <button
          onClick={() => selectAgent(null)}
          style={{ background: "none", border: "none", color: "#6a4020", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>

        {/* Caravan wares for sale */}
        {isMerchant && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#f0c040", fontWeight: "bold", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
                🐪 Wares for Sale
              </div>
              {caravanOrders.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {caravanOrders.map(order => {
                    const iconUrl = getItemIconUrl(order.item);
                    return (
                      <div key={order.id} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: "rgba(80,50,5,0.35)", border: "1px solid #8a5010",
                        borderRadius: 4, padding: "5px 8px",
                      }}>
                        {iconUrl
                          ? <img src={iconUrl} alt={order.item} width={20} height={20} style={{ imageRendering: "pixelated" }} />
                          : <span style={{ fontSize: 14 }}>📦</span>
                        }
                        <span style={{ flex: 1, fontSize: 11, color: "#e8d890" }}>{order.item}</span>
                        <span style={{ fontSize: 10, color: "#a0a0a0" }}>×{order.quantity}</span>
                        <span style={{ fontSize: 11, color: "#f0c040", fontWeight: "bold" }}>{order.price}c</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 10, color: "#4a3020" }}>All goods sold out</div>
              )}
            </div>
            <div style={{ height: 1, background: "#6a4010", margin: "8px 0" }} />
          </>
        )}

        {/* Wallet */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, color: "#f0c040", fontWeight: "bold" }}>
            💰 {eco?.wallet ?? 0} coin
          </div>
          {eco?.tool && (
            <div style={{ fontSize: 10, color: "#80a0c0", marginTop: 3 }}>
              🔧 Tools: {eco.tool.durability}% durability
            </div>
          )}
        </div>

        {/* Body stats */}
        {body && (
          <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 5 }}>
            <HungerBar value={body.hunger} />
            <EnergyBar value={body.energy} />
            {(body.sickness ?? 0) > 0 && (
              <div style={{ fontSize: 10, color: "#80e040" }}>🤒 Sick (level {body.sickness})</div>
            )}
            {(body.injury ?? 0) > 0 && (
              <div style={{ fontSize: 10, color: "#e06030" }}>🩹 Injured (level {body.injury})</div>
            )}
            <div style={{ fontSize: 10, color: "#a09060" }}>
              😴 Sleep: {body.sleep_quality}
            </div>
          </div>
        )}

        <div style={{ height: 1, background: "#3a2810", margin: "8px 0" }} />

        {/* Inventory — icon grid */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
            Inventory
          </div>
          {eco?.inventory?.items?.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 48px)", gap: 4 }}>
              {eco.inventory.items.map((item, idx) => {
                const iconUrl = getItemIconUrl(item.type);
                const avail = item.quantity - (item.reserved ?? 0);
                const hasReserved = (item.reserved ?? 0) > 0;
                return (
                  <div
                    key={idx}
                    title={`${item.type}: ${avail} available${item.reserved ? `, ${item.reserved} reserved` : ""}`}
                    style={{
                      width: 48, height: 60,
                      display: "flex", flexDirection: "column", alignItems: "center",
                      background: "rgba(60,40,10,0.5)",
                      border: `1px solid ${hasReserved ? "#c89030" : "#5a3c10"}`,
                      borderRadius: 4, padding: "4px 2px 2px", gap: 1,
                    }}
                  >
                    {iconUrl ? (
                      <img src={iconUrl} alt={item.type} width={28} height={28} style={{ imageRendering: "pixelated" }} />
                    ) : (
                      <span style={{ fontSize: 18, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>📦</span>
                    )}
                    <span style={{ fontSize: 11, color: "#d4c080", fontWeight: "bold", lineHeight: 1 }}>{avail}</span>
                    <span style={{ fontSize: 9, color: "#7a6040", maxWidth: 44, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
                      {item.type.slice(0, 7)}
                    </span>
                    {hasReserved && (
                      <span style={{ fontSize: 8, color: "#c89030", lineHeight: 1 }}>+{item.reserved}r</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: "#4a3020" }}>Empty</div>
          )}
        </div>

        {/* Loans */}
        {(() => {
          const loans = world.loans ?? [];
          const active = loans.filter((l: Loan) => !l.repaid);
          const owed = active.filter((l: Loan) => l.creditor === selectedAgent);
          const owes = active.filter((l: Loan) => l.debtor === selectedAgent);
          if (owed.length === 0 && owes.length === 0) return null;
          return (
            <>
              <div style={{ height: 1, background: "#3a2810", margin: "8px 0" }} />
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
                  Loans
                </div>
                {owed.map((l: Loan) => {
                  const dueDay = Math.ceil(l.dueTick / 16);
                  return (
                    <div key={l.id} style={{ fontSize: 10, color: "#80c8ff", marginBottom: 3 }}>
                      Owed {l.amount}c by {AGENT_DISPLAY[l.debtor]} (due day {dueDay})
                    </div>
                  );
                })}
                {owes.map((l: Loan) => {
                  const dueDay = Math.ceil(l.dueTick / 16);
                  const overdue = world.current_tick >= l.dueTick;
                  return (
                    <div key={l.id} style={{ fontSize: 10, color: overdue ? "#e84030" : "#e8a030", marginBottom: 3 }}>
                      Owes {l.amount}c to {AGENT_DISPLAY[l.creditor]} (due day {dueDay}){overdue ? " ⚠ overdue" : ""}
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}

        <div style={{ height: 1, background: "#3a2810", margin: "8px 0" }} />

        {/* Acquaintances */}
        <div>
          <div style={{ fontSize: 10, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
            Knows
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {world.acquaintances[selectedAgent]?.length ? (
              world.acquaintances[selectedAgent]!.map((a) => (
                <span
                  key={a}
                  onClick={() => selectAgent(a)}
                  style={{
                    fontSize: 10, color: "#d4c080",
                    background: "rgba(60,40,10,0.5)", border: "1px solid #5a3c10",
                    borderRadius: 3, padding: "2px 6px", cursor: "pointer",
                  }}
                >
                  {AGENT_DISPLAY[a]}
                </span>
              ))
            ) : (
              <span style={{ fontSize: 10, color: "#4a3020" }}>No acquaintances yet</span>
            )}
          </div>
        </div>

        {/* ─── Interview ─────────────────────────────── */}
        <div style={{ height: 1, background: "#3a2810", margin: "10px 0" }} />
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
            Interview {AGENT_DISPLAY[selectedAgent].split(" ")[0]}
          </div>
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAgent(); } }}
            placeholder="Ask them something…"
            rows={3}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(20,12,4,0.9)", border: "1px solid #5a3c10",
              borderRadius: 4, color: "#d4c080", fontSize: 10,
              fontFamily: "Georgia, serif", padding: "6px 8px",
              resize: "vertical", outline: "none",
            }}
          />
          <button
            onClick={askAgent}
            disabled={interviewing || !question.trim()}
            style={{
              marginTop: 4, width: "100%",
              background: interviewing ? "rgba(40,25,5,0.8)" : "rgba(80,50,5,0.8)",
              border: "1px solid #8a5010", borderRadius: 4,
              color: "#f0c040", fontSize: 10, fontFamily: "Georgia, serif",
              padding: "5px", cursor: interviewing ? "default" : "pointer",
              opacity: !question.trim() ? 0.5 : 1,
            }}
          >
            {interviewing ? "…" : "Ask"}
          </button>
          {answer && (
            <div ref={answerRef} style={{
              marginTop: 6, maxHeight: 140, overflowY: "auto",
              background: "rgba(30,18,5,0.9)", border: "1px solid #5a3c10",
              borderRadius: 4, padding: "6px 8px",
              fontSize: 10, color: "#e8d8a0", lineHeight: 1.5,
              fontStyle: "italic",
            }}>
              {answer}
            </div>
          )}
        </div>

        {/* ─── Whisper ───────────────────────────────── */}
        <div style={{ height: 1, background: "#3a2810", margin: "8px 0" }} />
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, marginBottom: 2, textTransform: "uppercase" }}>
            Whisper a Rumor
          </div>
          <div style={{ fontSize: 9, color: "#6a4820", fontStyle: "italic", marginBottom: 6 }}>
            They'll hear it next tick
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              type="text"
              value={whisper}
              onChange={e => setWhisper(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") whisperRumor(); }}
              placeholder="Spread a rumor…"
              style={{
                flex: 1, background: "rgba(20,12,4,0.9)", border: "1px solid #5a3c10",
                borderRadius: 4, color: "#d4c080", fontSize: 10,
                fontFamily: "Georgia, serif", padding: "5px 8px", outline: "none",
              }}
            />
            <button
              onClick={whisperRumor}
              disabled={whispering || !whisper.trim()}
              style={{
                background: "rgba(40,25,5,0.8)", border: "1px solid #8a5010",
                borderRadius: 4, color: "#f0c040", fontSize: 10,
                fontFamily: "Georgia, serif", padding: "5px 10px",
                cursor: whispering ? "default" : "pointer",
                opacity: !whisper.trim() ? 0.5 : 1,
              }}
            >
              {whispering ? "…" : "Whisper"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
