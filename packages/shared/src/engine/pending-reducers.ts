/**
 * @module engine/pending-reducers
 *
 * Reducer dispatch for {@link PendingResolution} entries. While any
 * resolution is queued for the actor of an incoming action, this module's
 * {@link applyResolution} runs *before* the per-phase reducer — replacing
 * the six bespoke short-circuits the per-phase reducers used to carry.
 *
 * Each `kind` of pending resolution has its own handler. New resolution
 * kinds are added here in lock-step with the discriminated union in
 * `types/pending.ts`.
 */

import type {
  GameState,
  GameAction,
  PendingResolution,
  CardInstance,
  GameEffect,
  CharacterInPlay,
} from '../index.js';
import type { ReducerResult } from './reducer-utils.js';
import { dequeueResolution, enqueueResolution, removeConstraint } from './pending.js';
import { getPlayerIndex, isCharacterCard, isFactionCard, GENERAL_INFLUENCE, CardStatus, ZERO_EFFECTIVE_STATS } from '../index.js';
import { resolveInstanceId } from '../types/state.js';
import { roll2d6, clonePlayers, cleanupEmptyCompanies, nextCompanyId, updatePlayer, updateCharacter, wrongActionType, removeById } from './reducer-utils.js';
import { applyCost } from './cost-evaluator.js';
import { logDetail } from './legal-actions/log.js';
import {
  resolveInfluenceAttemptRoll,
  resolveOpponentInfluenceDefend,
  applyOnGuardRevealAtResource,
  executeDeferredSiteAction,
} from './reducer-site.js';
import { autoResolve } from './chain-reducer.js';

/**
 * Resolve the top pending resolution for the action's actor by dispatching
 * to the kind-specific handler. The handler is responsible for dequeuing
 * the resolution it consumed (via {@link dequeueResolution}).
 *
 * Returns the resulting {@link ReducerResult}, or an `error` if the
 * incoming action does not satisfy the pending resolution. The caller in
 * `reducer.ts` falls through to the per-phase reducer when this function
 * returns `null` to indicate "no resolution applies — let the phase
 * reducer handle it."
 */
export function applyResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  switch (top.kind.type) {
    case 'corruption-check':
      return applyCorruptionCheckResolution(state, action, top);
    case 'order-effects':
      return applyOrderEffectsResolution(state, action, top);
    case 'on-guard-window':
      return applyOnGuardWindowResolution(state, action, top);
    case 'opponent-influence-defend':
      return applyOpponentInfluenceDefendResolution(state, action, top);
    case 'faction-influence-roll':
      return applyFactionInfluenceRollResolution(state, action, top);
    case 'muster-roll':
      return applyMusterRollResolution(state, action, top);
    case 'call-of-home-roll':
      return applyCallOfHomeRollResolution(state, action, top);
    case 'seized-by-terror-roll':
      return applySeizedByTerrorRollResolution(state, action, top);
    case 'gold-ring-test':
      return applyGoldRingTestResolution(state, action, top);
    case 'body-check-company':
      return applyBodyCheckCompanyResolution(state, action, top);
    case 'wizard-search-on-store':
      return applyWizardSearchOnStoreResolution(state, action, top);
  }
}

// ---- Per-kind handlers (filled in during migration) ----
//
// Each handler is initially a stub returning null so the per-phase
// reducer continues to handle the action through its legacy code path.
// The migration steps replace these stubs one at a time, deleting the
// per-phase short-circuits as each kind moves over.

/**
 * Unified corruption-check resolver. Handles transfer (with extra
 * remove-transferred-item-on-failure logic), wound, and Lure variants
 * via the discriminating `transferredItemId` and `reason` fields on
 * the resolution.
 *
 * Failure modes (CoE 2.II.5 / 2.III.x):
 *  - roll > CP: passed; no effect.
 *  - roll == CP or CP - 1: character + possessions discarded; followers
 *    promoted to general influence.
 *  - roll < CP - 1: character eliminated (removed from game), possessions
 *    discarded.
 *
 * For transfer checks, on failure we additionally remove the transferred
 * item from its new bearer (since the transfer didn't "stick"). The item
 * is included in the discard via `action.possessions`.
 */
function applyCorruptionCheckResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  // Reactive short-event plays (e.g. Halfling Strength's corruption-check
  // boost) are legal during the corruption-check resolution window —
  // return null so the dispatcher falls through to the per-phase reducer,
  // which runs the normal `play-short-event` handler. The pending
  // resolution stays in queue; the next legal-action cycle re-emits the
  // roll action with any freshly-added constraints factored in.
  if (action.type === 'play-short-event') return null;
  if (action.type !== 'corruption-check') {
    return { state, error: `Pending corruption check requires a corruption-check action, got '${action.type}'` };
  }
  if (top.kind.type !== 'corruption-check') return null;

  const { characterId, transferredItemId, reason } = top.kind;
  if (action.characterId !== characterId) {
    return { state, error: 'Wrong character for pending corruption check' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player.characters[characterId as string];
  if (!char) {
    // Character was eliminated since the resolution was queued — drop it.
    logDetail(`Corruption check (${reason}): character ${characterId as string} no longer in play — dequeuing`);
    return { state: dequeueResolution(state, top.id) };
  }

  const charDefId = resolveInstanceId(state, characterId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
  const charName = charDef?.name ?? '?';
  const cp = action.corruptionPoints;
  const modifier = action.corruptionModifier;

  // Roll 2d6 + modifier
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + modifier;
  const modStr = modifier !== 0 ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : '';
  logDetail(`Corruption check for ${charName} (${reason}): rolled ${roll.die1} + ${roll.die2}${modStr} = ${total} vs CP ${cp}`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Corruption: ${charName}`,
  };

  // Store the roll on the player
  const playersAfterRoll = clonePlayers(state);
  playersAfterRoll[playerIndex] = { ...playersAfterRoll[playerIndex], lastDiceRoll: roll };

  // Consume one-shot check-modifier constraints for this character. Any
  // constraint kind `check-modifier` with `check === 'corruption'` targeting
  // this character contributed to the modifier above and is now cleared.
  let postRollState: GameState = { ...state, players: playersAfterRoll, rng, cheatRollTotal };
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type === 'check-modifier'
        && constraint.kind.check === 'corruption'
        && constraint.target.kind === 'character'
        && constraint.target.characterId === characterId) {
      logDetail(`Consuming one-shot check-modifier constraint ${constraint.id} (corruption ${constraint.kind.value >= 0 ? '+' : ''}${constraint.kind.value})`);
      postRollState = removeConstraint(postRollState, constraint.id);
    }
  }

  if (total > cp) {
    logDetail(`Corruption check passed (${total} > ${cp})`);
    const stateAfterDequeue = dequeueResolution(postRollState, top.id);
    return { state: stateAfterDequeue, effects: [rollEffect] };
  }

  // The Ring's Betrayal failure mode: discard only the Ring, character stays
  if (top.kind.failureMode === 'discard-ring-only') {
    logDetail(`Corruption check FAILED (${total} <= ${cp}) — failureMode discard-ring-only: discarding Ring, ${charName} remains in play`);
    const ringInstances = action.possessions
      .map(id => {
        const defId = resolveInstanceId(state, id);
        const def = defId ? state.cardPool[defId as string] : undefined;
        const keywords: readonly string[] = def && 'keywords' in def ? (def as { keywords?: readonly string[] }).keywords ?? [] : [];
        return keywords.includes('ring') ? { instanceId: id, definitionId: defId! } : null;
      })
      .filter((x): x is CardInstance => x !== null);
    const ringIds = new Set(ringInstances.map(r => r.instanceId));
    const newCharacters = { ...player.characters };
    const currentChar = newCharacters[characterId as string];
    if (currentChar && ringIds.size > 0) {
      newCharacters[characterId as string] = {
        ...currentChar,
        items: currentChar.items.filter(i => !ringIds.has(i.instanceId)),
      };
    }
    const newDiscardPile = [...player.discardPile, ...ringInstances];
    playersAfterRoll[playerIndex] = {
      ...playersAfterRoll[playerIndex],
      characters: newCharacters,
      discardPile: newDiscardPile,
    };
    return {
      state: dequeueResolution({ ...postRollState, players: playersAfterRoll }, top.id),
      effects: [rollEffect],
    };
  }

  // Failed — discard or eliminate the character
  const newCharacters = { ...player.characters };

  // For transfer checks, remove the transferred item from its new bearer
  // (the transfer didn't stick — the item is included in the discard via
  // action.possessions).
  if (transferredItemId) {
    for (const [cid, cData] of Object.entries(newCharacters)) {
      if (cid === characterId as string) continue;
      const itemIdx = cData.items.findIndex(i => i.instanceId === transferredItemId);
      if (itemIdx >= 0) {
        newCharacters[cid] = { ...cData, items: cData.items.filter(i => i.instanceId !== transferredItemId) };
        break;
      }
    }
  }

  if (total >= cp - 1) {
    // Roll == CP or CP - 1: character + possessions discarded (not followers)
    logDetail(`Corruption check FAILED (${total} within 1 of ${cp}) — discarding ${charName} and ${action.possessions.length} possession(s)`);

    delete newCharacters[characterId as string];

    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== characterId),
    }));

    // Followers lose their controller — promote to general influence
    for (const followerId of char.followers) {
      const follower = newCharacters[followerId as string];
      if (follower) {
        newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }

    const toDiscard: CardInstance[] = [
      { instanceId: characterId, definitionId: char.definitionId },
      ...action.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! })),
    ];
    const newDiscardPile = [...player.discardPile, ...toDiscard];

    playersAfterRoll[playerIndex] = {
      ...playersAfterRoll[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      discardPile: newDiscardPile,
    };
  } else {
    // Roll < CP - 1: character eliminated, possessions discarded
    logDetail(`Corruption check FAILED (${total} < ${cp - 1}) — eliminating ${charName}, discarding ${action.possessions.length} possession(s)`);

    delete newCharacters[characterId as string];

    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== characterId),
    }));

    for (const followerId of char.followers) {
      const follower = newCharacters[followerId as string];
      if (follower) {
        newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }

    const newOutOfPlayPile = [...player.outOfPlayPile, { instanceId: characterId, definitionId: char.definitionId }];
    const newDiscardPile = [
      ...player.discardPile,
      ...action.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! })),
    ];

    playersAfterRoll[playerIndex] = {
      ...playersAfterRoll[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      outOfPlayPile: newOutOfPlayPile,
      discardPile: newDiscardPile,
    };
  }

  const cleanedState = cleanupEmptyCompanies({
    ...postRollState,
    players: playersAfterRoll,
  });

  return {
    state: dequeueResolution(cleanedState, top.id),
    effects: [rollEffect],
  };
}

function applyOrderEffectsResolution(
  _state: GameState,
  _action: GameAction,
  _top: PendingResolution,
): ReducerResult | null {
  return null;
}

/**
 * Resolve a queued `on-guard-window` resolution.
 *
 * Two stages:
 *
 *  - **`reveal-window`** — actor is the hazard player. They may reveal
 *    one on-guard card, which dequeues this resolution, requeues a new
 *    `awaiting-pass` resolution for the *resource* player, and
 *    initiates a chain for the revealed card. Or they may pass, which
 *    dequeues the resolution and runs the deferred action immediately.
 *  - **`awaiting-pass`** — actor is the resource player. Their only
 *    legal action is `pass`, which dequeues the resolution and runs
 *    the deferred action.
 */
/**
 * Reveal-path helper — when the revealed on-guard card's on-guard-reveal
 * effect declares a `cancel-chain-entry` apply targeting the deferred
 * short-event by `requiredSkill`, discard both cards and return the
 * updated state. Returns `null` when the reveal does not cancel the
 * deferred action (fall through to the default nested-chain behavior).
 */
function tryCancelDeferredOnReveal(
  state: GameState,
  revealAction: GameAction,
  deferredAction: GameAction,
): GameState | null {
  if (revealAction.type !== 'reveal-on-guard') return null;
  if (deferredAction.type !== 'play-short-event') return null;
  if (state.activePlayer === null) return null;

  const resourceIndex = getPlayerIndex(state, state.activePlayer);
  const resourcePlayer = state.players[resourceIndex];
  const siteState = state.phaseState as { activeCompanyIndex?: number };
  const activeCompanyIndex = siteState.activeCompanyIndex ?? 0;
  const company = resourcePlayer.companies[activeCompanyIndex];
  if (!company) return null;

  const ogIdx = company.onGuardCards.findIndex(c => c.instanceId === revealAction.cardInstanceId);
  if (ogIdx < 0) return null;
  const ogCard = company.onGuardCards[ogIdx];
  const ogDef = state.cardPool[ogCard.definitionId as string];
  if (!ogDef || !('effects' in ogDef)) return null;
  const ogEffects = (ogDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects ?? [];

  const revealEffect = ogEffects.find(
    (e): e is import('../types/effects.js').OnGuardRevealEffect =>
      e.type === 'on-guard-reveal'
      && (e as { apply?: { type?: string; select?: string; requiredSkill?: string } }).apply?.type === 'cancel-chain-entry'
      && (e as { apply?: { type?: string; select?: string; requiredSkill?: string } }).apply?.select === 'target'
      && typeof (e as { apply?: { type?: string; select?: string; requiredSkill?: string } }).apply?.requiredSkill === 'string',
  );
  if (!revealEffect?.apply) return null;
  const requiredSkill = (revealEffect.apply as { requiredSkill?: string }).requiredSkill!;

  const handIdx = resourcePlayer.hand.findIndex(c => c.instanceId === deferredAction.cardInstanceId);
  if (handIdx < 0) return null;
  const handCard = resourcePlayer.hand[handIdx];
  const handDef = state.cardPool[handCard.definitionId as string];
  if (!handDef || !('effects' in handDef)) return null;
  const handEffects = (handDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects ?? [];
  const hasSkill = handEffects.some(e => (e as { requiredSkill?: string }).requiredSkill === requiredSkill);
  if (!hasSkill) return null;

  const hazardIndex = state.players.findIndex(p => p.id === revealAction.player);
  if (hazardIndex < 0) return null;

  logDetail(`On-guard reveal: "${ogDef.name}" cancels deferred short-event "${handDef.name}" (requires ${requiredSkill})`);

  // Remove the on-guard card from the company, discard it to the hazard
  // player's discard pile, remove the short-event card from the resource
  // player's hand, and move it to their discard pile.
  const newOnGuard = [...company.onGuardCards];
  newOnGuard.splice(ogIdx, 1);
  const updatedCompanies = [...resourcePlayer.companies];
  updatedCompanies[activeCompanyIndex] = { ...company, onGuardCards: newOnGuard };
  const newHand = [...resourcePlayer.hand];
  newHand.splice(handIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[resourceIndex] = {
    ...resourcePlayer,
    companies: updatedCompanies,
    hand: newHand,
    discardPile: [...resourcePlayer.discardPile, { instanceId: handCard.instanceId, definitionId: handCard.definitionId }],
  };
  const hazardPlayer = newPlayers[hazardIndex];
  newPlayers[hazardIndex] = {
    ...hazardPlayer,
    discardPile: [...hazardPlayer.discardPile, { instanceId: ogCard.instanceId, definitionId: ogCard.definitionId }],
  };

  return { ...state, players: newPlayers };
}

function applyOnGuardWindowResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'on-guard-window') return null;
  const { stage, deferredAction } = top.kind;

  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending on-guard-window' };
  }

  if (stage === 'reveal-window') {
    if (action.type === 'pass') {
      logDetail('On-guard window: hazard player passes — running deferred action');
      const dequeued = dequeueResolution(state, top.id);
      return executeDeferredSiteAction(dequeued, deferredAction);
    }
    if (action.type === 'reveal-on-guard') {
      // Reveal-path A — cancel the deferred action. When the revealed
      // on-guard card declares an `on-guard-reveal` effect with an
      // `apply: cancel-chain-entry select:target requiredSkill:X`, and
      // the deferred action is a `play-short-event` whose source card
      // carries a matching `requiredSkill`, the short event is cancelled
      // outright: its card is discarded, the revealed card is discarded,
      // and no nested chain or deferred execution runs. Used by
      // Searching Eye to cancel a scout-skill short during the
      // opponent's site phase.
      const cancelledResult = tryCancelDeferredOnReveal(state, action, deferredAction);
      if (cancelledResult) {
        const next = dequeueResolution(cancelledResult, top.id);
        return { state: next };
      }

      logDetail('On-guard window: hazard player reveals — initiating chain, replacing resolution with awaiting-pass for active player');
      const revealResult = applyOnGuardRevealAtResource(state, action);
      if (revealResult.error) return revealResult;
      // Dequeue the reveal-window resolution and enqueue an awaiting-pass
      // resolution for the resource player. The chain takes priority
      // over the resolution; once it resolves, the active player's only
      // legal action is `pass`, which runs the deferred action.
      let newState = dequeueResolution(revealResult.state, top.id);
      const activePlayer = newState.activePlayer;
      if (activePlayer !== null) {
        newState = enqueueResolution(newState, {
          source: top.source,
          actor: activePlayer,
          scope: top.scope,
          kind: {
            type: 'on-guard-window',
            stage: 'awaiting-pass',
            deferredAction,
          },
        });
      }
      return { state: newState, effects: revealResult.effects };
    }
    return { state, error: `Expected pass or reveal-on-guard during on-guard window, got '${action.type}'` };
  }

  // stage === 'awaiting-pass'
  if (action.type !== 'pass') {
    return { state, error: `Expected pass to close on-guard window awaiting-pass, got '${action.type}'` };
  }
  logDetail('On-guard window: active player passes — running deferred action');
  const dequeued = dequeueResolution(state, top.id);
  return executeDeferredSiteAction(dequeued, deferredAction);
}

/**
 * Resolve a queued `opponent-influence-defend` resolution. The hazard
 * player either rolls 2d6 (standard defense) or plays a cancel-influence
 * card to automatically cancel the attempt. The standard roll-and-resolve
 * logic lives in `reducer-site.ts:resolveOpponentInfluenceDefend`.
 */
function applyOpponentInfluenceDefendResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'opponent-influence-defend') return null;

  if (action.type === 'cancel-influence') {
    return applyCancelInfluence(state, action, top);
  }

  if (action.type !== 'opponent-influence-defend') {
    return { state, error: `Pending opponent-influence-defend requires that action, got '${action.type}'` };
  }

  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending opponent-influence-defend' };
  }

  const result = resolveOpponentInfluenceDefend(state, top.kind.attempt);
  if (result.error) return result;

  return {
    state: dequeueResolution(result.state, top.id),
    effects: result.effects,
  };
}

/**
 * Handle a cancel-influence action: the defending player plays a
 * cancel-influence card (e.g. Wizard's Laughter) to automatically
 * cancel an opponent's influence attempt. The card is discarded from
 * hand, the influence attempt is removed, and the cost-paying character
 * makes a corruption check.
 */
function applyCancelInfluence(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult {
  if (action.type !== 'cancel-influence') {
    return wrongActionType(state, action, 'cancel-influence');
  }
  if (top.kind.type !== 'opponent-influence-defend') {
    return { state, error: 'cancel-influence requires a pending opponent-influence-defend' };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for cancel-influence' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const handCards = [...player.hand];
  const cardIndex = handCards.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex < 0) {
    return { state, error: 'cancel-influence card not found in hand' };
  }
  const [discardedCard] = handCards.splice(cardIndex, 1);
  const cardDef = state.cardPool[discardedCard.definitionId as string];
  if (!cardDef) {
    return { state, error: 'cancel-influence card definition not found' };
  }

  const cancelEffect = ('effects' in cardDef && cardDef.effects)
    ? (cardDef.effects as import('../index.js').CardEffect[]).find(e => e.type === 'cancel-influence')
    : undefined;
  if (!cancelEffect || cancelEffect.type !== 'cancel-influence') {
    return { state, error: 'Card has no cancel-influence effect' };
  }

  const newDiscard = [...player.discardPile, { instanceId: discardedCard.instanceId, definitionId: discardedCard.definitionId }];

  logDetail(`Cancel-influence: ${cardDef.name} played, influence attempt auto-canceled`);

  let resultState: GameState = updatePlayer(state, playerIndex, p => ({ ...p, hand: handCards, discardPile: newDiscard }));
  resultState = dequeueResolution(resultState, top.id);

  if (cancelEffect.cost?.check === 'corruption') {
    const activeCompanyIndex = (state.phaseState as { activeCompanyIndex?: number }).activeCompanyIndex ?? 0;
    const activePlayer = state.players.find(p => p.id === state.activePlayer);
    const companyId = activePlayer?.companies[activeCompanyIndex]?.id ?? '' as import('../index.js').CompanyId;
    const charDefId = resolveInstanceId(state, action.characterId);
    const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
    const reason = charDef && 'name' in charDef ? charDef.name : 'cancel-influence';

    const costResult = applyCost(resultState, cancelEffect.cost, action.characterId, {
      playerIndex,
      sourceCardId: action.cardInstanceId,
      companyId,
      checkScopeKind: 'company-site-subphase',
      label: reason,
    });
    if ('error' in costResult) return { state, error: costResult.error };
    resultState = costResult.state;
  }

  return { state: resultState };
}

/**
 * Resolve a queued `faction-influence-roll` resolution. The resource
 * player confirms the roll, the engine computes the dice result against
 * the faction's influence number (with all post-chain modifiers), and
 * the faction is placed in cardsInPlay (success) or discard (failure).
 *
 * The actual roll-and-resolve logic lives in
 * `reducer-site.ts:resolveInfluenceAttemptRoll`.
 */
function applyFactionInfluenceRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'faction-influence-roll') {
    return { state, error: `Pending faction-influence-roll requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'faction-influence-roll') return null;

  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending faction-influence-roll' };
  }

  // Reconstruct the chain-entry shape that resolveInfluenceAttemptRoll expects
  const entry = {
    card: { instanceId: top.kind.factionInstanceId, definitionId: top.kind.factionDefinitionId },
    declaredBy: top.actor,
    payload: {
      type: 'influence-attempt' as const,
      influencingCharacterId: top.kind.influencingCharacterId,
    },
  };

  // Run the roll. The chain still holds the unresolved influence-attempt
  // entry — find it, mark it resolved, and re-enter chain auto-resolution
  // so the chain can complete normally (handles deferred passives, parent
  // chain restoration, etc.).
  const rollResult = resolveInfluenceAttemptRoll(state, entry);
  let postRoll = dequeueResolution(rollResult.state, top.id);

  if (postRoll.chain) {
    const chain = postRoll.chain;
    const targetId = top.kind.factionInstanceId;
    const newEntries = chain.entries.map(e =>
      e.payload.type === 'influence-attempt'
        && !e.resolved
        && e.card?.instanceId === targetId
        ? { ...e, resolved: true }
        : e,
    );
    postRoll = { ...postRoll, chain: { ...chain, entries: newEntries } };

    const continued = autoResolve(postRoll);
    return {
      state: continued.state,
      effects: [...rollResult.effects, ...(continued.effects ?? [])],
    };
  }

  return {
    state: postRoll,
    effects: rollResult.effects,
  };
}

/**
 * Resolve a queued `muster-roll` resolution (Muster Disperses). The
 * faction's owner rolls 2d6 + unused general influence. If the total
 * is less than 11, the faction is discarded; otherwise it stays in play.
 */
function applyMusterRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'muster-roll') {
    return { state, error: `Pending muster-roll requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'muster-roll') return null;

  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending muster-roll' };
  }

  const { factionInstanceId, factionDefinitionId, factionOwner } = top.kind;
  const ownerIndex = getPlayerIndex(state, factionOwner);
  const owner = state.players[ownerIndex];

  const def = state.cardPool[factionDefinitionId as string];
  if (!def || !isFactionCard(def)) {
    return { state, error: 'Targeted card is not a faction' };
  }

  const unusedGI = GENERAL_INFLUENCE - owner.generalInfluenceUsed;
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + unusedGI;

  logDetail(`Muster roll: ${def.name} — rolled ${roll.die1} + ${roll.die2} + unused GI ${unusedGI} = ${total} vs 11`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: owner.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Muster: ${def.name}`,
  };

  const newPlayers = clonePlayers(state);
  newPlayers[ownerIndex] = { ...newPlayers[ownerIndex], lastDiceRoll: roll };

  if (total < 11) {
    logDetail(`Muster disperses: ${def.name} discarded (${total} < 11)`);
    const factionIdx = owner.cardsInPlay.findIndex(c => c.instanceId === factionInstanceId);
    if (factionIdx !== -1) {
      const factionCard = owner.cardsInPlay[factionIdx];
      const newCardsInPlay = [...owner.cardsInPlay];
      newCardsInPlay.splice(factionIdx, 1);
      newPlayers[ownerIndex] = {
        ...newPlayers[ownerIndex],
        cardsInPlay: newCardsInPlay,
        discardPile: [...newPlayers[ownerIndex].discardPile, factionCard],
      };
    }
  } else {
    logDetail(`Muster holds: ${def.name} stays in play (${total} >= 11)`);
  }

  let postRoll = dequeueResolution({ ...state, players: newPlayers, rng, cheatRollTotal }, top.id);

  // Re-enter chain auto-resolution if the chain is still active
  if (postRoll.chain) {
    const chain = postRoll.chain;
    // Mark the muster short-event entry as resolved if it hasn't been already
    const newEntries = chain.entries.map(e =>
      e.payload.type === 'short-event'
        && !e.resolved
        && e.payload.targetFactionInstanceId === factionInstanceId
        ? { ...e, resolved: true }
        : e,
    );
    postRoll = { ...postRoll, chain: { ...chain, entries: newEntries } };

    const continued = autoResolve(postRoll);
    return {
      state: continued.state,
      effects: [rollEffect, ...(continued.effects ?? [])],
    };
  }

  return {
    state: postRoll,
    effects: [rollEffect],
  };
}

