# Brunnfeld — Implementation Plan

**Medieval village economy simulation built on the Hauswelt social engine.**

---

## What we're keeping from Hauswelt (verbatim or near-verbatim)

| File | Status | Notes |
|------|--------|-------|
| `llm.ts` | **Copy as-is** | `callClaudeJSON`, model env var, stats |
| `memory.ts` | **Copy + extend** | Same markdown format. Add inventory/wallet entries. Add compression rules for trade events |
| `body.ts` | **Extend** | hunger/energy logic stays. Add: sickness state, injury state. Tie hunger to actual food inventory |
| `sounds.ts` | **Rewrite** | Same pattern, new adjacency map (Forge → Square → Residential Lane, etc.) |
| `messages.ts` | **Copy as-is** | send_message, phone_call → will use "send_message" / "leave_note" only |
| `doors.ts` | **Copy as-is** | lock/knock still relevant for homes and workshops |
| `away.ts` | **Rewrite** | Work schedules redesigned for medieval jobs. Same isAway() interface |
| `time.ts` | **Extend** | tick → simulated time stays. Add: season calc, day of season, year progress |
| `interview.ts` | **Copy as-is** | Talk to agent mid-sim |
| `agent-runner.ts` | **Extend** | Same buildPrompt() structure. Inject inventory/wallet/marketplace board |
| `tools.ts` | **Extend** | Keep existing resolveAction() pattern. Add new action cases |
| `engine.ts` | **Rewrite** | Same tick loop skeleton. Add economic resolution phase after social resolution |
| `server.ts` | **Extend** | Add /api/economy, /api/marketplace, /api/trades, /api/prices. Add SSE /stream |
| `environment-agent.ts` | **Rewrite** | Replace weather-only with season effects, events, scheduled events |
| `index.ts` | **Rewrite** | New CLI for Brunnfeld |

---

## New files to write

| File | What it does |
|------|-------------|
| `marketplace.ts` | Order book data structure, add/remove orders, price index rolling average |
| `production.ts` | Recipe validation (has inputs? at right location? has skill?), output application |
| `inventory.ts` | Per-agent inventory read/write, spoilage check (milk/meat), value calc |
| `tools-degradation.ts` | Tool durability tracking, degrade-per-use, break detection |
| `economy-tracker.ts` | GDP, Gini, supply/demand indexes, scarcity alerts, wealth distribution |
| `trade-scanner.ts` | Detect barter in conversation text. Same keyword-scan approach as door/mailbox resolvers |
| `marketplace-resolver.ts` | Match buy orders to sell orders. Execute trades, update wallets + inventories |
| `hiring.ts` | Resolve hire action, wage deduction, production bonus, laborer schedule override |
| `taxes.ts` | Weekly tax collection by Otto (elder). 10% of each wallet. Resistance mechanic |
| `seasons.ts` | Season state, production multipliers per season, weather effects |
| `events.ts` | Drought, plague, caravan, bandit threat, mine collapse. Triggered by conditions or random |
| `village-map.ts` | Location definitions, adjacency, travel times, opening hours |
| `types.ts` | Fully rewritten. All Brunnfeld types |

---

## Village Map

```typescript
// village-map.ts

export const LOCATIONS = [
  // Central hub
  'Village Square',
  // Workshops
  'Bakery', 'Tavern', 'Forge', 'Carpenter Shop', 'Mill',
  // Civic
  'Church', "Elder's House",
  // Residential
  'Cottage 1', 'Cottage 2', 'Cottage 3', 'Cottage 4', 'Cottage 5',
  'Cottage 6', 'Cottage 7', 'Cottage 8', 'Cottage 9',
  'Seamstress Cottage',    // Elke — seamstress home + workshop
  "Healer's Hut",          // Sybille
  // Production (outskirts — require travel)
  'Farm 1', 'Farm 2', 'Farm 3',
  'Forest', 'Mine',
] as const

export type Location = (typeof LOCATIONS)[number]

// Adjacency determines: (a) what locations you can hear sounds from, (b) valid move_to targets.
// Travel to non-adjacent location costs 2 ticks (routed through Village Square).
export const ADJACENCY: Record<Location, Location[]> = {
  'Village Square':     ['Bakery', 'Tavern', 'Church', 'Mill', 'Forge', 'Carpenter Shop', "Elder's House", 'Cottage 1', 'Farm 1'],
  'Bakery':             ['Village Square', 'Mill'],
  'Tavern':             ['Village Square', "Elder's House"],
  'Church':             ['Village Square', "Elder's House"],
  "Elder's House":      ['Church', 'Tavern', 'Village Square'],
  'Mill':               ['Village Square', 'Bakery', 'Farm 1'],
  'Forge':              ['Village Square', 'Carpenter Shop'],
  'Carpenter Shop':     ['Village Square', 'Forge'],
  'Cottage 1':          ['Village Square', 'Cottage 2'],
  'Cottage 2':          ['Cottage 1', 'Cottage 3'],
  'Cottage 3':          ['Cottage 2', 'Cottage 4'],
  'Cottage 4':          ['Cottage 3', 'Cottage 5'],
  'Cottage 5':          ['Cottage 4', 'Cottage 6'],
  'Cottage 6':          ['Cottage 5', 'Cottage 7'],
  'Cottage 7':          ['Cottage 6', 'Cottage 8', "Healer's Hut"],
  'Cottage 8':          ['Cottage 7', 'Cottage 9'],
  'Cottage 9':          ['Cottage 8', 'Seamstress Cottage'],
  'Seamstress Cottage': ['Cottage 9'],
  "Healer's Hut":       ['Cottage 7'],
  'Farm 1':             ['Village Square', 'Mill', 'Farm 2'],
  'Farm 2':             ['Farm 1', 'Farm 3'],
  'Farm 3':             ['Farm 2', 'Forest'],
  'Forest':             ['Farm 3', 'Mine'],
  'Mine':               ['Forest'],
}

// Opening hours (locations closed outside these ticks-of-day; agents are ejected at close)
// Tick 0 = 06:00, tick 15 = 21:00 (16 ticks per day, ~1 hr each)
export const OPENING_HOURS: Partial<Record<Location, { open: number; close: number }>> = {
  'Tavern':         { open: 4, close: 15 },   // 10:00 – 21:00
  'Bakery':         { open: 0, close: 8 },    // 06:00 – 14:00
  'Forge':          { open: 1, close: 10 },   // 07:00 – 16:00
  'Carpenter Shop': { open: 1, close: 10 },
  'Mill':           { open: 1, close: 10 },
  'Church':         { open: 0, close: 2 },    // 06:00 – 08:00 (morning service), also 12–13
  "Healer's Hut":   { open: 1, close: 11 },
  // Farms, Forest, Mine: no closing hours — daylight only enforced by away.ts schedules
}
```

---

## Types Architecture

