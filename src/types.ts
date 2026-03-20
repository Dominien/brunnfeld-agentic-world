// ─── Agents ────────────────────────────────────────────────

export type AgentName =
  | "hans" | "ida" | "konrad" | "ulrich" | "bertram"
  | "gerda" | "anselm" | "volker" | "wulf"
  | "liesel" | "sybille" | "friedrich"
  | "otto" | "pater_markus"
  | "dieter" | "magda" | "bertha" | "heinrich" | "elke" | "rupert";

export const AGENT_NAMES: AgentName[] = [
  "hans", "ida", "konrad", "ulrich", "bertram",
  "gerda", "anselm", "volker", "wulf",
  "liesel", "sybille", "friedrich",
  "otto", "pater_markus",
  "dieter", "magda", "bertha", "heinrich", "elke", "rupert",
];

export const AGENT_DISPLAY_NAMES: Record<AgentName, string> = {
  hans: "Hans", ida: "Ida", konrad: "Konrad", ulrich: "Ulrich", bertram: "Bertram",
  gerda: "Gerda", anselm: "Anselm", volker: "Volker", wulf: "Wulf",
  liesel: "Liesel", sybille: "Sybille", friedrich: "Friedrich",
  otto: "Otto", pater_markus: "Pater Markus",
  dieter: "Dieter", magda: "Magda", bertha: "Bertha", heinrich: "Heinrich",
  elke: "Elke", rupert: "Rupert",
};

export const AGENT_HOMES: Record<AgentName, string> = {
  hans: "Cottage 1", ida: "Cottage 2", konrad: "Farm 2",
  ulrich: "Cottage 4", bertram: "Cottage 5", gerda: "Mill",
  anselm: "Bakery", volker: "Forge", wulf: "Carpenter Shop",
  liesel: "Tavern", sybille: "Healer's Hut", friedrich: "Cottage 7",
  otto: "Elder's House", pater_markus: "Church",
  dieter: "Cottage 8", magda: "Cottage 8", bertha: "Cottage 9",
  heinrich: "Cottage 1", elke: "Seamstress Cottage", rupert: "Cottage 3",
};

// ─── Skills ────────────────────────────────────────────────

export type Skill =
  | "farmer" | "cattle" | "miner" | "woodcutter"
  | "miller" | "baker" | "blacksmith" | "carpenter"
  | "tavern" | "healer" | "merchant" | "seamstress"
  | "none";

export const AGENT_SKILLS: Record<AgentName, Skill> = {
  hans: "farmer", ida: "none", konrad: "cattle", ulrich: "farmer",
  bertram: "farmer", gerda: "miller", anselm: "baker", volker: "blacksmith",
  wulf: "carpenter", liesel: "tavern", sybille: "healer", friedrich: "woodcutter",
  otto: "none", pater_markus: "none",
  dieter: "miner", magda: "none", bertha: "none", heinrich: "farmer",
  elke: "seamstress", rupert: "miner",
};

export const AGENT_WORK_LOCATIONS: Record<AgentName, string> = {
  hans: "Farm 1", ida: "Cottage 2", konrad: "Farm 2", ulrich: "Farm 3",
  bertram: "Farm 1", gerda: "Mill", anselm: "Bakery", volker: "Forge",
  wulf: "Carpenter Shop", liesel: "Tavern", sybille: "Healer's Hut", friedrich: "Forest",
  otto: "Elder's House", pater_markus: "Church",
  dieter: "Mine", magda: "Village Square", bertha: "Village Square", heinrich: "Farm 1",
  elke: "Seamstress Cottage", rupert: "Mine",
};

// ─── Seasons ───────────────────────────────────────────────

export type Season = "spring" | "summer" | "autumn" | "winter";

// ─── Items ─────────────────────────────────────────────────

export type ItemType =
  | "wheat" | "flour" | "bread" | "meat" | "milk" | "eggs" | "vegetables"
  | "herbs" | "medicine" | "iron_ore" | "coal" | "iron_tools"
  | "timber" | "firewood" | "furniture" | "ale" | "meal" | "cloth";

export const ALL_ITEMS: ItemType[] = [
  "wheat", "flour", "bread", "meat", "milk", "eggs", "vegetables",
  "herbs", "medicine", "iron_ore", "coal", "iron_tools",
  "timber", "firewood", "furniture", "ale", "meal", "cloth",
];

export interface InventoryItem {
  type: ItemType;
  quantity: number;
  reserved?: number;        // locked in sell orders; not available for use/eat
  spoilsAtTick?: number;    // milk (2 days = 32 ticks), meat (3 days = 48 ticks)
}

export interface Inventory {
  items: InventoryItem[];
}

// ─── Tools ─────────────────────────────────────────────────

export interface ToolState {
  type: "iron_tools";
  durability: number;       // 0–100
}

// ─── Body ──────────────────────────────────────────────────

export interface BodyState {
  hunger: number;           // 0 (full) → 5 (starving). 5 for 3+ ticks → death
  energy: number;           // 0–10
  sleep_quality: "good" | "fair" | "poor";
  sickness?: number;        // 0 = healthy, 1–3 = sick (reduces productivity)
  injury?: number;          // 0 = fine, 1–3 = injured (mine accident, etc.)
  starvation_ticks?: number; // consecutive ticks at hunger === 5
}

// ─── Economic State (per agent) ────────────────────────────

