/**
 * @module held-creature
 *
 * Creatures kept "off to the side" with a hazard attached to a character —
 * Foes Shall Fall (dm-59): "If the strike is not defeated, place creature's
 * card with Foes Shall Fall—creature is considered off to the side. Target
 * character's company faces an attack from creature at the start of each
 * movement/hazard phase if creature is playable. Discard associated
 * creature's card if Foes Shall Fall is discarded. Discard Foes Shall Fall if
 * attached Dragon or Drake is defeated."
 *
 * The held creature lives in the host hazard's `CardInPlay.heldCreature` slot
 * on the bearer (the host is an ordinary character hazard, so its own
 * `stat-modifier` effects keep flowing to the bearer). This module owns:
 *
 * - {@link holdableAttackCreatureInstanceId} — which attacks have a creature
 *   card that can be held (gates the `attack.holdableCreature` play-target
 *   context field);
 * - {@link settlePendingHeldCreature} — the end-of-attack resolution of a
 *   freshly played holder (`hold-creature-if-strike-not-defeated`);
 * - {@link nextHeldCreatureAttack} / {@link liftHeldCreature} — the
 *   start-of-M/H recurring attack (driven from `handleOrderEffects`);
 * - {@link settleHeldCreatureAttack} — return the creature to its holder
 *   after an undefeated recurring attack, or discard the holder after a
 *   defeat;
 * - {@link sweepOrphanedHeldCreatures} — the `postReduce` safety net that
 *   discards a held creature whose holder left play by any path.
 *
 * Both settle functions are called from every attack-teardown path (normal
 * finalization and cancellation), after the generic creature disposal has
 * already routed the creature to the attacker's discard pile / defender's
 * kill pile.
 */

import type { GameState, CombatState, CardInstance, CardInstanceId, CardInPlay, MovementHazardPhaseState } from '../index.js';
import { getPlayerIndex } from '../state-utils.js';
import { resolveInstanceId } from '../types/state.js';
import { logDetail } from './legal-actions/log.js';
import { cardName, defById, getCardEffects, updateCharacter, updatePlayer } from './reducer-utils.js';

/**
 * The attack's creature card, when the attack is a hazard-creature attack
 * whose card could be placed off to the side: a creature played from hand
 * (M/H or on-guard), or one that attacks in place out of the hazard player's
 * deck/discard (The Hunt dm-143, Long Dark Reach dm-70). A creature already
 * attacking out of a holder is excluded — its card is already with another
 * card. Null for every other attack source.
 */
export function holdableAttackCreatureInstanceId(combat: CombatState): CardInstanceId | null {
  const src = combat.attackSource;
  switch (src.type) {
    case 'creature': return src.heldByHostInstanceId ? null : src.instanceId;
    case 'on-guard-creature': return src.cardInstanceId;
    case 'hunt-attack': return src.creatureInstanceId;
    case 'long-dark-reach-attack': return src.creatureInstanceId;
    default: return null;
  }
}

interface HolderLocation {
  readonly playerIndex: number;
  readonly characterId: CardInstanceId;
  readonly host: CardInPlay;
}

/** Locate an in-play character hazard by instance ID across both players. */
function findHolder(state: GameState, hostInstanceId: CardInstanceId): HolderLocation | null {
  for (let pi = 0; pi < state.players.length; pi++) {
    for (const ch of Object.values(state.players[pi].characters)) {
      const host = ch.hazards.find(h => h.instanceId === hostInstanceId);
      if (host) return { playerIndex: pi, characterId: ch.instanceId, host };
    }
  }
  return null;
}

/** Replace the holder hazard on its bearer. */
function updateHolder(state: GameState, loc: HolderLocation, fn: (h: CardInPlay) => CardInPlay): GameState {
  return updatePlayer(state, loc.playerIndex, p => updateCharacter(p, loc.characterId, c => ({
    ...c,
    hazards: c.hazards.map(h => (h.instanceId === loc.host.instanceId ? fn(h) : h)),
  })));
}

/**
 * Discard a holder from its bearer to its owner's (the bearer's opponent's)
 * discard pile, together with any creature it still holds.
 */