```typescript
// ─── Agents ───────────────────────────────────────────────

export type AgentName =
  | "hans" | "ida" | "konrad" | "ulrich" | "bertram"
  | "gerda" | "anselm" | "volker" | "wulf"
  | "liesel" | "sybille" | "friedrich"
  | "otto" | "pater_markus"
  | "dieter" | "magda" | "bertha" | "heinrich" | "elke" | "rupert"

export type Skill =
  | "farmer" | "cattle" | "miner" | "woodcutter"
  | "miller" | "baker" | "blacksmith" | "carpenter"
  | "tavern" | "healer" | "merchant" | "seamstress"
  | "none"

// ─── Inventory ────────────────────────────────────────────

export type ItemType =
  | "wheat" | "flour" | "bread" | "meat" | "milk" | "eggs" | "vegetables"
  | "herbs" | "medicine" | "iron_ore" | "coal" | "iron_tools"
  | "timber" | "firewood" | "furniture" | "ale" | "meal" | "cloth"

export interface InventoryItem {
  type: ItemType
  quantity: number
  reserved?: number       // quantity locked in sell orders (escrow); not available for use
  spoilsAtTick?: number   // for milk (2 days), meat (3 days)
}

export interface Inventory {
  items: InventoryItem[]
}

// ─── Tools ───────────────────────────────────────────────

export interface ToolState {
  type: "iron_tools"
  durability: number        // 0–100
}

// ─── Body ────────────────────────────────────────────────

export interface BodyState {
  hunger: number            // 0 (full) → 5 (starving). If >= 5 for 3+ ticks → death
  energy: number            // 0–10
  sleep_quality: "good" | "fair" | "poor"
  sickness?: number         // 0 = healthy, 1–3 = sick (reduces productivity)
  injury?: number           // 0 = fine, 1–3 = injured (from mine, etc.)
}

// ─── Economic State (per agent) ──────────────────────────

export interface AgentEconomicState {
  wallet: number            // coins
  inventory: Inventory
  tool: ToolState | null
  skill: Skill
  homeLocation: string
  workLocation: string
  workSchedule: { open: number; close: number }
  hiredBy?: string          // agent name if currently hired
  hiredUntilTick?: number
}

// ─── Marketplace ─────────────────────────────────────────

export interface Order {
  id: string
  agentId: AgentName
  type: "sell" | "buy"
  item: ItemType
  quantity: number
  price: number
  postedTick: number
  expiresAtTick: number
}

export interface Trade {
  id: string
  tick: number
  buyer: AgentName
  seller: AgentName
  item: ItemType
  quantity: number
  pricePerUnit: number
  total: number
}

export interface Marketplace {
  orders: Order[]
  history: Trade[]           // last 100 trades
  priceIndex: Record<ItemType, number>   // rolling avg of last 10 trades
  priceHistory: Record<ItemType, { tick: number; price: number }[]>
}

// ─── World State ─────────────────────────────────────────

export interface WorldState {
  current_tick: number
  current_time: string
  season: "spring" | "summer" | "autumn" | "winter"
  day_of_season: number       // 1–7
  weather: string
  active_events: ActiveEvent[]

  agent_locations: Record<AgentName, string>
  body: Record<AgentName, BodyState>
  economics: Record<AgentName, AgentEconomicState>

  marketplace: Marketplace
  doors: Record<string, "locked" | "unlocked">
  message_queue: Record<AgentName, QueuedMessage[]>
  objects: WorldObject[]
  action_feedback: Record<AgentName, string[]>
  acquaintances: Record<AgentName, string[]>

  // Economy tracking
  economy_snapshots: EconomySnapshot[]   // last 28 snapshots (1 per day)
  total_tax_collected: number
}
```

---

## Engine Tick Structure

```typescript
// engine.ts — runTick()

async function runTick(tick: number): Promise<void> {
  const state = readWorldState()
  const time = tickToTime(tick)

  // ── 1. DAWN PHASE (first tick of day only) ──────────────────
  if (time.hour === 6) {
    applySeason(state, time)          // seasons.ts: production multipliers
    degradeTools(state)               // tools-degradation.ts: all tools -3 if used yesterday
    applyOvernightProduction(state)   // fields, ovens: run once at dawn
    if (time.dayOfWeek === "Monday") {
      collectTaxes(state, time)       // taxes.ts
    }
    cleanExpiredObjects(state, time.dayNumber)
    placeScheduledObjects(time.dayNumber, state)
    checkEvents(state, time)          // events.ts: trigger random/condition events
  }

  // ── 2. PERCEPTION PHASE ─────────────────────────────────────
  // Build per-agent perceptions (parallel, no state mutation)
  const perceptions: Record<AgentName, string> = {}
  for (const agent of AGENT_NAMES) {
    perceptions[agent] = buildPerception(agent, state, time)
    // buildPerception() now includes:
    //   - Location + time
    //   - Other agents present
    //   - Visible shared objects
    //   - Sounds from adjacent locations
    //   - Body state (hunger, energy, sickness)
    //   - Inventory + wallet
    //   - Tool condition
    //   - Marketplace board (orders for items the agent cares about)
    //   - Pending messages/notes
    //   - Active events affecting them
    //   - action_feedback from last tick (what failed, what succeeded)
  }

  // ── 3. DECISION PHASE ───────────────────────────────────────
  // Batch LLM calls, 5 at a time (same as Hauswelt batching)
  // Multi-agent conversation groups: same sequential round logic as Hauswelt.
  // Cap: max 4 conversation rounds per group regardless of group size.
  // Village Square can have 5+ agents — without a cap the sequential rounds stall the tick.
  // Groups >4 agents: first 4 do conversation rounds, rest do solo perception calls.
  const results = await runBatchedAgents(AGENT_NAMES, perceptions, state, time)

  // ── 4. SOCIAL RESOLUTION ────────────────────────────────────
  // Movement, conversations, acquaintances, sounds
  // (Same as Hauswelt — just updated for new locations/agents)
  resolveSocial(results, state, time)

  // ── 5. ECONOMIC RESOLUTION ──────────────────────────────────
  resolveProduction(results, state, time)    // production.ts
  resolveMarketplace(results, state, time)   // marketplace-resolver.ts
  resolveBarter(results, state, time)        // trade-scanner.ts
  resolveHiring(results, state, time)        // hiring.ts
  checkSpoilage(state, time)                 // inventory.ts
  checkStarvation(state, time)               // body.ts
  checkToolBreakage(state)                   // tools-degradation.ts

  // ── 6. MEMORY + PERSISTENCE ─────────────────────────────────
  updateMemories(results, state, time)
  takeEconomySnapshot(state, time)           // economy-tracker.ts
  writeWorldState(state)
  writeTickLog(tick, buildTickLog(results, state, time))

  // ── 7. SSE EMIT ─────────────────────────────────────────────
  emitEvents(results, state, time)           // server.ts stagger buffer
}
```

---

## Perception Builder Changes

The key change from Hauswelt: perception now injects economic context.

```typescript
function buildPerception(agent: AgentName, state: WorldState, time: SimTime): string {
  const eco = state.economics[agent]
  const body = state.body[agent]
  const location = state.agent_locations[agent]

  // --- existing Hauswelt perception logic ---
  // ... other agents, sounds, objects, messages ...

  // --- NEW: economic context ---
  const inventoryLines = eco.inventory.items
    .map(i => `${i.type} ×${i.quantity}${i.spoilsAtTick ? ' [spoils soon]' : ''}`)
    .join(', ') || 'empty'

  const toolLine = eco.tool
    ? `Iron tools (${eco.tool.durability}/100)`
    : '(no tools — production halved)'

  const marketboardLines = getRelevantOrders(agent, state)
    .map(o => o.type === 'sell'
      ? `  Selling: ${o.item} ×${o.quantity} at ${o.price}c (${o.agentId})`
      : `  Wanted: ${o.item} ×${o.quantity} at up to ${o.price}c (${o.agentId})`
    ).join('\n')

  const actionFeedback = (state.action_feedback[agent] || []).join('\n')

  return `
${basePerception}

Inventory: ${inventoryLines}
Wallet: ${eco.wallet} coin
Tools: ${toolLine}

Marketplace board:
${marketboardLines || '  (no current orders)'}

${actionFeedback ? `Last tick feedback:\n${actionFeedback}` : ''}
`.trim()
}
```

---

## Action Schema Extension

```
Available actions:
- think / speak / do / wait / move_to
- knock_door / lock_door / unlock_door
- send_message / leave_note
- produce { item: "bread" }
  → Craft/gather item. You must be at the right location and have the inputs.
- eat { item: "bread", quantity: 1 }
  → Consume food from your inventory. Reduces hunger. You must have the item.
- post_order { side: "sell"|"buy", item: "bread", quantity: 2, price: 3 }
  → Post to marketplace board. Buyer doesn't need to be present. Expires in 1 day.
- buy_item { item: "flour", max_price: 6 }
  → Buy cheapest available sell order ≤ max_price. You must be at Village Square.
- cancel_order { order_id: "xxx" }
  → Remove your own order from the board.
- hire { target: "Dieter", wage: 5, task: "help carry ore at the mine" }
  → Hire a laborer for the day. Wage paid at end of day.
```

---

## Trade Scanner (barter resolution)

Same pattern as Hauswelt's eviction-keyword scanning. Runs over conversation actions:

```typescript
// trade-scanner.ts

interface BarterDetection {
  offerer: AgentName
  receiver: AgentName
  offerItems: { item: ItemType; quantity: number }[]
  requestItems: { item: ItemType; quantity: number }[]
}

// Keywords: "trade", "barter", "deal", "exchange", "give you X for Y", "swap"
// Agreement keywords: "deal", "agreed", "fine", "ok", "yes"

function scanForBarter(
  actions: Record<AgentName, ResolvedAction[]>,
  state: WorldState
): BarterDetection[] {
  // 1. Look for offer speech patterns
  // 2. Look for acceptance in same-tick response
  // 3. Validate both agents have the items
  // 4. Execute swap
}
```