export interface AgentEconomicState {
  wallet: number;
  inventory: Inventory;
  tool: ToolState | null;
  skill: Skill;
  homeLocation: string;
  workLocation: string;
  workSchedule: { open: number; close: number };
  hiredBy?: AgentName;
  hiredUntilTick?: number;
}

// ─── Marketplace ───────────────────────────────────────────

export interface Order {
  id: string;
  agentId: AgentName;
  type: "sell" | "buy";
  item: ItemType;
  quantity: number;
  price: number;            // coins per unit
  postedTick: number;
  expiresAtTick: number;
}

export interface Trade {
  id: string;
  tick: number;
  buyer: AgentName;
  seller: AgentName;
  item: ItemType;
  quantity: number;
  pricePerUnit: number;
  total: number;
}

export interface Marketplace {
  orders: Order[];
  history: Trade[];
  priceIndex: Record<ItemType, number>;
  priceHistory: Record<ItemType, { tick: number; price: number }[]>;
}

// ─── Economy Snapshot ──────────────────────────────────────

export interface EconomySnapshot {
  tick: number;
  day: number;
  season: Season;
  totalWealth: number;
  giniCoefficient: number;
  gdp: number;
  priceIndex: Record<ItemType, number>;
  scarcityAlerts: ItemType[];
  wealthDistribution: { agent: AgentName; wallet: number; inventoryValue: number }[];
}

// ─── World Events ──────────────────────────────────────────

export type EventType = "drought" | "plague" | "caravan" | "bandit_threat" | "mine_collapse" | "tax_day" | "double_harvest" | "plague_rumor";

export interface ActiveEvent {
  type: EventType;
  description: string;
  startTick: number;
  endTick: number;
  affectedAgents?: AgentName[];
}

// ─── World Objects ─────────────────────────────────────────

export interface WorldObject {
  id: string;
  type: "notice" | "letter" | "note";
  label: string;
  location: string;
  content: string;
  placed_day: number;
  discovered_by: string[];
  read_by: string[];
  visibility: "private" | "shared";
  duration_days?: number;
  recipient?: AgentName;
}

// ─── Messages ──────────────────────────────────────────────

export interface QueuedMessage {
  from: AgentName;
  type: "message" | "note";
  text?: string;
  sent_tick: number;
}

// ─── Loans ─────────────────────────────────────────────────

export interface Loan {
  id: string;
  creditor: AgentName;
  debtor: AgentName;
  amount: number;
  issuedTick: number;
  dueTick: number;          // issuedTick + 112 (7 in-game days)
  description: string;
  repaid: boolean;
}

// ─── Action Types ──────────────────────────────────────────

export type AgentActionType =
  | "speak" | "think" | "do" | "wait" | "move_to"
  | "knock_door" | "lock_door" | "unlock_door"
  | "send_message" | "leave_note" | "read"
  | "produce" | "eat"
  | "post_order" | "buy_item" | "cancel_order"
  | "hire" | "lend_coin" | "give_coin";

export interface AgentAction {
  type: AgentActionType;
  text?: string;
  location?: string;
  target?: string;
  object_id?: string;
  to?: string;
  // produce
  item?: ItemType | string;
  // post_order
  side?: "sell" | "buy";
  quantity?: number;
  price?: number;
  // buy_item
  max_price?: number;
  // cancel_order
  order_id?: string;
  // eat
  // hire
  wage?: number;
  task?: string;
  // lend_coin / give_coin
  amount?: number;
  description?: string;
}

export interface ResolvedAction extends AgentAction {
  result: string;
  visible: boolean;
}

export interface AgentTurnResult {
  agent: AgentName;
  actions: ResolvedAction[];
  pendingMove?: string;
}

// ─── Time ──────────────────────────────────────────────────

export interface SimTime {
  tick: number;
  hour: number;             // 6–21
  dayOfWeek: string;
  dayNumber: number;        // absolute day count from start
  weekNumber: number;
  seasonDay: number;        // 1–7 (day within current season)
  season: Season;
  yearNumber: number;
  isFirstTickOfDay: boolean;
  timeLabel: string;
}

// ─── World State ───────────────────────────────────────────

export interface WorldState {
  current_tick: number;
  current_time: string;
  season: Season;
  day_of_season: number;
  weather: string;
  active_events: ActiveEvent[];

  agent_locations: Record<AgentName, string>;
  body: Record<AgentName, BodyState>;
  economics: Record<AgentName, AgentEconomicState>;

  marketplace: Marketplace;
  doors: Record<string, "locked" | "unlocked">;
  message_queue: Record<AgentName, QueuedMessage[]>;
  objects: WorldObject[];
  action_feedback: Record<AgentName, string[]>;
  acquaintances: Record<AgentName, AgentName[]>;

  economy_snapshots: EconomySnapshot[];
  total_tax_collected: number;

  // Production tracking for economy snapshots
  production_log: { tick: number; agent: AgentName; item: ItemType; qty: number }[];

  // Loan records
  loans: Loan[];
}

// ─── Tick Log ──────────────────────────────────────────────

export interface TickLogEntry {
  agent: AgentName;
  actions: { type: string; text?: string; result?: string }[];
}

export interface TickLog {
  tick: number;
  simulated_time: string;
  season: Season;
  weather: string;
  locations: Record<string, { agents: string[]; rounds: unknown[] }>;
  movements: { agent: AgentName; from: string; to: string }[];
  trades: Trade[];
  productions: { agent: AgentName; item: ItemType; qty: number }[];
}
