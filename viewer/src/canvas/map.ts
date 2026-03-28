// ─── Village map layout constants ──────────────────────────────────────────
// Matches backend LOCATION_TILES (tx, ty on 32×26 grid, tile=48px)

export const TILE_SIZE = 48;

export const LOCATION_TILES: Record<string, { tx: number; ty: number }> = {
  "Village Square":     { tx: 16, ty: 8  },
  "Bakery":             { tx: 13, ty: 9  },
  "Tavern":             { tx: 15, ty: 9  },
  "Forge":              { tx: 20, ty: 9  },
  "Carpenter Shop":     { tx: 22, ty: 9  },
  "Mill":               { tx: 8,  ty: 8  },
  "Town Hall":          { tx: 24, ty: 8  },
  "Prison":             { tx: 25, ty: 9  },
  "Elder's House":      { tx: 27, ty: 8  },
  "Cottage 1":          { tx: 2,  ty: 11 },
  "Cottage 2":          { tx: 5,  ty: 11 },
  "Cottage 3":          { tx: 8,  ty: 11 },
  "Cottage 4":          { tx: 13, ty: 11 },
  "Cottage 5":          { tx: 17, ty: 11 },
  "Cottage 6":          { tx: 2,  ty: 13 },
  "Cottage 7":          { tx: 5,  ty: 13 },
  "Cottage 8":          { tx: 9,  ty: 13 },
  "Cottage 9":          { tx: 13, ty: 13 },
  "Seamstress Cottage": { tx: 20, ty: 13 },
  "Healer's Hut":       { tx: 24, ty: 14 },
  "Farm 1":             { tx: 4,  ty: 4  },
  "Farm 2":             { tx: 13, ty: 4  },
  "Farm 3":             { tx: 21, ty: 4  },
  "Forest":             { tx: 6,  ty: 1  },
  "Mine":               { tx: 28, ty: 1  },
  "Merchant Camp":      { tx: 16, ty: 5  },
};

export const ADJACENCY: [string, string][] = [
  ["Village Square", "Merchant Camp"],
  ["Village Square", "Bakery"],
  ["Village Square", "Tavern"],
  ["Village Square", "Town Hall"],
  ["Village Square", "Mill"],
  ["Village Square", "Forge"],
  ["Village Square", "Carpenter Shop"],
  ["Village Square", "Elder's House"],
  ["Village Square", "Cottage 1"],
  ["Village Square", "Farm 1"],
  ["Bakery", "Mill"],
  ["Tavern", "Elder's House"],
  ["Town Hall", "Elder's House"],
  ["Town Hall", "Prison"],
  ["Mill", "Farm 1"],
  ["Forge", "Carpenter Shop"],
  ["Cottage 1", "Cottage 2"],
  ["Cottage 2", "Cottage 3"],
  ["Cottage 3", "Cottage 4"],
  ["Cottage 4", "Cottage 5"],
  ["Cottage 5", "Cottage 6"],
  ["Cottage 6", "Cottage 7"],
  ["Cottage 7", "Cottage 8"],
  ["Cottage 7", "Healer's Hut"],
  ["Cottage 8", "Cottage 9"],
  ["Cottage 9", "Seamstress Cottage"],
  ["Farm 1", "Farm 2"],
  ["Farm 2", "Farm 3"],
  ["Farm 3", "Forest"],
  ["Forest", "Mine"],
];

// Building image path and display size for each location
export const LOCATION_BUILDINGS: Record<string, { img: string; w: number; h: number; label?: string }> = {
  "Village Square":     { img: "", w: 0, h: 0 },  // open area, no building
  "Bakery":             { img: "/assets/buildings/House2.png", w: 80, h: 120, label: "Bakery" },
  "Tavern":             { img: "/assets/buildings/House3.png", w: 80, h: 120, label: "Tavern" },
  "Forge":              { img: "/assets/buildings/Barracks.png", w: 100, h: 133, label: "Forge" },
  "Carpenter Shop":     { img: "/assets/buildings/Barracks.png", w: 100, h: 133, label: "Carpenter" },
  "Mill":               { img: "/assets/buildings/Tower.png", w: 72, h: 144, label: "Mill" },
  "Town Hall":          { img: "/assets/buildings/Monastery.png", w: 110, h: 183, label: "Town Hall" },
  "Prison":             { img: "/assets/buildings/Tower.png", w: 64, h: 128, label: "Prison" },
  "Elder's House":      { img: "/assets/buildings/Castle.png", w: 130, h: 104, label: "Elder's" },
  "Cottage 1":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Cottage 1" },
  "Cottage 2":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Cottage 2" },
  "Cottage 3":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Cottage 3" },
  "Cottage 4":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Cottage 4" },
  "Cottage 5":          { img: "/assets/buildings/House2.png", w: 64, h: 96, label: "Cottage 5" },
  "Cottage 6":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Cottage 6" },
  "Cottage 7":          { img: "/assets/buildings/House2.png", w: 64, h: 96, label: "Cottage 7" },
  "Cottage 8":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Cottage 8" },
  "Cottage 9":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Cottage 9" },
  "Seamstress Cottage": { img: "/assets/buildings/House3.png", w: 64, h: 96, label: "Seamstress" },
  "Healer's Hut":       { img: "/assets/buildings/House2.png", w: 64, h: 96, label: "Healer" },
  "Farm 1":             { img: "/assets/buildings/Archery.png", w: 100, h: 133, label: "Farm 1" },
  "Farm 2":             { img: "/assets/buildings/Archery.png", w: 100, h: 133, label: "Farm 2" },
  "Farm 3":             { img: "/assets/buildings/Archery.png", w: 100, h: 133, label: "Farm 3" },
  "Forest":             { img: "", w: 0, h: 0, label: "Forest" },
  "Mine":               { img: "/assets/buildings/Tower.png", w: 64, h: 128, label: "Mine" },
  "Merchant Camp":      { img: "", w: 0, h: 0, label: "Merchant" },
};

