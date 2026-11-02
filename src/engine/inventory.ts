import type { Account, GearSlot } from "./types";

/** Removes an item from the account and from the hero wearing it. Returns false if it wasn't there. */
export function removeItem(acc: Account, itemId: string): boolean {
  const i = acc.items.findIndex((x) => x.id === itemId);
  if (i < 0) return false;
  acc.items.splice(i, 1);
  for (const h of acc.heroes) for (const s of Object.keys(h.equipment) as GearSlot[]) if (h.equipment[s] === itemId) delete h.equipment[s];
  return true;
}
