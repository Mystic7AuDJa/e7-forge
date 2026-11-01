// Derives functional hero tags (strip, cleanse, CR push, def break...) from
// skill effects and skill text. Sources: EXCOFF hero-effects.json (MIT) and
// epic7db.com hero pages.

export interface ScrapedSkill { name: string; effects: string[]; text: string }

export const TAG_LABELS: Record<string, string> = {
  def_break: "Defense Break", atk_buff: "Attack Buff", speed_buff: "Speed Buff", crit_buff: "Crit Buff",
  def_buff: "Defense Buff", atk_down: "Attack Down", speed_down: "Speed Down", hit_down: "Hit Chance Down",
  stun: "Stun", sleep: "Sleep", provoke: "Provoke", silence: "Silence", unbuffable: "Unbuffable",
  unhealable: "Unhealable", immunity: "Immunity", barrier: "Barrier", invincible: "Invincible",
  immortal: "Immortality", nullifier: "Skill Nullifier", counter: "Counterattack", cr_push: "CR Push (allies)",
  cr_self: "CR Gain (self)", cr_reduce: "CR Reduce", strip: "Strip (removes buffs)", cleanse: "Cleanse",
  heal: "Heal", revive: "Revive", aoe: "AoE", extra_turn: "Extra Turn", dual_attack: "Dual Attack",
  restrict: "Restrict", bleed: "Bleed", burn: "Burn", poison: "Poison", detonate: "Detonate", fixed_dmg: "Fixed Damage",
  seal: "Seal", target: "Target", cd_reduce: "Cooldown Reduction (allies)", cd_increase: "Cooldown Increase",
  extinction: "Extinction", stealth: "Stealth", evasion: "Evasion",
};

const EFFECT_CODE_TAG: Record<string, string> = {
  stic_def_dn: "def_break", stic_att_up: "atk_buff", stic_att_up2: "atk_buff", stic_speed_up: "speed_buff",
  stic_cri_up: "crit_buff", stic_cridmg_up: "crit_buff", stic_def_up: "def_buff", stic_att_dn: "atk_down",
  stic_dodge_dn: "speed_down", stic_speed_dn: "speed_down", stic_blind: "hit_down", stic_stun: "stun",
  stic_sleep: "sleep", stic_provoke: "provoke", stic_provoke_hp: "provoke", stic_silence: "silence",
  stic_buf_impossible: "unbuffable", stic_heal_impossible: "unhealable", stic_debuf_impossible: "immunity",
  stic_protect: "barrier", stic_invincible: "invincible", stic_immortality: "immortal", stic_endure: "nullifier",
  stic_counter: "counter", stic_ab_up_block: "restrict", stic_blood: "bleed", stic_blaze: "burn", stic_dot: "poison",
  stic_dizzy: "seal", stic_target: "target", stic_heal: "heal",
};

const EFFECT_NAME_TAG: [RegExp, string][] = [
  [/^Decrease Defense/i, "def_break"], [/^Increase Attack/i, "atk_buff"], [/^Increase Speed/i, "speed_buff"],
  [/^Increase Critical Hit (Chance|Damage)/i, "crit_buff"], [/^Increase Defense/i, "def_buff"],
  [/^Decrease Attack/i, "atk_down"], [/^Decrease Speed/i, "speed_down"], [/^Decrease Hit Chance/i, "hit_down"],
  [/^Stun/i, "stun"], [/^Sleep/i, "sleep"], [/Provoke/i, "provoke"], [/^Silence/i, "silence"],
  [/^Unbuffable/i, "unbuffable"], [/^Unhealable/i, "unhealable"], [/^Immunity/i, "immunity"],
  [/^Barrier/i, "barrier"], [/^Invincib/i, "invincible"], [/^Immortal/i, "immortal"], [/Skill Nullifier/i, "nullifier"],
  [/^Counter/i, "counter"], [/^Restrict/i, "restrict"], [/^Bleed/i, "bleed"], [/^Burn/i, "burn"], [/^Poison/i, "poison"],
  [/^Decrease Combat Readiness/i, "cr_reduce"], [/^Increase Combat Readiness/i, "cr_self"], [/^Seal/i, "seal"],
  [/^Continuous Heal/i, "heal"], [/^Target/i, "target"],
  [/^Healing$/i, "heal"], [/^Dispel$/i, "strip"], [/^Buff Stealing/i, "strip"], [/^Cleanse$/i, "cleanse"],
  [/^(Revive|Resurrect)$/i, "revive"], [/^Extra Turn$/i, "extra_turn"], [/^Debuff Immunity/i, "immunity"],
  [/^Cannot Buff/i, "unbuffable"], [/^Dual Attack|^Enhanced Dual Attack/i, "dual_attack"], [/^Detonate/i, "detonate"],
  [/^Decrease Skill Cooldown/i, "cd_reduce"], [/^Increase Skill Cooldown/i, "cd_increase"], [/^Extinction/i, "extinction"],
  [/^Stealth/i, "stealth"], [/^Evasion/i, "evasion"],
];

