/**
 * @module cvcc-sides
 *
 * Resolving "which company is mine and which is the enemy's" in a
 * company-vs-company combat.
 *
 * In an ordinary hazard combat one side is a company and the other is a
 * creature, so `combat.companyId` is unambiguous. In a CvCC there are two
 * companies, and which one belongs to the acting player depends on whether
 * they are defending (their company is `combat.companyId`) or attacking
 * (their company is `attackSource.attackingCompanyId`). Every Balrog CvCC
 * card that targets "the opposing company" — the Whip (cancel-weapon),
 * ba-75 (discard an opponent's item), Crowned with Storm (ba-54) — has to
 * make the same determination, in both the legal-action generator and the
 * reducer that applies it.
 *
 * A `null` result means the player is not a combatant in this CvCC, which
 * is the case whenever the combat's attack source is not a company attack.
 */

import type { CompanyId, PlayerId } from '../types/common.js';
import type { CombatState } from '../types/state-combat.js';

/** The two participating companies of a CvCC, from one player's point of view. */
export interface CvccSides {
  /** The acting player's participating company. */
  readonly myCompanyId: CompanyId;
  /** The player on the other side of the combat. */
  readonly oppPlayerId: PlayerId;
  /** The opposing company. */
  readonly oppCompanyId: CompanyId;
}

/**
 * Identifies the acting player's participating company and the opponent's.
 *
 * Returns `null` when `playerId` is not a combatant — either they are a
 * bystander, or the combat is not a company-vs-company attack and so has
 * no second company to name.
 */
export function cvccSides(combat: CombatState, playerId: PlayerId): CvccSides | null {
  if (playerId === combat.defendingPlayerId) {
    if (combat.attackSource.type !== 'company-attack') return null;
    return {
      myCompanyId: combat.companyId,
      oppPlayerId: combat.attackingPlayerId,
      oppCompanyId: combat.attackSource.attackingCompanyId,
    };
  }
  if (playerId === combat.attackingPlayerId && combat.attackSource.type === 'company-attack') {
    return {
      myCompanyId: combat.attackSource.attackingCompanyId,
      oppPlayerId: combat.defendingPlayerId,
      oppCompanyId: combat.companyId,
    };
  }
  return null;
}
