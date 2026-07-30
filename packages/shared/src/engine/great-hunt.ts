/**
 * @module great-hunt
 *
 * The Great Hunt (wh-91) — Alatar's signature stage permanent-event.
 *
 * The card has two mechanics, both driven by the `reveal-and-attack` effect:
 *
 * 1. **On-play reveal-and-attack.** When the card enters play a
 *    `great-hunt-source` pending resolution asks the controller whether the
 *    opponent reveals from their play deck or their discard pile. On that
 *    choice the engine scans the chosen pile top-down, collecting up to
 *    `maxCreatures` hazard-creature instances; each attacks the controller's
 *    Alatar company in turn (a `great-hunt-attack` combat with `continuation:
 *    'reveal'`). The revealed cards never leave their pile — exactly like Lucky
 *    Search (tw-269) — so no instance is lost; if the play deck was used it is
 *    reshuffled when the sequence completes. A `great-hunt-reveal` constraint
 *    holds the queue between the interactive combats; combat finalization
 *    advances it (see {@link advanceGreatHuntReveal}).
 *
 * 2. **Ongoing discard trigger.** While the card is in play a
 *    `great-hunt-active` tracker constraint records every hazard-creature the
 *    opponent has discarded that has already been offered. On each post-reduce
 *    pass, during the controller's own turn, {@link sweepGreatHuntDiscards}
 *    finds hazard-creatures newly present in the opponent's discard pile and
 *    offers a `great-hunt-discard-attack` for each — "you may have it attack
 *    Alatar's company instead". Ruling: each discarded creature instance is
 *    offered at most once (recorded in the tracker), so the unbounded printed
 *    wording cannot loop forever, and the pre-existing discard pile at play
 *    time is seeded as already-processed so only *new* discards fire.
 *
 * Both attack modes reference the creature in place (deck/discard) via its
 * instance id and read its stats from the card definition, never moving it —
 * `great-hunt-attack` is not one of the attack-source types finalization
 * disposes of, so the creature stays where it is and is neither discarded nor
 * awarded as a trophy.
 */
import type { GameState } from '../index.js';
import type { CardInstanceId, CompanyId, PlayerId, CardDefinitionId } from '../types/common.js';
import type { CombatState } from '../types/state-combat.js';
import type { ActiveConstraint } from '../types/pending.js';
import type { RevealAndAttackEffect } from '../types/effects.js';
import type { Race } from '../types/common.js';
import { getPlayerIndex } from '../state-utils.js';
import { resolveInstanceId } from '../types/state.js';
import {
  defById, cardName, updatePlayer, companyById, getCardEffects,
  playerConvertsDetainmentToNormal, companyKeyedAttacksNormalSiteTypes, makeCombatState,
} from './reducer-utils.js';
import { buildInPlayNames } from './recompute-derived.js';
import { resolveAttackProwess, resolveAttackStrikes, resolveAttackBody } from './effects/resolver.js';
import { isDetainmentAttack } from './detainment.js';
import { addConstraint, removeConstraint, enqueueResolution } from './pending.js';
import { revealInstances } from './visibility.js';
import { shuffle } from '../rng.js';
import { logDetail } from './legal-actions/log.js';

/** The `reveal-and-attack` effect on a card definition, if any. */
export function findRevealAndAttackEffect(
  def: ReturnType<typeof defById>,
): RevealAndAttackEffect | undefined {
  return getCardEffects(def).find(
    (e): e is RevealAndAttackEffect => e.type === 'reveal-and-attack',
  );
}

/** Whether a definition id names a hazard-creature card. */
function isHazardCreatureDefId(state: GameState, defId: CardDefinitionId | undefined): boolean {
  if (!defId) return false;
  const def = defById(state, defId);
  return !!def && 'cardType' in def && (def as { cardType: string }).cardType === 'hazard-creature';
}

/**
 * Find the id of the controller's company that contains their revealed
 * avatar character named `avatarName` (e.g. "Alatar"). Returns null when the
 * avatar is not in play / not in any company — the ability then cannot fire.
 */
