import type { AgentName, AgentTurnResult, ItemType, Skill, WorldState, SimTime } from "./types.js";
import { getAgentNames, getLocationType } from "./world-registry.js";
import { getInventoryQty, removeFromInventory, addToInventory, feedbackToAgent } from "./inventory.js";
import { getSeasonMultiplier } from "./seasons.js";
import { getEventProductionMultiplier } from "./god-mode.js";

export interface Recipe {
  skill: Skill;
  inputs: Partial<Record<ItemType, number>>;
  output: Partial<Record<ItemType, number>>;
  tool: boolean;
  location: string;
}

export const RECIPES: Record<string, Recipe> = {
  wheat:      { skill: "farmer",     inputs: {},                          output: { wheat: 4 },       tool: true,  location: "Farm 1" },
  milk:       { skill: "cattle",     inputs: {},                          output: { milk: 3 },        tool: false, location: "Farm 2" },
  meat:       { skill: "cattle",     inputs: {},                          output: { meat: 2 },        tool: true,  location: "Farm 2" },
  eggs:       { skill: "farmer",     inputs: {},                          output: { eggs: 2 },        tool: false, location: "Farm 3" },
  vegetables: { skill: "farmer",     inputs: {},                          output: { vegetables: 3 },  tool: true,  location: "Farm 3" },
  flour:      { skill: "miller",     inputs: { wheat: 3 },               output: { flour: 2 },       tool: false, location: "Mill" },
  bread:      { skill: "baker",      inputs: { flour: 1 },               output: { bread: 4 },       tool: false, location: "Bakery" },
  iron_tools: { skill: "blacksmith", inputs: { iron_ore: 2, coal: 1 },   output: { iron_tools: 1 }, tool: false, location: "Forge" },
  furniture:  { skill: "carpenter",  inputs: { timber: 3 },              output: { furniture: 1 },   tool: true,  location: "Carpenter Shop" },
  medicine:   { skill: "healer",     inputs: { herbs: 3 },               output: { medicine: 1 },    tool: false, location: "Healer's Hut" },
  ale:        { skill: "tavern",     inputs: { wheat: 2 },               output: { ale: 4 },         tool: false, location: "Tavern" },
  meal:       { skill: "tavern",     inputs: { meat: 1, vegetables: 1 }, output: { meal: 3 },        tool: false, location: "Tavern" },
  cloth:      { skill: "seamstress", inputs: {},                          output: { cloth: 1 },       tool: false, location: "Seamstress Cottage" },
  timber:     { skill: "woodcutter", inputs: {},                          output: { timber: 3 },      tool: true,  location: "Forest" },
  firewood:   { skill: "woodcutter", inputs: {},                          output: { firewood: 4 },    tool: true,  location: "Forest" },
  herbs:      { skill: "healer",     inputs: {},                          output: { herbs: 2 },       tool: false, location: "Forest" },
  iron_ore:   { skill: "miner",      inputs: {},                          output: { iron_ore: 3 },    tool: true,  location: "Mine" },
  coal:       { skill: "miner",      inputs: {},                          output: { coal: 2 },        tool: true,  location: "Mine" },
};

// Farmers can work on Farm 1, 2, or 3 for general farm produce
export const MULTI_FARM_ITEMS: Partial<Record<string, string[]>> = {
  wheat:      ["Farm 1", "Farm 2", "Farm 3"],
  vegetables: ["Farm 1", "Farm 2", "Farm 3"],
  eggs:       ["Farm 1", "Farm 2", "Farm 3"],
  herbs:      ["Forest"],
};

/** Returns all producible items for a given skill with their input requirements and required location. */
export function getProducibleItems(skill: string): { item: string; inputs: Record<string, number>; location: string }[] {
  return Object.entries(RECIPES)
    .filter(([, r]) => r.skill === skill)
    .map(([item, r]) => ({ item, inputs: r.inputs as Record<string, number>, location: r.location }));
}

function getHiredLaborer(employer: AgentName, state: WorldState): AgentName | null {
  for (const a of getAgentNames()) {
    if (state.economics[a].hiredBy === employer) return a;
  }
  return null;
}

