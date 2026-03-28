/**
 * Runtime world registry.
 *
 * Loads from data/world_config.json if present; otherwise wraps the hardcoded
 * 1-village Brunnfeld defaults. All engine modules import from here instead of
 * directly from types.ts or village-map.ts.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Skill } from "./types.js";
import {
  AGENT_NAMES,
  AGENT_DISPLAY_NAMES,
  AGENT_SKILLS,
  AGENT_WORK_LOCATIONS,
  AGENT_HOMES,
  COUNCIL_MEMBERS,
} from "./types.js";
import {
  LOCATIONS,
  ADJACENCY,
  OPENING_HOURS,
  LOCATION_TILES,
} from "./village-map.js";

// ─── Schema ──────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  displayName: string;
  skill: Skill;
  homeLocation: string;
  workLocation: string;
  description: string;    // shown to unknown acquaintances: "a farmer", "the miller"
}

export interface VillageConfig {
  id: string;
  name: string;
  agents: AgentConfig[];
  locations: string[];
  locationTypes: Record<string, string>;  // location name → type ("farm", "mill", etc.)
  councilMembers: string[];
  adjacency: Record<string, string[]>;
  openingHours: Partial<Record<string, { open: number; close: number }>>;
  locationTiles?: Record<string, { tx: number; ty: number }>;
}

export interface RoadConfig {
  id: string;
  name: string;                        // "Road: Brunnfeld→Norddorf"
  connectsVillages: [string, string];  // village IDs
  transitTicks: number;
}

export interface WorldConfig {
  villages: VillageConfig[];
  roads: RoadConfig[];
}

// ─── Default location types (for Brunnfeld's bare location names) ────────

function inferLocationType(name: string): string | undefined {
  const n = name.toLowerCase();
  if (/farm \d/.test(n) || n === "farm") return "farm";
  if (n === "mill") return "mill";
  if (n === "forge") return "forge";
  if (n === "mine") return "mine";
  if (n === "forest") return "forest";
  if (n === "bakery") return "bakery";
  if (n === "tavern") return "tavern";
  if (n === "carpenter shop") return "carpenter";
  if (n === "healer's hut") return "healer";
  if (n === "seamstress cottage") return "seamstress";
  if (n === "town hall") return "townhall";
  if (n === "village square") return "square";
  if (n === "elder's house") return "elder";
  if (/cottage \d/.test(n) || n === "cottage") return "cottage";
  if (n === "prison") return "prison";
  if (n === "merchant camp") return "merchant";
  // For prefixed locations (multi-village): "Norddorf:Farm 1" → strip prefix, re-infer
  const colon = name.lastIndexOf(":");
  if (colon !== -1) return inferLocationType(name.slice(colon + 1).trim());
  return undefined;
}

// Default agent descriptions for Brunnfeld's hardcoded cast
const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  hans: "a farmer", ida: "a woman from the cottages", konrad: "a cattle farmer",
  ulrich: "a farmer", bertram: "a farmer", gerda: "the miller",
  anselm: "the baker", volker: "the blacksmith", wulf: "the carpenter",
  liesel: "the tavern keeper", sybille: "the village healer", friedrich: "a woodcutter",
  otto: "the village elder", pater_markus: "the village priest",
  dieter: "a miner", magda: "a villager", heinrich: "a farmer",
  elke: "the seamstress", rupert: "a miner",
  player: "a newcomer to the village",
};

// ─── Build default single-village config from hardcoded constants ────────

function buildDefaultConfig(): WorldConfig {
  const agents: AgentConfig[] = [...AGENT_NAMES, "player"].map(id => ({
    id,
    displayName: AGENT_DISPLAY_NAMES[id] ?? id,
    skill: AGENT_SKILLS[id] ?? "none",
    homeLocation: AGENT_HOMES[id] ?? "Village Square",
    workLocation: AGENT_WORK_LOCATIONS[id] ?? "Village Square",
    description: DEFAULT_DESCRIPTIONS[id] ?? "a villager",
  }));

  const locationTypes: Record<string, string> = {};
  for (const loc of LOCATIONS) {
    const t = inferLocationType(loc);
    if (t) locationTypes[loc] = t;
  }

  const village: VillageConfig = {
    id: "brunnfeld",
    name: "Brunnfeld",
    agents,
    locations: [...LOCATIONS],
    locationTypes,
    councilMembers: [...COUNCIL_MEMBERS],
    adjacency: { ...ADJACENCY },
    openingHours: { ...OPENING_HOURS },
    locationTiles: { ...LOCATION_TILES },
  };

  return { villages: [village], roads: [] };
}

// ─── Load (or build default) ──────────────────────────────────

function loadConfig(): WorldConfig {
  const path = join(process.cwd(), "data", "world_config.json");
  if (!existsSync(path)) return buildDefaultConfig();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as WorldConfig;
    // Ensure road adjacency is present in each village's adjacency map
    for (const road of raw.roads ?? []) {
      const [v1id, v2id] = road.connectsVillages;
      const v1 = raw.villages.find(v => v.id === v1id);
      const v2 = raw.villages.find(v => v.id === v2id);
      if (v1 && !v1.adjacency[road.name]) v1.adjacency[road.name] = [];
      if (v2 && !v2.adjacency[road.name]) v2.adjacency[road.name] = [];
    }
    return raw;
  } catch (e) {
    console.warn("[world-registry] Failed to parse world_config.json, using defaults:", e);
    return buildDefaultConfig();
  }
}

// Singleton — loaded once per process
let _config: WorldConfig | null = null;

function getConfig(): WorldConfig {
  if (!_config) _config = loadConfig();
  return _config;
}

/** Force reload from disk (used after generate-world runs). */
export function reloadConfig(): void {
  _config = null;
}

