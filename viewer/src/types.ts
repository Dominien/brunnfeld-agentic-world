// Frontend-mirrored types (slim subset of backend types.ts)

// Widened to string to support dynamically generated multi-village worlds.
export type AgentName = string;

export interface VillageInfo {
  id: string;
  name: string;
  agentCount: number;
  locationTiles?: Record<string, { tx: number; ty: number }>;
  locationTypes?: Record<string, string>;
}

export type Season = "spring" | "summer" | "autumn" | "winter";
export type ItemType = string;
export type Skill = string;

export interface InventoryItem {
  type: ItemType;
  quantity: number;
  reserved?: number;
}

export interface BodyState {
  hunger: number;
  energy: number;
  sleep_quality: string;
  sickness?: number;
  injury?: number;
  starvation_ticks?: number;
}

export interface AgentEconomicState {
  wallet: number;
  inventory: { items: InventoryItem[] };
  tool: { type: string; durability: number } | null;
  skill: Skill;
  homeLocation: string;
  workLocation: string;
  hiredBy?: AgentName;
}

export interface Order {
  id: string;
  agentId: AgentName;
  type: "sell" | "buy";
  item: ItemType;
  quantity: number;
  price: number;
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

export interface ActiveEvent {
  type: string;
  description: string;
  startTick: number;
  endTick: number;
}

export interface Loan {
  id: string;
  creditor: AgentName;
  debtor: AgentName;
  amount: number;
  issuedTick: number;
  dueTick: number;
  description: string;
  repaid: boolean;
}

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
  acquaintances: Record<AgentName, AgentName[]>;
  economy_snapshots: EconomySnapshot[];
  loans?: Loan[];
  player_created: boolean;
  pending_player_actions: unknown[];
}

export interface EconomySnapshot {
  tick: number;
  day: number;
  season: Season;
  totalWealth: number;
  giniCoefficient: number;
  gdp: number;
  scarcityAlerts: ItemType[];
  wealthDistribution: { agent: AgentName; wallet: number; inventoryValue: number }[];
}

export interface FeedEntry {
  id: number;
  tick: number;
  agent: AgentName;
  type: "speak" | "do" | "move" | "trade" | "production" | "thought" | "system";
  text: string;
  location?: string;
}

export type SSEEvent =
  | { type: "init"; state: WorldState; activeMeeting?: Record<string, unknown> | null }
  | { type: "tick"; tick: number; time: string; season: Season; weather: string }
  | { type: "thinking"; agent: AgentName; name: string }
  | { type: "stream"; agent: AgentName; name: string; chunk: string }
  | { type: "action"; agent: AgentName; actionType: string; text?: string; result?: string; location: string }
  | { type: "trade"; buyer: AgentName; seller: AgentName; item: ItemType; quantity: number; pricePerUnit: number; total: number; tick?: number }
  | { type: "production"; agent: AgentName; item: ItemType; qty: number }
  | { type: "economy"; snapshot: EconomySnapshot }
  | { type: "event"; eventType: string; description: string; active_events?: ActiveEvent[]; agent_locations?: Record<string, string> }
  | { type: "event_expired"; eventType: string }
  | { type: "order"; event: "posted" | "cancelled" | "expired"; orderId: string; agentId: AgentName; orderType?: "sell" | "buy"; item?: ItemType; quantity?: number; price?: number }
  | { type: "player:created"; agent: "player"; name: string; location: string; wallet: number; skill: string }
  | { type: "player:update"; agent: "player"; result: string; wallet: number; location: string; feedback?: string }
  | { type: "player:revived"; agent: "player"; newWallet: number }
  | { type: "meeting:start"; agendaType: string; description: string; attendees: AgentName[]; attendeeCount: number }
  | { type: "meeting:phase"; phase: "discussion" | "vote"; round?: number; proposal?: string }
  | { type: "meeting:vote"; agent: AgentName; side: "agree" | "disagree" }
  | { type: "meeting:result"; passed: boolean; agreeCount: number; law?: unknown }
  | { type: "meeting:end" }
  | { type: "meeting:quorum_fail"; description: string; attendeeCount: number }
  | { type: "harness:tool"; agent: AgentName; name: string; tool: string; summary: string };