/**
 * Resolve a queued `call-of-home-roll` resolution. The character's player
 * rolls 2d6. If roll + unused general influence < threshold, the character
 * returns to hand. Items/allies/hazards are discarded; followers fall to GI.
 */
function applyCallOfHomeRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'call-of-home-roll') {
    return { state, error: `Pending call-of-home-roll requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'call-of-home-roll') return null;
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending call-of-home-roll' };
  }

  const { targetCharacterId, threshold } = top.kind;
  const actorIndex = getPlayerIndex(state, action.player);
  const player = state.players[actorIndex];
  const charInPlay = player.characters[targetCharacterId as string];
  if (!charInPlay) {
    return { state: dequeueResolution(state, top.id), error: 'Target character not found' };
  }

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = isCharacterCard(charDef) ? charDef.name : (targetCharacterId as string);
  const unusedGI = GENERAL_INFLUENCE - player.generalInfluenceUsed;

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2;
  const checkValue = total + unusedGI;
  const passed = checkValue >= threshold;

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Call of Home: ${charName}`,
  };
  const effects: GameEffect[] = [rollEffect];
  logDetail(`Call of Home on ${charName}: rolled ${total} + unused GI ${unusedGI} = ${checkValue} vs threshold ${threshold} → ${passed ? 'STAYS' : 'RETURNS TO HAND'}`);

  // Update RNG state and store the roll on the player
  const stateAfterRoll = updatePlayer(state, actorIndex, p => ({ ...p, lastDiceRoll: roll }));
  let postRoll = dequeueResolution({ ...stateAfterRoll, rng, cheatRollTotal }, top.id);

  if (!passed) {
    postRoll = returnCharacterToHand(postRoll, actorIndex, targetCharacterId, charInPlay);
  }

  // Mark the chain entry as resolved and continue auto-resolution
  if (postRoll.chain) {
    const chain = postRoll.chain;
    const newEntries = chain.entries.map(e =>
      e.payload.type === 'short-event'
        && !e.resolved
        && e.payload.targetCharacterId === targetCharacterId
        ? { ...e, resolved: true }
        : e,
    );
    postRoll = { ...postRoll, chain: { ...chain, entries: newEntries } };

    const continued = autoResolve(postRoll);
    return {
      state: continued.state,
      effects: [...effects, ...(continued.effects ?? [])],
    };
  }

  return { state: postRoll, effects };
}

