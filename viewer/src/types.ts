// Frontend-mirrored types (slim subset of backend types.ts)

export type AgentName =
  | "hans" | "ida" | "konrad" | "ulrich" | "bertram"
  | "gerda" | "anselm" | "volker" | "wulf"
  | "liesel" | "sybille" | "friedrich"
  | "otto" | "pater_markus"
  | "dieter" | "magda" | "bertha" | "heinrich" | "elke" | "rupert";

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
  | { type: "init"; state: WorldState }
  | { type: "tick"; tick: number; time: string; season: Season; weather: string }
  | { type: "thinking"; agent: AgentName; name: string }
  | { type: "stream"; agent: AgentName; name: string; chunk: string }
  | { type: "action"; agent: AgentName; actionType: string; text?: string; result?: string; location: string }
  | { type: "trade"; buyer: AgentName; seller: AgentName; item: ItemType; quantity: number; pricePerUnit: number; total: number; tick?: number }
  | { type: "production"; agent: AgentName; item: ItemType; qty: number }
  | { type: "economy"; snapshot: EconomySnapshot }
  | { type: "event"; eventType: string; description: string }
  | { type: "order"; event: "posted" | "cancelled" | "expired"; orderId: string; agentId: AgentName; orderType?: "sell" | "buy"; item?: ItemType; quantity?: number; price?: number };
