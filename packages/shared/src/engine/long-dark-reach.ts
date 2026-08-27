/**
 * @module long-dark-reach
 *
 * Long Dark Reach (dm-70) — a hazard short-event playable on a moving company
 * with at least one Wilderness [{w}] in its site path, gated on the
 * card-player (the hazard player) holding at least 10 cards in their own play
 * deck.
 *
 * "Reveal the top seven cards of your play deck. One revealed Nazgûl, Dragon,
 * or a non-unique creature of your choice must immediately attack the company
 * regardless of its playability requirements (not count against the hazard
 * limit). The creature must be playable in a region besides Coastal Sea
 * [{c}]. If the creature could not normally be played on the company, modify
 * its prowess by -4. Shuffle all unused cards and return them to the top of
 * your play deck."
 *
 * Mechanically:
 * - The reveal targets the **card-player's own** play deck — unlike
 *   `reveal-deck-choose-penalty` (ba-16), which reveals the *opponent's* deck.
 * - An eligible candidate among the revealed cards is a hazard-creature whose
 *   race is Nazgûl (`Race.Ringwraith` — the engine's shared race for both
 *   Nazgûl hazard creatures and Ringwraith avatars) or Dragon, or any
 *   non-unique creature of any race — AND whose printed `keyedTo` offers at
 *   least one non-Coastal-Sea region (`creatureHasNonCoastalRegionKeying`,
 *   exported from `legal-actions/movement-hazard.ts`, the same helper A Pack
 *   at the Door tw-497 uses for its own "must be playable in a non-Coastal
 *   Sea region" clause).
 * - The choice is mandatory once at least one eligible candidate exists
 *   ("must immediately attack") — mirrors `desire-belly-choose-card`'s
 *   mandatory, no-pass shape. With none eligible, the reveal fizzles: every
 *   revealed card is immediately shuffled back to the top of the deck (no
 *   pending resolution), mirroring `reveal-deck-choose-set-aside`'s
 *   no-eligible-item fallthrough.
 * - "Regardless of its playability requirements" bypasses the creature's
 *   normal keying check entirely for legality — the attack always proceeds.
 *   Whether the creature *could* normally have been played on the company is
 *   still computed (via `creatureIsNormallyPlayableOnCompany`, delegating to
 *   the same keying-match logic the ordinary M/H hazard-play path uses)
 *   purely to decide the -4 prowess penalty.
 * - "Not count against the hazard limit" falls out for free: this attack is
 *   spawned directly by chain resolution, never through the ordinary
 *   `play-hazard` action that charges the limit.
 * - The chosen creature attacks in place — never moved out of the deck before
 *   combat, exactly like The Hunt (dm-143) / The Great Hunt (wh-91) — so no
 *   instance ever floats. `combat-finalize.ts` moves a defeated creature into
 *   the defending player's kill pile (or the card-player's discard pile under
 *   detainment), matching `hunt-attack`'s disposal block. An undefeated
 *   attack simply leaves the creature where the reshuffle below put it.
 * - The unused revealed cards are shuffled among themselves and returned to
 *   the top of the deck as soon as the choice resolves; the chosen card is
 *   left resting directly beneath them — still reachable, still in the deck —
 *   rather than vanishing, satisfying "no card instance may ever disappear
 *   from game state".
 */
import type { GameState } from '../index.js';
import type { CardInstanceId, CardDefinitionId, CompanyId, PlayerId } from '../types/common.js';
import type { CombatState } from '../types/state-combat.js';
import type { CreatureCard } from '../types/cards.js';
import { Race } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { getPlayerIndex } from '../state-utils.js';
import {
  defById, companyById, updatePlayer, makeCombatState,
  playerConvertsDetainmentToNormal, companyKeyedAttacksNormalSiteTypes,
} from './reducer-utils.js';
import { buildInPlayNames } from './recompute-derived.js';
import { resolveAttackProwess, resolveAttackStrikes, resolveAttackBody } from './effects/resolver.js';
import { isDetainmentAttack } from './detainment.js';
import { creatureHasNonCoastalRegionKeying, creatureIsNormallyPlayableOnCompany } from './legal-actions/movement-hazard.js';
import { shuffle } from '../rng.js';
import { logDetail } from './legal-actions/log.js';

/** One candidate among the revealed cards eligible to be named as the attacker. */
export interface LongDarkReachCandidate {
  readonly instanceId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
}

/**
 * Every revealed instance that is an eligible attacker: a hazard-creature
 * whose race is Nazgûl or Dragon, or any non-unique creature of any race —
 * AND playable in a region besides Coastal Sea.
 */
export function findLongDarkReachCandidates(
  state: GameState,
  revealedInstanceIds: readonly CardInstanceId[],
  cardPlayerId: PlayerId,
): LongDarkReachCandidate[] {
  const deck = state.players[getPlayerIndex(state, cardPlayerId)].playDeck;
  const candidates: LongDarkReachCandidate[] = [];
  for (const id of revealedInstanceIds) {
    const card = deck.find(c => c.instanceId === id);
    if (!card) continue;
    const def = defById(state, card.definitionId);
    if (!def || def.cardType !== 'hazard-creature') continue;
    const creatureDef = def as unknown as CreatureCard;
    const alwaysEligible = creatureDef.race === Race.Ringwraith || creatureDef.race === Race.Dragon;
    if (!alwaysEligible && creatureDef.unique) continue;
    if (!creatureHasNonCoastalRegionKeying(creatureDef)) continue;
    candidates.push({ instanceId: card.instanceId, definitionId: card.definitionId });
  }
  return candidates;
}

/**
 * Shuffle the revealed-but-unchosen cards among themselves and return them to
 * the top of `playerId`'s play deck; the chosen card (still present in the
 * deck) is left resting directly beneath them — reachable, never removed.
 */
