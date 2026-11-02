import { estimateRolls, gearScore } from "./gear";
import type { Account, GearSlot, Item } from "./types";

/** Removes an item from the account and from the hero wearing it. Returns false if it wasn't there. */
export function removeItem(acc: Account, itemId: string): boolean {
  const i = acc.items.findIndex((x) => x.id === itemId);
  if (i < 0) return false;
  acc.items.splice(i, 1);
  for (const h of acc.heroes) for (const s of Object.keys(h.equipment) as GearSlot[]) if (h.equipment[s] === itemId) delete h.equipment[s];
  return true;
}

/**
 * Keeps a gear level or main value entered by hand when fresh data (a scan or
 * re-import) still can't read it. Matches items by id. Returns how many were kept.
 */
export function keepManualFixes(oldItems: Item[], newItems: Item[]): number {
  const oldById = new Map(oldItems.map((i) => [i.id, i]));
  let n = 0;
  for (const it of newItems) {
    const old = oldById.get(it.id);
    if (!old) continue;
    if (!it.level && old.level) { it.level = old.level; estimateRolls(it); it.gs = gearScore(it.substats); n++; }
    if (!it.main.value && old.main.value && old.main.type === it.main.type) { it.main = { ...old.main }; n++; }
  }
  return n;
}