/**
 * Return a character to the player's hand, discarding all attached cards.
 * Items, allies, and hazards are discarded to their respective owners'
 * discard piles. Followers fall to GI if room, otherwise are discarded.
 */
function returnCharacterToHand(
  state: GameState,
  playerIndex: number,
  characterId: import('../index.js').CardInstanceId,
  charInPlay: import('../index.js').CharacterInPlay,
): GameState {
  const newPlayers = clonePlayers(state);
  const player = newPlayers[playerIndex];
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  const opponent = newPlayers[opponentIndex];
  const newDiscard = [...player.discardPile];
  const newOpponentDiscard = [...opponent.discardPile];

  // Discard items to owning player's discard pile
  for (const item of charInPlay.items) {
    newDiscard.push({ instanceId: item.instanceId, definitionId: item.definitionId });
    logDetail(`Call of Home: discarding item ${item.definitionId as string} from returned character`);
  }

  // Discard allies
  for (const ally of charInPlay.allies) {
    newDiscard.push({ instanceId: ally.instanceId, definitionId: ally.definitionId });
    logDetail(`Call of Home: discarding ally ${ally.definitionId as string} from returned character`);
  }

  // Discard hazards (back to hazard player = opponent)
  for (const hazard of charInPlay.hazards) {
    newOpponentDiscard.push({ instanceId: hazard.instanceId, definitionId: hazard.definitionId });
    logDetail(`Call of Home: discarding hazard ${hazard.definitionId as string} from returned character`);
  }

  // Handle followers — fall to GI if room, otherwise discard
  const newCharacters = { ...player.characters };
  for (const followerId of charInPlay.followers) {
    const follower = newCharacters[followerId as string];
    if (!follower) continue;
    const followerDef = state.cardPool[follower.definitionId as string];
    const followerMind = followerDef && isCharacterCard(followerDef) && followerDef.mind !== null ? followerDef.mind : 0;

    const currentGIUsed = Object.values(newCharacters)
      .filter(ch => ch.controlledBy === 'general' && ch.instanceId !== characterId)
      .reduce((sum, ch) => {
        const def = state.cardPool[ch.definitionId as string];
        return sum + (def && isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);

    if (currentGIUsed + followerMind <= GENERAL_INFLUENCE) {
      newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      logDetail(`Call of Home: follower ${followerId as string} falls to GI`);
    } else {
      for (const item of follower.items) {
        newDiscard.push({ instanceId: item.instanceId, definitionId: item.definitionId });
      }
      for (const ally of follower.allies) {
        newDiscard.push({ instanceId: ally.instanceId, definitionId: ally.definitionId });
      }
      newDiscard.push({ instanceId: follower.instanceId, definitionId: follower.definitionId });
      delete newCharacters[followerId as string];
      logDetail(`Call of Home: follower ${followerId as string} discarded (no GI room)`);
    }
  }

  // Remove the target character from characters map
  delete newCharacters[characterId as string];

  // Remove from companies
  const newCompanies = player.companies.map(company => {
    if (!company.characters.includes(characterId)) return company;
    return { ...company, characters: company.characters.filter(id => id !== characterId) };
  });

  // Add character card to hand
  const newHand = [...player.hand, { instanceId: charInPlay.instanceId, definitionId: charInPlay.definitionId }];

  newPlayers[playerIndex] = {
    ...player,
    characters: newCharacters,
    companies: newCompanies,
    hand: newHand,
    discardPile: newDiscard,
  };
  newPlayers[opponentIndex] = { ...opponent, discardPile: newOpponentDiscard };

  let result: GameState = { ...state, players: newPlayers };
  result = cleanupEmptyCompanies(result);
  return result;
}

/**
 * Discard a character to their owner's discard pile (body check / hazard discard).
 * Items and allies are discarded to the resource player's discard pile; hazards
 * go to the hazard player's discard pile. Followers fall to GI if room, else discarded.
 */
function discardCharacter(
  state: GameState,
  playerIndex: number,
  characterId: import('../index.js').CardInstanceId,
  charInPlay: import('../index.js').CharacterInPlay,
): GameState {
  const newPlayers = clonePlayers(state);
  const player = newPlayers[playerIndex];
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  const opponent = newPlayers[opponentIndex];
  const newDiscard = [...player.discardPile];
  const newOpponentDiscard = [...opponent.discardPile];

  for (const item of charInPlay.items) {
    newDiscard.push({ instanceId: item.instanceId, definitionId: item.definitionId });
  }
  for (const ally of charInPlay.allies) {
    newDiscard.push({ instanceId: ally.instanceId, definitionId: ally.definitionId });
  }
  for (const hazard of charInPlay.hazards) {
    newOpponentDiscard.push({ instanceId: hazard.instanceId, definitionId: hazard.definitionId });
  }

  const newCharacters = { ...player.characters };
  for (const followerId of charInPlay.followers) {
    const follower = newCharacters[followerId as string];
    if (!follower) continue;
    const followerDef = state.cardPool[follower.definitionId as string];
    const followerMind = followerDef && isCharacterCard(followerDef) && followerDef.mind !== null ? followerDef.mind : 0;
    const currentGIUsed = Object.values(newCharacters)
      .filter(ch => ch.controlledBy === 'general' && ch.instanceId !== characterId)
      .reduce((sum, ch) => {
        const def = state.cardPool[ch.definitionId as string];
        return sum + (def && isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);
    if (currentGIUsed + followerMind <= GENERAL_INFLUENCE) {
      newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
    } else {
      for (const item of follower.items) newDiscard.push({ instanceId: item.instanceId, definitionId: item.definitionId });
      for (const ally of follower.allies) newDiscard.push({ instanceId: ally.instanceId, definitionId: ally.definitionId });
      newDiscard.push({ instanceId: follower.instanceId, definitionId: follower.definitionId });
      delete newCharacters[followerId as string];
    }
  }

  delete newCharacters[characterId as string];
  const newCompanies = player.companies.map(company => {
    if (!company.characters.includes(characterId)) return company;
    return { ...company, characters: company.characters.filter(id => id !== characterId) };
  });

  // Character card goes to the resource player's discard pile (not hand)
  newDiscard.push({ instanceId: charInPlay.instanceId, definitionId: charInPlay.definitionId });

  newPlayers[playerIndex] = {
    ...player,
    characters: newCharacters,
    companies: newCompanies,
    discardPile: newDiscard,
  };
  newPlayers[opponentIndex] = { ...opponent, discardPile: newOpponentDiscard };

  let result: GameState = { ...state, players: newPlayers };
  result = cleanupEmptyCompanies(result);
  return result;
}

/**
 * Resolve a queued `body-check-company` resolution (from a mass-body-check
 * hazard, e.g. Veils Flung Away). The resource player rolls 2d6.
 *
 * - For Orc/Troll: uses `discardBodyCheck` array from card data as the threshold;
 *   min(array) is the pass threshold so all listed results trigger discard.
 *   Discarded characters go to the resource player's discard pile (not hand).
 * - For other races: uses `body` as the threshold.
 * - If roll >= (min(discardBodyCheck) + modifier): no effect (pass).
 * - Orc or Troll and roll fails: character is discarded (to discard pile).
 * - Other races, untapped, and roll fails: character becomes tapped.
 * - Other races, already tapped, roll fails: no effect.
 */
function applyBodyCheckCompanyResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'body-check-company-roll') {
    return { state, error: `Pending body-check-company requires body-check-company-roll, got '${action.type}'` };
  }
  if (top.kind.type !== 'body-check-company') return null;
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending body-check-company' };
  }

  const { characterId, modifier, sourceDefinitionId } = top.kind;
  const actorIndex = getPlayerIndex(state, action.player);
  const player = state.players[actorIndex];
  const charInPlay = player.characters[characterId as string];
  if (!charInPlay) {
    return { state: dequeueResolution(state, top.id), error: 'Target character not found for body check' };
  }

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = isCharacterCard(charDef) ? charDef.name : (characterId as string);
  const body = isCharacterCard(charDef) && charDef.body != null ? charDef.body : 9;
  const race = isCharacterCard(charDef) ? charDef.race : '';
  const isOrcOrTroll = race === 'orc' || race === 'troll';
  // Orc/Troll use their card-stated discard threshold (may differ from body);
  // other races use body for the fail/tap comparison.
  // Orc/Troll use their card-stated discard threshold array (may differ from body);
  // the minimum value sets the pass threshold so all listed results trigger discard.
  const discardValues = isOrcOrTroll && isCharacterCard(charDef) && charDef.cardType === 'minion-character' && charDef.discardBodyCheck != null
    ? charDef.discardBodyCheck
    : [body];
  const discardCheck = Math.min(...discardValues);
  const effectiveThreshold = discardCheck + modifier;

  const sourceDef = state.cardPool[sourceDefinitionId as string];
  const sourceName = sourceDef?.name ?? '?';

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const passed = rollTotal >= effectiveThreshold;

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Body check (${sourceName}): ${charName}`,
  };
  logDetail(`${sourceName} body check on ${charName}: roll ${rollTotal} vs discard threshold ${discardCheck}${modifier < 0 ? modifier : `+${modifier}`} = ${effectiveThreshold} → ${passed ? 'PASS' : 'FAIL'} (race: ${race ?? 'unknown'})`);

  const stateAfterRoll = updatePlayer(
    { ...state, rng, cheatRollTotal },
    actorIndex,
    p => ({ ...p, lastDiceRoll: roll }),
  );
  let postRoll = dequeueResolution(stateAfterRoll, top.id);

  if (!passed) {
    if (isOrcOrTroll) {
      logDetail(`${sourceName}: ${charName} (${race}) failed body check — discarded to discard pile`);
      postRoll = discardCharacter(postRoll, actorIndex, characterId, charInPlay);
    } else if (charInPlay.status === 'untapped') {
      logDetail(`${sourceName}: ${charName} failed body check while untapped — tapped`);
      postRoll = updatePlayer(postRoll, actorIndex, p =>
        updateCharacter(p, characterId, c => ({ ...c, status: CardStatus.Tapped })),
      );
    } else {
      logDetail(`${sourceName}: ${charName} failed body check but was already tapped — no effect`);
    }
  }

  // Once all body-check resolutions from this same source are dequeued,
  // mark the originating short-event chain entry as resolved and let the
  // chain finish normally (so the card lands in the hazard discard pile).
  const remainingBodyChecks = postRoll.pendingResolutions.filter(
    r => r.kind.type === 'body-check-company' && r.source === top.source,
  );
  if (remainingBodyChecks.length === 0 && postRoll.chain) {
    const chain = postRoll.chain;
    const newEntries = chain.entries.map(e =>
      e.payload.type === 'short-event'
        && !e.resolved
        && e.card?.instanceId === top.source
        ? { ...e, resolved: true }
        : e,
    );
    postRoll = { ...postRoll, chain: { ...chain, entries: newEntries } };
    const continued = autoResolve(postRoll);
    return {
      state: continued.state,
      effects: [rollEffect, ...(continued.effects ?? [])],
    };
  }

  return { state: postRoll, effects: [rollEffect] };
}

/**
 * Resolve a queued `seized-by-terror-roll` resolution. The character's
 * player rolls 2d6 and adds the character's mind. If roll + mind < threshold
 * (12), the character splits off into a new company at the original company's
 * site of origin. The original company continues to its destination.
 *
 * If the character is alone in their company, the whole company returns to
 * the site of origin (destinationSite is cleared).
 */
function applySeizedByTerrorRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'seized-by-terror-roll') {
    return { state, error: `Pending seized-by-terror-roll requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'seized-by-terror-roll') return null;
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending seized-by-terror-roll' };
  }

  const { targetCharacterId, threshold, originSiteInstanceId } = top.kind;
  const actorIndex = getPlayerIndex(state, action.player);
  const player = state.players[actorIndex];
  const charInPlay = player.characters[targetCharacterId as string];
  if (!charInPlay) {
    return { state: dequeueResolution(state, top.id), error: 'Target character not found' };
  }

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = isCharacterCard(charDef) ? charDef.name : (targetCharacterId as string);
  const mind = charDef && isCharacterCard(charDef) && charDef.mind !== null ? charDef.mind : 0;

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2;
  const checkValue = total + mind;
  const passed = checkValue >= threshold;

  const rollEffect: import('../index.js').GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Seized by Terror: ${charName}`,
  };
  const effects: import('../index.js').GameEffect[] = [rollEffect];
  logDetail(`Seized by Terror on ${charName}: rolled ${total} + mind ${mind} = ${checkValue} vs threshold ${threshold} → ${passed ? 'STAYS' : 'SPLITS OFF TO ORIGIN'}`);

  const stateAfterRoll = updatePlayer(state, actorIndex, p => ({ ...p, lastDiceRoll: roll }));
  let postRoll = dequeueResolution({ ...stateAfterRoll, rng, cheatRollTotal }, top.id);

  if (!passed) {
    postRoll = splitCharacterToOrigin(postRoll, actorIndex, targetCharacterId, originSiteInstanceId);
  }

  if (postRoll.chain) {
    const chain = postRoll.chain;
    const newEntries = chain.entries.map(e =>
      e.payload.type === 'short-event'
        && !e.resolved
        && e.payload.targetCharacterId === targetCharacterId
        ? { ...e, resolved: true }
        : e,
    );
    postRoll = { ...postRoll, chain: { ...chain, entries: newEntries } };

    const continued = autoResolve(postRoll);
    return {
      state: continued.state,
      effects: [...effects, ...(continued.effects ?? [])],
    };
  }

  return { state: postRoll, effects };
}

/**
 * Split a character off from their current company into a new solo company
 * at the site of origin. If the character is the only one in their company,
 * the company stays at origin instead (destinationSite is cleared).
 */
function splitCharacterToOrigin(
  state: GameState,
  playerIndex: number,
  characterId: import('../index.js').CardInstanceId,
  originSiteInstanceId: import('../index.js').CardInstanceId,
): GameState {
  const newPlayers = clonePlayers(state);
  const player = newPlayers[playerIndex];

  // Find which company the character is in
  const sourceCompanyIndex = player.companies.findIndex(c =>
    c.characters.some(id => id === characterId),
  );
  if (sourceCompanyIndex < 0) return state;
  const sourceCompany = player.companies[sourceCompanyIndex];

  // Find the origin site in play
  let originSite: import('../index.js').SiteInPlay | null = sourceCompany.currentSite;
  if (sourceCompany.currentSite?.instanceId !== originSiteInstanceId) {
    const deckEntry = state.players[playerIndex].siteDeck.find(s => s.instanceId === originSiteInstanceId);
    if (deckEntry) {
      originSite = { instanceId: deckEntry.instanceId, definitionId: deckEntry.definitionId, status: CardStatus.Untapped };
    }
  }

  const updatedCompanies = [...player.companies];

  if (sourceCompany.characters.length <= 1) {
    // Character is alone — whole company returns to origin
    logDetail(`Seized by Terror: ${characterId as string} is alone — company returns to site of origin`);
    updatedCompanies[sourceCompanyIndex] = {
      ...sourceCompany,
      destinationSite: null,
      movementPath: [],
    };
  } else {
    // Remove character from source company
    updatedCompanies[sourceCompanyIndex] = {
      ...sourceCompany,
      characters: sourceCompany.characters.filter(id => id !== characterId),
    };

    // Create new solo company at the site of origin
    const newCompany: import('../index.js').Company = {
      id: nextCompanyId(player),
      characters: [characterId],
      currentSite: originSite ?? null,
      siteCardOwned: false,
      destinationSite: null,
      movementPath: [],
      moved: false,
      siteOfOrigin: null,
      onGuardCards: [],
      hazards: [],
    };
    updatedCompanies.push(newCompany);
    logDetail(`Seized by Terror: ${characterId as string} splits off into new company ${newCompany.id as string} at origin site`);
  }

  newPlayers[playerIndex] = { ...player, companies: updatedCompanies };
  let result: GameState = { ...state, players: newPlayers };
  result = cleanupEmptyCompanies(result);
  return result;
}

/**
 * Resolve a queued `gold-ring-test` resolution (Rule 9.21 / 9.22). The
 * ring's owner rolls 2d6, the site's roll modifier is applied, and the
 * gold-ring item is discarded regardless of the result. Rule 9.21's
 * replacement-with-special-ring step is not yet implemented; the roll is
 * logged so the player can see the final test value.
 */
function applyGoldRingTestResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'gold-ring-test-roll') {
    return { state, error: `Pending gold-ring-test requires a gold-ring-test-roll action, got '${action.type}'` };
  }
  if (top.kind.type !== 'gold-ring-test') return null;
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending gold-ring-test' };
  }

  const { goldRingInstanceId, rollModifier } = top.kind;
  const actorIndex = getPlayerIndex(state, action.player);
  const player = state.players[actorIndex];

  // Locate the gold ring in the owner's out-of-play pile (where store-item
  // just moved it). If absent, error so the caller can surface a bug.
  const ringIdx = player.outOfPlayPile.findIndex(c => c.instanceId === goldRingInstanceId);
  if (ringIdx === -1) {
    return { state: dequeueResolution(state, top.id), error: 'Gold ring not found in out-of-play pile' };
  }
  const ringCard = player.outOfPlayPile[ringIdx];
  const ringDef = state.cardPool[ringCard.definitionId as string];
  const ringName = ringDef?.name ?? (ringCard.definitionId as string);

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + rollModifier;
  const modSign = rollModifier >= 0 ? '+' : '';
  logDetail(`Gold-ring auto-test: ${ringName} — rolled ${roll.die1} + ${roll.die2} ${modSign}${rollModifier} = ${total}; ring discarded`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Gold-ring test: ${ringName}`,
  };

  // Discard the gold ring from out-of-play regardless of the roll
  // (Rule 9.21: gold ring is immediately discarded when tested).
  const newOutOfPlay = [...player.outOfPlayPile];
  newOutOfPlay.splice(ringIdx, 1);
  const stateAfterRing = updatePlayer(state, actorIndex, p => ({
    ...p,
    outOfPlayPile: newOutOfPlay,
    discardPile: [...p.discardPile, ringCard],
    lastDiceRoll: roll,
  }));

  const postRoll = dequeueResolution(
    { ...stateAfterRing, rng, cheatRollTotal },
    top.id,
  );

  return { state: postRoll, effects: [rollEffect] };
}

