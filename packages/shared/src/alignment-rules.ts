/**
 * @module alignment-rules
 *
 * Static per-alignment rules data. Different alignments (wizard, ringwraith,
 * fallen-wizard, balrog) have different limits and constraints that affect
 * deck construction, draft, and gameplay.
 */

import { Alignment } from './types/common.js';
import type { CardDefinitionId } from './types/common.js';
import {
  RIVENDELL, MINAS_MORGUL, DOL_GULDUR, THE_WHITE_TOWERS, MORIA_BALROG, THE_UNDER_GATES,
  ETTENMOORS, ETTENMOORS_HERO, THE_WHITE_TOWERS_MINION, THE_WHITE_TOWERS_HERO,
} from './card-ids.js';

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
 * - Fallen-wizard: any version of The White Towers or Ettenmoors (1 site)
 * - Balrog: Moria and/or The Under-gates (up to 2 darkhavens)
 */
const ALIGNMENT_RULES: { readonly [K in Alignment]: AlignmentRules } = {
  'wizard': { maxStartingCompanySize: 5, defaultStartingSites: [RIVENDELL], maxStartingSites: 1 },
  'ringwraith': { maxStartingCompanySize: 6, defaultStartingSites: [MINAS_MORGUL, DOL_GULDUR], maxStartingSites: 2 },
  'fallen-wizard': { maxStartingCompanySize: 5, defaultStartingSites: [THE_WHITE_TOWERS, THE_WHITE_TOWERS_HERO, THE_WHITE_TOWERS_MINION, ETTENMOORS, ETTENMOORS_HERO], maxStartingSites: 1 },
  'balrog': { maxStartingCompanySize: 6, defaultStartingSites: [MORIA_BALROG, THE_UNDER_GATES], maxStartingSites: 2 },
};

/** Returns the alignment-specific rules for the given alignment. */
export function getAlignmentRules(alignment: Alignment): AlignmentRules {
  return ALIGNMENT_RULES[alignment];
}
