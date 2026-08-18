/**
 * @module alignment-rules
 *
 * Static per-alignment rules data. Different alignments (wizard, ringwraith,
 * fallen-wizard, balrog) have different limits and constraints that affect
 * deck construction, draft, and gameplay.
 */

import { Alignment } from './types/common.js';
import type { CardDefinitionId } from './types/common.js';
import { RIVENDELL, ETTENMOORS_HERO, THE_WHITE_TOWERS_HERO, WEATHERTOP_HERO } from './card-ids.js';

const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const THE_WHITE_TOWERS = 'wh-58' as CardDefinitionId;
const MORIA_BALROG = 'ba-93' as CardDefinitionId;
const THE_UNDER_GATES = 'ba-100' as CardDefinitionId;
const ETTENMOORS = 'le-373' as CardDefinitionId;
const THE_WHITE_TOWERS_MINION = 'le-412' as CardDefinitionId;
const WEATHERTOP_MINION = 'as-169' as CardDefinitionId;

/** Per-alignment rule constants. */
export interface AlignmentRules {
  /** Maximum number of characters allowed in the starting company. */
  readonly maxStartingCompanySize: number;
  /** Default starting haven site(s) for this alignment. */
  readonly defaultStartingSites: readonly CardDefinitionId[];
  /** Maximum number of starting sites a player can select. */
  readonly maxStartingSites: number;
}

/**
 * Alignment-specific rules, keyed by alignment value.
 *
 * Starting sites per the CRF:
 * - Wizard: Rivendell (1 haven)
 * - Ringwraith: Minas Morgul and/or Dol Guldur (up to 2 darkhavens)
 * - Fallen-wizard: any version of The White Towers, or of a Ruins & Lairs in
 *   Arthedain or Rhudaur — Ettenmoors and Weathertop (1 site, rule 1.10.F1)
 * - Balrog: Moria and/or The Under-gates (up to 2 darkhavens)
 */
const ALIGNMENT_RULES: { readonly [K in Alignment]: AlignmentRules } = {
  'wizard': { maxStartingCompanySize: 5, defaultStartingSites: [RIVENDELL], maxStartingSites: 1 },
  'ringwraith': { maxStartingCompanySize: 6, defaultStartingSites: [MINAS_MORGUL, DOL_GULDUR], maxStartingSites: 2 },
  'fallen-wizard': { maxStartingCompanySize: 5, defaultStartingSites: [THE_WHITE_TOWERS, THE_WHITE_TOWERS_HERO, THE_WHITE_TOWERS_MINION, ETTENMOORS, ETTENMOORS_HERO, WEATHERTOP_HERO, WEATHERTOP_MINION], maxStartingSites: 1 },
  'balrog': { maxStartingCompanySize: 6, defaultStartingSites: [MORIA_BALROG, THE_UNDER_GATES], maxStartingSites: 2 },
};

/** Returns the alignment-specific rules for the given alignment. */
export function getAlignmentRules(alignment: Alignment): AlignmentRules {
  return ALIGNMENT_RULES[alignment];
}

/**
 * Extra general influence granted on top of the base pool (rules 1.55 /
 * 1.56, CoE 1.12.R1 / 1.12.B1): 5 points for a Ringwraith or Balrog player,
 * 0 otherwise. This extra influence can never be used to control characters
 * — it is not part of {@link effectiveGeneralInfluence} in `reducer-utils.ts`,
 * which governs the mind-value budget for controlling characters. It exists
 * for future rules that key off a player's *unused* general influence (e.g.
 * CoE 8.3 step 3, defending against an influence attempt).
 */
export function extraGeneralInfluence(alignment: Alignment): number {
  return alignment === Alignment.Ringwraith || alignment === Alignment.Balrog ? 5 : 0;
}

/**
 * Cross-alignment influence penalty per CoE rules 8.W1, 8.R1, 8.F1, 8.B1.
 *
 * When a player's character (not an agent hazard) makes an influence
 * attempt against an opposing-alignment player's card, the attacker's
 * roll is modified by -5:
 *
 * - Wizard vs Ringwraith / Balrog
 * - Ringwraith vs Wizard / Fallen-wizard
 * - Fallen-wizard vs Ringwraith / Balrog
 * - Balrog vs Wizard / Fallen-wizard
 *
 * Returns -5 if the pairing incurs the penalty, 0 otherwise.
 */
export function crossAlignmentInfluencePenalty(
  influencerAlignment: Alignment,
  targetAlignment: Alignment,
): number {
  const W = Alignment.Wizard;
  const R = Alignment.Ringwraith;
  const F = Alignment.FallenWizard;
  const B = Alignment.Balrog;
  if (influencerAlignment === W && (targetAlignment === R || targetAlignment === B)) return -5;
  if (influencerAlignment === R && (targetAlignment === W || targetAlignment === F)) return -5;
  if (influencerAlignment === F && (targetAlignment === R || targetAlignment === B)) return -5;
  if (influencerAlignment === B && (targetAlignment === W || targetAlignment === F)) return -5;
  return 0;
}