export function findAvatarCompanyId(
  state: GameState,
  playerIndex: number,
  avatarName: string,
): CompanyId | null {
  const player = state.players[playerIndex];
  for (const company of player.companies) {
    for (const charId of company.characters) {
      const char = player.characters[charId];
      if (!char) continue;
      const def = defById(state, char.definitionId);
      if (def && def.name === avatarName) return company.id;
    }
  }
  return null;
}

/**
 * Build a `great-hunt-attack` CombatState for `creatureInstanceId` (an instance
 * sitting in the opponent's deck or discard) attacking the controller's Alatar
 * company. Returns null when the creature definition or company is missing.
 */
export function buildGreatHuntCombat(
  state: GameState,
  greatHuntInstanceId: CardInstanceId,
  creatureInstanceId: CardInstanceId,
  controllerId: PlayerId,
  opponentId: PlayerId,
  companyId: CompanyId,
  continuation: 'reveal' | 'none',
): CombatState | null {
  const creatureDefId = resolveInstanceId(state, creatureInstanceId);
  const creatureDef = creatureDefId ? defById(state, creatureDefId) : undefined;
  if (!creatureDef || !('strikes' in creatureDef) || (creatureDef as { cardType?: string }).cardType !== 'hazard-creature') {
    return null;
  }
  const controllerIndex = getPlayerIndex(state, controllerId);
  const company = companyById(state.players[controllerIndex].companies, companyId);
  if (!company) return null;

  const cDef = creatureDef as unknown as {
    prowess: number; strikes: number; body: number | null; race: Race;
    keyedTo: readonly import('../types/cards.js').CreatureKeyRestriction[];
    effects?: readonly import('../types/effects.js').CardEffect[];
  };
  const inPlayNames = buildInPlayNames(state);
  const creatureRace = cDef.race;
  const attackBoostCtx = { companyId, creatureInstanceId };
  const effectiveProwess = resolveAttackProwess(state, cDef.prowess, inPlayNames, creatureRace, false, undefined, attackBoostCtx);
  const effectiveStrikes = resolveAttackStrikes(state, cDef.strikes, inPlayNames, creatureRace, false, attackBoostCtx);
  const effectiveBody = resolveAttackBody(state, cDef.body, inPlayNames, creatureRace, attackBoostCtx);

  logDetail(
    `The Great Hunt: ${cDef.race} "${creatureDef.name}" (${effectiveStrikes} strikes, ${effectiveProwess} prowess) `
    + `attacks ${controllerId as string}'s Alatar company ${companyId as string}`,
  );

  return makeCombatState({
    attackSource: {
      type: 'great-hunt-attack',
      greatHuntInstanceId,
      creatureInstanceId,
      continuation,
    },
    companyId,
    defendingPlayerId: controllerId,
    attackingPlayerId: opponentId,
    strikesTotal: effectiveStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: effectiveBody,
    creatureRace,
    assignmentPhase: 'defender',
    detainment: isDetainmentAttack({
      attackEffects: cDef.effects,
      attackRace: creatureRace,
      attackKeyedTo: cDef.keyedTo,
      inPlayNames,
      defendingAlignment: state.players[controllerIndex].alignment,
      defenderForcesNormalAttacks: playerConvertsDetainmentToNormal(state, state.players[controllerIndex]),
      // A Great Hunt attack has no declared keying, so the override falls back
      // to the union of the creature's currently-valid keyedTo site types.
      normalIfKeyedToSiteTypes: companyKeyedAttacksNormalSiteTypes(state, companyId),
    }),
  });
}

/**
 * Called from `resolvePermanentEvent` after The Great Hunt enters play. Adds
 * the ongoing `great-hunt-active` tracker (seeded with the opponent's current
 * discard-pile creature ids so only *later* discards trigger) and enqueues the
 * `great-hunt-source` reveal choice for the controller.
 */