function discardHolder(state: GameState, loc: HolderLocation): GameState {
  const ownerIdx = 1 - loc.playerIndex;
  const { heldCreature, ...bare } = loc.host;
  let next = updatePlayer(state, loc.playerIndex, p => updateCharacter(p, loc.characterId, c => ({
    ...c,
    hazards: c.hazards.filter(h => h.instanceId !== loc.host.instanceId),
  })));
  next = updatePlayer(next, ownerIdx, p => ({
    ...p,
    discardPile: [
      ...p.discardPile,
      { instanceId: bare.instanceId, definitionId: bare.definitionId },
      ...(heldCreature ? [heldCreature] : []),
    ],
  }));
  return next;
}

/**
 * Pull `creatureInstanceId` out of the attacking player's discard pile (or
 * play deck, for creatures that attack in place) — where the generic
 * creature disposal leaves an undefeated creature. Null if it is elsewhere
 * (e.g. forced into the kill pile).
 */
function takeUndefeatedCreature(
  state: GameState,
  attackerIdx: number,
  creatureInstanceId: CardInstanceId,
): { state: GameState; creature: CardInstance } | null {
  const attacker = state.players[attackerIdx];
  const creature = attacker.discardPile.find(c => c.instanceId === creatureInstanceId)
    ?? attacker.playDeck.find(c => c.instanceId === creatureInstanceId);
  if (!creature) return null;
  const next = updatePlayer(state, attackerIdx, p => ({
    ...p,
    discardPile: p.discardPile.filter(c => c.instanceId !== creatureInstanceId),
    playDeck: p.playDeck.filter(c => c.instanceId !== creatureInstanceId),
  }));
  return { state: next, creature: { instanceId: creature.instanceId, definitionId: creature.definitionId } };
}

/**
 * Resolve `combat.pendingHeldCreature` once the attack it was played into has
 * ended: a defeated strike discards the holder; any other outcome (wounded,
 * eliminated, tie, canceled, …) places the creature's card off to the side
 * with it. A holder that already left play (its bearer was eliminated) is
 * left alone — the creature simply stays discarded.
 */
export function settlePendingHeldCreature(state: GameState, combat: CombatState): GameState {
  const pending = combat.pendingHeldCreature;
  if (!pending) return state;
  const loc = findHolder(state, pending.hostInstanceId);
  const label = loc ? cardName(state, loc.host.definitionId) : `held-creature host ${pending.hostInstanceId as string}`;
  if (!loc) {
    logDetail(`${label}: no longer in play at the end of the attack — creature not held`);
    return state;
  }
  const strike = combat.strikeAssignments[pending.strikeIndex];
  const defeated = strike?.characterId === pending.targetCharacterId && strike.result === 'success';
  if (defeated) {
    logDetail(`${label}: strike against ${pending.targetCharacterId as string} was defeated — discarding`);
    return discardHolder(state, loc);
  }
  const attackerIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const taken = takeUndefeatedCreature(state, attackerIdx, pending.creatureInstanceId);
  if (!taken) {
    logDetail(`${label}: strike not defeated, but the creature card is no longer available — nothing to hold`);
    return state;
  }
  logDetail(`${label}: strike not defeated (${strike?.result ?? 'no result'}) — placing "${cardName(state, taken.creature.definitionId, '?')}" off to the side with it`);
  return updateHolder(taken.state, loc, h => ({ ...h, heldCreature: taken.creature }));
}

/**
 * After an attack by a held creature (`AttackSource.heldByHostInstanceId`):
 * if the attack was defeated the holder is discarded (the creature itself was
 * already routed to the defender's kill pile); otherwise the creature returns
 * off to the side with its holder. If the holder left play during the attack
 * the creature stays in the discard pile.
 */
