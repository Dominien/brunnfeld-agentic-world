import "dotenv/config";
import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, unlinkSync, copyFileSync, mkdirSync,
} from "fs";
import { join } from "path";
import { readWorldState } from "./memory.js";
import { runSimulation } from "./engine.js";
import type { WorldState } from "./types.js";
import { ALL_ITEMS } from "./types.js";

const DATA_DIR = join(process.cwd(), "data");
const INITIAL_MEMORIES_DIR = join(DATA_DIR, "memory_initial");

// ─── Initial World State ─────────────────────────────────────

function initWorldState(): WorldState {
  return {
    current_tick: 0,
    current_time: "Simulation not started",
    season: "spring",
    day_of_season: 1,
    weather: "Mild, 12°C, partly cloudy",
    active_events: [],

    agent_locations: {
      hans: "Cottage 1", ida: "Cottage 2", konrad: "Farm 2",
      ulrich: "Cottage 4", bertram: "Cottage 5", gerda: "Mill",
      anselm: "Bakery", volker: "Forge", wulf: "Carpenter Shop",
      liesel: "Tavern", sybille: "Healer's Hut", friedrich: "Cottage 7",
      otto: "Elder's House", pater_markus: "Town Hall",
      dieter: "Cottage 8", magda: "Cottage 8", bertha: "Cottage 9",
      heinrich: "Cottage 1", elke: "Seamstress Cottage", rupert: "Cottage 3",
      player: "Village Square",
    },

    body: {
      hans:         { hunger: 1, energy: 9, sleep_quality: "good" },
      ida:          { hunger: 1, energy: 8, sleep_quality: "fair" },
      konrad:       { hunger: 2, energy: 8, sleep_quality: "good" },
      ulrich:       { hunger: 1, energy: 9, sleep_quality: "good" },
      bertram:      { hunger: 2, energy: 7, sleep_quality: "fair" },
      gerda:        { hunger: 1, energy: 9, sleep_quality: "good" },
      anselm:       { hunger: 0, energy: 8, sleep_quality: "good" },
      volker:       { hunger: 2, energy: 9, sleep_quality: "good" },
      wulf:         { hunger: 1, energy: 8, sleep_quality: "fair" },
      liesel:       { hunger: 1, energy: 7, sleep_quality: "fair" },
      sybille:      { hunger: 1, energy: 9, sleep_quality: "good" },
      friedrich:    { hunger: 2, energy: 9, sleep_quality: "good" },
      otto:         { hunger: 1, energy: 7, sleep_quality: "fair" },
      pater_markus: { hunger: 1, energy: 8, sleep_quality: "good" },
      dieter:       { hunger: 2, energy: 8, sleep_quality: "fair" },
      magda:        { hunger: 1, energy: 8, sleep_quality: "good" },
      bertha:       { hunger: 2, energy: 7, sleep_quality: "poor" },
      heinrich:     { hunger: 1, energy: 9, sleep_quality: "good" },
      elke:         { hunger: 1, energy: 8, sleep_quality: "fair" },
      rupert:       { hunger: 2, energy: 9, sleep_quality: "good" },
      player:       { hunger: 0, energy: 8, sleep_quality: "good" },
    },

    economics: {
      hans:         { wallet: 30, inventory: { items: [{ type: "wheat", quantity: 8 }] }, tool: { type: "iron_tools", durability: 80 }, skill: "farmer", homeLocation: "Cottage 1", workLocation: "Farm 1", workSchedule: { open: 6, close: 16 } },
      ida:          { wallet: 12, inventory: { items: [{ type: "cloth", quantity: 2 }] }, tool: null, skill: "none", homeLocation: "Cottage 2", workLocation: "Cottage 2", workSchedule: { open: 6, close: 21 } },
      konrad:       { wallet: 40, inventory: { items: [{ type: "milk", quantity: 3 }, { type: "meat", quantity: 2 }] }, tool: { type: "iron_tools", durability: 90 }, skill: "cattle", homeLocation: "Farm 2", workLocation: "Farm 2", workSchedule: { open: 6, close: 15 } },
      ulrich:       { wallet: 20, inventory: { items: [{ type: "vegetables", quantity: 4 }] }, tool: { type: "iron_tools", durability: 70 }, skill: "farmer", homeLocation: "Cottage 4", workLocation: "Farm 3", workSchedule: { open: 6, close: 16 } },
      bertram:      { wallet: 15, inventory: { items: [{ type: "wheat", quantity: 5 }] }, tool: { type: "iron_tools", durability: 60 }, skill: "farmer", homeLocation: "Cottage 5", workLocation: "Farm 1", workSchedule: { open: 6, close: 16 } },
      gerda:        { wallet: 45, inventory: { items: [{ type: "flour", quantity: 4 }] }, tool: null, skill: "miller", homeLocation: "Mill", workLocation: "Mill", workSchedule: { open: 7, close: 16 } },
      anselm:       { wallet: 32, inventory: { items: [{ type: "bread", quantity: 6 }, { type: "flour", quantity: 2 }] }, tool: null, skill: "baker", homeLocation: "Bakery", workLocation: "Bakery", workSchedule: { open: 6, close: 13 } },
      volker:       { wallet: 60, inventory: { items: [{ type: "iron_ore", quantity: 4 }, { type: "coal", quantity: 3 }] }, tool: null, skill: "blacksmith", homeLocation: "Forge", workLocation: "Forge", workSchedule: { open: 7, close: 16 } },
      wulf:         { wallet: 35, inventory: { items: [{ type: "timber", quantity: 5 }] }, tool: { type: "iron_tools", durability: 75 }, skill: "carpenter", homeLocation: "Carpenter Shop", workLocation: "Carpenter Shop", workSchedule: { open: 7, close: 16 } },
      liesel:       { wallet: 55, inventory: { items: [{ type: "ale", quantity: 6 }, { type: "wheat", quantity: 4 }] }, tool: null, skill: "tavern", homeLocation: "Tavern", workLocation: "Tavern", workSchedule: { open: 10, close: 21 } },
      sybille:      { wallet: 28, inventory: { items: [{ type: "herbs", quantity: 5 }, { type: "medicine", quantity: 2 }] }, tool: null, skill: "healer", homeLocation: "Healer's Hut", workLocation: "Healer's Hut", workSchedule: { open: 7, close: 17 } },
      friedrich:    { wallet: 22, inventory: { items: [{ type: "timber", quantity: 3 }, { type: "firewood", quantity: 6 }] }, tool: { type: "iron_tools", durability: 85 }, skill: "woodcutter", homeLocation: "Cottage 7", workLocation: "Forest", workSchedule: { open: 6, close: 17 } },
      otto:         { wallet: 120, inventory: { items: [] }, tool: null, skill: "none", homeLocation: "Elder's House", workLocation: "Elder's House", workSchedule: { open: 6, close: 21 } },
      pater_markus: { wallet: 25, inventory: { items: [] }, tool: null, skill: "none", homeLocation: "Town Hall", workLocation: "Town Hall", workSchedule: { open: 6, close: 21 } },
      dieter:       { wallet: 18, inventory: { items: [{ type: "iron_ore", quantity: 2 }, { type: "coal", quantity: 1 }] }, tool: { type: "iron_tools", durability: 65 }, skill: "miner", homeLocation: "Cottage 8", workLocation: "Mine", workSchedule: { open: 7, close: 17 } },
      magda:        { wallet: 10, inventory: { items: [{ type: "bread", quantity: 2 }] }, tool: null, skill: "none", homeLocation: "Cottage 8", workLocation: "Village Square", workSchedule: { open: 6, close: 21 } },
      bertha:       { wallet: 55, inventory: { items: [{ type: "bread", quantity: 4 }, { type: "iron_tools", quantity: 2 }] }, tool: null, skill: "merchant", homeLocation: "Cottage 9", workLocation: "Village Square", workSchedule: { open: 6, close: 21 } },
      heinrich:     { wallet: 25, inventory: { items: [{ type: "wheat", quantity: 6 }, { type: "eggs", quantity: 3 }] }, tool: { type: "iron_tools", durability: 55 }, skill: "farmer", homeLocation: "Cottage 1", workLocation: "Farm 1", workSchedule: { open: 6, close: 16 } },
      elke:         { wallet: 30, inventory: { items: [{ type: "cloth", quantity: 3 }] }, tool: null, skill: "seamstress", homeLocation: "Seamstress Cottage", workLocation: "Seamstress Cottage", workSchedule: { open: 7, close: 16 } },
      rupert:       { wallet: 20, inventory: { items: [{ type: "iron_ore", quantity: 3 }, { type: "coal", quantity: 2 }] }, tool: { type: "iron_tools", durability: 80 }, skill: "miner", homeLocation: "Cottage 3", workLocation: "Mine", workSchedule: { open: 7, close: 17 } },
      player:       { wallet: 0, inventory: { items: [] }, tool: null, skill: "none", homeLocation: "Village Square", workLocation: "Village Square", workSchedule: { open: 6, close: 21 } },
    },

    marketplace: {
      orders: [],
      history: [],
      priceIndex: {
        wheat: 2, flour: 5, bread: 3, meat: 8, milk: 2,
        iron_tools: 15, coal: 3, iron_ore: 4, timber: 3, firewood: 2,
        herbs: 1, medicine: 10, ale: 3, meal: 6, cloth: 5,
        furniture: 12, eggs: 1, vegetables: 2,
      },
      priceHistory: Object.fromEntries(ALL_ITEMS.map(i => [i, []])) as Record<string, []>,
    },

    doors: {
      "Cottage 1": "unlocked", "Cottage 2": "unlocked", "Cottage 3": "unlocked",
      "Cottage 4": "unlocked", "Cottage 5": "unlocked", "Cottage 6": "unlocked",
      "Cottage 7": "unlocked", "Cottage 8": "unlocked", "Cottage 9": "unlocked",
      "Seamstress Cottage": "unlocked", "Healer's Hut": "unlocked",
      "Bakery": "unlocked", "Tavern": "unlocked", "Forge": "unlocked",
      "Carpenter Shop": "unlocked", "Mill": "unlocked",
      "Town Hall": "unlocked", "Prison": "unlocked",
      "Elder's House": "unlocked",
      "Farm 1": "unlocked", "Farm 2": "unlocked", "Farm 3": "unlocked",
    },

    message_queue: {
      hans: [], ida: [], konrad: [], ulrich: [], bertram: [],
      gerda: [], anselm: [], volker: [], wulf: [],
      liesel: [], sybille: [], friedrich: [],
      otto: [], pater_markus: [],
      dieter: [], magda: [], bertha: [], heinrich: [], elke: [], rupert: [],
      player: [],
    },

    objects: [],
    action_feedback: {
      hans: [], ida: [], konrad: [], ulrich: [], bertram: [],
      gerda: [], anselm: [], volker: [], wulf: [],
      liesel: [], sybille: [], friedrich: [],
      otto: [], pater_markus: [],
      dieter: [], magda: [], bertha: [], heinrich: [], elke: [], rupert: [],
      player: [],
    },

    acquaintances: {
      hans: ["heinrich"],    // housemates
      ida: [],
      konrad: [],
      ulrich: [],
      bertram: [],
      gerda: ["anselm"],     // miller + baker working relationship
      anselm: ["gerda"],
      volker: ["wulf"],      // forge + carpenter side by side
      wulf: ["volker"],
      liesel: ["otto", "pater_markus"],   // tavern keeper knows community leaders
      sybille: [],
      friedrich: ["rupert"], // both woodsy types
      otto: ["pater_markus", "liesel"],
      pater_markus: ["otto"],
      dieter: ["rupert"],    // mine workers
      magda: ["dieter"],     // housemates
      bertha: [],
      heinrich: ["hans"],    // housemates
      elke: [],
      rupert: ["dieter", "friedrich"],
      player: [],
    },

    economy_snapshots: [],
    total_tax_collected: 0,
    production_log: [],
    loans: [],
    caughtStealing: {},
    // Governance
    pending_meeting: undefined,
    active_laws: [],
    banned: {},
    tax_rate: 0.10,
    player_created: false,
    pending_player_actions: [],
  };
}

