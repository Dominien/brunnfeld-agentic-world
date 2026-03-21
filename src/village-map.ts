export const LOCATIONS = [
  "Village Square",
  "Bakery", "Tavern", "Forge", "Carpenter Shop", "Mill",
  "Town Hall", "Prison", "Elder's House",
  "Cottage 1", "Cottage 2", "Cottage 3", "Cottage 4", "Cottage 5",
  "Cottage 6", "Cottage 7", "Cottage 8", "Cottage 9",
  "Seamstress Cottage",
  "Healer's Hut",
  "Farm 1", "Farm 2", "Farm 3",
  "Forest", "Mine",
  "Merchant Camp",
] as const;

export type Location = (typeof LOCATIONS)[number];

// Adjacency: locations you can hear and move to directly in 1 tick.
// Move to non-adjacent location costs 2 ticks (routed through Village Square).
export const ADJACENCY: Record<string, string[]> = {
  "Village Square":     ["Bakery", "Tavern", "Town Hall", "Mill", "Forge", "Carpenter Shop", "Elder's House", "Cottage 1", "Farm 1", "Merchant Camp"],
  "Merchant Camp":      ["Village Square"],
  "Bakery":             ["Village Square", "Mill"],
  "Tavern":             ["Village Square", "Elder's House"],
  "Town Hall":          ["Village Square", "Elder's House", "Prison"],
  "Prison":             ["Town Hall"],
  "Elder's House":      ["Town Hall", "Tavern", "Village Square"],
  "Mill":               ["Village Square", "Bakery", "Farm 1"],
  "Forge":              ["Village Square", "Carpenter Shop"],
  "Carpenter Shop":     ["Village Square", "Forge"],
  "Cottage 1":          ["Village Square", "Cottage 2"],
  "Cottage 2":          ["Cottage 1", "Cottage 3"],
  "Cottage 3":          ["Cottage 2", "Cottage 4"],
  "Cottage 4":          ["Cottage 3", "Cottage 5"],
  "Cottage 5":          ["Cottage 4", "Cottage 6"],
  "Cottage 6":          ["Cottage 5", "Cottage 7"],
  "Cottage 7":          ["Cottage 6", "Cottage 8", "Healer's Hut"],
  "Cottage 8":          ["Cottage 7", "Cottage 9"],
  "Cottage 9":          ["Cottage 8", "Seamstress Cottage"],
  "Seamstress Cottage": ["Cottage 9"],
  "Healer's Hut":       ["Cottage 7"],
  "Farm 1":             ["Village Square", "Mill", "Farm 2"],
  "Farm 2":             ["Farm 1", "Farm 3"],
  "Farm 3":             ["Farm 2", "Forest"],
  "Forest":             ["Farm 3", "Mine"],
  "Mine":               ["Forest"],
};

// Opening hours: tick index within day (0 = 06:00, 15 = 21:00)
// Absent = always open.
export const OPENING_HOURS: Partial<Record<string, { open: number; close: number }>> = {
  "Tavern":         { open: 4, close: 15 },   // 10:00–21:00
  "Bakery":         { open: 0, close: 8 },    // 06:00–14:00
  "Forge":          { open: 1, close: 10 },   // 07:00–16:00
  "Carpenter Shop": { open: 1, close: 10 },
  "Mill":           { open: 1, close: 10 },
  "Healer's Hut":   { open: 1, close: 11 },   // 07:00–17:00
};

export function isLocationOpen(location: string, hourIndex: number): boolean {
  const hours = OPENING_HOURS[location];
  if (!hours) return true;
  return hourIndex >= hours.open && hourIndex < hours.close;
}

export function isValidLocation(loc: string): boolean {
  return (LOCATIONS as readonly string[]).includes(loc);
}

export function getAdjacentLocations(location: string): string[] {
  return ADJACENCY[location] ?? [];
}

// Tile coordinates for the village renderer (32×26 tile grid, tile size = 16px × 3x scale)
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
