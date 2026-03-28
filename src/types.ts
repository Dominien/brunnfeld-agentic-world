// ─── Agents ────────────────────────────────────────────────

// Widened to string to support dynamically generated multi-village worlds.
// The hardcoded constants below (AGENT_NAMES, AGENT_SKILLS, etc.) remain as
// defaults for the 1-village Brunnfeld world.
export type AgentName = string;

export const AGENT_NAMES: AgentName[] = [
  "hans", "ida", "konrad", "ulrich", "bertram",
  "gerda", "anselm", "volker", "wulf",
  "liesel", "sybille", "friedrich",
  "otto", "pater_markus",
  "dieter", "magda", "heinrich", "elke", "rupert",
];

export const COUNCIL_MEMBERS: AgentName[] = ["otto", "gerda", "volker", "anselm", "hans"];

export const AGENT_DISPLAY_NAMES: Record<AgentName, string> = {
  hans: "Hans", ida: "Ida", konrad: "Konrad", ulrich: "Ulrich", bertram: "Bertram",
  gerda: "Gerda", anselm: "Anselm", volker: "Volker", wulf: "Wulf",
  liesel: "Liesel", sybille: "Sybille", friedrich: "Friedrich",
  otto: "Otto", pater_markus: "Pater Markus",
  dieter: "Dieter", magda: "Magda", heinrich: "Heinrich",
  elke: "Elke", rupert: "Rupert",
  player: "You",
};

export const AGENT_HOMES: Record<AgentName, string> = {
  hans: "Cottage 1", ida: "Cottage 2", konrad: "Farm 2",
  ulrich: "Cottage 4", bertram: "Cottage 5", gerda: "Mill",
  anselm: "Bakery", volker: "Forge", wulf: "Carpenter Shop",
  liesel: "Tavern", sybille: "Healer's Hut", friedrich: "Cottage 7",
  otto: "Elder's House", pater_markus: "Town Hall",
  dieter: "Cottage 8", magda: "Cottage 8", heinrich: "Cottage 1", elke: "Seamstress Cottage", rupert: "Cottage 3",
  player: "Village Square",
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
  dieter: "miner", magda: "none", heinrich: "farmer",
  elke: "seamstress", rupert: "miner",
  player: "none",
};

export const AGENT_WORK_LOCATIONS: Record<AgentName, string> = {
  hans: "Farm 1", ida: "Cottage 2", konrad: "Farm 2", ulrich: "Farm 3",
  bertram: "Farm 1", gerda: "Mill", anselm: "Bakery", volker: "Forge",
  wulf: "Carpenter Shop", liesel: "Tavern", sybille: "Healer's Hut", friedrich: "Forest",
  otto: "Elder's House", pater_markus: "Town Hall",
  dieter: "Mine", magda: "Village Square", heinrich: "Farm 1",
  elke: "Seamstress Cottage", rupert: "Mine",
  player: "Village Square",
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
  villageId?: string;  // undefined = "brunnfeld" (backward compat)
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

// ─── Theft Records ─────────────────────────────────────────

export interface StealRecord {
  from: AgentName;
  item: string;
}

// ─── Governance ────────────────────────────────────────────

export interface PendingMeeting {
  scheduledTick: number;
  agendaType: "tax_change" | "marketplace_hours" | "banishment" | "general_rule";
  description: string;
  target?: AgentName;
  calledAtTick: number;
}

export interface Law {
  id: string;
  type: "tax_change" | "marketplace_hours" | "banishment" | "general_rule";
  description: string;
  passedTick: number;
  value?: number;
  target?: AgentName;
}

// ─── Action Types ──────────────────────────────────────────

export type AgentActionType =
  | "speak" | "think" | "wait" | "move_to" | "petition_meeting"
  | "knock_door" | "lock_door" | "unlock_door"
  | "send_message" | "leave_note" | "read"
  | "produce" | "eat"
  | "post_order" | "buy_item" | "cancel_order"
  | "hire" | "lend_coin" | "give_coin" | "steal" | "call_meeting" | "propose_rule" | "vote";

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
  side?: "sell" | "buy" | "agree" | "disagree";
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
  // governance
  agenda_type?: "tax_change" | "marketplace_hours" | "banishment" | "general_rule";
  value?: number;
}

export interface ResolvedAction extends AgentAction {
  result: string;
  visible: boolean;
}

export interface AgentTurnResult {
  agent: AgentName;
  actions: ResolvedAction[];
  pendingMove?: string;
  historyLines?: string[];
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

  // Theft records (persists forever)
  caughtStealing: Partial<Record<AgentName, StealRecord[]>>;

  // Governance
  pending_meeting?: PendingMeeting;
  pending_petitions?: { agent: AgentName; topic: string; tick: number }[];
  active_laws: Law[];
  banned: Partial<Record<AgentName, number>>;
  tax_rate: number;

  // Player character
  player_created: boolean;
  pending_player_actions: AgentAction[];

  // Multi-village: per-village marketplaces (absent = single-village mode using `marketplace`)
  marketplaces?: Record<string, Marketplace>;
}

// ─── Tick Log ──────────────────────────────────────────────

export interface TickLogEntry {
  agent: AgentName;
  actions: { type: string; text?: string; result?: string }[];
}

export interface MeetingLog {
  description: string;
  agendaType: string;
  attendees: AgentName[];
  discussion: { agent: AgentName; text: string }[];
  proposal: string;
  votes: { agree: AgentName[]; disagree: AgentName[] };
  passed: boolean;
  agreeCount: number;
  requiredCount: number;
  law?: string;
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
  meeting?: MeetingLog;
}