// ─── Lookup tables (built lazily from config) ────────────────

let _agentMap: Map<string, AgentConfig> | null = null;
let _agentVillage: Map<string, string> | null = null;
let _locationVillage: Map<string, string> | null = null;
let _villageMap: Map<string, VillageConfig> | null = null;

function buildMaps(): void {
  const cfg = getConfig();
  _agentMap = new Map();
  _agentVillage = new Map();
  _locationVillage = new Map();
  _villageMap = new Map();

  for (const village of cfg.villages) {
    _villageMap.set(village.id, village);
    for (const agent of village.agents) {
      _agentMap.set(agent.id, agent);
      _agentVillage.set(agent.id, village.id);
    }
    for (const loc of village.locations) {
      _locationVillage.set(loc, village.id);
    }
    // Roads in this village's adjacency but not in its location list need village mapping too
    for (const road of cfg.roads ?? []) {
      _locationVillage.set(road.name, road.connectsVillages[0]);
    }
  }
}

function ensureMaps(): void {
  if (!_agentMap) buildMaps();
}

// ─── Public API ───────────────────────────────────────────────

export function getAgentNames(): string[] {
  return getConfig().villages.flatMap(v => v.agents.map(a => a.id)).filter(id => id !== "player");
}

export function getVillageAgents(villageId: string): string[] {
  const v = getConfig().villages.find(v => v.id === villageId);
  return v ? v.agents.map(a => a.id).filter(id => id !== "player") : [];
}

export function getAgentVillage(agent: string): string {
  ensureMaps();
  return _agentVillage!.get(agent) ?? "brunnfeld";
}

export function getDisplayName(agent: string): string {
  ensureMaps();
  return _agentMap!.get(agent)?.displayName ?? AGENT_DISPLAY_NAMES[agent] ?? agent;
}

export function getSkill(agent: string): Skill {
  ensureMaps();
  const skill = _agentMap!.get(agent)?.skill;
  if (skill) return skill;
  return AGENT_SKILLS[agent] ?? "none";
}

export function getDescription(agent: string): string {
  ensureMaps();
  return _agentMap!.get(agent)?.description ?? DEFAULT_DESCRIPTIONS[agent] ?? "a villager";
}

export function getCouncilMembers(villageId: string): string[] {
  const v = getConfig().villages.find(v => v.id === villageId);
  return v?.councilMembers ?? [];
}