const TEXT_TAG: [RegExp, string][] = [
  [/remov\w*\s+(?:up to\s+)?(?:a|one|two|three|all|\d+)\s+(?:of the\s+)?buffs?\b/i, "strip"],
  [/remov\w*\s+all\s+buffs/i, "strip"],
  [/dispel\w*\s+[^.]{0,40}\bbuffs?\b/i, "strip"],
  [/(?:remov|dispel)\w*\s+[^.]{0,40}\bdebuffs?\b/i, "cleanse"],
  [/increas\w*\s+(?:the\s+)?combat readiness of\s+(?:all\s+)?(?:allies|all allies|an ally|the ally|other allies)/i, "cr_push"],
  [/combat readiness of all allies[^.]{0,30}increas/i, "cr_push"],
  [/decreas\w*\s+[^.]{0,60}combat readiness/i, "cr_reduce"],
  [/\b(?:resurrect|revive)/i, "revive"],
  [/\b(?:recovers?|restores?)\s+(?:the\s+)?health\b|\bheals?\b/i, "heal"],
  [/\ball enemies\b/i, "aoe"],
  [/\bextra turn\b/i, "extra_turn"],
  [/\bdual attack/i, "dual_attack"],
  [/\bdetonat/i, "detonate"],
  [/\bfixed damage\b|\bdamage that is fixed\b/i, "fixed_dmg"],
];

export function deriveTags(opts: {
  effectCodes?: Record<string, { buffs?: string[]; debuffs?: string[] }>;
  scraped?: ScrapedSkill[];
}): string[] {
  const tags = new Set<string>();
  for (const sk of Object.values(opts.effectCodes ?? {})) {
    for (const code of [...(sk.buffs ?? []), ...(sk.debuffs ?? [])]) {
      const t = EFFECT_CODE_TAG[code];
      if (t) tags.add(t);
    }
  }
  for (const sk of opts.scraped ?? []) {
    for (const raw of sk.effects) {
      const eff = decodeEntities(raw);
      for (const [re, t] of EFFECT_NAME_TAG) if (re.test(eff)) tags.add(t);
    }
    // strip "debuff" text before testing for buff-removal to avoid cleanse/strip confusion
    const txt = sk.text ?? "";
    for (const [re, t] of TEXT_TAG) {
      if (t === "strip") {
        if (re.test(txt.replace(/debuffs?/gi, "XX"))) tags.add(t);
      } else if (re.test(txt)) tags.add(t);
    }
  }
  return [...tags].sort();
}

/** Extracts skills from an epic7db.com hero page (same parser as the bundled scrape). */
export function parseEpic7dbHeroPage(page: string): ScrapedSkill[] {
  const skills: ScrapedSkill[] = [];
  const skillRe = /<div class="skill accordion[\s\S]*?<h3>([\s\S]*?)<\/h3>([\s\S]*?)(?=<div class="skill accordion|<\/section>)/g;
  const effRe = /<img src="\/images\/status_effects\/[^"]+" alt="([^"]+)"/g;
  const bottomRe = /<div class="bottom">([\s\S]*?)<\/div>/g;
  const clean = (t: string) => decodeEntities(t.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  for (const m of page.matchAll(skillRe)) {
    const body = m[2];
    const effects = [...new Set([...body.matchAll(effRe)].map((x) => x[1]))].sort();
    const text = [...body.matchAll(bottomRe)].map((x) => clean(x[1])).filter(Boolean).join(" ").slice(0, 1200);
    skills.push({ name: clean(m[1]), effects, text });
  }
  return skills;
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

export function epic7dbSlug(name: string) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[’'.:!?,()]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
