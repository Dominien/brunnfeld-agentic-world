import type { AgentName, AgentTurnResult, ItemType, WorldState, SimTime } from "./types.js";
import { getInventoryQty, removeFromInventory, addToInventory, feedbackToAgent, unreserveInventory } from "./inventory.js";
import { updatePriceIndex } from "./marketplace.js";

interface BarterOffer {
  offerer: AgentName;
  receiver: AgentName;
  offerItems: { item: ItemType; quantity: number }[];
  requestItems: { item: ItemType; quantity: number }[];
  text: string;
}

const BARTER_KEYWORDS = ["trade", "barter", "deal", "exchange", "give you", "swap", "i'll give", "i will give", "offer you"];
const ACCEPT_KEYWORDS = ["deal", "agreed", "fine", "ok", "yes", "accept", "done", "sure", "i agree", "sounds good"];

const ITEM_WORDS: Record<string, ItemType> = {
  wheat: "wheat", flour: "flour", bread: "bread", meat: "meat", milk: "milk",
  eggs: "eggs", egg: "eggs", vegetables: "vegetables", veg: "vegetables",
  herbs: "herbs", herb: "herbs", medicine: "medicine",
  "iron ore": "iron_ore", ore: "iron_ore", coal: "coal",
  "iron tools": "iron_tools", tools: "iron_tools",
  timber: "timber", firewood: "firewood", wood: "timber",
  furniture: "furniture", ale: "ale", meal: "meal", cloth: "cloth",
};

function parseItemsFromText(text: string): { item: ItemType; quantity: number }[] {
  const lower = text.toLowerCase();
  const results: { item: ItemType; quantity: number }[] = [];

  for (const [word, itemType] of Object.entries(ITEM_WORDS)) {
    const pattern = new RegExp(`(\\d+)\\s+${word}|${word}\\s+(\\d+)|(a|an|one|some)\\s+${word}`, "i");
    const match = pattern.exec(lower);
    if (match) {
      const qtyStr = match[1] || match[2];
      const qty = qtyStr ? parseInt(qtyStr) : 1;
      if (!results.find(r => r.item === itemType)) {
        results.push({ item: itemType, quantity: qty });
      }
    }
  }

  return results;
}

function isBarterOffer(text: string): boolean {
  const lower = text.toLowerCase();
  return BARTER_KEYWORDS.some(k => lower.includes(k));
}

function isAcceptance(text: string): boolean {
  const lower = text.toLowerCase();
  return ACCEPT_KEYWORDS.some(k => lower.includes(k));
}

export function resolveBarter(
  results: AgentTurnResult[],
  state: WorldState,
  time: SimTime,
): void {
  // Collect all speech this tick by location
  const speechByAgent: Record<AgentName, string[]> = {} as Record<AgentName, string[]>;
  for (const result of results) {
    speechByAgent[result.agent] = result.actions
      .filter(a => a.type === "speak" && a.text)
      .map(a => a.text!);
  }

  // Look for barter offers + same-tick acceptances
  for (const result of results) {
    const offerer = result.agent;
    const offererLocation = state.agent_locations[offerer];

    for (const speech of speechByAgent[offerer] ?? []) {
      if (!isBarterOffer(speech)) continue;

      const offerItems = parseItemsFromText(speech);
      if (offerItems.length === 0) continue;

      // Find who they might be offering to: agents at same location
      const nearby = results
        .filter(r => r.agent !== offerer && state.agent_locations[r.agent] === offererLocation)
        .map(r => r.agent);

      for (const receiver of nearby) {
        // Check if receiver accepted
        const receiverSpeech = (speechByAgent[receiver] ?? []).join(" ");
        if (!isAcceptance(receiverSpeech)) continue;

        const requestItems = parseItemsFromText(receiverSpeech);
        if (requestItems.length === 0) continue;

        // Validate both have the items
        let valid = true;
        for (const { item, quantity } of offerItems) {
          if (getInventoryQty(state.economics[offerer].inventory, item) < quantity) {
            feedbackToAgent(offerer, state, `[Barter failed] You don't have enough ${item}.`);
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        for (const { item, quantity } of requestItems) {
          if (getInventoryQty(state.economics[receiver].inventory, item) < quantity) {
            feedbackToAgent(receiver, state, `[Barter failed] You don't have enough ${item}.`);
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        // Execute swap — unreserve first so sell orders don't leave ghost reservations
        for (const { item, quantity } of offerItems) {
          unreserveInventory(offerer, item, quantity, state);
          removeFromInventory(state.economics[offerer].inventory, item, quantity);
          addToInventory(state.economics[receiver].inventory, item, quantity, time.tick);
        }
        for (const { item, quantity } of requestItems) {
          unreserveInventory(receiver, item, quantity, state);
          removeFromInventory(state.economics[receiver].inventory, item, quantity);
          addToInventory(state.economics[offerer].inventory, item, quantity, time.tick);
        }

        const offerStr = offerItems.map(i => `${i.quantity} ${i.item}`).join(", ");
        const requestStr = requestItems.map(i => `${i.quantity} ${i.item}`).join(", ");
        feedbackToAgent(offerer, state, `Barter completed: gave ${offerStr}, received ${requestStr}.`);
        feedbackToAgent(receiver, state, `Barter completed: gave ${requestStr}, received ${offerStr}.`);

        // Update price index for both sides
        for (const { item } of [...offerItems, ...requestItems]) {
          updatePriceIndex(state.marketplace, item, state.marketplace.priceIndex[item] ?? 1);
        }

        // Push to trade history
        state.marketplace.history.push({
          id: `barter_${time.tick}_${offerer}_${receiver}`,
          tick: time.tick,
          buyer: receiver,
          seller: offerer,
          item: offerItems[0]!.item,
          quantity: offerItems[0]!.quantity,
          pricePerUnit: 0,
          total: 0,
        });
      }
    }
  }
}
