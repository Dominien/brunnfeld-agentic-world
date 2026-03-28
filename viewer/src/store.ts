import { create } from "zustand";
import type { AgentName, WorldState, FeedEntry, SSEEvent, EconomySnapshot, VillageInfo } from "./types";

export interface AgentAnimation {
  agent: AgentName;
  fromLoc: string;
  toLoc: string;
  startMs: number;
  durationMs: number;
}

const AGENT_DISPLAY_BASE: Record<string, string> = {
  hans: "Hans", ida: "Ida", konrad: "Konrad", ulrich: "Ulrich", bertram: "Bertram",
  gerda: "Gerda", anselm: "Anselm", volker: "Volker", wulf: "Wulf",
  liesel: "Liesel", sybille: "Sybille", friedrich: "Friedrich",
  otto: "Otto", pater_markus: "Pater Markus",
  dieter: "Dieter", magda: "Magda", heinrich: "Heinrich",
  elke: "Elke", rupert: "Rupert",
  player: "You",
};

/** Format an agent ID as a display name (fallback for dynamically generated agents). */
export function formatAgentName(id: string): string {
  return AGENT_DISPLAY_BASE[id] ?? id.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Auto-formats unknown agent IDs so all AGENT_DISPLAY[x] calls work for generated agents. */
export const AGENT_DISPLAY: Record<string, string> = new Proxy(AGENT_DISPLAY_BASE, {
  get(target, prop: string) {
    return target[prop] ?? prop.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  },
});

let feedCounter = 0;
let orderFeedCounter = 0;

export interface OrderFeedEntry {
  id: number;
  at: number;
  kind: "posted" | "cancelled" | "expired" | "filled";
  side?: "sell" | "buy";
  agent: AgentName;
  counterAgent?: AgentName;
  item?: string;
  quantity?: number;
  price?: number;
}

export interface PriceFlash {
  dir: "up" | "down";
  at: number;
}

// ─── Parse a tick log into feed entries ───────────────────────────────────

interface TickLogAction {
  type: string;
  text?: string;
  result?: string;
}

interface TickLogAgentTurn {
  agent: AgentName;
  actions: TickLogAction[];
}

interface TickLogLocation {
  agents: string[];
  rounds: TickLogAgentTurn[][];
}

interface TickLogRaw {
  tick: number;
  simulated_time: string;
  season: string;
  weather: string;
  locations: Record<string, TickLogLocation>;
  movements: { agent: AgentName; from: string; to: string }[];
  trades: { id: string; buyer: AgentName; seller: AgentName; item: string; quantity: number; pricePerUnit: number; total: number }[];
  productions: { agent: AgentName; item: string; qty: number }[];
}

export function tickLogToFeed(log: TickLogRaw): FeedEntry[] {
  const entries: FeedEntry[] = [];

  for (const [location, info] of Object.entries(log.locations)) {
    for (const round of info.rounds) {
      for (const agentTurn of round) {
        for (const action of agentTurn.actions) {
          if (!action.result) continue;
          const isSpeak = action.type === "speak";
          const isDo = action.type === "do";
          const isMove = action.type === "move_to";
          const isPropose = action.type === "propose_rule";
          const isVote = action.type === "vote";
          if (!isSpeak && !isDo && !isMove && !isPropose && !isVote) continue;
          entries.push({
            id: feedCounter++,
            tick: log.tick,
            agent: agentTurn.agent,
            type: isSpeak ? "speak" : isMove ? "move" : "do",
            text: action.result,
            location,
          });
        }
      }
    }
  }

  for (const trade of log.trades) {
    entries.push({
      id: feedCounter++,
      tick: log.tick,
      agent: trade.buyer,
      type: "trade",
      text: `${formatAgentName(trade.buyer)} bought ${trade.quantity}× ${trade.item} from ${formatAgentName(trade.seller)} for ${trade.total} coin`,
    });
  }

  for (const prod of log.productions) {
    entries.push({
      id: feedCounter++,
      tick: log.tick,
      agent: prod.agent,
      type: "production",
      text: `${formatAgentName(prod.agent)} produced ${prod.qty}× ${prod.item}`,
    });
  }

  for (const mv of log.movements) {
    if (mv.from !== mv.to) {
      entries.push({
        id: feedCounter++,
        tick: log.tick,
        agent: mv.agent,
        type: "move",
        text: `${formatAgentName(mv.agent)} moves to ${mv.to}`,
        location: mv.to,
      });
    }
  }

  return entries;
}

// ─── Store ────────────────────────────────────────────────────────────────

type ViewMode = "live" | "history";

export interface StreamEntry {
  agent: AgentName;
  name: string;
  text: string;
}

export interface MeetingState {
  phase: "discussion" | "vote" | "result";
  agendaType: string;
  description: string;
  attendees: AgentName[];
  votes: Partial<Record<AgentName, "agree" | "disagree">>;
  proposal: string | null;
  result: { passed: boolean; agreeCount: number } | null;
  discussion: { agent: AgentName; name: string; text: string }[];
}

interface VillageStore {
  world: WorldState | null;
  feed: FeedEntry[];
  selectedAgent: AgentName | null;
  selectedAgentVersion: number;
  connected: boolean;
  currentTick: number;
  latestEconomy: EconomySnapshot | null;
  streaming: Record<string, StreamEntry>;  // agent → live stream
  agentStatus: Record<string, string>;    // agent → current harness tool summary
  orderFeed: OrderFeedEntry[];
  priceFlashes: Record<string, PriceFlash>;
  playerCreated: boolean;
  playerName: string;
  watchMode: boolean;
  activeMeeting: MeetingState | null;
  activeVillageId: string;
  villages: VillageInfo[];
  setWatchMode: (v: boolean) => void;
  setActiveVillageId: (id: string) => void;
  setVillages: (v: VillageInfo[]) => void;

  // Tick navigation
  mode: ViewMode;
  availableTicks: string[];       // e.g. ["tick_00001", "tick_00002"]
  historyTickId: string | null;   // currently viewed tick in history mode
  historyFeed: FeedEntry[];       // feed for the history tick
  historyLoading: boolean;

  pendingAnimations: AgentAnimation[];

  setWorld: (w: WorldState) => void;
  selectAgent: (a: AgentName | null) => void;
  setConnected: (v: boolean) => void;
  handleSSEEvent: (e: SSEEvent) => void;
  appendHistoricalFeed: (entries: FeedEntry[]) => void;
  setAvailableTicks: (ticks: string[]) => void;
  setMode: (mode: ViewMode) => void;
  loadHistoryTick: (tickId: string) => Promise<void>;
  stepHistory: (delta: number) => void;
  consumeAnimations: () => AgentAnimation[];
  commitAgentLocation: (agent: AgentName, loc: string) => void;
}

export const useVillageStore = create<VillageStore>((set, get) => ({
  world: null,
  feed: [],
  selectedAgent: null,
  selectedAgentVersion: 0,
  connected: false,
  currentTick: 0,
  latestEconomy: null,
  streaming: {},
  agentStatus: {},
  orderFeed: [],
  priceFlashes: {},
  pendingAnimations: [],
  playerCreated: false,
  playerName: "",
  watchMode: false,
  activeMeeting: null,
  activeVillageId: "brunnfeld",
  villages: [],
  setWatchMode: (watchMode) => set((s) => ({
    watchMode,
    selectedAgent: watchMode && s.selectedAgent === "player" ? null : s.selectedAgent,
  })),
  setActiveVillageId: (activeVillageId) => set({ activeVillageId }),
  setVillages: (villages) => set({ villages }),

  mode: "live",
  availableTicks: [],
  historyTickId: null,
  historyFeed: [],
  historyLoading: false,

  setWorld: (world) => set({ world }),
  selectAgent: (selectedAgent) => set((s) => ({ selectedAgent, selectedAgentVersion: s.selectedAgentVersion + 1 })),
  setConnected: (connected) => set({ connected }),

  setAvailableTicks: (availableTicks) => set({ availableTicks }),

  appendHistoricalFeed: (entries) =>
    set((s) => ({ feed: [...entries, ...s.feed].slice(0, 300) })),

  setMode: (mode) => set({ mode }),

  loadHistoryTick: async (tickId: string) => {
    set({ historyLoading: true, historyTickId: tickId });
    try {
      const res = await fetch(`/api/tick/${tickId}`);
      const log: TickLogRaw = await res.json();
      const entries = tickLogToFeed(log);
      set({ historyFeed: entries, historyLoading: false });
    } catch {
      set({ historyLoading: false });
    }
  },

  stepHistory: (delta: number) => {
    const { availableTicks, historyTickId, mode } = get();
    if (!availableTicks.length) return;
    const currentIdx = historyTickId ? availableTicks.indexOf(historyTickId) : availableTicks.length - 1;
    const newIdx = Math.max(0, Math.min(availableTicks.length - 1, currentIdx + delta));
    const newTickId = availableTicks[newIdx]!;
    if (mode !== "history") set({ mode: "history" });
    get().loadHistoryTick(newTickId);
  },

  consumeAnimations: () => {
    const anims = get().pendingAnimations;
    if (anims.length === 0) return [];
    set({ pendingAnimations: [] });
    return anims;
  },

  commitAgentLocation: (agent: AgentName, loc: string) => {
    set((s) => ({
      world: s.world ? {
        ...s.world,
        agent_locations: { ...s.world.agent_locations, [agent]: loc },
      } : s.world,
    }));
  },

  handleSSEEvent: (e: SSEEvent) => {
    const { world } = get();

    if (e.type === "init") {
      const fills: OrderFeedEntry[] = (e.state.marketplace.history ?? [])
        .slice(-50)
        .reverse()
        .map((trade) => ({
          id: orderFeedCounter++,
          at: Date.now(),
          kind: "filled" as const,
          agent: trade.buyer,
          counterAgent: trade.seller,
          item: trade.item,
          quantity: trade.quantity,
          price: trade.pricePerUnit,
        }));
      const lastSnap = e.state.economy_snapshots?.at(-1) ?? null;
      set({
        world: e.state,
        currentTick: e.state.current_tick,
        orderFeed: fills,
        latestEconomy: lastSnap,
        playerCreated: e.state.player_created ?? false,
        activeMeeting: e.activeMeeting ?? null,
      });
      return;
    }

    if (e.type === "harness:tool") {
      set(s => ({ agentStatus: { ...s.agentStatus, [e.agent]: e.summary } }));
      return;
    }

    if (e.type === "thinking") {
      set((s) => ({
        streaming: {
          ...s.streaming,
          [e.agent]: { agent: e.agent, name: e.name, text: "" },
        },
      }));
      return;
    }

    if (e.type === "stream") {
      if (!e.chunk) {
        // Empty chunk = done streaming this agent
        set((s) => {
          const next = { ...s.streaming };
          delete next[e.agent];
          return { streaming: next };
        });
      } else {
        set((s) => {
          const prev = s.streaming[e.agent];
          return {
            streaming: {
              ...s.streaming,
              [e.agent]: { agent: e.agent, name: e.name, text: (prev?.text ?? "") + e.chunk },
            },
          };
        });
      }
      return;
    }

    if (e.type === "tick") {
      set((s) => ({
        currentTick: e.tick,
        streaming: {},     // clear all streams on new tick
        agentStatus: {},   // clear harness status on new tick
        world: s.world ? {
          ...s.world,
          current_tick: e.tick,
          current_time: e.time,
          season: e.season,
          weather: e.weather,
        } : s.world,
      }));  // closes set(
      // Refresh available ticks list so navigator stays up to date
      fetch("/api/ticks")
        .then((r) => r.json())
        .then((ticks: string[]) => get().setAvailableTicks(ticks))
        .catch(() => {});
      return;
    }

    if (e.type === "action") {
      const isSpeech = e.actionType === "speak";
      const isDo = e.actionType === "do";
      const isMove = e.actionType === "move_to";
      if (!e.result || e.actionType === "think" || e.actionType === "wait") return;
      if (!isSpeech && !isDo && !isMove) return;

      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: e.agent,
        type: isSpeech ? "speak" : isMove ? "move" : "do",
        text: e.result ?? "",
        location: e.location,
      };
      set((s) => {
        const base = { feed: [entry, ...s.feed].slice(0, 300) };
        if (isSpeech && e.location === "Town Hall" && s.activeMeeting) {
          return {
            ...base,
            activeMeeting: {
              ...s.activeMeeting,
              discussion: [
                ...s.activeMeeting.discussion,
                { agent: e.agent, name: formatAgentName(e.agent), text: e.result ?? "" },
              ].slice(-60),
            },
          };
        }
        return base;
      });

      if (e.location) {
        if (isMove && world) {
          const fromLoc = world.agent_locations[e.agent];
          if (fromLoc && fromLoc !== e.location) {
            set((s) => ({
              pendingAnimations: [
                ...s.pendingAnimations,
                {
                  agent: e.agent,
                  fromLoc,
                  toLoc: e.location!,
                  startMs: performance.now(),
                  durationMs: 1200,
                },
              ],
            }));
          } else {
            set((s) => ({
              world: s.world ? {
                ...s.world,
                agent_locations: { ...s.world.agent_locations, [e.agent]: e.location! },
              } : s.world,
            }));
          }
        }
        // Non-move actions carry an informational location (where the action happened),
        // not a destination — do not snap agent position for speak/do/etc.
      }
      return;
    }

    if (e.type === "trade") {
      const currentPrice = world?.marketplace.priceIndex[e.item] ?? null;
      const dir: PriceFlash["dir"] = currentPrice == null || e.pricePerUnit === currentPrice
        ? "up"
        : e.pricePerUnit > currentPrice ? "up" : "down";

      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: e.buyer,
        type: "trade",
        text: `${formatAgentName(e.buyer)} bought ${e.quantity}× ${e.item} from ${formatAgentName(e.seller)} for ${e.total} coin`,
      };
      const orderEntry: OrderFeedEntry = {
        id: orderFeedCounter++,
        at: Date.now(),
        kind: "filled",
        agent: e.buyer,
        counterAgent: e.seller,
        item: e.item,
        quantity: e.quantity,
        price: e.pricePerUnit,
      };
      set((s) => ({
        feed: [entry, ...s.feed].slice(0, 300),
        orderFeed: [orderEntry, ...s.orderFeed].slice(0, 150),
        priceFlashes: { ...s.priceFlashes, [e.item]: { dir, at: Date.now() } },
      }));
      return;
    }

    if (e.type === "production") {
      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: e.agent,
        type: "production",
        text: `${formatAgentName(e.agent)} produced ${e.qty}× ${e.item}`,
      };
      set((s) => ({ feed: [entry, ...s.feed].slice(0, 300) }));
      return;
    }

    if (e.type === "economy") {
      set((s) => ({
        latestEconomy: e.snapshot,
        world: s.world ? {
          ...s.world,
          economy_snapshots: [...(s.world.economy_snapshots ?? []), e.snapshot],
        } : s.world,
      }));
      return;
    }

    if (e.type === "order") {
      const orderEntry: OrderFeedEntry = {
        id: orderFeedCounter++,
        at: Date.now(),
        kind: e.event,
        side: e.orderType,
        agent: e.agentId,
        item: e.item,
        quantity: e.quantity,
        price: e.price,
      };
      set((s) => ({ orderFeed: [orderEntry, ...s.orderFeed].slice(0, 150) }));
      return;
    }

    if (e.type === "event") {
      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: "otto",
        type: "system",
        text: `⚡ ${e.description}`,
      };
      set((s) => ({
        feed: [entry, ...s.feed].slice(0, 300),
        world: s.world
          ? {
              ...s.world,
              ...(e.active_events ? { active_events: e.active_events } : {}),
              ...(e.agent_locations ? { agent_locations: e.agent_locations as Record<AgentName, string> } : {}),
            }
          : s.world,
      }));
      return;
    }

    if (e.type === "event_expired") {
      set((s) => {
        if (!s.world?.active_events.some(ev => ev.type === e.eventType)) return s;
        return { world: { ...s.world!, active_events: s.world!.active_events.filter(ev => ev.type !== e.eventType) } };
      });
      return;
    }

    if (e.type === "player:created") {
      set((s) => ({
        playerCreated: true,
        playerName: e.name,
        world: s.world ? {
          ...s.world,
          player_created: true,
          agent_locations: { ...s.world.agent_locations, player: e.location },
        } : s.world,
      }));
      return;
    }

    if (e.type === "player:update") {
      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: "player",
        type: "do",
        text: e.result || e.feedback || "You act.",
      };
      const world = get().world;
      const fromLoc = world?.agent_locations["player"];
      const isMove = !!(fromLoc && e.location && fromLoc !== e.location);
      set((s) => {
        const baseWorld = s.world ? {
          ...s.world,
          // always patch wallet
          economics: {
            ...s.world.economics,
            player: s.world.economics.player
              ? { ...s.world.economics.player, wallet: e.wallet }
              : s.world.economics.player,
          },
          // only snap location if not animating
          ...(!isMove && e.location ? {
            agent_locations: { ...s.world.agent_locations, player: e.location },
          } : {}),
        } : s.world;
        return {
          feed: [entry, ...s.feed].slice(0, 300),
          world: baseWorld,
          ...(isMove ? {
            pendingAnimations: [
              ...s.pendingAnimations,
              { agent: "player" as AgentName, fromLoc: fromLoc!, toLoc: e.location, startMs: performance.now(), durationMs: 900 },
            ],
          } : {}),
        };
      });
      return;
    }

    if (e.type === "player:revived") {
      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: "player",
        type: "system",
        text: `You collapsed from hunger. Pater Markus nursed you back (-10 coin).`,
      };
      set((s) => ({
        feed: [entry, ...s.feed].slice(0, 300),
        world: s.world ? {
          ...s.world,
          agent_locations: { ...s.world.agent_locations, player: "Healer's Hut" },
          economics: {
            ...s.world.economics,
            player: s.world.economics.player
              ? { ...s.world.economics.player, wallet: e.newWallet }
              : s.world.economics.player,
          },
        } : s.world,
      }));
      return;
    }

    if (e.type === "meeting:start") {
      set({
        activeMeeting: {
          phase: "discussion",
          agendaType: e.agendaType,
          description: e.description,
          attendees: e.attendees,
          votes: {},
          proposal: null,
          result: null,
          discussion: [],
        },
      });
      return;
    }

    if (e.type === "meeting:phase") {
      if (e.phase === "vote") {
        set((s) => ({
          activeMeeting: s.activeMeeting ? {
            ...s.activeMeeting,
            phase: "vote",
            proposal: e.proposal ?? null,
          } : s.activeMeeting,
        }));
      }
      return;
    }

    if (e.type === "meeting:vote") {
      set((s) => ({
        activeMeeting: s.activeMeeting ? {
          ...s.activeMeeting,
          votes: { ...s.activeMeeting.votes, [e.agent]: e.side },
        } : s.activeMeeting,
      }));
      return;
    }

    if (e.type === "meeting:result") {
      set((s) => ({
        activeMeeting: s.activeMeeting ? {
          ...s.activeMeeting,
          phase: "result",
          result: { passed: e.passed, agreeCount: e.agreeCount },
        } : s.activeMeeting,
      }));
      return;
    }

    if (e.type === "meeting:end") {
      setTimeout(() => set({ activeMeeting: null }), 4000);
      return;
    }

    if (e.type === "meeting:quorum_fail") {
      // Brief notification then clear (no meeting happened)
      setTimeout(() => set({ activeMeeting: null }), 3000);
      return;
    }
  },
}));
