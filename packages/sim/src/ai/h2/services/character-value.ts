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
import { memoizeOnFirst } from '../core/memo.js';
import { pAtMost } from '../core/dice.js';
import type { MpDelta, MpSource } from '../core/tsd.js';
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
  /**
   * What handing this character `added` more corruption points is worth, in
   * TSD — the rise in the odds of failing a check, times what failing costs.
   */
  corruptionRisk(instanceId: CardInstanceId, added: number): CharacterPrice;
  /**
   * What taking `removed` corruption points *off* this character is worth.
   *
   * The mirror of {@link corruptionRisk} and deliberately a separate method
   * rather than a negative argument: both return a positive magnitude, so a
   * caller reading one cannot accidentally spend the other with the wrong sign.
   */
  corruptionRelief(instanceId: CardInstanceId, removed: number): CharacterPrice;
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
function buildComputeCharacterValue(
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

  /** Everything that leaves play with a character: its points and its items'. */
  const lossDelta = (instanceId: CardInstanceId): MpDelta => {
    const delta: Record<string, number> = {};
    const character = view.self.characters[instanceId];
    if (!character) return delta;
    const add = (definitionId: string): void => {
      const fields = cardPool[definitionId] as unknown as
        { marshallingPoints?: number; marshallingCategory?: string } | undefined;
      const points = fields?.marshallingPoints ?? 0;
      if (points === 0) return;
      const source = (fields?.marshallingCategory ?? 'misc') as MpSource;
      delta[source] = (delta[source] ?? 0) - points;
    };
    add(character.definitionId);
    for (const item of character.items) add(item.definitionId);
    for (const ally of character.allies) add(ally.definitionId);
    return delta;
  };

  /** The flat cost of losing a character, shared by both consumers below. */
  const lossCostOf = (instanceId: CardInstanceId): CharacterPrice => {
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
  };

  return {
    corruptionRisk(instanceId: CardInstanceId, added: number): CharacterPrice {
      const character = view.self.characters[instanceId];
      if (!character || added <= 0) return { tsd: 0, reason: 'no corruption added' };
      // A corruption check succeeds on a roll *above* the character's
      // corruption points (`corruption-check`, CoE 7.1), so more points means
      // a wider failing band. The rise is what carrying this card costs.
      const before = character.effectiveStats.corruptionPoints;
      const deltaFail = pAtMost(before + added) - pAtMost(before);
      if (deltaFail <= 0) return { tsd: 0, reason: 'the failing band is already as wide as it gets' };
      // A positive magnitude, like every other price this service returns:
      // the marshalling points that would leave play plus what losing the
      // character costs beyond them.
      const onFailure = (standing.tsd - standing.tsdAfter(lossDelta(instanceId)))
        + lossCostOf(instanceId).tsd;
      return {
        tsd: deltaFail * onFailure,
        reason: `corruption ${before} → ${before + added} widens the failing band by `
          + `${(deltaFail * 100).toFixed(1)}%, against ${onFailure.toFixed(1)} tsd lost if it fails`,
      };
    },

    corruptionRelief(instanceId: CardInstanceId, removed: number): CharacterPrice {
      const character = view.self.characters[instanceId];
      if (!character || removed <= 0) return { tsd: 0, reason: 'no corruption removed' };
      const before = character.effectiveStats.corruptionPoints;
      const after = Math.max(0, before - removed);
      const deltaFail = pAtMost(before) - pAtMost(after);
      if (deltaFail <= 0) return { tsd: 0, reason: 'he was not going to fail a check on this' };
      const onFailure = (standing.tsd - standing.tsdAfter(lossDelta(instanceId)))
        + lossCostOf(instanceId).tsd;
      return {
        tsd: deltaFail * onFailure,
        reason: `corruption ${before} → ${after} narrows the failing band by `
          + `${(deltaFail * 100).toFixed(1)}%, against ${onFailure.toFixed(1)} tsd lost if it fails`,
      };
    },

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

    lossCost: lossCostOf,
  };
}

/**
 * Build the service, once per position.
 *
 * The registry asks every module about every candidate on a decision and hands
 * them all the same view, so this would otherwise be rebuilt once per
 * candidate for an answer that cannot differ. See `core/memo`.
 */
export const computeCharacterValue = memoizeOnFirst(buildComputeCharacterValue);
