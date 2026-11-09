// Shared pickups from snack crates. Odds lean on race position: leaders get defensive items,
// the back of the pack gets the strong catch-up ones.

export type ItemId = 'jawbreaker' | 'taffy' | 'butter' | 'espresso' | 'gum' | 'sugarCrash';

export interface ItemDef {
  id: ItemId;
  name: string;
  text: string;
  // Weights at the front (1st), middle and back (last) of the pack.
  odds: [number, number, number];
}

export const ITEMS: Record<ItemId, ItemDef> = {
  jawbreaker: { id: 'jawbreaker', name: 'Jawbreaker', text: 'Rolls straight ahead and bounces off walls.', odds: [30, 28, 14] },
  taffy: { id: 'taffy', name: 'Homing Taffy', text: 'Chases down the kart in front of you.', odds: [4, 24, 24] },
  butter: { id: 'butter', name: 'Butter Pat', text: 'Drop it behind you. Whoever hits it spins out.', odds: [40, 16, 4] },
  espresso: { id: 'espresso', name: 'Espresso Shot', text: 'A quick burst of speed. Comes in threes at the back.', odds: [10, 20, 30] },
  gum: { id: 'gum', name: 'Bubble Gum', text: 'A bubble that pops instead of you. Blocks one hit.', odds: [16, 10, 8] },
  sugarCrash: { id: 'sugarCrash', name: 'Sugar Crash', text: 'Everyone ahead of you crashes off their sugar high and slows down.', odds: [0, 2, 16] },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/** Pick an item. `pos` is 0 for first place up to 1 for last. `r` is a random number 0..1. */
export function rollItem(pos: number, r: number): { item: ItemId; count: number } {
  const w = ITEM_IDS.map((id) => {
    const [a, b, c] = ITEMS[id].odds;
    return pos < 0.5 ? a + (b - a) * (pos / 0.5) : b + (c - b) * ((pos - 0.5) / 0.5);
  });
  const total = w.reduce((s, v) => s + v, 0);
  let x = r * total;
  for (let i = 0; i < w.length; i++) {
    x -= w[i];
    if (x < 0) {
      const item = ITEM_IDS[i];
      return { item, count: item === 'espresso' && pos > 0.6 ? 3 : 1 };
    }
  }
  return { item: 'butter', count: 1 };
}