export function kickoffGreatHunt(
  state: GameState,
  greatHuntInstanceId: CardInstanceId,
  greatHuntDefId: CardDefinitionId,
  controllerId: PlayerId,
  effect: RevealAndAttackEffect,
): GameState {
  const controllerIndex = getPlayerIndex(state, controllerId);
  const opponentIndex = 1 - controllerIndex;
  const opponentId = state.players[opponentIndex].id;
  const companyId = findAvatarCompanyId(state, controllerIndex, effect.attackAvatar);

  // Seed the ongoing tracker with every creature already in the opponent's
  // discard pile — "thereafter" applies only to future discards.
  const seeded = state.players[opponentIndex].discardPile
    .filter(c => isHazardCreatureDefId(state, c.definitionId))
    .map(c => c.instanceId);
  let working = addConstraint(state, {
    source: greatHuntInstanceId,
    sourceDefinitionId: greatHuntDefId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'player', playerId: controllerId },
    kind: { type: 'great-hunt-active', greatHuntInstanceId, processedDiscardIds: seeded },
  });
  logDetail(`The Great Hunt: ongoing discard trigger active for ${controllerId as string} (seeded ${seeded.length} existing discard creature(s))`);

  if (!companyId) {
    logDetail(`The Great Hunt: ${effect.attackAvatar} not in a company — reveal process fizzles`);
    return working;
  }

  logDetail(`The Great Hunt: ${controllerId as string} chooses which of ${opponentId as string}'s piles to reveal`);
  working = enqueueResolution(working, {
    source: greatHuntInstanceId,
    actor: controllerId,
    scope: { kind: 'phase', phase: working.phaseState.phase },
    kind: {
      type: 'great-hunt-source',
      greatHuntInstanceId,
      maxCreatures: effect.maxCreatures,
      opponentId,
      companyId,
    },
  });
  return working;
}

/**
 * Resolve the controller's source choice: scan the opponent's chosen pile
 * top-down for up to `maxCreatures` hazard-creatures, reveal every card up to
 * the last collected creature, record the queue in a `great-hunt-reveal`
 * constraint, and initiate the first creature's attack. If no creatures are
 * found, reshuffle the deck (when the deck was used) and finish immediately.
 */
export function startGreatHuntReveal(
  state: GameState,
  greatHuntInstanceId: CardInstanceId,
  source: 'deck' | 'discard',
  maxCreatures: number,
  opponentId: PlayerId,
  companyId: CompanyId,
  controllerId: PlayerId,
): GameState {
  const opponentIndex = getPlayerIndex(state, opponentId);
  const pile = source === 'deck'
    ? state.players[opponentIndex].playDeck
    : state.players[opponentIndex].discardPile;
  const greatHuntDefId = resolveInstanceId(state, greatHuntInstanceId)!;

  // Scan top-down, collecting creature instances and the cards revealed up to
  // (and including) the last collected creature.
  const creatureQueue: CardInstanceId[] = [];
  const revealedCards: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] = [];
  const revealedUpTo: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] = [];
  for (const card of pile) {
    revealedCards.push({ instanceId: card.instanceId, definitionId: card.definitionId });
    if (isHazardCreatureDefId(state, card.definitionId)) {
      creatureQueue.push(card.instanceId);
      // Everything revealed so far becomes "seen" once a creature is hit.
      revealedUpTo.length = 0;
      revealedUpTo.push(...revealedCards);
      if (creatureQueue.length >= maxCreatures) break;
    }
  }
  // If the whole pile was scanned without reaching maxCreatures, the entire
  // scanned run is revealed (all cards were turned over).
  const toReveal = creatureQueue.length >= maxCreatures ? revealedUpTo : revealedCards;

  let working = revealInstances(state, toReveal);
  logDetail(
    `The Great Hunt: revealed ${toReveal.length} card(s) from ${opponentId as string}'s ${source}; `
    + `${creatureQueue.length} creature(s) will attack (max ${maxCreatures})`,
  );

  const reshuffleDeck = source === 'deck';

  if (creatureQueue.length === 0) {
    if (reshuffleDeck) working = reshuffleOpponentDeck(working, opponentIndex);
    logDetail(`The Great Hunt: no creatures revealed — process complete`);
    return working;
  }

  working = addConstraint(working, {
    source: greatHuntInstanceId,
    sourceDefinitionId: greatHuntDefId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'player', playerId: controllerId },
    kind: {
      type: 'great-hunt-reveal',
      greatHuntInstanceId,
      creatureInstanceIds: creatureQueue,
      queueIndex: 0,
      reshuffleDeck,
    },
  });

  // Initiate the first creature's attack.
  return spawnNextRevealAttack(working, greatHuntInstanceId, controllerId, opponentId);
}

