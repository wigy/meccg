/**
 * @module ai/h2/services/character-value
 *
 * What tapping or losing a character forgoes, beyond the marshalling points
 * that leave with it.
 *
 * This is the `hand` shadow-price pattern of §3.5 generalised to characters:
 * one number, one owner, subtracted by every consumer. The argument transfers
 * exactly — if `combat` privately guesses what a character is worth while
 * `factions` privately guesses whether he is available, the two will answer
 * inconsistently, and that inconsistency *is* the weight soup this design
 * exists to remove.
 *
 * It fixes a defect that has been recorded on every `combat` evaluation since
 * P1: a tap cost 0.3 for everyone. An influence attempt requires an **untapped**
 * character with enough free direct influence (`reducer-site.ts` validates
 * exactly that), so tapping the one character who could have attempted a
 * faction forfeits the whole attempt — which is worth far more than 0.3.
 *
 * The price is a **reservation value**: computed from the standing and the
 * roster, never from the consumer's decision. That is what keeps the services
 * a DAG — `combat` subtracts this number without `factions` ever being asked
 * about the combat.
 */

import type { CardDefinition, CardInstanceId, CompanyId, PlayerView } from '@meccg/shared';
import type { Tunables } from '../core/tunables.js';
import type { Standing } from './standing.js';
import type { Budget, CharacterBudget } from './budget.js';
import { computeBudget } from './budget.js';

/** A price with the reason it is what it is. */
export interface CharacterPrice {
  /** The cost in TSD. */
  readonly tsd: number;
  /** Why, for the rationale that spends it. */
  readonly reason: string;
}

/** What a character is worth keeping untapped and alive. */
export interface CharacterValue {
  /** What tapping this character forgoes this turn. */
  tapCost(instanceId: CardInstanceId): CharacterPrice;
  /** What losing it forgoes beyond its own marshalling points. */
  lossCost(instanceId: CardInstanceId): CharacterPrice;
}

/** The company a character belongs to, if any. */
function companyOf(view: PlayerView, instanceId: CardInstanceId): CompanyId | null {
  const company = view.self.companies.find(c => c.characters.includes(instanceId));
  return company ? company.id : null;
}

/**
 * Build the service.
 *
 * Two things are priced beyond the flat tempo, and both are rule-derived
 * rather than tuned:
 *
 * - **Influence forfeited by tapping.** Only an untapped character may attempt
 *   an influence check, so tapping the company's best influencer costs what
 *   that attempt was worth. The attempt's value is bounded by what a faction
 *   point is worth *in this standing* — zero at the half-total cap, in which
 *   case tapping him costs nothing extra after all.
 * - **Followers lost with their holder.** A character carrying followers holds
 *   them with direct influence; losing him reverts them to the general
 *   influence pool, and the mind that reverts is a hard number the budget
 *   already knows.
 */
export function computeCharacterValue(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
  budget: Budget = computeBudget(view, cardPool),
): CharacterValue {
  const priceOfInfluence = (character: CharacterBudget): number => {
    if (character.freeDirectInfluence <= 0) return 0;
    const companyId = companyOf(view, character.instanceId);
    if (!companyId) return 0;
    // Only the best influencer's tap forfeits an attempt — if someone else can
    // make the same check, tapping this one costs the tempo and no more.
    const best = budget.bestInfluencerIn(companyId);
    if (!best || best.instanceId !== character.instanceId) return 0;
    // And the attempt is only worth forfeiting if faction points are worth
    // anything: at the half-total cap this whole term is correctly zero.
    return standing.marginal.faction * tunables.influenceTapCost;
  };

  return {
    tapCost(instanceId: CardInstanceId): CharacterPrice {
      const character = budget.characters[instanceId as string];
      if (!character) return { tsd: tunables.tapTempoCost, reason: 'flat tempo — character not in play' };
      if (!character.untapped) return { tsd: 0, reason: 'already tapped or wounded — nothing more is forgone' };
      const influence = priceOfInfluence(character);
      if (influence <= 0) {
        return { tsd: tunables.tapTempoCost, reason: 'flat tempo — no influence attempt is forfeited' };
      }
      return {
        tsd: tunables.tapTempoCost + influence,
        reason: `flat tempo plus the influence attempt forfeited — ${character.freeDirectInfluence} free `
          + `direct influence, and a faction point is worth ${standing.marginal.faction} here`,
      };
    },

    lossCost(instanceId: CardInstanceId): CharacterPrice {
      const character = budget.characters[instanceId as string];
      if (!character) return { tsd: tunables.eliminationTempoCost, reason: 'flat cost — character not in play' };
      const inPlay = view.self.characters[instanceId];
      const followerMind = (inPlay?.followers ?? []).reduce((sum, id) => {
        const follower = budget.characters[id as string];
        return sum + (follower ? follower.mind : 0);
      }, 0);
      if (followerMind === 0) {
        return { tsd: tunables.eliminationTempoCost, reason: 'flat cost — no followers revert' };
      }
      return {
        tsd: tunables.eliminationTempoCost + followerMind * tunables.revertedMindCost,
        reason: `flat cost plus ${followerMind} mind of followers reverting to the general influence pool`,
      };
    },
  };
}
