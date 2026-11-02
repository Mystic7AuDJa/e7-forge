// Parses a saved copy (Print -> PDF, pdftotext -raw) of the slendy.gg E7
// Dictionary "Artifacts" tab: name, class restriction, stars and effect text.
// Hero data already has artifact stats by code; this adds what they do and
// who can use them.

export type ArtifactClass = "Any class" | "Knight" | "Warrior" | "Thief" | "Ranger" | "Mage" | "Soul Weaver";
export interface ArtifactInfo { class: ArtifactClass; stars: number; effect: string }
export interface ArtifactDictionary { source: string; gameData: string; artifacts: Record<string, ArtifactInfo> }

const CLASS_LINE = /^(Any class|Knight|Warrior|Thief|Ranger|Mage|Soul Weaver) (★+)$/;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseArtifactDictionary(raw: string, knownNames: string[]): { dict: ArtifactDictionary; unknown: string[] } {
  const date = raw.match(/Game data from (\d{4}-\d{2}-\d{2})/)?.[1];
  if (!date || !/Search artifacts/.test(raw)) throw new Error("Not the Artifacts tab of the slendy.gg E7 Dictionary.");
  const known = new Map(knownNames.map((n) => [norm(n), n]));
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.findIndex((l) => /artifacts$/.test(l) && /^Search artifacts/.test(l));
  const marks = lines.map((l, i) => (CLASS_LINE.test(l) ? i : -1)).filter((i) => i >= 0);
  const artifacts: Record<string, ArtifactInfo> = {};
  const unknown: string[] = [];
  let prevEnd = head + 1;
  // Each record is: name line(s), "Class ★★★★★", effect line(s). Names never end in a period; effects do.
  const nameStart = (i: number) => {
    for (const t of [1, 2, 3]) if (known.has(norm(lines.slice(i - t, i).join(" ")))) return i - t;
    let j = i;
    while (j - 1 >= prevEnd && !/[.)]$/.test(lines[j - 1]) && i - j < 2) j--;
    return j;
  };
  const starts = marks.map((i) => { const s = nameStart(i); prevEnd = i + 1; return s; });
  marks.forEach((i, k) => {
    const printed = lines.slice(starts[k], i).join(" ");
    const name = known.get(norm(printed)) ?? printed;
    if (!known.has(norm(printed))) unknown.push(printed);
    const [, cls, stars] = lines[i].match(CLASS_LINE)!;
    const effect = lines.slice(i + 1, starts[k + 1] ?? lines.length).join(" ").replace(/(\d)- (\d)/g, "$1-$2").replace(/\s+/g, " ").trim();
    artifacts[name] = { class: cls as ArtifactClass, stars: stars.length, effect };
  });
  return { dict: { source: "https://slendy.gg (E7 Dictionary)", gameData: date, artifacts }, unknown };
}

const ROLE_CLASS: Record<string, ArtifactClass> = { knight: "Knight", warrior: "Warrior", assassin: "Thief", ranger: "Ranger", mage: "Mage", manauser: "Soul Weaver" };

/** False when the artifact is locked to another class (its effect then doesn't apply). */
export function artifactFits(info: ArtifactInfo | undefined, role: string | undefined) {
  if (!info || !role || info.class === "Any class") return true;
  return ROLE_CLASS[role] === info.class;
}
