/**
 * @module hunt
 *
 * The Hunt (dm-143) — Alatar's short-event resource event.
 *
 * "Playable on Alatar during the organization phase. Name a specific hazard
 * creature card your opponent revealed to you through a mechanism of the
 * game and discarded. Unless eliminated or prevented from being in play,
 * your opponent then finds this particular card (reshuffling his play deck
 * if it was searched). This creature immediately attacks Alatar as though he
 * were a one-character company. Alatar cannot use or benefit from spells
 * against the attack. If untapped, tap Alatar afterwards."
 *
 * Mechanically:
 * - A "specific hazard creature card your opponent revealed to you" is any
 *   instance whose identity is recorded in `GameState.handRevealedInstances`
 *   (the engine's ledger of cards revealed while sitting in an otherwise
 *   private pile — see `visibility.ts`). "Unless eliminated or prevented from
 *   being in play" is modeled by only offering instances still reachable in
 *   the opponent's play deck or discard pile — a creature moved to the kill
 *   pile / out-of-play, or one that was never a hazard-creature, is simply
 *   not a candidate.
 * - "Your opponent then finds this particular card" — the creature is never
 *   moved out of its pile; it is attacked in place, exactly like The Great
 *   Hunt (wh-91) or Lucky Search (tw-269). If it was found in the play deck,
 *   the deck is reshuffled once it is named ("reshuffling his play deck if it
 *   was searched"); a discard-pile find needs no reshuffle.
 * - "As though he were a one-character company" is `CombatState.
 *   soloDefenderInstanceId` — no other member of the bearer's actual company
 *   may be assigned a strike.
 * - A defeated attack still awards kill marshalling points (CoE rule 964):
 *   `combat-finalize.ts` moves the creature out of whichever pile it was
 *   attacked from and into the defending player's kill pile, same as any
 *   other creature attack (barring detainment, CoE 3.II.3). An undefeated
 *   attack leaves it exactly where it already was.
 * - "Cannot use or benefit from spells against the attack" is `CombatState.
 *   spellsIneffective`, enforced centrally in `legal-actions/combat.ts`
 *   (`cancelAttackActions`) and `effects/resolver.ts`
 *   (`collectCreatureAttackBoostEffects`).
 * - "If untapped, tap [the bearer] afterwards" is applied in
 *   `combat-finalize.ts` / `combat-cancel.ts` once the forced attack
 *   concludes, whichever way it concludes.
 */
import type { GameState } from '../index.js';
import type { CardInstanceId, CardDefinitionId, CompanyId, PlayerId } from '../types/common.js';
import type { CombatState } from '../types/state-combat.js';
import { CardStatus } from '../types/common.js';
import { getPlayerIndex } from '../state-utils.js';
import {
  defById, companyById, updatePlayer, updateCharacter, makeCombatState,
  playerConvertsDetainmentToNormal, companyKeyedAttacksNormalSiteTypes,
} from './reducer-utils.js';
import { buildInPlayNames } from './recompute-derived.js';
import { resolveAttackProwess, resolveAttackStrikes, resolveAttackBody } from './effects/resolver.js';
import { isDetainmentAttack } from './detainment.js';
import { shuffle } from '../rng.js';
import { logDetail } from './legal-actions/log.js';
import { forgetDeckReveals } from './visibility.js';

/** One candidate hazard-creature The Hunt may name. */
export interface HuntCandidate {
  readonly instanceId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly source: 'deck' | 'discard';
}

/**
 * Every hazard-creature instance in `opponentId`'s play deck or discard pile
 * whose identity is already known to the opponent's controller (recorded in
 * `GameState.revealedInstances`) — the engine's model of "a specific hazard
 * creature card your opponent revealed to you ... and discarded". This is
 * deliberately the broad reveal ledger, not the narrower
 * `GameState.handRevealedInstances` (which exists only to drive hand/play-deck
 * *redaction* in `projection.ts`): CRF 22 rules "the discarding and revealing
 * of the card do not have to be in any specific order", so a creature that
 * was simply seen attacking — and is later reshuffled back into the deck or
 * sits in the discard pile — counts as "revealed to you" just as much as one
 * exposed by an explicit peek/reveal effect.
 */
export function findHuntCandidates(state: GameState, opponentId: PlayerId): readonly HuntCandidate[] {
  const opponentIndex = getPlayerIndex(state, opponentId);
  const opponent = state.players[opponentIndex];
  const isKnownHazardCreature = (definitionId: CardDefinitionId, instanceId: CardInstanceId): boolean => {
    if (state.revealedInstances[instanceId] !== definitionId) return false;
    const def = defById(state, definitionId);
    return !!def && 'cardType' in def && (def as { cardType: string }).cardType === 'hazard-creature';
  };
  const candidates: HuntCandidate[] = [];
  for (const card of opponent.playDeck) {
    if (isKnownHazardCreature(card.definitionId, card.instanceId)) {
      candidates.push({ instanceId: card.instanceId, definitionId: card.definitionId, source: 'deck' });
    }
  }
  for (const card of opponent.discardPile) {
    if (isKnownHazardCreature(card.definitionId, card.instanceId)) {
      candidates.push({ instanceId: card.instanceId, definitionId: card.definitionId, source: 'discard' });
    }
  }
  return candidates;
}