export function tilePx(tile: { tx: number; ty: number }): { x: number; y: number } {
  return { x: tile.tx * TILE_SIZE, y: tile.ty * TILE_SIZE };
}

// ─── Dynamic tile/building overrides for multi-village support ────────────

let _activeTiles: Record<string, { tx: number; ty: number }> | null = null;
let _activeBuildings: Record<string, { img: string; w: number; h: number; label?: string }> | null = null;

export function setActiveTiles(tiles: Record<string, { tx: number; ty: number }> | null): void {
  _activeTiles = tiles;
}
export function setActiveBuildings(b: Record<string, { img: string; w: number; h: number; label?: string }> | null): void {
  _activeBuildings = b;
}
export function getActiveTiles(): Record<string, { tx: number; ty: number }> {
  return _activeTiles ?? LOCATION_TILES;
}
export function getActiveBuildings(): Record<string, { img: string; w: number; h: number; label?: string }> {
  return _activeBuildings ?? LOCATION_BUILDINGS;
}

/** Derive LOCATION_BUILDINGS-compatible data from world_config locationTiles + locationTypes. */
export function buildingsFromVillage(
  locationTiles: Record<string, { tx: number; ty: number }>,
  locationTypes: Record<string, string>,
): Record<string, { img: string; w: number; h: number; label?: string }> {
  const result: Record<string, { img: string; w: number; h: number; label?: string }> = {};
  for (const name of Object.keys(locationTiles)) {
    const type = locationTypes[name] ?? inferLocationType(name);
    result[name] = typeToBuilding(type, name);
  }
  return result;
}

function inferLocationType(name: string): string {
  const l = name.toLowerCase();
  if (l.startsWith("cottage")) return "cottage";
  if (l.startsWith("farm")) return "farm";
  if (l === "forest") return "forest";
  if (l === "mine") return "mine";
  if (l === "village square") return "square";
  if (l === "town hall") return "townhall";
  if (l === "elder's house" || l === "elders house") return "elder";
  if (l === "prison") return "prison";
  if (l === "mill") return "mill";
  if (l === "forge") return "forge";
  if (l === "bakery") return "bakery";
  if (l === "tavern") return "tavern";
  if (l === "carpenter shop") return "carpenter";
  if (l === "healer's hut" || l === "healers hut") return "healer";
  if (l === "seamstress cottage") return "seamstress";
  if (l === "merchant camp") return "merchant";
  return "cottage";
}

function typeToBuilding(type: string, label: string): { img: string; w: number; h: number; label: string } {
  switch (type) {
    case "farm":       return { img: "/assets/buildings/Archery.png",   w: 100, h: 133, label };
    case "forge":
    case "carpenter":  return { img: "/assets/buildings/Barracks.png",  w: 100, h: 133, label };
    case "mill":
    case "mine":
    case "prison":     return { img: "/assets/buildings/Tower.png",     w: 64,  h: 128, label };
    case "townhall":   return { img: "/assets/buildings/Monastery.png", w: 110, h: 183, label };
    case "elder":      return { img: "/assets/buildings/Castle.png",    w: 130, h: 104, label };
    case "tavern":
    case "seamstress": return { img: "/assets/buildings/House3.png",    w: 80,  h: 120, label };
    case "bakery":     return { img: "/assets/buildings/House2.png",    w: 80,  h: 120, label };
    case "healer":     return { img: "/assets/buildings/House2.png",    w: 64,  h: 96,  label };
    case "square":
    case "forest":
    case "merchant":   return { img: "", w: 0, h: 0, label };
    case "cottage":
    default:           return { img: "/assets/buildings/House1.png",    w: 64,  h: 96,  label };
  }
}

export function locationPx(name: string): { x: number; y: number } {
  const tile = getActiveTiles()[name];
  if (!tile) return { x: 0, y: 0 };
  return tilePx(tile);
}

// Canvas world size
export const WORLD_W = 32 * TILE_SIZE;  // 1536
export const WORLD_H = 26 * TILE_SIZE;  // 1248