/** Shuffle the opponent's play deck (Great Hunt "reshuffle play deck if used"). */
function reshuffleOpponentDeck(state: GameState, opponentIndex: number): GameState {
  const [reshuffled, rng] = shuffle(state.players[opponentIndex].playDeck, state.rng);
  logDetail(`The Great Hunt: reshuffling ${reshuffled.length}-card play deck`);
  return { ...updatePlayer(state, opponentIndex, p => ({ ...p, playDeck: reshuffled })), rng };
}

/**
 * Initiate the attack for the creature at the current `queueIndex` of the
 * `great-hunt-reveal` constraint, advancing the index. If the creature can no
 * longer be built (edge cases), skips to the next. Returns state with `combat`
 * set, or completed state when the queue is drained.
 */
function spawnNextRevealAttack(
  state: GameState,
  greatHuntInstanceId: CardInstanceId,
  controllerId: PlayerId,
  opponentId: PlayerId,
): GameState {
  let working = state;
  for (;;) {
    const constraint = findRevealConstraint(working, greatHuntInstanceId);
    if (!constraint || constraint.kind.type !== 'great-hunt-reveal') return working;
    const { creatureInstanceIds, queueIndex, reshuffleDeck } = constraint.kind;
    if (queueIndex >= creatureInstanceIds.length) {
      // Sequence complete.
      let done = removeConstraint(working, constraint.id);
      if (reshuffleDeck) done = reshuffleOpponentDeck(done, getPlayerIndex(done, opponentId));
      logDetail(`The Great Hunt: reveal sequence complete`);
      return done;
    }
    // Re-derive Alatar's company each step (it may have changed between combats).
    const companyId = findAvatarCompanyId(working, getPlayerIndex(working, controllerId),
      avatarNameFor(working, greatHuntInstanceId) ?? '');
    const creatureId = creatureInstanceIds[queueIndex];
    // Advance the index first so a null combat still progresses.
    working = replaceRevealConstraint(working, constraint, { ...constraint.kind, queueIndex: queueIndex + 1 });
    if (!companyId) {
      logDetail(`The Great Hunt: Alatar company gone — skipping remaining reveal attacks`);
      let done = removeConstraint(working, findRevealConstraint(working, greatHuntInstanceId)?.id ?? constraint.id);
      if (reshuffleDeck) done = reshuffleOpponentDeck(done, getPlayerIndex(done, opponentId));
      return done;
    }
    const combat = buildGreatHuntCombat(working, greatHuntInstanceId, creatureId, controllerId, opponentId, companyId, 'reveal');
    if (combat) return { ...working, combat };
    // Could not build (creature vanished) — loop to the next queued creature.
  }
}

/**
 * Advance the reveal sequence after a `great-hunt-attack` (continuation
 * 'reveal') finalizes. Called from combat finalization / cancellation.
 */
export function advanceGreatHuntReveal(state: GameState, greatHuntInstanceId: CardInstanceId): GameState {
  const constraint = findRevealConstraint(state, greatHuntInstanceId);
  if (!constraint || constraint.kind.type !== 'great-hunt-reveal') return state;
  const controllerId = revealConstraintController(constraint);
  const opponentId = state.players[1 - getPlayerIndex(state, controllerId)].id;
  return spawnNextRevealAttack(state, greatHuntInstanceId, controllerId, opponentId);
}

/** The `great-hunt-reveal` constraint for a given Great Hunt instance, if any. */
function findRevealConstraint(state: GameState, greatHuntInstanceId: CardInstanceId): ActiveConstraint | undefined {
  return state.activeConstraints.find(
    c => c.kind.type === 'great-hunt-reveal' && c.kind.greatHuntInstanceId === greatHuntInstanceId,
  );
}

/** Controller player id of a `great-hunt-*` constraint (its player target). */
function revealConstraintController(constraint: ActiveConstraint): PlayerId {
  return constraint.target.kind === 'player'
    ? constraint.target.playerId
    : ('' as PlayerId);
}

/** Replace a reveal constraint's kind payload (immutably). */
function replaceRevealConstraint(
  state: GameState,
  constraint: ActiveConstraint,
  newKind: Extract<ActiveConstraint['kind'], { type: 'great-hunt-reveal' }>,
): GameState {
  return {
    ...state,
    activeConstraints: state.activeConstraints.map(c => c.id === constraint.id ? { ...c, kind: newKind } : c),
  };
}

