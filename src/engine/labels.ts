import { TAG_LABELS } from "./tagger";

// Game data uses internal names; the UI should always show the in-game English ones.
export const CLASS_LABEL: Record<string, string> = {
  warrior: "Warrior", knight: "Knight", assassin: "Thief", ranger: "Ranger", mage: "Mage", manauser: "Soul Weaver",
};

// herodata calls Earth "wind"; guides say earth / water.
export const ELEMENT_LABEL: Record<string, string> = {
  fire: "Fire", ice: "Ice", wind: "Earth", earth: "Earth", water: "Ice", light: "Light", dark: "Dark",
};

export const classLabel = (r?: string | null) => (r ? CLASS_LABEL[r] ?? cap(r) : "");
export const elementLabel = (e?: string | null) => (e ? ELEMENT_LABEL[e.toLowerCase()] ?? cap(e) : "");
export const tagLabel = (t: string) => TAG_LABELS[t] ?? cap(t.replace(/_/g, " "));
export const tagList = (tags: string[]) => tags.map(tagLabel).join(", ");

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
