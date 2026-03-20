/**
 * @module alignment-rules
 *
 * Static per-alignment rules data. Different alignments (wizard, ringwraith,
 * fallen-wizard, balrog) have different limits and constraints that affect
 * deck construction, draft, and gameplay.
 */

import { Alignment } from './types/common.js';
import type { CardDefinitionId } from './types/common.js';
import { RIVENDELL } from './card-ids.js';

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
 * NOTE: `defaultStartingSites` currently uses Rivendell for all alignments
 * because we only have hero site cards in the pool so far. Per the rules:
 * - Wizard: Rivendell
 * - Ringwraith: Minas Morgul and/or Dol Guldur
 * - Fallen-wizard: White Towers or specific Ruins & Lairs
 * - Balrog: Moria and/or Under-gates
 * Update these once the corresponding minion/dark-domain site cards are added.
 */
const ALIGNMENT_RULES: { readonly [K in Alignment]: AlignmentRules } = {
  'wizard': { maxStartingCompanySize: 5, defaultStartingSites: [RIVENDELL], maxStartingSites: 1 },
  'ringwraith': { maxStartingCompanySize: 6, defaultStartingSites: [RIVENDELL], maxStartingSites: 2 },
  'fallen-wizard': { maxStartingCompanySize: 5, defaultStartingSites: [RIVENDELL], maxStartingSites: 1 },
  'balrog': { maxStartingCompanySize: 6, defaultStartingSites: [RIVENDELL], maxStartingSites: 2 },
};

/** Returns the alignment-specific rules for the given alignment. */
export function getAlignmentRules(alignment: Alignment): AlignmentRules {
  return ALIGNMENT_RULES[alignment];
}