/** Look up the avatar name the Great Hunt attacks (from its `reveal-and-attack` effect). */
function avatarNameFor(state: GameState, greatHuntInstanceId: CardInstanceId): string | null {
  const defId = resolveInstanceId(state, greatHuntInstanceId);
  const eff = findRevealAndAttackEffect(defId ? defById(state, defId) : undefined);
  return eff?.attackAvatar ?? null;
}

/**
 * Post-reduce sweep for the ongoing discard trigger. For every player holding a
 * `great-hunt-active` tracker whose Great Hunt card is still in play: remove
 * trackers whose card left play; otherwise record every hazard-creature newly
 * present in the opponent's discard pile as processed, and — only during the
 * controller's own turn — offer a `great-hunt-discard-attack` for each. Marking
 * discards processed on *every* pass (including the opponent's turn) ensures a
 * creature discarded outside the controller's turn is never offered later: the
 * card only fires "whenever your opponent discards a creature **during your
 * turn**". Each creature is offered at most once (loop-prevention ruling).
 */
export function sweepGreatHuntDiscards(state: GameState): GameState {
  let working = state;
  const trackers = working.activeConstraints.filter(c => c.kind.type === 'great-hunt-active');
  for (const tracker of trackers) {
    if (tracker.kind.type !== 'great-hunt-active') continue;
    const greatHuntInstanceId = tracker.kind.greatHuntInstanceId;
    const controllerId = revealConstraintController(tracker);
    const controllerIndex = getPlayerIndex(working, controllerId);

    // Card left play → drop the tracker.
    const stillInPlay = working.players[controllerIndex].cardsInPlay.some(c => c.instanceId === greatHuntInstanceId);
    if (!stillInPlay) {
      logDetail(`The Great Hunt left play — clearing ongoing discard trigger for ${controllerId as string}`);
      working = removeConstraint(working, tracker.id);
      continue;
    }

    // Never act mid-combat; combat casualties are swept once the attack clears.
    if (working.combat != null) continue;

    const opponentIndex = 1 - controllerIndex;
    const opponentId = working.players[opponentIndex].id;
    const processed = new Set(tracker.kind.processedDiscardIds.map(id => id as string));

    const newlyDiscarded = working.players[opponentIndex].discardPile.filter(
      c => isHazardCreatureDefId(working, c.definitionId) && !processed.has(c.instanceId as string),
    );
    if (newlyDiscarded.length === 0) continue;

    // Record all as processed immediately (loop-prevention + "during your turn":
    // creatures discarded on the opponent's turn are marked here and never
    // offered on a later controller turn).
    const updatedProcessed = [...tracker.kind.processedDiscardIds, ...newlyDiscarded.map(c => c.instanceId)];
    working = {
      ...working,
      activeConstraints: working.activeConstraints.map(c =>
        c.id === tracker.id && c.kind.type === 'great-hunt-active'
          ? { ...c, kind: { ...c.kind, processedDiscardIds: updatedProcessed } }
          : c),
    };

    // Offers only during the controller's own turn, and only if Alatar is in a
    // company to be attacked.
    if (working.activePlayer !== controllerId) continue;
    const companyId = findAvatarCompanyId(working, controllerIndex, avatarNameFor(working, greatHuntInstanceId) ?? '');
    if (!companyId) continue;

    for (const creature of newlyDiscarded) {
      const cDefId = resolveInstanceId(working, creature.instanceId);
      logDetail(
        `The Great Hunt: ${opponentId as string} discarded ${cDefId ? cardName(working, cDefId, '?') : '?'} `
        + `— offering ${controllerId as string} the attack option`,
      );
      working = enqueueResolution(working, {
        source: greatHuntInstanceId,
        actor: controllerId,
        scope: { kind: 'phase', phase: working.phaseState.phase },
        kind: {
          type: 'great-hunt-discard-attack',
          greatHuntInstanceId,
          creatureInstanceId: creature.instanceId,
          opponentId,
          companyId,
        },
      });
    }
  }
  return working;
}