// ─── Reset ────────────────────────────────────────────────────

function resetSimulation(): void {
  console.log("Resetting Brunnfeld to initial state...\n");

  // Restore initial memories
  if (existsSync(INITIAL_MEMORIES_DIR)) {
    const memDir = join(DATA_DIR, "memory");
    for (const file of readdirSync(INITIAL_MEMORIES_DIR)) {
      copyFileSync(join(INITIAL_MEMORIES_DIR, file), join(memDir, file));
    }
    console.log("  Restored initial memory files.");
  }

  writeFileSync(join(DATA_DIR, "world_state.json"), JSON.stringify(initWorldState(), null, 2));
  console.log("  Reset world state.");

  // Clear logs
  const logsDir = join(DATA_DIR, "logs");
  if (existsSync(logsDir)) {
    for (const file of readdirSync(logsDir)) {
      if (file.endsWith(".json")) unlinkSync(join(logsDir, file));
    }
    console.log("  Cleared tick logs.");
  }

  console.log("\nReset complete. Run `npm start` to begin.\n");
}

// ─── Backup initial memories ──────────────────────────────────

function backupInitialMemories(): void {
  if (existsSync(INITIAL_MEMORIES_DIR)) return;
  mkdirSync(INITIAL_MEMORIES_DIR, { recursive: true });
  const memDir = join(DATA_DIR, "memory");
  for (const file of readdirSync(memDir)) {
    if (file.endsWith(".md")) copyFileSync(join(memDir, file), join(INITIAL_MEMORIES_DIR, file));
  }
}

