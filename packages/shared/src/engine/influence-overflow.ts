/**
 * @module influence-overflow
 *
 * CoE 3.47 — the end-of-organization-phase general-influence overflow.
 *
 * A player's non-follower characters are paid for out of their general
 * influence, but the total can drift above the pool *between* organization
 * phases: a controlling character is eliminated and its followers revert to
 * general influence (CoE 2.II.2.2.3), an in-play general-influence bonus is
 * discarded, a character's mind is raised. The rule tolerates the excess for
 * the rest of the turn and settles it at one fixed point — the moment the
 * player leaves their organization phase — by forcing them to remove
 * non-avatar characters until they are back within the pool.
 *
 * The removals follow a strict order, so this module exposes a single
 * {@link influenceOverflowStep} that answers "what may the player remove
 * *next*" and lets the caller (legal actions, reducer, enqueue site) share one
 * interpretation of the rule:
 *
 * 1. Characters brought into play during this organization phase — returned to
 *    the player's **hand**, since they were only just paid for.
 * 2. Characters that lost direct-influence control between organization phases
 *    and were never reassigned during this one — **discarded**.
 * 3. Anything else the player picks — **discarded**.
 *
 * Avatars are never candidates (they cannot be discarded while organizing,
 * CoE 3.22), and neither are characters whose control costs the pool nothing
 * (followers, prisoners, influence-exempt characters): removing one could not
 * reduce the overflow, so offering it would only stall the resolution.
 */

import type { GameState, PlayerId, CardInstanceId, CharacterInPlay } from '../index.js';
import { isAvatarCharacter, isCharacterCard } from '../types/cards.js';
import { companyExemptsCharacterFromInfluence } from './company-composition.js';
import { controlCostOf } from './control-cost.js';
import { characterBearsAttachedEffect, defById, findCharacterCompany, generalInfluenceControlLimit, playerById } from './reducer-utils.js';

/** Which tier of CoE 3.47 the current step is drawing from. */
export type InfluenceOverflowTier = 'played-this-turn' | 'uncontrolled' | 'free-choice';

/** The candidates a player may remove next, and what happens to the one they pick. */
export interface InfluenceOverflowStep {
  /** The rule tier these candidates come from. */
  readonly tier: InfluenceOverflowTier;
  /** Where the removed character card goes. Tier 1 characters go back to hand. */
  readonly destination: 'hand' | 'discard';
  /** Characters the player may remove at this step (never empty). */
  readonly candidateIds: readonly CardInstanceId[];
}

/**
 * How far `playerId` is above the general influence they may spend on
 * controlling characters. Zero (or negative, clamped to zero) when within it.
 */
export function influenceOverflowAmount(state: GameState, playerId: PlayerId): number {
  const player = playerById(state, playerId);
  if (!player) return 0;
  return Math.max(0, player.generalInfluenceUsed - generalInfluenceControlLimit(state, playerId));
}

/**
 * Whether removing `char` would actually free general influence — i.e. it is
 * one of the characters the pool is currently being charged for. Mirrors the
 * condition {@link recomputeDerived} uses to accumulate `generalInfluenceUsed`.
 */
function chargesGeneralInfluence(state: GameState, playerId: PlayerId, char: CharacterInPlay): boolean {
  const player = playerById(state, playerId);
  if (!player) return false;
  if (char.controlledBy !== 'general' || char.influenceUnsubtracted) return false;
  const charDef = defById(state, char.definitionId);
  if (!isCharacterCard(charDef) || charDef.mind === null) return false;
  const isPrisoner = state.activeConstraints.some(
    c => c.target.kind === 'character'
      && c.target.characterId === char.instanceId
      && (c.kind.type === 'character-is-prisoner' || c.kind.type === 'character-pressed' || c.kind.type === 'character-captured-by-bearer'),
  );
  if (isPrisoner) return false;
  const company = findCharacterCompany(player.companies, char.instanceId);
  const exempt = characterBearsAttachedEffect(state, char, 'general-influence-exempt')
    || companyExemptsCharacterFromInfluence(state, company?.id, charDef, char.effectiveStats.mind ?? undefined);
  if (exempt) return false;
  return (controlCostOf(state, char, char.effectiveStats.mind ?? charDef.mind) ?? 0) > 0;
}

/** Every character of `playerId` that could be removed to relieve the overflow. */
function removableCharacters(state: GameState, playerId: PlayerId): readonly CardInstanceId[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  return Object.values(player.characters)
    .filter(char => {
      const charDef = defById(state, char.definitionId);
      if (!isCharacterCard(charDef) || isAvatarCharacter(charDef)) return false;
      return chargesGeneralInfluence(state, playerId, char);
    })
    .map(char => char.instanceId);
}

/**
 * The next removal the CoE 3.47 overflow demands of `playerId`, or `null` when
 * the player is back within their general influence (or nothing removable is
 * left, in which case the resolution has done all it can).
 *
 * `playedThisTurnIds` and `uncontrolledIds` are the tier-1 and tier-2 id lists
 * captured when the resolution was enqueued; both are re-filtered against live
 * state here, so a character that left play as collateral of an earlier removal
 * simply drops out of its tier.
 */
export function influenceOverflowStep(
  state: GameState,
  playerId: PlayerId,
  playedThisTurnIds: readonly CardInstanceId[],
  uncontrolledIds: readonly CardInstanceId[],
): InfluenceOverflowStep | null {
  if (influenceOverflowAmount(state, playerId) === 0) return null;
  const removable = new Set(removableCharacters(state, playerId));
  if (removable.size === 0) return null;

  const tier1 = playedThisTurnIds.filter(id => removable.has(id));
  if (tier1.length > 0) return { tier: 'played-this-turn', destination: 'hand', candidateIds: tier1 };

  const tier2 = uncontrolledIds.filter(id => removable.has(id));
  if (tier2.length > 0) return { tier: 'uncontrolled', destination: 'discard', candidateIds: tier2 };

  return { tier: 'free-choice', destination: 'discard', candidateIds: [...removable] };
}