export function getVillageLocations(villageId: string): string[] {
  ensureMaps();
  const v = _villageMap!.get(villageId);
  if (!v) return [...LOCATIONS];
  // Include road locations connected to this village
  const cfg = getConfig();
  const roads = (cfg.roads ?? [])
    .filter(r => r.connectsVillages.includes(villageId))
    .map(r => r.name);
  return [...v.locations, ...roads];
}

export function getAllLocations(): string[] {
  const cfg = getConfig();
  const locs = cfg.villages.flatMap(v => v.locations);
  const roads = (cfg.roads ?? []).map(r => r.name);
  return [...locs, ...roads];
}

export function getVillageAdjacency(villageId: string): Record<string, string[]> {
  ensureMaps();
  return _villageMap!.get(villageId)?.adjacency ?? ADJACENCY;
}

export function getVillageOpeningHours(
  villageId: string,
): Partial<Record<string, { open: number; close: number }>> {
  ensureMaps();
  return _villageMap!.get(villageId)?.openingHours ?? OPENING_HOURS;
}

export function getLocationTiles(villageId: string): Record<string, { tx: number; ty: number }> {
  ensureMaps();
  return _villageMap!.get(villageId)?.locationTiles ?? LOCATION_TILES;
}

export function getLocationType(loc: string): string | undefined {
  const cfg = getConfig();
  for (const village of cfg.villages) {
    const t = village.locationTypes[loc];
    if (t) return t;
  }
  // Fallback: infer from name
  return inferLocationType(loc);
}

export function getVillageForLocation(loc: string): string | undefined {
  ensureMaps();
  return _locationVillage!.get(loc);
}

export function getVillages(): VillageConfig[] {
  return getConfig().villages;
}

export function getRoads(): RoadConfig[] {
  return getConfig().roads ?? [];
}

export function isRoadLocation(loc: string): boolean {
  return (getConfig().roads ?? []).some(r => r.name === loc);
}

export function isValidLocation(loc: string): boolean {
  ensureMaps();
  return _locationVillage!.has(loc) || isRoadLocation(loc);
}

/**
 * Resolves a potentially bare location name to the fully qualified name for the given agent.
 * e.g. a Norddorf agent typing "Forest" → "Norddorf:Forest"
 * If already valid (or unresolvable), returns the input unchanged.
 */
export function resolveAgentLocation(agent: string, loc: string, currentVillageId?: string): string {
  if (isValidLocation(loc)) return loc;

  // Strip hallucinated village-name prefix (e.g. "Brunnfeld:Village Square" → "Village Square")
  const cfg = getConfig();
  for (const v of cfg.villages) {
    if (v.name && loc.startsWith(`${v.name}:`)) {
      const stripped = loc.slice(v.name.length + 1);
      if (isValidLocation(stripped)) return stripped;
      const reprefixed = `${v.name}:${stripped}`;
      if (isValidLocation(reprefixed)) return reprefixed;
    }
  }

  const vid = currentVillageId ?? getAgentVillage(agent);
  const vName = cfg.villages.find(v => v.id === vid)?.name ?? "";
  if (!vName) return loc;
  const prefixed = `${vName}:${loc}`;
  return isValidLocation(prefixed) ? prefixed : loc;
}

/** Returns opening hours for any location, regardless of which village it belongs to. */
export function getLocationHours(loc: string): { open: number; close: number } | undefined {
  const cfg = getConfig();
  for (const village of cfg.villages) {
    if (village.openingHours[loc]) return village.openingHours[loc];
  }
  // Fallback for bare names (single-village mode)
  return OPENING_HOURS[loc];
}

export function isLocationOpenByRegistry(loc: string, hourIndex: number): boolean {
  const hours = getLocationHours(loc);
  if (!hours) return true;
  return hourIndex >= hours.open && hourIndex < hours.close;
}

export function getAgentHomeLocation(agent: string): string {
  ensureMaps();
  return _agentMap!.get(agent)?.homeLocation ?? AGENT_HOMES[agent] ?? "Village Square";
}

export function getAgentWorkLocation(agent: string): string {
  ensureMaps();
  return _agentMap!.get(agent)?.workLocation ?? AGENT_WORK_LOCATIONS[agent] ?? "Village Square";
}