export function settleHeldCreatureAttack(state: GameState, combat: CombatState, defeated: boolean): GameState {
  const src = combat.attackSource;
  if (src.type !== 'creature' || !src.heldByHostInstanceId) return state;
  const loc = findHolder(state, src.heldByHostInstanceId);
  const creatureDefId = resolveInstanceId(state, src.instanceId);
  const creatureLabel = creatureDefId ? cardName(state, creatureDefId) : (src.instanceId as string);
  if (defeated) {
    if (!loc) return state;
    logDetail(`Held creature "${creatureLabel}" defeated — discarding its holder "${cardName(state, loc.host.definitionId, '?')}"`);
    return discardHolder(state, loc);
  }
  if (!loc) {
    logDetail(`Held creature "${creatureLabel}": holder left play during the attack — creature stays discarded`);
    return state;
  }
  const attackerIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const taken = takeUndefeatedCreature(state, attackerIdx, src.instanceId);
  if (!taken) return state;
  logDetail(`Held creature "${creatureLabel}" not defeated — returning off to the side with "${cardName(state, loc.host.definitionId, '?')}"`);
  return updateHolder(taken.state, loc, h => ({ ...h, heldCreature: taken.creature }));
}

/**
 * The next `held-creature-attack` holder on a character of the active M/H
 * company whose start-of-phase attack has not yet been handled this
 * order-effects step. Null when none remain.
 */
export function nextHeldCreatureAttack(
  state: GameState,
  mhState: MovementHazardPhaseState,
): { readonly characterId: CardInstanceId; readonly host: CardInPlay; readonly creature: CardInstance } | null {
  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[activeIdx];
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company) return null;
  const faced = new Set((mhState.heldCreatureAttacksFaced ?? []) as readonly string[]);
  for (const charId of company.characters) {
    const ch = player.characters[charId];
    if (!ch) continue;
    for (const h of ch.hazards) {
      if (!h.heldCreature || faced.has(h.instanceId as string)) continue;
      if (!getCardEffects(defById(state, h.definitionId)).some(e => e.type === 'held-creature-attack')) continue;
      return { characterId: charId, host: h, creature: h.heldCreature };
    }
  }
  return null;
}

/** Remove the held creature from its holder so it can attack. */
export function liftHeldCreature(state: GameState, hostInstanceId: CardInstanceId): GameState {
  const loc = findHolder(state, hostInstanceId);
  if (!loc) return state;
  return updateHolder(state, loc, h => {
    const { heldCreature: _c, ...rest } = h;
    void _c;
    return rest;
  });
}

/**
 * Put a lifted creature back on its holder — used when the attack never
 * started (e.g. canceled outright on initiation), which leaves the creature
 * undefeated. Pulls it back out of the attacker's discard pile if the
 * initiation path already discarded it.
 */
export function restoreHeldCreature(state: GameState, hostInstanceId: CardInstanceId, creature: CardInstance): GameState {
  const loc = findHolder(state, hostInstanceId);
  if (!loc) return state;
  const attackerIdx = 1 - loc.playerIndex;
  const next = updatePlayer(state, attackerIdx, p => ({
    ...p,
    discardPile: p.discardPile.filter(c => c.instanceId !== creature.instanceId),
  }));
  return updateHolder(next, loc, h => ({ ...h, heldCreature: creature }));
}

/**
 * `postReduce` safety net: a holder can leave play through any of the
 * engine's many character-hazard removal paths (bearer eliminated, removal
 * roll, discard effects, …), none of which know about `heldCreature`. For
 * every creature held in `prevState` that is no longer reachable in
 * `nextState`, discard it to its owner — the holder's owner, i.e. the
 * opponent of the bearer's player ("Discard associated creature's card if
 * Foes Shall Fall is discarded").
 */
export function sweepOrphanedHeldCreatures(prevState: GameState, nextState: GameState): GameState {
  let result = nextState;
  for (let pi = 0; pi < prevState.players.length; pi++) {
    for (const ch of Object.values(prevState.players[pi].characters)) {
      for (const h of ch.hazards) {
        const held = h.heldCreature;
        if (!held) continue;
        if (resolveInstanceId(result, held.instanceId) !== undefined) continue;
        const ownerIdx = 1 - pi;
        logDetail(`Held creature ${held.instanceId as string}: holder ${h.instanceId as string} left play — discarding the creature to player ${ownerIdx}`);
        result = updatePlayer(result, ownerIdx, p => ({ ...p, discardPile: [...p.discardPile, held] }));
      }
    }
  }
  return result;
}