export function resolveProduction(
  results: AgentTurnResult[],
  state: WorldState,
  time: SimTime,
): void {
  const producedThisTick = new Set<AgentName>();
  for (const result of results) {
    for (const action of result.actions) {
      if (action.type !== "produce") continue;

      const agent = result.agent;

      if (producedThisTick.has(agent)) {
        feedbackToAgent(agent, state, `[Can't produce] Already produced this tick. One production per hour.`);
        continue;
      }
      const eco = state.economics[agent];
      const itemKey = action.item as string;
      const recipe = RECIPES[itemKey];

      if (!recipe) {
        feedbackToAgent(agent, state, `[Can't do that] No recipe for "${itemKey}".`);
        continue;
      }

      if (eco.skill !== recipe.skill) {
        // Allow hired laborers to produce using their employer's skill
        const employer = eco.hiredBy ? state.economics[eco.hiredBy] : null;
        if (!employer || employer.skill !== recipe.skill) {
          feedbackToAgent(agent, state, `[Can't do that] You don't have the ${recipe.skill} skill.`);
          continue;
        }
      }

      const currentLocation = state.agent_locations[agent];
      const validLocations = MULTI_FARM_ITEMS[itemKey] ?? [recipe.location];
      const currentLocType = getLocationType(currentLocation);
      const atValidLocation = validLocations.includes(currentLocation) ||
        (currentLocType != null &&
         validLocations.some(vl => getLocationType(vl) === currentLocType));
      if (!atValidLocation) {
        feedbackToAgent(agent, state, `[Can't do that] You must be at ${recipe.location} to produce ${itemKey}.`);
        continue;
      }

      if (recipe.tool && (!eco.tool || eco.tool.durability <= 0)) {
        feedbackToAgent(agent, state, `[Can't do that] You need working iron tools to produce ${itemKey}.`);
        continue;
      }

      let inputsFailed = false;
      for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
        const have = getInventoryQty(eco.inventory, inputItem as ItemType);
        if (have < qty) {
          feedbackToAgent(agent, state, `[Can't do that] Need ${qty} ${inputItem} but only have ${have}.`);
          inputsFailed = true;
          break;
        }
      }
      if (inputsFailed) continue;

      // Consume inputs
      for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
        removeFromInventory(eco.inventory, inputItem as ItemType, qty);
      }

      // Tool degradation on use
      if (recipe.tool && eco.tool) {
        eco.tool.durability = Math.max(0, eco.tool.durability - 3);
      }

      // Season multiplier
      const outputItem = Object.keys(recipe.output)[0] as ItemType;
      const baseQty = Object.values(recipe.output)[0]!;
      const multiplier = getSeasonMultiplier(outputItem, state.season);
      const eventMultiplier = getEventProductionMultiplier(outputItem, state.active_events);

      if (multiplier === 0 || eventMultiplier === 0) {
        const reason = eventMultiplier === 0
          ? `[Can't produce] ${outputItem} production is blocked by a village event.`
          : `[Can't do that] You can't produce ${outputItem} in ${state.season}.`;
        feedbackToAgent(agent, state, reason);
        // Restore consumed inputs
        for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
          addToInventory(eco.inventory, inputItem as ItemType, qty);
        }
        continue;
      }

      // Laborer routing
      const isLaborer = !!eco.hiredBy;
      const laborerWorking = !isLaborer ? getHiredLaborer(agent, state) : null;
      const laborBonus = laborerWorking ? 1.5 : 1.0;
      const outputTarget = isLaborer ? eco.hiredBy! : agent;

      const qty = Math.floor(baseQty * multiplier * laborBonus * eventMultiplier);
      addToInventory(state.economics[outputTarget].inventory, outputItem, qty, time.tick);
      producedThisTick.add(agent);

      // Track for economy snapshots
      state.production_log.push({ tick: time.tick, agent, item: outputItem, qty });

      feedbackToAgent(agent, state, `Produced ${qty} ${outputItem}${isLaborer ? ` (delivered to ${outputTarget})` : ""}.`);
      if (isLaborer) {
        feedbackToAgent(outputTarget as AgentName, state, `${agent} delivered ${qty} ${outputItem} to your inventory.`);
      }
    }
  }
}