// ─── Viewer (in-process server so SSE events are shared) ─────

async function startViewer(): Promise<void> {
  const viewerPkg = join(process.cwd(), "viewer", "package.json");
  if (!existsSync(viewerPkg)) return;
  // Import server so it starts in the same process as the engine,
  // sharing the eventBus for live SSE streaming.
  await import("./server.js");
}

// ─── Graceful shutdown ────────────────────────────────────────

function setupShutdown(): void {
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n\nShutting down. Resume with: npm run resume");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ─── First run: write initial state if none exists ────────────

function ensureInitialState(): void {
  const statePath = join(DATA_DIR, "world_state.json");
  if (!existsSync(statePath)) {
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(join(DATA_DIR, "memory"), { recursive: true });
    mkdirSync(join(DATA_DIR, "profiles"), { recursive: true });
    writeFileSync(statePath, JSON.stringify(initWorldState(), null, 2));
    console.log("  Created initial world state.");
  }
}

// ─── CLI ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--reset")) {
    resetSimulation();
    return;
  }

  setupShutdown();
  ensureInitialState();
  backupInitialMemories();

  await startViewer();

  if (args.includes("--resume")) {
    const state = readWorldState();
    console.log(`Resuming from tick ${state.current_tick + 1}...`);
    await runSimulation(state.current_tick + 1);
    return;
  }

  if (args.includes("--tick-once")) {
    const state = readWorldState();
    await runSimulation(state.current_tick + 1, true);
    return;
  }

  const fromIdx = args.indexOf("--from");
  if (fromIdx >= 0 && args[fromIdx + 1]) {
    await runSimulation(parseInt(args[fromIdx + 1]!));
    return;
  }

  const state = readWorldState();
  if (state.current_tick > 0) {
    console.log(`Simulation in progress (tick ${state.current_tick}).`);
    console.log("Use --resume to continue or --reset to start over.");
    return;
  }

  await runSimulation();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