---

## Marketplace Resolver

```typescript
// marketplace-resolver.ts

export function resolveMarketplace(
  results: AgentTurnResult[],
  state: WorldState,
  time: SimTime
): void {
  for (const result of results) {
    for (const action of result.actions) {

      // Post order
      if (action.type === 'post_order') {
        const valid = validatePostOrder(action, result.agent, state)
        if (!valid.ok) {
          feedbackToAgent(result.agent, state, `[Can't do that] ${valid.reason}`)
          continue
        }
        addOrder(state.marketplace, {
          id: generateId(),
          agentId: result.agent,
          type: action.side,
          item: action.item,
          quantity: action.quantity,
          price: action.price,
          postedTick: time.tick,
          expiresAtTick: time.tick + 16   // 1 simulated day
        })
        // Hold items in escrow for sell orders (reserve from inventory)
        // reserveInventory: sets item.reserved += qty on the matching InventoryItem.
        // Reserved items count against getInventoryQty() for production/eat checks,
        // but are not removed until executeTrade(). On order cancel/expire, unreserve.
        if (action.side === 'sell') reserveInventory(result.agent, action.item, action.quantity, state)
      }

      // Buy item
      if (action.type === 'buy_item') {
        const agentLocation = state.agent_locations[result.agent]
        if (agentLocation !== 'Village Square' && agentLocation !== 'Marketplace') {
          feedbackToAgent(result.agent, state, '[Can\'t do that] You must be at the Village Square to buy from the marketplace.')
          continue
        }
        const matches = state.marketplace.orders
          .filter(o => o.type === 'sell' && o.item === action.item && o.price <= action.max_price)
          .sort((a, b) => a.price - b.price)

        if (matches.length === 0) {
          feedbackToAgent(result.agent, state, `[No match] No sell orders for ${action.item} at or below ${action.max_price} coin.`)
          continue
        }

        const order = matches[0]
        const buyer = result.agent
        const cost = order.price * order.quantity

        if (state.economics[buyer].wallet < cost) {
          feedbackToAgent(buyer, state, `[Can't afford] You need ${cost} coin but have ${state.economics[buyer].wallet}.`)
          continue
        }

        // Execute trade
        executeTrade(buyer, order.agentId, order.item, order.quantity, order.price, state, time)
        removeOrder(state.marketplace, order.id)
      }
    }
  }

  // Expire old orders
  state.marketplace.orders = state.marketplace.orders.filter(o => o.expiresAtTick > time.tick)
}
```

---

## Production Resolver

```typescript
// production.ts

export const RECIPES: Record<string, Recipe> = {
  wheat:      { skill: 'farmer',     inputs: {},                      output: { wheat: 4 },       tool: true,  location: 'Farm 1' },
  milk:       { skill: 'cattle',     inputs: {},                      output: { milk: 3 },        tool: false, location: 'Farm 2' },
  meat:       { skill: 'cattle',     inputs: {},                      output: { meat: 2 },        tool: true,  location: 'Farm 2' },
  eggs:       { skill: 'farmer',     inputs: {},                      output: { eggs: 2 },        tool: false, location: 'Farm 3' },
  vegetables: { skill: 'farmer',     inputs: {},                      output: { vegetables: 3 },  tool: true,  location: 'Farm 3' },
  flour:      { skill: 'miller',     inputs: { wheat: 3 },           output: { flour: 2 },       tool: false, location: 'Mill' },
  bread:      { skill: 'baker',      inputs: { flour: 1 },           output: { bread: 4 },       tool: false, location: 'Bakery' },
  iron_tools: { skill: 'blacksmith', inputs: { iron_ore: 2, coal: 1 },output: { iron_tools: 1 }, tool: false, location: 'Forge' },
  furniture:  { skill: 'carpenter',  inputs: { timber: 3 },          output: { furniture: 1 },   tool: true,  location: 'Carpenter Shop' },
  medicine:   { skill: 'healer',     inputs: { herbs: 3 },           output: { medicine: 1 },    tool: false, location: "Healer's Hut" },
  ale:        { skill: 'tavern',     inputs: { wheat: 2 },           output: { ale: 4 },         tool: false, location: 'Tavern' },
  meal:       { skill: 'tavern',     inputs: { meat: 1, vegetables: 1 }, output: { meal: 3 },   tool: false, location: 'Tavern' },
  cloth:      { skill: 'seamstress', inputs: {},                      output: { cloth: 1 },       tool: false, location: 'Seamstress Cottage' },
  timber:     { skill: 'woodcutter', inputs: {},                      output: { timber: 3 },      tool: true,  location: 'Forest' },
  firewood:   { skill: 'woodcutter', inputs: {},                      output: { firewood: 4 },    tool: true,  location: 'Forest' },
  herbs:      { skill: 'healer',     inputs: {},                      output: { herbs: 2 },       tool: false, location: 'Forest' },
  iron_ore:   { skill: 'miner',      inputs: {},                      output: { iron_ore: 3 },    tool: true,  location: 'Mine' },
  coal:       { skill: 'miner',      inputs: {},                      output: { coal: 2 },        tool: true,  location: 'Mine' },
}

export function resolveProduction(
  results: AgentTurnResult[],
  state: WorldState,
  time: SimTime
): void {
  for (const result of results) {
    for (const action of result.actions) {
      if (action.type !== 'produce') continue

      const agent = result.agent
      const eco = state.economics[agent]
      const recipe = RECIPES[action.item]

      // Validations (produce feedback injected for next tick)
      if (!recipe) {
        feedbackToAgent(agent, state, `[Can't do that] No recipe for "${action.item}".`)
        continue
      }
      if (eco.skill !== recipe.skill) {
        feedbackToAgent(agent, state, `[Can't do that] You don't have the ${recipe.skill} skill.`)
        continue
      }
      const currentLocation = state.agent_locations[agent]
      if (currentLocation !== recipe.location) {
        feedbackToAgent(agent, state, `[Can't do that] You must be at ${recipe.location} to produce ${action.item}.`)
        continue
      }
      if (recipe.tool && (!eco.tool || eco.tool.durability <= 0)) {
        feedbackToAgent(agent, state, `[Can't do that] You need working iron tools to produce ${action.item}.`)
        continue
      }
      for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
        const have = getInventoryQty(eco.inventory, inputItem as ItemType)
        if (have < qty) {
          feedbackToAgent(agent, state, `[Can't do that] Need ${qty} ${inputItem} but you only have ${have}.`)
          continue
        }
      }

      // Consume inputs
      for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
        removeFromInventory(eco.inventory, inputItem as ItemType, qty)
      }

      // Apply season multiplier
      const multiplier = getSeasonMultiplier(action.item, state.season)

      // Apply tool degradation
      if (recipe.tool && eco.tool) {
        eco.tool.durability = Math.max(0, eco.tool.durability - 3)
      }

      // Laborer routing: if this agent is hired, their output goes to employer's inventory
      // If this agent has hired a laborer, they get +50% output
      const isLaborer = !!eco.hiredBy
      const hasLaborer = !isLaborer && !!getHiredLaborer(agent, state)
      const laborBonus = hasLaborer ? 1.5 : 1.0
      const outputTarget = isLaborer ? eco.hiredBy! : agent

      // Add outputs
      const qty = Math.floor(Object.values(recipe.output)[0] * multiplier * laborBonus)
      const outputItem = Object.keys(recipe.output)[0] as ItemType
      addToInventory(state.economics[outputTarget].inventory, outputItem, qty, time.tick)

      // Feedback to both parties
      feedbackToAgent(agent, state, `Produced ${qty} ${outputItem}${isLaborer ? ` (delivered to ${outputTarget})` : ''}.`)
      if (isLaborer) feedbackToAgent(outputTarget as AgentName, state, `${agent} delivered ${qty} ${outputItem} to your inventory.`)
    }
  }
}
```

---

## Season Multipliers

```typescript
// seasons.ts — used by production.ts: getSeasonMultiplier(item, season)

