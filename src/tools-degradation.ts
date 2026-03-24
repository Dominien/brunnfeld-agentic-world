import type { AgentName, WorldState } from "./types.js";
import { getAgentNames } from "./world-registry.js";
import { getInventoryQty, removeFromInventory, feedbackToAgent } from "./inventory.js";

// Called at dawn: break tools that hit 0, inject feedback
export function degradeTools(state: WorldState): void {
  for (const agent of getAgentNames()) {
    const eco = state.economics[agent];
    if (!eco.tool) continue;
    if (eco.tool.durability <= 0) {
      eco.tool = null;
      feedbackToAgent(agent, state, "Your iron tools broke. You need new ones to work efficiently.");
    }
  }
}

// Called after degradeTools: equip from inventory if tool is missing and stock available
export function autoEquipTools(state: WorldState): void {
  for (const agent of getAgentNames()) {
    const eco = state.economics[agent];
    if (eco.tool && eco.tool.durability > 0) continue;
    const hasStock = getInventoryQty(eco.inventory, "iron_tools") > 0;
    if (!hasStock) continue;
    removeFromInventory(eco.inventory, "iron_tools", 1);
    eco.tool = { type: "iron_tools", durability: 100 };
    feedbackToAgent(agent, state, "You equipped a fresh set of iron tools from your stock.");
  }
}

export function getToolPerception(agent: AgentName, state: WorldState): string {
  const eco = state.economics[agent];
  if (!eco.tool) return "(no tools — tool-requiring production halved)";
  if (eco.tool.durability <= 20) return `Iron tools (${eco.tool.durability}/100) — nearly broken!`;
  return `Iron tools (${eco.tool.durability}/100)`;
}
