#!/usr/bin/env node
/**
 * World Generator for Brunnfeld
 *
 * Usage:
 *   node dist/generate-world.js                           # 1 village, 19 hardcoded agents
 *   node dist/generate-world.js --villages=2              # 2 villages × 19 agents each
 *   node dist/generate-world.js --villages=3 --agents=30  # 3 villages × 30 agents
 *   node dist/generate-world.js --seed=42                 # deterministic output
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type {
  WorldState, AgentEconomicState, BodyState, Marketplace, Skill, ItemType,
} from "./types.js";
import {
  AGENT_NAMES, AGENT_DISPLAY_NAMES, AGENT_SKILLS, AGENT_WORK_LOCATIONS, AGENT_HOMES,
  COUNCIL_MEMBERS, ALL_ITEMS,
} from "./types.js";
import { LOCATIONS, ADJACENCY, OPENING_HOURS, LOCATION_TILES } from "./village-map.js";
import type { WorldConfig, VillageConfig, AgentConfig, RoadConfig } from "./world-registry.js";

const DATA_DIR = join(process.cwd(), "data");
const DEFAULT_PRICE_INDEX: Record<ItemType, number> = {
  wheat: 2, flour: 5, bread: 3, meat: 8, milk: 2,
  iron_tools: 15, coal: 3, iron_ore: 4, timber: 3, firewood: 2,
  herbs: 1, medicine: 10, ale: 3, meal: 6, cloth: 5,
  furniture: 12, eggs: 1, vegetables: 2,
};

// ─── Seeded PRNG ──────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 0x100000000;
  };
}

// ─── Name pools ───────────────────────────────────────────────

const MALE_NAMES = [
  // original pool
  "Albrecht", "Arnold", "Balthazar", "Bernd", "Bruno", "Burkhard", "Casimir",
  "Clemens", "Conrad", "Dietmar", "Dietrich", "Eberhard", "Eckart", "Edmund",
  "Ernst", "Erwin", "Felix", "Ferdinand", "Florian", "Franz", "Georg", "Gerard",
  "Gerhard", "Gottfried", "Gottlieb", "Gregor", "Gunter", "Gustav", "Hannes",
  "Helmut", "Herbert", "Herman", "Hugo", "Ignaz", "Jakob", "Johann", "Jonas",
  "Josef", "Karl", "Kaspar", "Klaus", "Leonhard", "Leopold", "Lorenz", "Lucas",
  "Ludwig", "Magnus", "Martin", "Matthias", "Maximilian", "Michael", "Moritz",
  "Niklas", "Norbert", "Oswald", "Peter", "Philipp", "Ralf", "Reinhold", "Richard",
  "Roland", "Rudolf", "Sebastian", "Sigmund", "Stefan", "Thomas", "Tobias",
  "Viktor", "Wendel", "Werner", "Wilhelm", "Willibald", "Wolfgang", "Xaver",
  // expanded pool
  "Adelbert", "Adalbert", "Adalger", "Adalhard", "Adalbero", "Adalwin",
  "Alcuin", "Aldric", "Alwin", "Amelrich", "Ansgar", "Anshelm", "Aribo",
  "Arnulf", "Aswin", "Balduin", "Baldram", "Barthold", "Baturich", "Benno",
  "Benzo", "Bero", "Berthold", "Bertwin", "Bodo", "Bonifaz", "Bruning",
  "Bucelin", "Chunibert", "Dankmar", "Dankward", "Dankwin", "Detlef", "Diemo",
  "Dietbald", "Dietbert", "Dietger", "Dietlef", "Dietwin", "Diez", "Dominik",
  "Eberwin", "Ebregisil", "Eckhard", "Eginhard", "Egino", "Ekkehard", "Emmerich",
  "Engelbert", "Engelhard", "Engelmar", "Engilbert", "Erbo", "Erhard", "Erich",
  "Erkanbald", "Erkenbald", "Folkbert", "Folkmar", "Folko", "Folkwin", "Forchwin",
  "Fridbert", "Friedmar", "Friedwin", "Frizzo", "Fulco", "Gebhard", "Gerbert",
  "Gerfried", "Germar", "Gerold", "Gero", "Gisbert", "Giselbert", "Gotthard",
  "Gottlob", "Gozwin", "Gozelo", "Grimald", "Grimbert", "Gumbert", "Gunther",
  "Guntram", "Haribert", "Hartmann", "Hartmut", "Hartwig", "Hartwin", "Hatto",
  "Helmbrecht", "Helmger", "Helmold", "Helmwin", "Herborg", "Heriger", "Hermann",
  "Herwig", "Hildebrand", "Hildeger", "Hildigrim", "Hildolf", "Hubertus", "Hucbald",
  "Hunold", "Ingelbert", "Ingelram", "Ingolf", "Ingomar", "Ingulf", "Isanbard",
  "Isengrim", "Ivo", "Jordanis", "Konrad", "Kraft", "Kunibald", "Kuno", "Kurt",
  "Lambert", "Lamprecht", "Landbrecht", "Lanzo", "Leodegar", "Liudger", "Liudolf",
  "Liuwin", "Lother", "Luitbert", "Luitpold", "Luitwin", "Madalbert", "Manfred",
  "Marcward", "Markwart", "Meinhard", "Meinolf", "Meinrad", "Meinwerk", "Neidhart",
  "Nikolas", "Nortmann", "Ordulf", "Ortlieb", "Ortwin", "Oswin", "Otger", "Otmar",
  "Otwin", "Pabo", "Peregrin", "Rabanus", "Raimund", "Rainald", "Reginbert",
  "Reginbold", "Reginhar", "Reginmar", "Reginold", "Reginward", "Reinbald",
  "Reinfried", "Reinhard", "Reinmar", "Reinward", "Reinwin", "Rezzo", "Richer",
  "Richwin", "Roderich", "Rotbert", "Ruprecht", "Salomon", "Segesmund", "Sibrand",
  "Siegbert", "Siegfried", "Sieghard", "Siegmar", "Sigibald", "Sigibert", "Sigiwin",
  "Sigisbert", "Sigismund", "Simo", "Theobald", "Theobert", "Theoger", "Thietmar",
  "Thilo", "Ulfried", "Ulwin", "Unwan", "Utto", "Veit", "Volkbert", "Volkmar",
  "Volkwin", "Waldbert", "Waldemar", "Waldfried", "Waldger", "Waldmar", "Walther",
  "Warin", "Wasmund", "Wernher", "Widbert", "Wichmann", "Widulf", "Wigand",
  "Wigbert", "Wilfrid", "Wilfred", "Wilko", "Willram", "Wimbert", "Winfried",
  "Winnibald", "Wipo", "Wolfbert", "Wolfger", "Wolfhard", "Wolfmar", "Wolfram",
  "Wolfwin", "Wulfbert", "Wulfhard",
];

const FEMALE_NAMES = [
  // original pool
  "Adelheid", "Agnes", "Anna", "Barbara", "Berta", "Brigitte", "Cecilia",
  "Christine", "Clara", "Dorothea", "Emma", "Eva", "Franziska", "Frieda",
  "Gisela", "Gretel", "Hedwig", "Helena", "Hildegard", "Ilse", "Ingeborg",
  "Irma", "Johanna", "Josephine", "Kathe", "Klara", "Kunigunde", "Lena",
  "Lotte", "Luise", "Marta", "Mathilde", "Mechthild", "Monika", "Notburga",
  "Ottilie", "Paula", "Petra", "Regina", "Rosalinde", "Sabine", "Sophie",
  "Theresia", "Trude", "Ursula", "Veronika", "Walburga", "Wilhelmine",
  // expanded pool
  "Adela", "Adelburg", "Adelgund", "Adelhild", "Adelmut", "Adeltraud",
  "Adelvera", "Adelvira", "Agathe", "Albrade", "Aleidis", "Alheid", "Alheide",
  "Alide", "Almuth", "Altburg", "Amelgard", "Amelinde", "Ameltraud", "Anngard",
  "Annlinde", "Ansfrid", "Armgard", "Arnhild", "Arntraud", "Athalrat", "Bederun",
  "Berchta", "Berhild", "Bernhild", "Berthild", "Birgitta", "Brunhilde",
  "Christiane", "Cordula", "Cundegund", "Dagmar", "Diemut", "Dietlind",
  "Edwigis", "Egidia", "Eleonore", "Elfriede", "Elsbeth", "Elvira", "Engela",
  "Engelburg", "Engelhild", "Engelmut", "Erdmuth", "Fida", "Fredigard",
  "Friedlind", "Gerlind", "Gerhild", "Gertraud", "Gertrud", "Gilberta",
  "Goldrun", "Gota", "Gotlind", "Gundel", "Gundula", "Hadwigis", "Hadewig",
  "Halla", "Hawis", "Heide", "Heilgard", "Heilwig", "Helmberta", "Herlind",
  "Hildedrud", "Hildegund", "Hildelind", "Hildemut", "Hildetraud", "Hildigund",
  "Hiltrud", "Hroswitha", "Ida", "Inge", "Irmengard", "Irmentrud", "Irmhild",
  "Irmine", "Juta", "Juteke", "Kunhild", "Lamberta", "Leibgart", "Leutgard",
  "Lioba", "Liudgard", "Lora", "Loretta", "Luitgard", "Lutgard", "Mahalda",
  "Mahaut", "Mechthilde", "Mergart", "Meta", "Modesta", "Nele", "Norberta",
  "Nortburga", "Notlind", "Odilia", "Ortlinde", "Petrissa", "Petronella",
  "Radegund", "Raicha", "Rele", "Richildis", "Richenza", "Riquilda", "Rohesia",
  "Roswitha", "Rothild", "Ruthild", "Salome", "Scholastica", "Senke", "Sibilla",
  "Sigrid", "Sibylle", "Stanna", "Tekla", "Thecla", "Theodelinde", "Udelhild",
  "Uta", "Udelinde", "Waldburga", "Wandeltraud", "Werinburg", "Wiburg",
  "Willeburgis", "Wulfhildis", "Wulftraud", "Zeisela",
];

const BYNAMES = [
  "vom Berg", "der Junge", "der Alte", "aus dem Tal", "vom Hof",
  "der Starke", "der Stille", "der Kluge", "am Bach", "am Weg",
  "von der Mühle", "am Markt", "der Frohe", "der Kräftige",
];

const VILLAGE_NAMES = [
  { id: "brunnfeld",  name: "Brunnfeld"  },
  { id: "norddorf",   name: "Norddorf"   },
  { id: "ostheim",    name: "Ostheim"    },
  { id: "westmark",   name: "Westmark"   },
  { id: "suedtal",    name: "Südtal"     },
];

// ─── Skill defaults ───────────────────────────────────────────

interface SkillDefaults {
  wallet: number;
  items: { type: ItemType; quantity: number }[];
  tool: { type: "iron_tools"; durability: number } | null;
  workSchedule: { open: number; close: number };
}

const SKILL_DEFAULTS: Record<Skill, SkillDefaults> = {
  farmer:      { wallet: 20, items: [{ type: "wheat",   quantity: 6 }], tool: { type: "iron_tools", durability: 70 }, workSchedule: { open: 6,  close: 16 } },
  cattle:      { wallet: 35, items: [{ type: "milk",    quantity: 3 }, { type: "meat", quantity: 2 }], tool: { type: "iron_tools", durability: 80 }, workSchedule: { open: 6, close: 15 } },
  miner:       { wallet: 18, items: [{ type: "iron_ore",quantity: 3 }, { type: "coal", quantity: 2 }], tool: { type: "iron_tools", durability: 70 }, workSchedule: { open: 7, close: 17 } },
  woodcutter:  { wallet: 22, items: [{ type: "timber",  quantity: 3 }, { type: "firewood", quantity: 5 }], tool: { type: "iron_tools", durability: 75 }, workSchedule: { open: 6, close: 17 } },
  miller:      { wallet: 40, items: [{ type: "flour",   quantity: 4 }], tool: null, workSchedule: { open: 7, close: 16 } },
  baker:       { wallet: 30, items: [{ type: "bread",   quantity: 5 }, { type: "flour", quantity: 2 }], tool: null, workSchedule: { open: 6, close: 13 } },
  blacksmith:  { wallet: 55, items: [{ type: "iron_ore",quantity: 4 }, { type: "coal", quantity: 3 }], tool: null, workSchedule: { open: 7, close: 16 } },
  carpenter:   { wallet: 35, items: [{ type: "timber",  quantity: 5 }], tool: { type: "iron_tools", durability: 75 }, workSchedule: { open: 7, close: 16 } },
  tavern:      { wallet: 50, items: [{ type: "ale",     quantity: 6 }, { type: "wheat", quantity: 3 }], tool: null, workSchedule: { open: 10, close: 21 } },
  healer:      { wallet: 28, items: [{ type: "herbs",   quantity: 5 }, { type: "medicine", quantity: 2 }], tool: null, workSchedule: { open: 7, close: 17 } },
  seamstress:  { wallet: 30, items: [{ type: "cloth",   quantity: 3 }], tool: null, workSchedule: { open: 7, close: 16 } },
  merchant:    { wallet: 80, items: [], tool: null, workSchedule: { open: 6, close: 21 } },
  none:        { wallet: 15, items: [{ type: "bread",   quantity: 2 }], tool: null, workSchedule: { open: 6, close: 21 } },
};

// ─── Skill → work location ────────────────────────────────────

function workLocationForSkill(skill: Skill, farmIndex: number): string {
  switch (skill) {
    case "farmer":    return farmIndex <= 1 ? "Farm 1" : farmIndex === 2 ? "Farm 2" : "Farm 3";
    case "cattle":    return "Farm 2";
    case "miner":     return "Mine";
    case "woodcutter":return "Forest";
    case "miller":    return "Mill";
    case "baker":     return "Bakery";
    case "blacksmith":return "Forge";
    case "carpenter": return "Carpenter Shop";
    case "tavern":    return "Tavern";
    case "healer":    return "Healer's Hut";
    case "seamstress":return "Seamstress Cottage";
    default:          return "Village Square";
  }
}

// Specialist skills that live at their workplace
const LIVE_AT_WORK: Set<Skill> = new Set(["miller", "baker", "blacksmith", "carpenter", "tavern", "healer", "seamstress", "merchant"]);
const COTTAGE_LOCATIONS = [
  "Cottage 1", "Cottage 2", "Cottage 3", "Cottage 4", "Cottage 5",
  "Cottage 6", "Cottage 7", "Cottage 8", "Cottage 9",
];

// ─── Skill distribution ───────────────────────────────────────

const SPECIALIST_SKILLS: Skill[] = ["miller", "baker", "blacksmith", "carpenter", "tavern", "healer", "seamstress"];
const BULK_SKILL_POOL: { skill: Skill; weight: number }[] = [
  { skill: "farmer",     weight: 36 },
  { skill: "cattle",     weight: 12 },
  { skill: "miner",      weight: 12 },
  { skill: "woodcutter", weight: 9  },
  { skill: "none",       weight: 31 },
];

function pickFromWeighted(pool: { skill: Skill; weight: number }[], rng: () => number): Skill {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = rng() * total;
  for (const p of pool) {
    r -= p.weight;
    if (r <= 0) return p.skill;
  }
  return pool[pool.length - 1]!.skill;
}

function buildAgentSkills(count: number, rng: () => number): Skill[] {
  const skills: Skill[] = [];
  // Always include one of each specialist
  for (const s of SPECIALIST_SKILLS) {
    if (skills.length < count) skills.push(s);
  }
  // Fill remaining from bulk pool
  while (skills.length < count) {
    skills.push(pickFromWeighted(BULK_SKILL_POOL, rng));
  }
  // Shuffle
  for (let i = skills.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [skills[i], skills[j]] = [skills[j]!, skills[i]!];
  }
  return skills;
}

// ─── Agent name generation ────────────────────────────────────

function generateAgentNames(count: number, rng: () => number, globalUsed: Set<string> = new Set()): { id: string; displayName: string }[] {
  const allFirstNames = [...MALE_NAMES, ...FEMALE_NAMES];
  const result: { id: string; displayName: string }[] = [];

  // Shuffle name pool
  const shuffled = [...allFirstNames];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  let nameIdx = 0;
  let bynameIdx = 0;

  for (let i = 0; i < count; i++) {
    let displayName: string;
    let id: string;

    if (nameIdx < shuffled.length) {
      displayName = shuffled[nameIdx++]!;
      id = displayName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/__+/g, "_");
    } else {
      // Need byname disambiguation
      const base = shuffled[i % shuffled.length]!;
      const byname = BYNAMES[bynameIdx % BYNAMES.length]!;
      bynameIdx++;
      displayName = `${base} ${byname}`;
      id = displayName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/__+/g, "_");
    }

    // Handle ID collisions (checked globally across all villages)
    let finalId = id;
    let suffix = 2;
    while (globalUsed.has(finalId)) {
      finalId = `${id}_${suffix++}`;
    }
    globalUsed.add(finalId);
    result.push({ id: finalId, displayName });
  }

  return result;
}

// ─── Location building ────────────────────────────────────────

function prefixLoc(name: string, villageName: string): string {
  return `${villageName}:${name}`;
}

function buildVillageLocations(villageName: string): string[] {
  if (villageName === "Brunnfeld") return [...LOCATIONS];
  return (LOCATIONS as readonly string[]).map(loc => prefixLoc(loc, villageName));
}

function buildVillageAdjacency(villageName: string): Record<string, string[]> {
  if (villageName === "Brunnfeld") return { ...ADJACENCY };
  const adj: Record<string, string[]> = {};
  for (const [loc, neighbors] of Object.entries(ADJACENCY)) {
    adj[prefixLoc(loc, villageName)] = neighbors.map(n => prefixLoc(n, villageName));
  }
  return adj;
}

function buildVillageOpeningHours(villageName: string): Partial<Record<string, { open: number; close: number }>> {
  if (villageName === "Brunnfeld") return { ...OPENING_HOURS };
  const hours: Partial<Record<string, { open: number; close: number }>> = {};
  for (const [loc, h] of Object.entries(OPENING_HOURS)) {
    hours[prefixLoc(loc, villageName)] = h;
  }
  return hours;
}

function buildVillageLocationTypes(villageName: string): Record<string, string> {
  const TYPE_MAP: Record<string, string> = {
    "Village Square": "square", "Bakery": "bakery", "Tavern": "tavern",
    "Forge": "forge", "Carpenter Shop": "carpenter", "Mill": "mill",
    "Town Hall": "townhall", "Prison": "prison", "Elder's House": "elder",
    "Seamstress Cottage": "seamstress", "Healer's Hut": "healer",
    "Farm 1": "farm", "Farm 2": "farm", "Farm 3": "farm",
    "Forest": "forest", "Mine": "mine", "Merchant Camp": "merchant",
  };
  const locs = LOCATIONS as readonly string[];
  const out: Record<string, string> = {};
  for (const loc of locs) {
    const t = TYPE_MAP[loc];
    if (t) {
      const key = villageName === "Brunnfeld" ? loc : prefixLoc(loc, villageName);
      out[key] = t;
    }
    if (/Cottage \d/.test(loc)) {
      const key = villageName === "Brunnfeld" ? loc : prefixLoc(loc, villageName);
      out[key] = "cottage";
    }
  }
  return out;
}

function resolveLocName(bare: string, villageName: string): string {
  return villageName === "Brunnfeld" ? bare : prefixLoc(bare, villageName);
}

// ─── Agent config building ────────────────────────────────────

interface AgentBuildSpec {
  id: string;
  displayName: string;
  skill: Skill;
  homeLocation: string;
  workLocation: string;
  description: string;
}

function buildAgentSpec(
  id: string,
  displayName: string,
  skill: Skill,
  villageName: string,
  farmCounter: { n: number },
  cottageCounter: { n: number },
): AgentBuildSpec {
  let bareWork = workLocationForSkill(skill, farmCounter.n);
  if (skill === "farmer") farmCounter.n++;

  const bareHome = LIVE_AT_WORK.has(skill)
    ? bareWork
    : COTTAGE_LOCATIONS[cottageCounter.n++ % COTTAGE_LOCATIONS.length]!;

  const workLocation = resolveLocName(bareWork, villageName);
  const homeLocation = resolveLocName(bareHome, villageName);

  const SKILL_DESC: Record<Skill, string> = {
    farmer: "a farmer", cattle: "a cattle farmer", miner: "a miner",
    woodcutter: "a woodcutter", miller: "the miller", baker: "the baker",
    blacksmith: "the blacksmith", carpenter: "the carpenter", tavern: "the tavern keeper",
    healer: "the village healer", seamstress: "the seamstress", merchant: "a merchant",
    none: "a villager",
  };

  return {
    id, displayName, skill,
    homeLocation, workLocation,
    description: SKILL_DESC[skill],
  };
}

// ─── Initial economics / body ─────────────────────────────────

function initialEconomics(spec: AgentBuildSpec, villageId: string): AgentEconomicState {
  const d = SKILL_DEFAULTS[spec.skill];
  return {
    wallet: d.wallet,
    inventory: { items: d.items.map(i => ({ ...i })) },
    tool: d.tool ? { ...d.tool } : null,
    skill: spec.skill,
    homeLocation: spec.homeLocation,
    workLocation: spec.workLocation,
    workSchedule: { ...d.workSchedule },
    villageId,
  };
}

function initialBody(rng: () => number): BodyState {
  const hunger = rng() < 0.2 ? 2 : 1;
  const energy = 7 + Math.floor(rng() * 3); // 7–9
  const sq = rng() < 0.5 ? "good" : "fair";
  return { hunger, energy, sleep_quality: sq };
}

function emptyMarketplace(): Marketplace {
  return {
    orders: [],
    history: [],
    priceIndex: { ...DEFAULT_PRICE_INDEX },
    priceHistory: Object.fromEntries(ALL_ITEMS.map(i => [i, []])) as Record<string, []>,
  };
}

// ─── Profile / memory stubs ───────────────────────────────────

function profileStub(displayName: string, skill: Skill, villageName: string, workLocation: string): string {
  const SKILL_INTRO: Record<Skill, string> = {
    farmer: `${displayName} is a farmer in ${villageName}, working the fields at ${workLocation}.\n\nA hardworking soul who knows the rhythm of the seasons, ${displayName} cares above all about a good harvest and fair prices at the market.`,
    cattle: `${displayName} tends cattle in ${villageName} at ${workLocation}.\n\nRaising animals is slow work but steady, and ${displayName} takes pride in the quality of the milk and meat the farm produces.`,
    miner: `${displayName} works the mine in ${villageName}.\n\nLife underground is dangerous and dark, but iron ore and coal feed the whole village's tools and hearths, and ${displayName} knows the value of that.`,
    woodcutter: `${displayName} chops wood in the forest near ${villageName}.\n\nTimber and firewood keep homes warm through winter; ${displayName} has a strong back and a steady axe.`,
    miller: `${displayName} runs the mill in ${villageName}.\n\nGrain into flour — the mill is the hinge on which the whole village turns, and ${displayName} knows it.`,
    baker: `${displayName} keeps the bakery in ${villageName} running before anyone else is awake.\n\nFresh bread every morning is a simple gift, but ${displayName} takes genuine pride in it.`,
    blacksmith: `${displayName} works the forge in ${villageName}.\n\nIron tools are the lifeblood of every farmer, miner, and woodcutter here; ${displayName} is essential — and occasionally reminds people of it.`,
    carpenter: `${displayName} is the carpenter in ${villageName}, working from ${workLocation}.\n\nFurniture, repairs, structures — without skilled woodwork a village falls apart, and ${displayName} keeps it together.`,
    tavern: `${displayName} runs the tavern in ${villageName}.\n\nAle and meals, gossip and warmth — the tavern is where ${villageName} comes to breathe, and ${displayName} is at the center of it all.`,
    healer: `${displayName} is the healer in ${villageName}.\n\nHerbs and patience, calm hands and hard knowledge — ${displayName} tends the sick and hopes the plague rumors stay rumors.`,
    seamstress: `${displayName} sews cloth into clothing in ${villageName}.\n\nA steady hand and an eye for fabric — ${displayName} is who the village turns to when winter is coming and the old coat won't last.`,
    merchant: `${displayName} is a traveling merchant based in ${villageName}.\n\nBuying low, selling high, moving goods between places that need them — ${displayName} has a nose for opportunity.`,
    none: `${displayName} lives in ${villageName}, doing whatever work comes along.\n\nNot tied to a single trade, ${displayName} gets by on adaptability and a willingness to help.`,
  };
  return `# ${displayName}\n\n${SKILL_INTRO[skill]}\n`;
}

function memoryStub(displayName: string): string {
  return `# ${displayName}\n\n## People\n*(Nobody known yet)*\n\n## Experiences\n*(Nothing yet)*\n\n## Important\n*(Nothing)*\n`;
}

// ─── Build 1-village default world ───────────────────────────

function buildDefaultWorldConfig(): WorldConfig {
  const agents: AgentConfig[] = [...AGENT_NAMES, "player"].map(id => {
    const skill = AGENT_SKILLS[id] ?? "none";
    const SKILL_DESC: Record<string, string> = {
      hans: "a farmer", ida: "a woman from the cottages", konrad: "a cattle farmer",
      ulrich: "a farmer", bertram: "a farmer", gerda: "the miller",
      anselm: "the baker", volker: "the blacksmith", wulf: "the carpenter",
      liesel: "the tavern keeper", sybille: "the village healer", friedrich: "a woodcutter",
      otto: "the village elder", pater_markus: "the village priest",
      dieter: "a miner", magda: "a villager", heinrich: "a farmer",
      elke: "the seamstress", rupert: "a miner", player: "a newcomer to the village",
    };
    return {
      id,
      displayName: AGENT_DISPLAY_NAMES[id] ?? id,
      skill,
      homeLocation: AGENT_HOMES[id] ?? "Village Square",
      workLocation: AGENT_WORK_LOCATIONS[id] ?? "Village Square",
      description: SKILL_DESC[id] ?? "a villager",
    };
  });

  const locationTypes: Record<string, string> = {};
  for (const [loc, t] of Object.entries(buildVillageLocationTypes("Brunnfeld"))) {
    locationTypes[loc] = t;
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

function buildDefaultWorldState(): WorldState {
  const allAgents = [...AGENT_NAMES, "player"];
  const emptyRecord = <T>(fn: (a: string) => T): Record<string, T> =>
    Object.fromEntries(allAgents.map(a => [a, fn(a)]));

  return {
    current_tick: 0,
    current_time: "Simulation not started",
    season: "spring",
    day_of_season: 1,
    weather: "Mild, 12°C, partly cloudy",
    active_events: [],

    agent_locations: {
      hans: "Cottage 1", ida: "Cottage 2", konrad: "Farm 2",
      ulrich: "Cottage 4", bertram: "Cottage 5", gerda: "Mill",
      anselm: "Bakery", volker: "Forge", wulf: "Carpenter Shop",
      liesel: "Tavern", sybille: "Healer's Hut", friedrich: "Cottage 7",
      otto: "Elder's House", pater_markus: "Town Hall",
      dieter: "Cottage 8", magda: "Cottage 8", heinrich: "Cottage 1",
      elke: "Seamstress Cottage", rupert: "Cottage 3", player: "Village Square",
    },

    body: {
      hans:         { hunger: 1, energy: 9, sleep_quality: "good" },
      ida:          { hunger: 1, energy: 8, sleep_quality: "fair" },
      konrad:       { hunger: 2, energy: 8, sleep_quality: "good" },
      ulrich:       { hunger: 1, energy: 9, sleep_quality: "good" },
      bertram:      { hunger: 2, energy: 7, sleep_quality: "fair" },
      gerda:        { hunger: 1, energy: 9, sleep_quality: "good" },
      anselm:       { hunger: 0, energy: 8, sleep_quality: "good" },
      volker:       { hunger: 2, energy: 9, sleep_quality: "good" },
      wulf:         { hunger: 1, energy: 8, sleep_quality: "fair" },
      liesel:       { hunger: 1, energy: 7, sleep_quality: "fair" },
      sybille:      { hunger: 1, energy: 9, sleep_quality: "good" },
      friedrich:    { hunger: 2, energy: 9, sleep_quality: "good" },
      otto:         { hunger: 1, energy: 7, sleep_quality: "fair" },
      pater_markus: { hunger: 1, energy: 8, sleep_quality: "good" },
      dieter:       { hunger: 2, energy: 8, sleep_quality: "fair" },
      magda:        { hunger: 1, energy: 8, sleep_quality: "good" },
      heinrich:     { hunger: 1, energy: 9, sleep_quality: "good" },
      elke:         { hunger: 1, energy: 8, sleep_quality: "fair" },
      rupert:       { hunger: 2, energy: 9, sleep_quality: "good" },
      player:       { hunger: 0, energy: 8, sleep_quality: "good" },
    },

    economics: {
      hans:         { wallet: 30, inventory: { items: [{ type: "wheat", quantity: 8 }] }, tool: { type: "iron_tools", durability: 80 }, skill: "farmer",     homeLocation: "Cottage 1",        workLocation: "Farm 1",           workSchedule: { open: 6,  close: 16 } },
      ida:          { wallet: 12, inventory: { items: [{ type: "cloth", quantity: 2 }] }, tool: null, skill: "none",       homeLocation: "Cottage 2",        workLocation: "Cottage 2",        workSchedule: { open: 6,  close: 21 } },
      konrad:       { wallet: 40, inventory: { items: [{ type: "milk",  quantity: 3 }, { type: "meat",  quantity: 2 }] }, tool: { type: "iron_tools", durability: 90 }, skill: "cattle",    homeLocation: "Farm 2",           workLocation: "Farm 2",           workSchedule: { open: 6,  close: 15 } },
      ulrich:       { wallet: 20, inventory: { items: [{ type: "vegetables", quantity: 4 }] }, tool: { type: "iron_tools", durability: 70 }, skill: "farmer",     homeLocation: "Cottage 4",        workLocation: "Farm 3",           workSchedule: { open: 6,  close: 16 } },
      bertram:      { wallet: 15, inventory: { items: [{ type: "wheat", quantity: 5 }] }, tool: { type: "iron_tools", durability: 60 }, skill: "farmer",     homeLocation: "Cottage 5",        workLocation: "Farm 1",           workSchedule: { open: 6,  close: 16 } },
      gerda:        { wallet: 45, inventory: { items: [{ type: "flour", quantity: 4 }] }, tool: null, skill: "miller",     homeLocation: "Mill",             workLocation: "Mill",             workSchedule: { open: 7,  close: 16 } },
      anselm:       { wallet: 32, inventory: { items: [{ type: "bread", quantity: 6 }, { type: "flour", quantity: 2 }] }, tool: null, skill: "baker",      homeLocation: "Bakery",           workLocation: "Bakery",           workSchedule: { open: 6,  close: 13 } },
      volker:       { wallet: 60, inventory: { items: [{ type: "iron_ore", quantity: 4 }, { type: "coal", quantity: 3 }] }, tool: null, skill: "blacksmith", homeLocation: "Forge",            workLocation: "Forge",            workSchedule: { open: 7,  close: 16 } },
      wulf:         { wallet: 35, inventory: { items: [{ type: "timber", quantity: 5 }] }, tool: { type: "iron_tools", durability: 75 }, skill: "carpenter",  homeLocation: "Carpenter Shop",   workLocation: "Carpenter Shop",   workSchedule: { open: 7,  close: 16 } },
      liesel:       { wallet: 55, inventory: { items: [{ type: "ale",   quantity: 6 }, { type: "wheat", quantity: 4 }] }, tool: null, skill: "tavern",     homeLocation: "Tavern",           workLocation: "Tavern",           workSchedule: { open: 10, close: 21 } },
      sybille:      { wallet: 28, inventory: { items: [{ type: "herbs", quantity: 5 }, { type: "medicine", quantity: 2 }] }, tool: null, skill: "healer",     homeLocation: "Healer's Hut",     workLocation: "Healer's Hut",     workSchedule: { open: 7,  close: 17 } },
      friedrich:    { wallet: 22, inventory: { items: [{ type: "timber", quantity: 3 }, { type: "firewood", quantity: 6 }] }, tool: { type: "iron_tools", durability: 85 }, skill: "woodcutter", homeLocation: "Cottage 7",        workLocation: "Forest",           workSchedule: { open: 6,  close: 17 } },
      otto:         { wallet: 120, inventory: { items: [] }, tool: null, skill: "none",     homeLocation: "Elder's House",    workLocation: "Elder's House",    workSchedule: { open: 6,  close: 21 } },
      pater_markus: { wallet: 25, inventory: { items: [] }, tool: null, skill: "none",     homeLocation: "Town Hall",        workLocation: "Town Hall",        workSchedule: { open: 6,  close: 21 } },
      dieter:       { wallet: 18, inventory: { items: [{ type: "iron_ore", quantity: 2 }, { type: "coal", quantity: 1 }] }, tool: { type: "iron_tools", durability: 65 }, skill: "miner",      homeLocation: "Cottage 8",        workLocation: "Mine",             workSchedule: { open: 7,  close: 17 } },
      magda:        { wallet: 10, inventory: { items: [{ type: "bread", quantity: 2 }] }, tool: null, skill: "none",     homeLocation: "Cottage 8",        workLocation: "Village Square",   workSchedule: { open: 6,  close: 21 } },
      heinrich:     { wallet: 25, inventory: { items: [{ type: "wheat", quantity: 6 }, { type: "eggs", quantity: 3 }] }, tool: { type: "iron_tools", durability: 55 }, skill: "farmer",     homeLocation: "Cottage 1",        workLocation: "Farm 1",           workSchedule: { open: 6,  close: 16 } },
      elke:         { wallet: 30, inventory: { items: [{ type: "cloth", quantity: 3 }] }, tool: null, skill: "seamstress", homeLocation: "Seamstress Cottage", workLocation: "Seamstress Cottage", workSchedule: { open: 7, close: 16 } },
      rupert:       { wallet: 20, inventory: { items: [{ type: "iron_ore", quantity: 3 }, { type: "coal", quantity: 2 }] }, tool: { type: "iron_tools", durability: 80 }, skill: "miner",      homeLocation: "Cottage 3",        workLocation: "Mine",             workSchedule: { open: 7,  close: 17 } },
      player:       { wallet: 0,  inventory: { items: [] }, tool: null, skill: "none",     homeLocation: "Village Square",   workLocation: "Village Square",   workSchedule: { open: 6,  close: 21 } },
    },

    marketplace: emptyMarketplace(),

    doors: Object.fromEntries([
      "Cottage 1", "Cottage 2", "Cottage 3", "Cottage 4", "Cottage 5",
      "Cottage 6", "Cottage 7", "Cottage 8", "Cottage 9",
      "Seamstress Cottage", "Healer's Hut", "Bakery", "Tavern", "Forge",
      "Carpenter Shop", "Mill", "Town Hall", "Prison", "Elder's House",
      "Farm 1", "Farm 2", "Farm 3",
    ].map(loc => [loc, "unlocked"])),

    message_queue: emptyRecord(() => []),
    objects: [],
    action_feedback: emptyRecord(() => []),
    acquaintances: {
      hans: ["heinrich"], ida: [], konrad: [], ulrich: [], bertram: [],
      gerda: ["anselm"], anselm: ["gerda"], volker: ["wulf"], wulf: ["volker"],
      liesel: ["otto", "pater_markus"], sybille: [], friedrich: ["rupert"],
      otto: ["pater_markus", "liesel"], pater_markus: ["otto"],
      dieter: ["rupert"], magda: ["dieter"], heinrich: ["hans"],
      elke: [], rupert: ["dieter", "friedrich"], player: [],
    },

    economy_snapshots: [],
    total_tax_collected: 0,
    production_log: [],
    loans: [],
    caughtStealing: {},
    pending_meeting: undefined,
    active_laws: [],
    banned: {},
    tax_rate: 0.10,
    player_created: false,
    pending_player_actions: [],
  };
}

// ─── Build multi-village world ────────────────────────────────

function buildGeneratedWorldConfig(numVillages: number, agentsPerVillage: number, rng: () => number): WorldConfig {
  const villageSlots = VILLAGE_NAMES.slice(0, numVillages);
  const villages: VillageConfig[] = [];
  const roads: RoadConfig[] = [];

  // Generate all agent names in one pass so the shuffle is global — no village
  // can ever receive a name another village already took, eliminating _2 suffixes.
  const allNames = generateAgentNames(numVillages * agentsPerVillage, rng);
  let nameOffset = 0;

  for (const { id: villageId, name: villageName } of villageSlots) {
    const isDefault = villageName === "Brunnfeld";
    const skills = buildAgentSkills(agentsPerVillage, rng);
    const names = allNames.slice(nameOffset, nameOffset + agentsPerVillage);
    nameOffset += agentsPerVillage;

    const farmCounter = { n: 1 };
    const cottageCounter = { n: 0 };

    const agentSpecs: AgentBuildSpec[] = names.map((n, i) =>
      buildAgentSpec(n.id, n.displayName, skills[i]!, villageName, farmCounter, cottageCounter)
    );

    // Designate council: elder=first "none", plus miller, blacksmith, baker, first farmer
    const councilMembers: string[] = [];
    const findFirst = (s: Skill) => agentSpecs.find(a => a.skill === s)?.id;
    const firstNone = agentSpecs.find(a => a.skill === "none")?.id ?? agentSpecs[0]!.id;
    councilMembers.push(firstNone);
    for (const s of ["miller", "blacksmith", "baker", "farmer"] as Skill[]) {
      const found = findFirst(s);
      if (found && !councilMembers.includes(found)) councilMembers.push(found);
      if (councilMembers.length >= 5) break;
    }

    const agents: AgentConfig[] = agentSpecs.map(s => ({
      id: s.id,
      displayName: s.displayName,
      skill: s.skill,
      homeLocation: s.homeLocation,
      workLocation: s.workLocation,
      description: s.description,
    }));

    // Add player to first village
    if (isDefault) {
      agents.push({
        id: "player",
        displayName: "You",
        skill: "none",
        homeLocation: "Village Square",
        workLocation: "Village Square",
        description: "a newcomer to the village",
      });
    }

    const locationTilesRaw = { ...LOCATION_TILES };
    const locationTiles: Record<string, { tx: number; ty: number }> = isDefault
      ? locationTilesRaw
      : Object.fromEntries(
          Object.entries(locationTilesRaw).map(([loc, t]) => [prefixLoc(loc, villageName), t])
        );

    villages.push({
      id: villageId,
      name: villageName,
      agents,
      locations: buildVillageLocations(villageName),
      locationTypes: buildVillageLocationTypes(villageName),
      councilMembers,
      adjacency: buildVillageAdjacency(villageName),
      openingHours: buildVillageOpeningHours(villageName),
      locationTiles,
    });
  }

  // Build roads connecting villages in a ring
  for (let i = 0; i < villageSlots.length - 1; i++) {
    const v1 = villageSlots[i]!;
    const v2 = villageSlots[i + 1]!;
    const roadName = `Road: ${v1.name}→${v2.name}`;
    roads.push({
      id: `road_${v1.id}_${v2.id}`,
      name: roadName,
      connectsVillages: [v1.id, v2.id],
      transitTicks: 2,
    });

    // Add road to both villages' adjacency and location lists
    const v1cfg = villages.find(v => v.id === v1.id)!;
    const v2cfg = villages.find(v => v.id === v2.id)!;

    // Road adjacency entry (bidirectional)
    const v1square = v1.name === "Brunnfeld" ? "Village Square" : prefixLoc("Village Square", v1.name);
    const v2square = v2.name === "Brunnfeld" ? "Village Square" : prefixLoc("Village Square", v2.name);
    v1cfg.adjacency[roadName] = [v1square, v2square];
    v2cfg.adjacency[roadName] = [v1square, v2square];

    // Add road to each village's adjacency for Village Square
    if (!v1cfg.adjacency[v1square]) v1cfg.adjacency[v1square] = [];
    if (!v1cfg.adjacency[v1square]!.includes(roadName)) v1cfg.adjacency[v1square]!.push(roadName);
    if (!v2cfg.adjacency[v2square]) v2cfg.adjacency[v2square] = [];
    if (!v2cfg.adjacency[v2square]!.includes(roadName)) v2cfg.adjacency[v2square]!.push(roadName);

    // Add road to each village's locations list
    if (!v1cfg.locations.includes(roadName)) v1cfg.locations.push(roadName);
    if (!v2cfg.locations.includes(roadName)) v2cfg.locations.push(roadName);
  }

  return { villages, roads };
}

function buildGeneratedWorldState(config: WorldConfig, rng: () => number): WorldState {
  const agent_locations: Record<string, string> = {};
  const body: Record<string, BodyState> = {};
  const economics: Record<string, AgentEconomicState> = {};
  const message_queue: Record<string, unknown[]> = {};
  const action_feedback: Record<string, unknown[]> = {};
  const acquaintances: Record<string, string[]> = {};

  const marketplaces: Record<string, Marketplace> = {};

  for (const village of config.villages) {
    marketplaces[village.id] = emptyMarketplace();

    for (const agent of village.agents) {
      if (agent.id === "player") {
        agent_locations["player"] = village.name === "Brunnfeld" ? "Village Square" : prefixLoc("Village Square", village.name);
        body["player"] = { hunger: 0, energy: 8, sleep_quality: "good" };
        economics["player"] = {
          wallet: 0, inventory: { items: [] }, tool: null,
          skill: "none", homeLocation: agent.homeLocation,
          workLocation: agent.workLocation,
          workSchedule: { open: 6, close: 21 },
          villageId: village.id,
        };
        message_queue["player"] = [];
        action_feedback["player"] = [];
        acquaintances["player"] = [];
        continue;
      }

      agent_locations[agent.id] = agent.homeLocation;
      body[agent.id] = initialBody(rng);

      const spec: AgentBuildSpec = {
        id: agent.id,
        displayName: agent.displayName,
        skill: agent.skill,
        homeLocation: agent.homeLocation,
        workLocation: agent.workLocation,
        description: agent.description,
      };
      economics[agent.id] = initialEconomics(spec, village.id);
      message_queue[agent.id] = [];
      action_feedback[agent.id] = [];
      acquaintances[agent.id] = [];
    }
  }

  // Build doors for all lockable locations across all villages
  const doors: Record<string, "locked" | "unlocked"> = {};
  const LOCKABLE_SUFFIXES = [
    "Cottage 1","Cottage 2","Cottage 3","Cottage 4","Cottage 5",
    "Cottage 6","Cottage 7","Cottage 8","Cottage 9",
    "Seamstress Cottage","Healer's Hut","Bakery","Tavern","Forge",
    "Carpenter Shop","Mill","Town Hall","Prison","Elder's House",
    "Farm 1","Farm 2","Farm 3",
  ];
  for (const village of config.villages) {
    for (const suf of LOCKABLE_SUFFIXES) {
      const loc = village.name === "Brunnfeld" ? suf : prefixLoc(suf, village.name);
      if (village.locations.includes(loc)) doors[loc] = "unlocked";
    }
  }

  // Use single `marketplace` (Brunnfeld's) for backward compat; also populate `marketplaces`
  const brunnfeldMkt = marketplaces["brunnfeld"] ?? Object.values(marketplaces)[0]!;

  return {
    current_tick: 0,
    current_time: "Simulation not started",
    season: "spring",
    day_of_season: 1,
    weather: "Mild, 12°C, partly cloudy",
    active_events: [],
    agent_locations,
    body: body as WorldState["body"],
    economics: economics as WorldState["economics"],
    marketplace: brunnfeldMkt,
    marketplaces,
    doors,
    message_queue: message_queue as WorldState["message_queue"],
    objects: [],
    action_feedback: action_feedback as WorldState["action_feedback"],
    acquaintances: acquaintances as WorldState["acquaintances"],
    economy_snapshots: [],
    total_tax_collected: 0,
    production_log: [],
    loans: [],
    caughtStealing: {},
    pending_meeting: undefined,
    active_laws: [],
    banned: {},
    tax_rate: 0.10,
    player_created: false,
    pending_player_actions: [],
  };
}

// ─── Profile / memory file writing ───────────────────────────

function writeAgentFiles(config: WorldConfig): void {
  const profDir     = join(DATA_DIR, "profiles");
  const memDir      = join(DATA_DIR, "memory");
  const memInitDir  = join(DATA_DIR, "memory_initial");
  mkdirSync(profDir,    { recursive: true });
  mkdirSync(memDir,     { recursive: true });
  mkdirSync(memInitDir, { recursive: true });

  for (const village of config.villages) {
    for (const agent of village.agents) {
      if (agent.id === "player") continue;

      // Always write profile stub (skip if already exists — profiles accumulate story)
      const profPath = join(profDir, `${agent.id}.md`);
      if (!existsSync(profPath)) {
        writeFileSync(profPath, profileStub(agent.displayName, agent.skill, village.name, agent.workLocation));
      }

      // Always write blank memory stubs to both memory/ and memory_initial/
      // so `npm reset` can restore a clean baseline.
      const blankMemory = memoryStub(agent.displayName);
      writeFileSync(join(memDir,     `${agent.id}.md`), blankMemory);
      writeFileSync(join(memInitDir, `${agent.id}.md`), blankMemory);
    }
  }
}

// ─── CLI ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const getArg = (name: string): number | undefined => {
    const a = args.find(a => a.startsWith(`--${name}=`));
    if (!a) return undefined;
    const v = parseInt(a.split("=")[1] ?? "", 10);
    return isNaN(v) ? undefined : v;
  };

  const numVillages     = Math.min(5, Math.max(1, getArg("villages") ?? 1));
  const agentsPerVillage= Math.min(200, Math.max(7, getArg("agents") ?? 19));
  const seed            = getArg("seed") ?? Date.now();

  const rng = makeRng(seed);

  mkdirSync(DATA_DIR, { recursive: true });

  let worldConfig: WorldConfig;
  let worldState: WorldState;

  if (numVillages === 1 && agentsPerVillage === 19) {
    // Exact default Brunnfeld world
    worldConfig = buildDefaultWorldConfig();
    worldState  = buildDefaultWorldState();
  } else if (numVillages === 1) {
    // Single village with custom agent count
    worldConfig = buildGeneratedWorldConfig(1, agentsPerVillage, rng);
    worldState  = buildGeneratedWorldState(worldConfig, rng);
  } else {
    // Multi-village
    worldConfig = buildGeneratedWorldConfig(numVillages, agentsPerVillage, rng);
    worldState  = buildGeneratedWorldState(worldConfig, rng);
  }

  // Write world_config.json
  writeFileSync(
    join(DATA_DIR, "world_config.json"),
    JSON.stringify(worldConfig, null, 2),
  );

  // Write world_state.json
  writeFileSync(
    join(DATA_DIR, "world_state.json"),
    JSON.stringify(worldState, null, 2),
  );

  // Write profile/memory stubs for agents that don't have files yet
  writeAgentFiles(worldConfig);

  // Clear tick logs
  const logsDir = join(DATA_DIR, "logs");
  if (existsSync(logsDir)) {
    const { readdirSync, unlinkSync } = await import("fs");
    for (const file of readdirSync(logsDir)) {
      if (file.endsWith(".json")) unlinkSync(join(logsDir, file));
    }
  }

  const totalAgents = worldConfig.villages.reduce((n, v) => n + v.agents.filter(a => a.id !== "player").length, 0);
  console.log(`World generated: ${numVillages} village(s), ${totalAgents} agents, seed=${seed}`);
  for (const v of worldConfig.villages) {
    const agentCount = v.agents.filter(a => a.id !== "player").length;
    console.log(`  ${v.name}: ${agentCount} agents`);
  }
  console.log(`  Written to data/world_config.json and data/world_state.json`);
}

main().catch(err => {
  console.error("generate-world failed:", err);
  process.exit(1);
});