export const SEASON_MULTIPLIERS: Record<ItemType, Record<Season, number>> = {
  // ─── Field / animal — strongly seasonal ───────────────────
  wheat:      { spring: 1.2, summer: 1.5, autumn: 1.0, winter: 0.0 },
  vegetables: { spring: 1.2, summer: 1.5, autumn: 1.0, winter: 0.0 },
  herbs:      { spring: 1.5, summer: 1.2, autumn: 0.8, winter: 0.0 },
  eggs:       { spring: 1.5, summer: 1.0, autumn: 0.8, winter: 0.5 },
  milk:       { spring: 1.2, summer: 1.0, autumn: 0.8, winter: 0.6 },
  meat:       { spring: 1.0, summer: 1.0, autumn: 1.2, winter: 0.8 },
  // ─── Forest / mine — mildly seasonal ──────────────────────
  timber:     { spring: 1.0, summer: 1.0, autumn: 1.2, winter: 0.8 },
  firewood:   { spring: 0.8, summer: 0.8, autumn: 1.2, winter: 1.5 },
  iron_ore:   { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 0.8 },
  coal:       { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.2 },
  // ─── Processed / indoor — unaffected ──────────────────────
  flour:      { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  bread:      { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  iron_tools: { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  furniture:  { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  medicine:   { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  cloth:      { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.2 },
  ale:        { spring: 1.0, summer: 1.2, autumn: 1.5, winter: 1.0 },
  meal:       { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
}

// Winter survival mechanic: firewood
// At dawn in winter, if an agent has no firewood at home, energy recovery is halved
// and sickness risk is +1. Woodcutters and those who buy firewood in autumn survive better.
export function applyWinterHeating(state: WorldState): void {
  if (state.season !== 'winter') return
  for (const agent of AGENT_NAMES) {
    const eco = state.economics[agent]
    const hasFirewood = getInventoryQty(eco.inventory, 'firewood') > 0
    if (!hasFirewood) {
      // Consume no firewood (they have none) — reduce energy recovery
      state.body[agent].energy = Math.max(0, state.body[agent].energy - 1)
      // Bump sickness risk (resolved in body.ts checkSickness at dawn)
      state.body[agent].sickness = Math.min(3, (state.body[agent].sickness ?? 0) + 1)
    } else {
      removeFromInventory(eco.inventory, 'firewood', 1)
    }
  }
}
```

---

## Food Consumption

Eating is explicit via the `eat` action. The engine also applies auto-eat at dawn to prevent starvation deaths from inactive agents.

```typescript
// body.ts — resolveEat() called from tools.ts eat action handler

export const SATIATION: Partial<Record<ItemType, number>> = {
  bread:      2,
  meal:       3,
  meat:       2,
  vegetables: 1,
  eggs:       1,
  milk:       1,
  // ale: 0 — thirst only, no hunger reduction
}

export function resolveEat(agent: AgentName, item: ItemType, quantity: number, state: WorldState): void {
  const eco = state.economics[agent]
  const available = getInventoryQty(eco.inventory, item) - (getReserved(eco.inventory, item))
  if (available < quantity) {
    feedbackToAgent(agent, state, `[Can't eat] You only have ${available} ${item}.`)
    return
  }
  const satiation = SATIATION[item]
  if (!satiation) {
    feedbackToAgent(agent, state, `[Can't eat] ${item} is not edible.`)
    return
  }
  removeFromInventory(eco.inventory, item, quantity)
  state.body[agent].hunger = Math.max(0, state.body[agent].hunger - satiation * quantity)
  feedbackToAgent(agent, state, `You ate ${quantity} ${item}. Hunger reduced.`)
}

// Auto-eat at dawn: if hunger >= 4 and agent has any food, consume the cheapest item.
// Prevents starvation deaths for agents who forget to eat.
export function applyDawnAutoEat(state: WorldState): void {
  for (const agent of AGENT_NAMES) {
    const body = state.body[agent]
    if (body.hunger < 4) continue
    const eco = state.economics[agent]
    const edibles = eco.inventory.items
      .filter(i => SATIATION[i.type] && (i.quantity - (i.reserved ?? 0)) > 0)
      .sort((a, b) => (state.marketplace.priceIndex[a.type] ?? 99) - (state.marketplace.priceIndex[b.type] ?? 99))
    if (edibles.length === 0) continue   // truly starving — starvation check handles this
    const food = edibles[0]
    removeFromInventory(eco.inventory, food.type, 1)
    body.hunger = Math.max(0, body.hunger - (SATIATION[food.type] ?? 1))
  }
}
```

---

## Tool Auto-Equip

`iron_tools` is both a tradeable `ItemType` (can sit in inventory) and an equipped `ToolState`. The lifecycle:

1. **Produce or buy** `iron_tools` → added to inventory as a normal item.
2. **At dawn** (or on first `produce` attempt requiring a tool): if `eco.tool === null` or `eco.tool.durability === 0`, auto-equip from inventory.
3. **On use**: `eco.tool.durability -= 3` per produce tick.
4. **On break** (`durability === 0`): `eco.tool = null`. The item is consumed — it does not return to inventory.
5. **Multiple in inventory**: only one equipped at a time; extras stay as tradeable stock.

```typescript
// tools-degradation.ts

export function autoEquipTools(state: WorldState): void {
  for (const agent of AGENT_NAMES) {
    const eco = state.economics[agent]
    if (eco.tool && eco.tool.durability > 0) continue   // already equipped and working
    const hasStock = getInventoryQty(eco.inventory, 'iron_tools') > 0
    if (!hasStock) continue
    removeFromInventory(eco.inventory, 'iron_tools', 1)
    eco.tool = { type: 'iron_tools', durability: 100 }
    feedbackToAgent(agent, state, 'You equipped a fresh set of iron tools.')
  }
}

// Called at dawn in engine.ts, before production phase
export function degradeTools(state: WorldState): void {
  for (const agent of AGENT_NAMES) {
    const eco = state.economics[agent]
    if (!eco.tool) continue
    if (eco.tool.durability <= 0) {
      eco.tool = null
      feedbackToAgent(agent, state, 'Your iron tools broke. You need new ones.')
    }
  }
}
```

`autoEquipTools()` runs at dawn after `degradeTools()`.

---

## Economy Tracker

```typescript
// economy-tracker.ts

export function takeEconomySnapshot(state: WorldState, time: SimTime): void {
  const wallets = AGENT_NAMES.map(a => state.economics[a].wallet)
  const totalWealth = wallets.reduce((a, b) => a + b, 0)

  // Gini coefficient
  const sorted = [...wallets].sort((a, b) => a - b)
  const n = sorted.length
  const gini = sorted.reduce((acc, val, i) => acc + (2 * (i + 1) - n - 1) * val, 0)
    / (n * totalWealth) || 0

  // GDP: total trade volume today
  const todayStart = time.tick - (time.tick % 16)
  const gdp = state.marketplace.history
    .filter(t => t.tick >= todayStart)
    .reduce((a, t) => a + t.total, 0)

  const snapshot: EconomySnapshot = {
    tick: time.tick,
    day: time.dayNumber,
    season: state.season,
    totalWealth,
    giniCoefficient: Math.round(gini * 100) / 100,
    gdp,
    inflationRate: calcInflation(state),
    priceIndex: { ...state.marketplace.priceIndex },
    supplyIndex: calcSupply(state),
    demandIndex: calcDemand(state),
    scarcityAlerts: calcScarcity(state),
    wealthDistribution: AGENT_NAMES.map(a => ({
      agent: a,
      wallet: state.economics[a].wallet,
      inventory_value: calcInventoryValue(state.economics[a].inventory, state.marketplace.priceIndex),
    })),
    tradeCounts: calcTradeCounts(state, todayStart),
    productionCounts: calcProductionCounts(state, todayStart),
    tradeRelationships: calcTradeRelationships(state, todayStart),
    debtors: AGENT_NAMES.filter(a => state.economics[a].wallet < 5),
    hoarders: calcHoarders(state),
  }

  state.economy_snapshots.push(snapshot)
  if (state.economy_snapshots.length > 28) {
    state.economy_snapshots.shift()
  }
}
```

---

## SSE Streaming

The server currently serves static JSON files. For Brunnfeld we add real-time streaming.

```typescript
// server.ts additions

import { EventEmitter } from 'events'
export const eventBus = new EventEmitter()
eventBus.setMaxListeners(100)

// ─── SSE endpoint ─────────────────────────────────────────

app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  const handlers: Record<string, (e: unknown) => void> = {
    'agent:action':     (e) => send({ type: 'action', ...e }),
    'agent:thought':    (e) => send({ type: 'thought', ...e }),
    'trade:completed':  (e) => send({ type: 'trade', ...e }),
    'price:updated':    (e) => send({ type: 'price', ...e }),
    'production:done':  (e) => send({ type: 'production', ...e }),
    'economy:snapshot': (e) => send({ type: 'economy', ...e }),
    'event:triggered':  (e) => send({ type: 'event', ...e }),
  }

  for (const [evt, handler] of Object.entries(handlers)) {
    eventBus.on(evt, handler)
  }

  req.on('close', () => {
    for (const [evt, handler] of Object.entries(handlers)) {
      eventBus.off(evt, handler)
    }
  })
})
```

```typescript
// stagger-buffer.ts — same concept as described in spec

export class StaggerBuffer {
  private queue: { event: string; data: unknown; emitAt: number }[] = []

  push(event: string, data: unknown, minMs = 200, maxMs = 800) {
    const delay = minMs + Math.random() * (maxMs - minMs)
    this.queue.push({ event, data, emitAt: Date.now() + delay })
    this.queue.sort((a, b) => a.emitAt - b.emitAt)
  }

  drain(bus: EventEmitter) {
    const now = Date.now()
    while (this.queue.length && this.queue[0].emitAt <= now) {
      const { event, data } = this.queue.shift()!
      bus.emit(event, data)
    }
  }
}
```

---

## Frontend — Game Viewer

**Stack:** Vite + React + TypeScript + HTML Canvas (2D)

**Asset packs used:**
- `Asset_Pack/` — terrain tiles, building sprites, unit sprites (Pawn/Monk/Warrior), UI elements, particle FX, decorations
- `Items-Assets/` — item icons for inventory, marketplace, activity feed

---

### Screen Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  HUD Bar: [Season icon] Day 3 — Spring  06:00  ☁ Cloudy 9°C  [GDP] │  ← 40px
├──────────────────────────────────────┬──────────────────────────────┤
│                                      │  ╔══════════════════════════╗ │
│                                      │  ║  [Agent] [Market] [Econ] ║ │  ← tab bar
│        Village Map Canvas            │  ╠══════════════════════════╣ │
│        (pan + zoom)                  │  ║                          ║ │
│                                      │  ║   Right Panel            ║ │
│        Top-down tile map             │  ║   (WoodTable texture bg) ║ │
│        with animated agents          │  ║                          ║ │
│        walking between buildings     │  ║   Agent Card             ║ │
│                                      │  ║   Inventory Grid         ║ │
│                                      │  ║   Market Orders          ║ │
│                                      │  ║   Economy Charts         ║ │
│                                      │  ╚══════════════════════════╝ │
├──────────────────────────────────────┴──────────────────────────────┤
│  Activity Feed — scrolling cards (action / trade / event / produce) │  ← 120px
└─────────────────────────────────────────────────────────────────────┘
```

Full-screen layout. Canvas takes remaining space after HUD and feed.
Right panel is 340px fixed, overlays the right edge of canvas.
Map clicks behind the panel are ignored.

---

### Asset Mapping

#### Buildings → Location sprites

| Location | Sprite | Notes |
|----------|--------|-------|
| Village Square | *(open plaza — no building, stone tile ring)* | market stall decoration |
| Bakery | `Buildings/Blue/House2.png` | |
| Tavern | `Buildings/Yellow/House3.png` | |
| Forge | `Buildings/Red/House1.png` | Fire_01 particle above chimney |
| Carpenter Shop | `Buildings/Yellow/House2.png` | |
| Mill | `Buildings/Blue/Tower.png` | + Dust_01 particle when producing |
| Church | `Buildings/Purple/Monastery.png` | |
| Elder's House | `Buildings/Yellow/Castle.png` | |
| Healer's Hut | `Buildings/Blue/House1.png` | |
| Seamstress Cottage | `Buildings/Purple/House1.png` | |
| Cottage 1–9 | `Buildings/Blue/House1-3.png` alternating | |
| Farm 1–3 | *(field tiles + Sheep sprite)* | no building |
| Forest | `Terrain/Resources/Trees/Tree1-4.png` | clustered, stumps when felled |
| Mine | `Buildings/Black/Tower.png` | dark, Dust_02 particle |

#### Agent sprites → Unit type + color

Agents are rendered as Pawn sprites. Carry animation switches based on current action.

| Agent | Unit | Color | Carry animation |
|-------|------|-------|-----------------|
| Hans / Heinrich / Bertram | Pawn | Yellow | `_With_Axe` when farming |
| Konrad (cattle) | Pawn | Yellow | `_With_Meat` when producing |
| Gerda (miller) | Pawn | Blue | `_With_Hammer` when milling |
| Anselm (baker) | Pawn | Blue | `_With_Hammer` when baking |
| Volker (blacksmith) | Pawn | Red | `_With_Hammer` when forging |
| Wulf (carpenter) | Pawn | Yellow | `_With_Axe` when building |
| Liesel (tavern) | Pawn | Yellow | `_With_Knife` when serving |
| Sybille (healer) | Monk | Blue | `Heal` animation when treating |
| Friedrich / Rupert (woodcutter) | Pawn | Blue | `_With_Axe` in Forest |
| Dieter / Bertha (miner) | Pawn | Black | `_With_Pickaxe` in Mine |
| Otto (elder) | Warrior | Yellow | `Guard` pose at Elder's House |
| Pater Markus | Monk | Purple | `Idle` at Church |
| Ida / Magda / Elke / Ulrike / others | Pawn | Blue/Purple | `Idle` / `_With_Gold` at market |

**State machine for each agent sprite:**

```
IDLE      → play Pawn_Idle (loop, 4 frames)
WALKING   → play Pawn_Run  (loop, 4 frames), lerp position to destination
WORKING   → play Pawn_With_{tool} (loop) — chosen by current skill + action
TRADING   → play Pawn_With_Gold (once), then back to IDLE
EATING    → play Pawn_With_Knife (once, 2 cycles), then back to IDLE
SICK      → play Pawn_Idle at 50% opacity, slight wobble via CSS transform
DEAD      → sprite flips horizontal, fades out over 2s
```

Facing direction: sprites face right by default. Flip horizontal (`scaleX(-1)`) when moving left.

#### Item icons → Items-Assets mapping

| Brunnfeld ItemType | Asset path | Fallback |
|--------------------|-----------|----------|
| wheat | *(custom 16×16 — a golden grain pile; no direct match)* | `Ore & Gem/Gold Nugget.png` tinted |
| flour | `Material/Wool.png` | |
| bread | `Food/Bread.png` | |
| meat | `Food/Meat.png` | |
| milk | `Food/Wine 2.png` | |
| eggs | `Monster Part/Egg.png` | |
| vegetables | `Food/Green Apple.png` | |
| herbs | `Food/Mushroom.png` | |
| medicine | `Potion/Green Potion.png` | |
| iron_ore | `Ore & Gem/Silver Nugget.png` | |
| coal | `Ore & Gem/Coal.png` | |
| iron_tools | `Weapon & Tool/Pickaxe.png` | |
| timber | `Material/Wood Log.png` | |
| firewood | `Material/Wooden Plank.png` | |
| furniture | `Misc/Chest.png` | |
| ale | `Food/Beer.png` | |
| meal | `Food/Fish Steak.png` | |
| cloth | `Material/Fabric.png` | |
| *(wallet/coins)* | `Misc/Golden Coin.png` | |

#### Agent portraits

`UI Elements/Human Avatars/Avatars_01-25.png` — one per agent (20 agents + 5 spare).
Assign by index in `AGENT_NAMES` order. Portrait shows in AgentCard, hover tooltip, activity feed.

---

### Tile Map Design

**Tile source:** `Terrain/Tileset/Tilemap_color1.png`
**Tile size:** 16×16 px rendered at **3× scale** (48×48 px on screen)
**Map dimensions:** 32 tiles wide × 26 tiles tall (1536×1248 logical px)
**Camera:** pan freely, zoom 1×–2×, starts centered on Village Square

```
Tile map layout (each cell = 1 tile, letter = terrain type):
G = grass, R = dirt road, S = stone, W = water, F = forest, M = mine shaft

     0    4    8    12   16   20   24   28   31
 0:  F    F    F    F    F    F    F    M    M
 1:  F    F    F    F    F    F    F    M    M
 2:  F    [FOREST zone]      F    F    F    F
 3:  G    G    G    R    R    R    R    G    G
 4:  [FARM 1]   R   [FARM 2]  R  [FARM 3]   G
 5:  G    G    G    R    G    G    R    G    G
 6:  G    G    G    R    G    G    R    G    G
 7:  R    R    R    R    R    R    R    R    R   ← North Road
 8:  G    [MILL]   R  [VILLAGE SQUARE]  [CHURCH] [ELDER'S]
 9:  G    G    R    [BAKERY][TAVERN] R  [FORGE][CARP.]
10:  R    R    R    R    R    R    R    R    R   ← Residential Road
11:  [C1] [C2] [C3] G    [C4] [C5] G   G    G
12:  G    G    G    G    G    G    G    G    G
13:  [C6] [C7] G    [C8] [C9] G    [SEAMSTRESS] G
14:  G    G    G    G    G    [HEALER'S HUT]    G
15:  W    W    W    W    W    W    W    W    W   ← river / map edge
```

Each **location** has a pixel anchor point (center of its tile area) used for:
- Placing building sprite
- Snapping agent sprites when `IDLE` at that location
- Pathfinding interpolation when `WALKING`

```typescript
// village-map.ts (extended for renderer)

export const LOCATION_TILES: Record<Location, { tx: number; ty: number }> = {
  'Village Square':     { tx: 16, ty: 8  },
  'Bakery':             { tx: 13, ty: 9  },
  'Tavern':             { tx: 15, ty: 9  },
  'Forge':              { tx: 20, ty: 9  },
  'Carpenter Shop':     { tx: 22, ty: 9  },
  'Mill':               { tx: 8,  ty: 8  },
  'Church':             { tx: 24, ty: 8  },
  "Elder's House":      { tx: 27, ty: 8  },
  'Cottage 1':          { tx: 2,  ty: 11 },
  'Cottage 2':          { tx: 5,  ty: 11 },
  'Cottage 3':          { tx: 8,  ty: 11 },
  'Cottage 4':          { tx: 13, ty: 11 },
  'Cottage 5':          { tx: 17, ty: 11 },
  'Cottage 6':          { tx: 2,  ty: 13 },
  'Cottage 7':          { tx: 5,  ty: 13 },
  'Cottage 8':          { tx: 9,  ty: 13 },
  'Cottage 9':          { tx: 13, ty: 13 },
  'Seamstress Cottage': { tx: 20, ty: 13 },
  "Healer's Hut":       { tx: 24, ty: 14 },
  'Farm 1':             { tx: 4,  ty: 4  },
  'Farm 2':             { tx: 13, ty: 4  },
  'Farm 3':             { tx: 21, ty: 4  },
  'Forest':             { tx: 6,  ty: 1  },
  'Mine':               { tx: 28, ty: 1  },
}
```

---

### Canvas Architecture

Five layers drawn in order each frame via `requestAnimationFrame`:

```
Layer 0 — Terrain      (static, redrawn only on camera move)
Layer 1 — Buildings    (static, redrawn only on camera move)
Layer 2 — Decorations  (trees, rocks, bushes, sheep — slow animation)
Layer 3 — Agents       (every frame — moving sprites)
Layer 4 — Particles    (every frame — fire, dust, coins, snow)
Layer 5 — UI Canvas    (health bars above agents, trade pop-ups)
```

Layers 0–2 are rendered to an offscreen `OffscreenCanvas` and only re-composited when the camera moves (pan/zoom). Layers 3–5 are rendered every frame directly.

```typescript
// canvas/VillageRenderer.ts

export class VillageRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private camera: Camera
  private staticLayer: OffscreenCanvas
  private dirty = true          // triggers static layer repaint

  private tilesheet: HTMLImageElement      // Tilemap_color1.png
  private buildings: Map<Location, HTMLImageElement>
  private unitSprites: Map<string, HTMLImageElement>   // "pawn_run_right" etc

  render(state: ViewerState, dt: number) {
    if (this.dirty) {
      this.paintStaticLayer()
      this.dirty = false
    }
    this.ctx.drawImage(this.staticLayer, 0, 0)
    this.paintDecorations(dt)
    this.paintAgents(state.agents, dt)
    this.paintParticles(state.particles, dt)
    this.paintAgentLabels(state.agents, state.selectedAgent)
  }
}
```

**Camera:**
```typescript
// canvas/CameraController.ts

export class Camera {
  x = 0; y = 0        // world offset (pixels)
  zoom = 1.5           // 1× – 2×

  // Mouse wheel → zoom. Middle drag or right drag → pan.
  // On mobile: pinch zoom + touch drag.
  screenToWorld(sx: number, sy: number): { wx: number; wy: number }
  worldToScreen(wx: number, wy: number): { sx: number; sy: number }
}
```

---

### Animation System

```typescript
// sprites/PawnAnimator.ts

type AgentAnimState = 'idle' | 'walk' | 'work' | 'trade' | 'eat' | 'sick' | 'dead'

interface SpriteSheet {
  img: HTMLImageElement
  frameW: number    // px per frame
  frameH: number
  frames: number
  fps: number
}

const SHEETS: Record<string, SpriteSheet> = {
  pawn_idle:         { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 4 },
  pawn_run:          { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 8 },
  pawn_axe:          { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 6 },
  pawn_hammer:       { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 6 },
  pawn_pickaxe:      { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 6 },
  pawn_gold:         { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 6 },
  pawn_meat:         { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 6 },
  pawn_wood:         { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 6 },
  monk_idle:         { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 4 },
  monk_heal:         { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 6 },
  warrior_idle:      { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 4 },
  warrior_guard:     { img: ..., frameW: 16, frameH: 16, frames: 4, fps: 4 },
}

// Choose sprite key from agent state
function resolveSheet(agent: AgentName, state: AgentAnimState, action?: string): string {
  if (state === 'walk')  return 'pawn_run'
  if (state === 'trade') return 'pawn_gold'
  if (state === 'eat')   return 'pawn_knife'
  if (state === 'work') {
    const skill = agentSkills[agent]
    if (skill === 'farmer' || skill === 'woodcutter' || skill === 'carpenter') return 'pawn_axe'
    if (skill === 'blacksmith' || skill === 'baker' || skill === 'miller')     return 'pawn_hammer'
    if (skill === 'miner')   return 'pawn_pickaxe'
    if (skill === 'cattle')  return 'pawn_meat'
    if (skill === 'healer')  return 'monk_heal'
  }
  if (agentSkills[agent] === 'healer') return 'monk_idle'
  if (agent === 'pater_markus')        return 'monk_idle'
  if (agent === 'otto')                return 'warrior_guard'
  return 'pawn_idle'
}
```

**Agent position interpolation:**

Each agent has a visual position `(vx, vy)` that smoothly lerps toward the target `(tx, ty)` (the location's tile anchor). Speed = distance / (tickMs * 0.6) so agents arrive before the next tick.

```typescript
// canvas/AgentLayer.ts

function updateAgentPositions(agents: AgentVisualState[], dt: number) {
  for (const a of agents) {
    const speed = 0.004 * dt   // fraction of remaining distance per ms
    a.vx += (a.tx - a.vx) * speed
    a.vy += (a.ty - a.vy) * speed
    a.animState = distance(a.vx, a.vy, a.tx, a.ty) > 8 ? 'walk' : a.logicState
    a.facingLeft = a.tx < a.vx
  }
}
```

---

### Particle System

```typescript
// canvas/ParticleLayer.ts

type ParticleType =
  | 'forge_fire'      // Fire_01.png loop above Forge chimney (always when Volker is working)
  | 'mill_dust'       // Dust_01.png burst when Gerda produces flour
  | 'mine_dust'       // Dust_02.png loop at Mine when a miner is working
  | 'trade_coin'      // Golden Coin sprite flies from seller location to buyer location
  | 'production_pop'  // item icon pops up (+bread, +wheat) over agent head
  | 'heal_effect'     // Heal_Effect.png from Monk heal animation over patient
  | 'death'           // Explosion_01.png — agent dies
  | 'snow'            // winter: random white particles fall from top
  | 'leaves'          // autumn: brown leaf sprites drift down
  | 'rain'            // summer storm: diagonal blue lines
  | 'tax_coin'        // coin stream from each cottage to Elder's House on tax day

interface Particle {
  type: ParticleType
  x: number; y: number
  vx: number; vy: number
  life: number        // 0–1, decreases over time
  maxLife: number     // ms
  data?: unknown      // e.g. { item: ItemType } for production_pop
}
```

**Trigger map** (SSE event → particle):

| SSE event | Particle spawned |
|-----------|-----------------|
| `production:done` | `production_pop` over agent head, item icon floats up and fades |
| `trade:completed` | `trade_coin` flies from seller → buyer (3 coin sprites, staggered 80ms) |
| `agent:action` type=`produce` at Forge | `forge_fire` persistent loop |
| `agent:action` type=`produce` at Mill | `mill_dust` burst |
| `agent:action` type=`produce` at Mine | `mine_dust` persistent |
| `event:triggered` drought | screen edge turns orange tint, no rain |
| `event:triggered` plague | greenish fog overlay + `heal_effect` particles scattered |
| `economy:snapshot` tax day | `tax_coin` streams from all cottages to Elder's House |
| season = winter | continuous `snow` |
| season = autumn | periodic `leaves` |
| agent death (hunger >= 5 for 3 ticks) | `death` explosion + sprite fade |

---

### Day / Night Overlay

A semi-transparent black canvas overlay, opacity driven by time-of-day:

```typescript
function getDayNightAlpha(hour: number): number {
  // 06:00 = 0 (full light), 21:00 = 0.65 (dark), midnight = 0.8
  if (hour >= 6 && hour <= 14) return 0
  if (hour >= 20) return 0.65
  if (hour <= 5)  return 0.75
  return (hour - 14) / 6 * 0.65   // gradual sunset 14→20
}
```

Lantern glows (Lantern.png from Misc) appear as small warm circles (radial gradient, gold at center, transparent at edge) around the Tavern, Church, and Forge during night hours.

---

### React UI Components

```
viewer/src/
  assets/
    manifest.ts             ← maps ItemType → image path, AgentName → portrait index
    index.ts                ← preloads all HTMLImageElements into a cache Map

  canvas/
    VillageRenderer.ts
    AgentLayer.ts
    ParticleLayer.ts
    CameraController.ts

  sprites/
    PawnAnimator.ts
    SpriteSheet.ts

  components/
    GameHUD.tsx             ← top bar
    RightPanel.tsx          ← tab container (wood texture bg)
      AgentCard.tsx         ← portrait + name + role ribbon + vitals bars
      InventoryGrid.tsx     ← 4×5 grid cells (WoodTable_Slots texture), item icons
      AgentActions.tsx      ← last 3 actions as speech bubbles
      MarketplacePanel.tsx  ← order book table with item icons + price sparklines
      EconomyDashboard.tsx  ← GDP ticker, Gini gauge, price line charts, wealth bars
      EventsLog.tsx         ← world events on SpecialPaper.png scroll
    ActivityFeed.tsx        ← bottom scroll: cards with portrait + icon + text
    EventBanner.tsx         ← full-width slide-down on major world events
    AgentTooltip.tsx        ← hover: portrait, name, job, hunger dots, location
    SeasonBadge.tsx         ← season icon + day label in HUD

  hooks/
    useEventStream.ts       ← EventSource → dispatch to Zustand store
    useVillageStore.ts      ← Zustand store: agents, marketplace, economy, particles
    useAgentSelection.ts    ← selected agent id, click handler passed to canvas
    useCamera.ts            ← camera state + wheel/drag handlers
    useAnimationQueue.ts    ← SSE events → timed particle/animation triggers

  App.tsx
```

---

### UI Design System (Asset_Pack UI Elements)

All UI panels use the `WoodTable.png` texture as background (CSS `background-image: url(...)`, `background-repeat: repeat`, `image-rendering: pixelated`).

Panel headers use `BigRibbons.png` sliced into a CSS border-image.

```scss
.panel {
  background-image: url('/assets/ui/WoodTable.png');
  background-size: 64px 64px;        // tile the texture
  image-rendering: pixelated;
  border: 3px solid #5c3a1e;
  border-radius: 4px;
}

.panel-header {
  background-image: url('/assets/ui/BigRibbons.png');
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-family: 'Press Start 2P', monospace;   // pixel font
  font-size: 10px;
}

.btn-primary {
  background-image: url('/assets/ui/Buttons/BigBlueButton_Regular.png');
  image-rendering: pixelated;
  background-size: 100% 100%;
  &:active { background-image: url('/assets/ui/Buttons/BigBlueButton_Pressed.png'); }
}

.inventory-slot {
  background-image: url('/assets/ui/WoodTable_Slots.png');
  background-size: 100% 100%;
  image-rendering: pixelated;
  width: 48px; height: 48px;
  position: relative;
  .item-icon { width: 32px; height: 32px; image-rendering: pixelated; }
  .quantity-badge {
    position: absolute; bottom: 2px; right: 4px;
    font-size: 8px; color: #fff; text-shadow: 1px 1px 0 #000;
  }
}

.vitals-bar {
  .bar-base  { background-image: url('/assets/ui/Bars/SmallBar_Base.png'); }
  .bar-fill  { background-image: url('/assets/ui/Bars/SmallBar_Fill.png');
               width: calc(var(--pct) * 100%); }
}
```

**AgentCard component:**

```tsx
// components/AgentCard.tsx

export function AgentCard({ agent }: { agent: AgentName }) {
  const eco = useVillageStore(s => s.economics[agent])
  const body = useVillageStore(s => s.body[agent])
  const portraitIdx = AGENT_PORTRAIT_MAP[agent]    // 1–20

  return (
    <div className="panel agent-card">
      <div className="panel-header">{AGENT_DISPLAY_NAMES[agent]}</div>
      <div className="card-body">
        <img className="portrait"
             src={`/assets/ui/Human Avatars/Avatars_${String(portraitIdx).padStart(2,'0')}.png`} />
        <div className="vitals">
          <RibbonLabel color="blue">{SKILL_LABELS[eco.skill]}</RibbonLabel>
          <VitalsBar label="Hunger" value={5 - body.hunger} max={5} color="red" />
          <VitalsBar label="Energy" value={body.energy} max={10} color="yellow" />
          {body.sickness ? <VitalsBar label="Sickness" value={3 - body.sickness} max={3} color="green" /> : null}
        </div>
        <div className="wallet">
          <img src="/assets/items/Misc/Golden Coin.png" />
          <span>{eco.wallet} coin</span>
        </div>
        {eco.tool && (
          <div className="tool-row">
            <img src="/assets/items/Weapon & Tool/Pickaxe.png" />
            <div className="vitals-bar">
              <div className="bar-base"><div className="bar-fill" style={{ '--pct': eco.tool.durability/100 } as CSSProperties} /></div>
            </div>
          </div>
        )}
      </div>
      <InventoryGrid inventory={eco.inventory} />
    </div>
  )
}
```

**Activity Feed:**

```tsx
// components/ActivityFeed.tsx
// Cards slide in from right, max 20 visible, oldest fade out left.

interface FeedCard {
  id: string
  type: 'action' | 'trade' | 'production' | 'event'
  agent?: AgentName
  text: string
  itemIcon?: string      // path to Items-Assets image
  timestamp: number
}

// Icons per card type:
// action  → agent portrait (small, 24px)
// trade   → Golden Coin.png
// production → item icon from manifest
// event   → Icon_01.png (warning/star icons)
```

---

### Economy Dashboard

```tsx
// components/EconomyDashboard.tsx

// Price chart: recharts LineChart (lightweight), one line per ItemType.
// Colors map to item category: food = warm, ore = grey, tools = blue.
// Show last 10 ticks (scrolling window).

// Gini gauge: SVG arc gauge, 0 (equal) = green, 1 (extreme) = red.

// Wealth bar chart: horizontal bars, one per agent, sorted by wallet.
// Agent portrait as y-axis label. Bar color = relative wealth tier.

// GDP ticker: animated number counter at top of panel.
// Shows today's trade volume in coins, ticks up as trades happen via SSE.
```

---

### Event Banner

When `event:triggered` SSE fires (drought, plague, caravan, bandit, mine collapse):

```tsx
// components/EventBanner.tsx

// Slides down from top, SpecialPaper.png background, takes full width.
// Shows event icon (Icon_01-12), title, description from event payload.
// Auto-dismisses after 6 seconds or on click.
// During event: persistent subtle overlay on canvas (drought = orange tint,
// plague = green fog, bandit = red edge pulse).
```

---

### State Management

```typescript
// hooks/useVillageStore.ts (Zustand)

interface VillageStore {
  // Server state (from SSE + REST)
  tick: number
  time: string
  season: Season
  weather: string
  agents: Record<AgentName, AgentViewState>
  marketplace: Marketplace
  economySnapshots: EconomySnapshot[]
  activeEvents: ActiveEvent[]

  // Visual state
  selectedAgent: AgentName | null
  particles: Particle[]
  feedCards: FeedCard[]
  animQueue: AnimQueueItem[]

  // Actions
  selectAgent: (name: AgentName | null) => void
  pushParticle: (p: Particle) => void
  pushFeedCard: (c: FeedCard) => void
  handleSSEEvent: (e: SSEEvent) => void
}
```

```typescript
// hooks/useEventStream.ts

export function useEventStream(url: string) {
  const handleSSEEvent = useVillageStore(s => s.handleSSEEvent)

  useEffect(() => {
    const es = new EventSource(url)
    es.onmessage = (e) => {
      handleSSEEvent(JSON.parse(e.data))
    }
    es.onerror = () => {
      // retry after 3s — SSE auto-reconnects but we reset state
    }
    return () => es.close()
  }, [url])
}
```

Initial state loaded via `GET /api/state` on mount, then SSE keeps it live.

---

### Asset Preloader

```typescript
// assets/index.ts

const IMAGE_CACHE = new Map<string, HTMLImageElement>()

export async function preloadAssets(): Promise<void> {
  const paths = [
    ...Object.values(ITEM_ICONS),
    ...Object.values(BUILDING_SPRITES),
    ...AGENT_SPRITE_KEYS.map(k => SPRITE_PATH[k]),
    ...UI_ASSETS,
  ]
  await Promise.all(paths.map(p => loadImage(p)))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    if (IMAGE_CACHE.has(src)) return res(IMAGE_CACHE.get(src)!)
    const img = new Image()
    img.onload = () => { IMAGE_CACHE.set(src, img); res(img) }
    img.onerror = rej
    img.src = src
  })
}

export const img = (path: string) => IMAGE_CACHE.get(path)!
```

App shows a loading screen (progress bar using `BigBar_Base/Fill.png`) while preloading. ~535 images, batched in groups of 20.

---

## Initial World State

```typescript
// index.ts — initWorldState()

function initWorldState(): WorldState {
  return {
    current_tick: 1,
    current_time: 'Monday, 06:00',
    season: 'spring',
    day_of_season: 1,
    weather: 'Cloudy, 9°C',
    active_events: [],

    agent_locations: {
      hans: 'Cottage 1', ida: 'Cottage 2', konrad: 'Farm 2',
      ulrich: 'Cottage 4', bertram: 'Cottage 5', gerda: 'Mill',
      anselm: 'Bakery', volker: 'Forge', wulf: 'Carpenter Shop',
      liesel: 'Tavern', sybille: "Healer's Hut", friedrich: 'Cottage 7',
      otto: "Elder's House", pater_markus: 'Church',
      dieter: 'Cottage 8', magda: 'Cottage 8', bertha: 'Cottage 9',
      heinrich: 'Cottage 1', elke: 'Seamstress Cottage', rupert: 'Cottage 3',
    },

    economics: {
      hans:        { wallet: 30, inventory: { items: [{ type: 'wheat', quantity: 8 }] }, tool: { type: 'iron_tools', durability: 80 }, skill: 'farmer', ... },
      gerda:       { wallet: 45, inventory: { items: [{ type: 'flour', quantity: 4 }] }, tool: null, skill: 'miller', ... },
      anselm:      { wallet: 32, inventory: { items: [{ type: 'bread', quantity: 6 }, { type: 'flour', quantity: 2 }] }, tool: null, skill: 'baker', ... },
      volker:      { wallet: 60, inventory: { items: [{ type: 'iron_ore', quantity: 4 }, { type: 'coal', quantity: 3 }] }, tool: null, skill: 'blacksmith', ... },
      // ... all 20 agents with starting conditions
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
      priceHistory: {},
    },

    // ... rest of state
  }
}
```

---

## Build Order

### Phase 1 — Economic kernel (no viewer, terminal only)

1. `types.ts` — all new types
2. `village-map.ts` — locations, adjacency
3. `inventory.ts` — inventory CRUD, spoilage
4. `marketplace.ts` — order book operations
5. `production.ts` — recipes + resolver
6. `tools-degradation.ts`
7. `marketplace-resolver.ts` — matching engine
8. `trade-scanner.ts` — barter detection
9. `economy-tracker.ts`
10. Extend `engine.ts` — add economic phases to tick loop
11. Extend `agent-runner.ts` — inject economic context into perception
12. Extend `tools.ts` — add new action cases
13. Port `memory.ts`, `body.ts`, `sounds.ts`, `away.ts`, `time.ts` with updates
14. `index.ts` — new init + CLI
15. Run 6-agent subset in terminal. Verify trades happen.

### Phase 2 — Full cast + events

16. Load all 20 agents with profiles + memory_initial
17. `seasons.ts` — season effects on production
18. `events.ts` — drought, caravan, mine collapse
19. `taxes.ts` — weekly elder tax
20. `hiring.ts` — laborer hire/wage resolution
21. Run full 20-agent sim. Watch economy emerge.

### Phase 3 — Viewer

22. Scaffold `viewer/` with Vite + React + Canvas
23. `VillageRenderer.ts` — tile map with provided assets
24. `AgentSprites.ts` — walking between locations
25. `useEventStream.ts` — SSE connection
26. `ActivityFeed.tsx` — live event log
27. `AgentPanel.tsx` — selected agent details
28. `EconomyDashboard.tsx` — price chart, Gini, wealth bar
29. `MarketplaceView.tsx` — live orders
30. SSE endpoint + StaggerBuffer in `server.ts`

---

## Key Differences from Hauswelt

| Hauswelt | Brunnfeld |
|----------|-----------|
| 6 agents | 20 agents |
| Apartment building | Medieval village |
| Social drama (eviction) | Economic simulation (survival) |
| `AgentFinances` — passive (rent, income) | `AgentEconomicState` — active (inventory, wallet, production) |
| No marketplace | Full order book with matching engine |
| `FridgeItem` — informal food tracking | `Inventory` — typed item system with spoilage |
| `BodyState` hunger — decorative | Hunger tied to food inventory; starvation = death |
| No tools | Tool durability system |
| SSE not implemented | Full SSE with StaggerBuffer |
| Static JSON server | SSE + REST API server |
| `environment-agent.ts` — weather only | `seasons.ts` + `events.ts` — full event system |
| No economy analytics | `economy-tracker.ts` — GDP, Gini, price index |
| Viewer: apartment building | Viewer: top-down village canvas |

---

## Files NOT ported from Hauswelt

- `finances.ts` — replaced by `AgentEconomicState.wallet` in world state
- `away.ts` — rewritten completely for medieval schedules
- `interview.ts` — can port as-is later
- `environment-agent.ts` — replaced by `seasons.ts` + `events.ts` + `village-map.ts`
- The eviction/objection/law firm logic — Brunnfeld-specific conflict resolution will emerge from the engine naturally

---

## Token Cost Estimate

Based on Hauswelt feedback memory:
- 20 agents × ~800 tokens perception = ~16,000 tokens input per tick
- ~20,000 tokens output per tick (actions)
- At Haiku pricing: ~$0.003/tick, ~$0.05/day (16 ticks), ~$1.50/full year sim

Keep CHARACTER_MODEL=haiku. Only use Sonnet for the environment agent (events) if needed.