/** Shuffle the opponent's play deck (The Hunt "reshuffling his play deck if it was searched"). */
function reshuffleOpponentDeck(state: GameState, opponentIndex: number): GameState {
  const [reshuffled, rng] = shuffle(state.players[opponentIndex].playDeck, state.rng);
  logDetail(`The Hunt: reshuffling ${reshuffled.length}-card play deck (searched, not found in discard)`);
  return forgetDeckReveals(
    { ...updatePlayer(state, opponentIndex, p => ({ ...p, playDeck: reshuffled })), rng },
    opponentIndex,
  );
}

/**
 * Build the `hunt-attack` CombatState for `creatureInstanceId` (an instance
 * sitting in the opponent's deck or discard) attacking `bearerInstanceId` as a
 * one-character company. Reshuffles the opponent's play deck first if the
 * creature was found there. Returns null when the creature definition, the
 * bearer, or the bearer's company cannot be resolved.
 */
export function buildHuntCombat(
  state: GameState,
  huntInstanceId: CardInstanceId,
  candidate: HuntCandidate,
  bearerInstanceId: CardInstanceId,
  controllerId: PlayerId,
  opponentId: PlayerId,
  companyId: CompanyId,
): { state: GameState; combat: CombatState | null } {
  let working = state;
  if (candidate.source === 'deck') {
    working = reshuffleOpponentDeck(working, getPlayerIndex(working, opponentId));
  }

  const creatureDef = defById(working, candidate.definitionId);
  if (!creatureDef || !('strikes' in creatureDef) || (creatureDef as { cardType?: string }).cardType !== 'hazard-creature') {
    return { state: working, combat: null };
  }
  const controllerIndex = getPlayerIndex(working, controllerId);
  const company = companyById(working.players[controllerIndex].companies, companyId);
  if (!company) return { state: working, combat: null };

  const cDef = creatureDef as unknown as {
    prowess: number; strikes: number; body: number | null; race: import('../types/common.js').Race;
    keyedTo: readonly import('../types/cards.js').CreatureKeyRestriction[];
    effects?: readonly import('../types/effects.js').CardEffect[];
  };
  const inPlayNames = buildInPlayNames(working);
  const creatureRace = cDef.race;
  const attackBoostCtx = { companyId, creatureInstanceId: candidate.instanceId, suppressSpellSources: true };
  const effectiveProwess = resolveAttackProwess(working, cDef.prowess, inPlayNames, creatureRace, false, undefined, attackBoostCtx);
  const effectiveStrikes = resolveAttackStrikes(working, cDef.strikes, inPlayNames, creatureRace, false, attackBoostCtx);
  const effectiveBody = resolveAttackBody(working, cDef.body, inPlayNames, creatureRace, attackBoostCtx);

  logDetail(
    `The Hunt: ${creatureRace} "${creatureDef.name}" (${effectiveStrikes} strikes, ${effectiveProwess} prowess) `
    + `found in ${opponentId as string}'s ${candidate.source} — forced to attack ${bearerInstanceId as string} alone`,
  );

  const combat = makeCombatState(working, {
    attackSource: {
      type: 'hunt-attack',
      huntInstanceId,
      creatureInstanceId: candidate.instanceId,
      bearerInstanceId,
    },
    companyId,
    defendingPlayerId: controllerId,
    attackingPlayerId: opponentId,
    strikesTotal: effectiveStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: effectiveBody,
    creatureRace,
    soloDefenderInstanceId: bearerInstanceId,
    spellsIneffective: true,
    assignmentPhase: 'defender',
    detainment: isDetainmentAttack({
      attackEffects: cDef.effects,
      attackRace: creatureRace,
      attackKeyedTo: cDef.keyedTo,
      inPlayNames,
      defendingAlignment: working.players[controllerIndex].alignment,
      defenderForcesNormalAttacks: playerConvertsDetainmentToNormal(working, working.players[controllerIndex]),
      // The Hunt attack has no declared keying — the override falls back to
      // the union of the creature's currently-valid keyedTo site types.
      normalIfKeyedToSiteTypes: companyKeyedAttacksNormalSiteTypes(working, companyId),
    }),
  });
  return { state: working, combat };
}

/**
 * Tap `bearerInstanceId` if untapped ("If untapped, tap Alatar afterwards"),
 * once a `hunt-attack` combat concludes (finalized or canceled).
 */
export function tapHuntBearerAfterwards(state: GameState, defendingPlayerId: PlayerId, bearerInstanceId: CardInstanceId): GameState {
  const defIdx = getPlayerIndex(state, defendingPlayerId);
  return updatePlayer(state, defIdx, p => updateCharacter(p, bearerInstanceId as string, ch => {
    if (ch.status !== CardStatus.Untapped) return ch;
    logDetail(`The Hunt: tapping ${bearerInstanceId as string} (was untapped) after the forced attack`);
    return { ...ch, status: CardStatus.Tapped };
  }));
}