function shuffleUnusedBackToTop(
  state: GameState,
  playerId: PlayerId,
  revealedInstanceIds: readonly CardInstanceId[],
  chosenInstanceId: CardInstanceId,
): GameState {
  const playerIdx = getPlayerIndex(state, playerId);
  const deck = state.players[playerIdx].playDeck;
  const revealedSet = new Set(revealedInstanceIds as readonly string[]);
  const unused = deck.filter(c => revealedSet.has(c.instanceId as string) && c.instanceId !== chosenInstanceId);
  const chosen = deck.find(c => c.instanceId === chosenInstanceId);
  const rest = deck.filter(c => !revealedSet.has(c.instanceId as string));
  const [shuffled, rng] = shuffle(unused, state.rng);
  const newDeck = chosen ? [...shuffled, chosen, ...rest] : [...shuffled, ...rest];
  logDetail(`Long Dark Reach: shuffling ${shuffled.length} unused revealed card(s) back to the top of ${playerId as string}'s play deck`);
  return { ...updatePlayer(state, playerIdx, p => ({ ...p, playDeck: newDeck })), rng };
}

/**
 * No eligible candidate among the revealed cards — shuffle the whole revealed
 * block back to the top of `cardPlayerId`'s play deck (all of it is "unused").
 */
export function fizzleLongDarkReach(
  state: GameState,
  cardPlayerId: PlayerId,
  revealedInstanceIds: readonly CardInstanceId[],
): GameState {
  const playerIdx = getPlayerIndex(state, cardPlayerId);
  const deck = state.players[playerIdx].playDeck;
  const revealedSet = new Set(revealedInstanceIds as readonly string[]);
  const revealed = deck.filter(c => revealedSet.has(c.instanceId as string));
  const rest = deck.filter(c => !revealedSet.has(c.instanceId as string));
  const [shuffled, rng] = shuffle(revealed, state.rng);
  logDetail(`Long Dark Reach: no eligible creature among the ${revealed.length} revealed card(s) — shuffling them all back to the top`);
  return { ...updatePlayer(state, playerIdx, p => ({ ...p, playDeck: [...shuffled, ...rest] })), rng };
}

/**
 * Build the `long-dark-reach-attack` CombatState for the chosen creature
 * attacking `companyId` normally (the whole company defends, no
 * solo-defender restriction). Shuffles the unused revealed cards back to the
 * top of the card-player's deck first. Returns null combat when the creature
 * definition or the target company cannot be resolved — the shuffle still
 * happens either way.
 */
export function buildLongDarkReachCombat(
  state: GameState,
  sourceInstanceId: CardInstanceId,
  candidate: LongDarkReachCandidate,
  revealedInstanceIds: readonly CardInstanceId[],
  cardPlayerId: PlayerId,
  defendingPlayerId: PlayerId,
  companyId: CompanyId,
): { state: GameState; combat: CombatState | null } {
  const working = shuffleUnusedBackToTop(state, cardPlayerId, revealedInstanceIds, candidate.instanceId);

  const creatureDef = defById(working, candidate.definitionId);
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') {
    return { state: working, combat: null };
  }
  const defIdx = getPlayerIndex(working, defendingPlayerId);
  const company = companyById(working.players[defIdx].companies, companyId);
  if (!company) return { state: working, combat: null };

  const cDef = creatureDef as unknown as CreatureCard;
  const inPlayNames = buildInPlayNames(working);
  const creatureRace = cDef.race;
  const attackBoostCtx = { companyId, creatureInstanceId: candidate.instanceId };
  const effectiveProwess = resolveAttackProwess(working, cDef.prowess, inPlayNames, creatureRace, false, undefined, attackBoostCtx);
  const effectiveStrikes = resolveAttackStrikes(working, cDef.strikes, inPlayNames, creatureRace, false, attackBoostCtx);
  const effectiveBody = resolveAttackBody(working, cDef.body, inPlayNames, creatureRace, attackBoostCtx);

  const normallyPlayable = working.phaseState.phase === Phase.MovementHazard
    && creatureIsNormallyPlayableOnCompany(cDef, working.phaseState, working, company);
  const penalty = normallyPlayable ? 0 : -4;
  logDetail(
    `Long Dark Reach: ${creatureRace} "${creatureDef.name}" (${effectiveStrikes} strikes, ${effectiveProwess} prowess) `
    + `forced to attack company ${companyId as string} — `
    + `${normallyPlayable ? 'normally playable on the company, no penalty' : `not normally playable, ${penalty} prowess`}`,
  );

  const combat = makeCombatState(working, {
    attackSource: { type: 'long-dark-reach-attack', sourceInstanceId, creatureInstanceId: candidate.instanceId },
    companyId,
    defendingPlayerId,
    attackingPlayerId: cardPlayerId,
    strikesTotal: effectiveStrikes,
    strikeProwess: effectiveProwess + penalty,
    creatureBody: effectiveBody,
    creatureRace,
    assignmentPhase: 'defender',
    detainment: isDetainmentAttack({
      attackEffects: cDef.effects,
      attackRace: creatureRace,
      attackKeyedTo: cDef.keyedTo,
      inPlayNames,
      defendingAlignment: working.players[defIdx].alignment,
      defenderForcesNormalAttacks: playerConvertsDetainmentToNormal(working, working.players[defIdx]),
      // No declared keying (the attack bypasses the creature's normal keying
      // check entirely) — falls back to the union of the creature's
      // currently-valid keyedTo site types, exactly like The Hunt (dm-143).
      normalIfKeyedToSiteTypes: companyKeyedAttacksNormalSiteTypes(working, companyId),
    }),
  });
  return { state: working, combat };
}