/**
 * Resolve a `wizard-search-on-store` pending resolution.
 *
 * Handles `play-wizard-from-search` (adds the Wizard to the company) and
 * `skip-wizard-search` (closes the window without playing anyone).
 *
 * The Windlord Found Me (dm-164): playing the wizard here does NOT count
 * toward the one-character-per-turn limit.
 */
function applyWizardSearchOnStoreResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'wizard-search-on-store') return null;

  if (action.type === 'skip-wizard-search') {
    if (action.player !== top.actor) {
      return { state, error: 'Wrong player for wizard-search-on-store' };
    }
    logDetail('Wizard-search: skipped by player');
    return { state: dequeueResolution(state, top.id) };
  }

  if (action.type !== 'play-wizard-from-search') {
    return { state, error: `Pending wizard-search-on-store requires play-wizard-from-search or skip-wizard-search, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for wizard-search-on-store' };
  }

  const { companyId } = top.kind;
  const { wizardDefinitionId, source } = action;

  const actorIndex = getPlayerIndex(state, action.player);
  const player = state.players[actorIndex];

  // Find the wizard instance in the specified pile
  let wizardInst: CardInstance | undefined;
  if (source === 'play-deck') {
    wizardInst = player.playDeck.find(c => c.definitionId === wizardDefinitionId);
  } else {
    wizardInst = player.discardPile.find(c => c.definitionId === wizardDefinitionId);
  }
  if (!wizardInst) {
    return { state, error: `Wizard ${wizardDefinitionId as string} not found in ${source}` };
  }

  const wizardDef = state.cardPool[wizardInst.definitionId as string];
  const wizardName = wizardDef?.name ?? (wizardDefinitionId as string);
  logDetail(`Wizard-search: playing ${wizardName} from ${source}`);

  // Find the company by ID
  const companyIdx = player.companies.findIndex(c => c.id === companyId);
  if (companyIdx === -1) {
    return { state, error: `Company ${companyId as string} not found` };
  }

  // Build the CharacterInPlay entry
  const newChar: CharacterInPlay = {
    instanceId: wizardInst.instanceId,
    definitionId: wizardInst.definitionId,
    status: CardStatus.Untapped,
    items: [],
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: 'general',
    effectiveStats: ZERO_EFFECTIVE_STATS,
  };

  // Remove wizard from the source pile and add to characters + company
  const newCharacters = {
    ...player.characters,
    [wizardInst.instanceId as string]: newChar,
  };
  const updatedCompanies = [...player.companies];
  updatedCompanies[companyIdx] = {
    ...player.companies[companyIdx],
    characters: [...player.companies[companyIdx].characters, wizardInst.instanceId],
  };

  const newPlayer = {
    ...player,
    characters: newCharacters,
    companies: updatedCompanies,
    playDeck: source === 'play-deck'
      ? removeById(player.playDeck, wizardInst.instanceId)
      : player.playDeck,
    discardPile: source === 'discard-pile'
      ? removeById(player.discardPile, wizardInst.instanceId)
      : player.discardPile,
    // Wizard does not count toward one-character-per-turn limit (card text explicit)
  };

  const stateAfterPlay = dequeueResolution(
    updatePlayer(state, actorIndex, () => newPlayer),
    top.id,
  );

  return { state: stateAfterPlay };
}
