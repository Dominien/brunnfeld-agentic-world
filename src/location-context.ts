import type { AgentName } from "./types.js";

export interface SpeechEntry {
  agentId: AgentName;
  name: string;
  text: string;
}

export interface VisibleAction {
  agentId: AgentName;
  name: string;
  type: string;
  summary: string;
}

export interface NegotiationOffer {
  from: AgentName;
  fromName: string;
  to: AgentName;
  item: string;
  price: number;
  qty: number;
}

export interface LocationContext {
  location: string;
  speechLog: SpeechEntry[];
  visibleActions: VisibleAction[];
  negotiationOffers: NegotiationOffer[];
}

export function createLocationContext(location: string): LocationContext {
  return {
    location,
    speechLog: [],
    visibleActions: [],
    negotiationOffers: [],
  };
}
