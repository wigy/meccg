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
import type { CardInPlay } from '../types/state-cards.js';
import type { ChainEntry } from '../types/state-combat.js';
import type { ReducerResult } from './reducer-utils.js';
import { dequeueResolution, enqueueResolution, removeConstraint, addConstraint } from './pending.js';
import { getPlayerIndex, isCharacterCard, isFactionCard, CardStatus, ZERO_EFFECTIVE_STATS, Skill, Phase, formatSignedNumber } from '../index.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import { resolveDef, getItemGrantedSkills, collectCharacterEffects, resolveCheckModifier } from './effects/index.js';
import { hasPlayFlag } from '../effects/index.js';
import { activePlayerState, cardName, classifyCorruptionOutcome, cleanupEmptyCompanies, clonePlayers, defById, diceRollEffect, effectiveGeneralInfluence, findById, findCharacterCompany, findHazardMaintenanceEffect, getCardEffects, matchesDefinition, nextCompanyId, removeById, roll2d6, sweepCompanyMembershipChangedEvents, sweepLeaderLeavesCompanyEvents, toCardInstance, updateCharacter, updatePlayer, wrongActionType } from './reducer-utils.js';
import { applyCost } from './cost-evaluator.js';
import { logDetail, logHeading } from './legal-actions/log.js';
import { oneRingWin } from './reducer-free-council.js';
import {
  resolveInfluenceAttemptRoll,
  resolveOpponentInfluenceDefend,
  applyOnGuardRevealAtResource,
  executeDeferredSiteAction,
} from './reducer-site.js';
import { autoResolve } from './chain-reducer.js';
import { availableDI } from './legal-actions/organization.js';
import { eligibleRingCategories } from './legal-actions/pending.js';
import type { RingTestTableEffect, RingTestSearchEffect } from '../types/effects.js';
import { resolveCancelAttackEntry } from './reducer-combat.js';

/**
 * Shared tail of the roll-resolution handlers: mark every unresolved chain
 * entry matching `matches` as resolved, then re-enter chain auto-resolution and
 * merge its effects after `effects`. When no chain is active, returns `state`
 * unchanged with `effects`. The handlers differ only in the entry-match
 * predicate and the roll's own effects, so this folds their identical
 * "resolve-entry → autoResolve → merge" boilerplate into one place.
 */
function resolveChainEntryAndContinue(
  state: GameState,
  matches: (entry: ChainEntry) => boolean,
  effects: readonly GameEffect[],
): ReducerResult {
  if (!state.chain) return { state, effects: [...effects] };
  const chain = state.chain;
  const newEntries = chain.entries.map(e => !e.resolved && matches(e) ? { ...e, resolved: true } : e);
  const continued = autoResolve({ ...state, chain: { ...chain, entries: newEntries } });
  return { state: continued.state, effects: [...effects, ...(continued.effects ?? [])] };
}

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
    case 'flattery-attempt':
      return applyFlateryAttemptResolution(state, action, top);
    case 'call-of-home-roll':
      return applyCallOfHomeRollResolution(state, action, top);
    case 'seized-by-terror-roll':
      return applySeizedByTerrorRollResolution(state, action, top);
    case 'gold-ring-test':
      return applyGoldRingTestResolution(state, action, top);
    case 'body-check-company':
      return applyBodyCheckCompanyResolution(state, action, top);
    case 'ring-play-offer':
      return applyRingPlayOfferResolution(state, action, top);
    case 'resource-play-offer':
      return applyResourcePlayOfferResolution(state, action, top);
    case 'wizard-search-on-store':
      return applyWizardSearchOnStoreResolution(state, action, top);
    case 'select-card-bearer':
      return applySelectCardBearerResolution(state, action, top);
    case 'glamour-hazard-roll':
      return applyGlamourHazardRollResolution(state, action, top);
    case 'discard-one-company-item':
      return applyDiscardOneCompanyItemResolution(state, action, top);
    case 'hazard-event-maintenance':
      return applyHazardEventMaintenanceResolution(state, action, top);
    case 'cvcc-ally-discard-roll':
      return applyCvccAllyDiscardRollResolution(state, action, top);
    case 'tap-one-character':
      return applyTapOneCharacterResolution(state, action, top);
    case 'haven-restore-character':
      return applyHavenRestoreCharacterResolution(state, action, top);
    case 'stay-her-appetite-roll':
      return applyStayHerAppetiteRollResolution(state, action, top);
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
  // A corruption-check-window grant-action (When I Know Anything td-166: tap
  // sage to add +3 to this check) is also legal here — fall through to the
  // per-phase reducer's `activate-granted-action` handler. The pending
  // resolution stays queued; the next legal-action cycle re-emits the roll
  // action with the freshly-added check-modifier constraint factored in.
  if (action.type === 'activate-granted-action') return null;
  if (top.kind.type !== 'corruption-check') return null;

  const { characterId, transferredItemId, reason } = top.kind;

  // Check if the character still exists BEFORE validating the action type.
  // When a character is eliminated mid-series (e.g. during a multi-region
  // corruption check), the legal-action computer offers `pass` instead of
  // `corruption-check`. Accept `pass` here to dequeue the now-irrelevant
  // resolution.
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player.characters[characterId as string];
  if (!char) {
    // Character was eliminated since the resolution was queued — drop it.
    logDetail(`Corruption check (${reason}): character ${characterId as string} no longer in play — dequeuing`);
    return { state: dequeueResolution(state, top.id) };
  }

  if (action.type !== 'corruption-check') {
    return { state, error: `Pending corruption check requires a corruption-check action, got '${action.type}'` };
  }
  if (action.characterId !== characterId) {
    return { state, error: 'Wrong character for pending corruption check' };
  }

  const charDef = resolveDef(state, characterId);
  const charName = charDef?.name ?? '?';
  const cp = action.corruptionPoints;
  const modifier = action.corruptionModifier;

  // Roll 2d6 + modifier
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + modifier;
  const modStr = modifier !== 0 ? ` ${formatSignedNumber(modifier)}` : '';
  logDetail(`Corruption check for ${charName} (${reason}): rolled ${roll.die1} + ${roll.die2}${modStr} = ${total} vs CP ${cp}`);

  const rollEffect = diceRollEffect(player.name, roll, `Corruption: ${charName}`);

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
      logDetail(`Consuming one-shot check-modifier constraint ${constraint.id} (corruption ${formatSignedNumber(constraint.kind.value)})`);
      postRollState = removeConstraint(postRollState, constraint.id);
    }
  }

  // Classify against the controlling player's alignment (CoE 7.1 / 7.1.F1): a
  // minion character or the Fallen-wizard avatar *taps and succeeds* on a roll
  // of CP or CP-1 rather than being discarded.
  const outcome = classifyCorruptionOutcome(charDef, player.alignment, total, cp);

  if (outcome === 'success' || outcome === 'tap-success') {
    let successState: GameState = postRollState;
    if (outcome === 'tap-success') {
      // The character taps but stays in play; the check counts as a success.
      // Only an untapped character changes state — an already-tapped or wounded
      // character stays as it is (you cannot tap it "further").
      const tappedPlayers = clonePlayers(postRollState);
      const tappedChars = { ...tappedPlayers[playerIndex].characters };
      const tappedChar = tappedChars[characterId as string];
      if (tappedChar && tappedChar.status === CardStatus.Untapped) {
        tappedChars[characterId as string] = { ...tappedChar, status: CardStatus.Tapped };
      }
      tappedPlayers[playerIndex] = { ...tappedPlayers[playerIndex], characters: tappedChars };
      successState = { ...postRollState, players: tappedPlayers };
      logDetail(`Corruption check (${total} within 1 of ${cp}) — ${charName} taps and the check is considered successful (CoE 7.1)`);
    } else {
      logDetail(`Corruption check passed (${total} > ${cp})`);
    }
    let stateAfterDequeue = dequeueResolution(successState, top.id);
    // onSuccess hook (CoE 10.39): Cracks of Doom wins the game on a passing
    // −4 corruption check. The source card is the win card (tw-205); the
    // actor is its controller.
    const onSuccess = top.kind.onSuccess;
    if (onSuccess?.type === 'win-game') {
      const winCard = top.source ? resolveInstanceId(state, top.source) : null;
      logHeading(`Corruption check succeeded — ${player.name} wins with The One Ring (CoE 10.39)`);
      stateAfterDequeue = oneRingWin(stateAfterDequeue, player.id, winCard ?? null);
    }
    return { state: stateAfterDequeue, effects: [rollEffect] };
  }

  // The Ring's Betrayal failure mode: discard only the Ring, character stays
  if (top.kind.failureMode === 'discard-ring-only') {
    logDetail(`Corruption check FAILED (${total} <= ${cp}) — failureMode discard-ring-only: discarding Ring, ${charName} remains in play`);
    const ringInstances = action.possessions
      .map(id => {
        const defId = resolveInstanceId(state, id);
        const def = defId ? defById(state, defId) : undefined;
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

  if (outcome === 'discard') {
    // Roll == CP or CP - 1 on a hero character: it + possessions discarded (not followers)
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

    // Separate hazards (owned by opponent) from non-hazard possessions
    const hazardPlayerIndex = playerIndex === 0 ? 1 : 0;
    const hazardPossessions: CardInstance[] = [];
    const nonHazardPossessions: CardInstance[] = [];
    for (const id of action.possessions) {
      const hazOwner = ownerOf(id) as string;
      const defId = resolveInstanceId(state, id)!;
      if (hazOwner === (playersAfterRoll[hazardPlayerIndex].id as string)) {
        logDetail(`Discarding hazard ${id as string} to hazard player`);
        hazardPossessions.push({ instanceId: id, definitionId: defId });
      } else {
        nonHazardPossessions.push({ instanceId: id, definitionId: defId });
      }
    }
    if (hazardPossessions.length > 0) {
      playersAfterRoll[hazardPlayerIndex] = {
        ...playersAfterRoll[hazardPlayerIndex],
        discardPile: [...playersAfterRoll[hazardPlayerIndex].discardPile, ...hazardPossessions],
      };
    }

    const toDiscard: CardInstance[] = [
      { instanceId: characterId, definitionId: char.definitionId },
      ...nonHazardPossessions,
    ];
    playersAfterRoll[playerIndex] = {
      ...playersAfterRoll[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      discardPile: [...playersAfterRoll[playerIndex].discardPile, ...toDiscard],
    };
    for (const hazard of char.hazards) {
      logDetail(`Discarding hazard ${hazard.instanceId as string} from discarded character`);
      const hazOwner = ownerOf(hazard.instanceId);
      let hazOwnerIdx = playersAfterRoll.findIndex(p => p.id === hazOwner);
      if (hazOwnerIdx === -1) hazOwnerIdx = playerIndex === 0 ? 1 : 0;
      playersAfterRoll[hazOwnerIdx] = { ...playersAfterRoll[hazOwnerIdx], discardPile: [...playersAfterRoll[hazOwnerIdx].discardPile, toCardInstance(hazard)] };
    }
  } else {
    // outcome === 'eliminate': hard fail (≥2 below CP) or a Wizard avatar on any
    // failure — character eliminated, possessions discarded.
    logDetail(`Corruption check FAILED (outcome eliminate, ${total} vs CP ${cp}) — eliminating ${charName}, discarding ${action.possessions.length} possession(s)`);

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

    // Separate hazards (owned by opponent) from non-hazard possessions
    const hazardPlayerIndex = playerIndex === 0 ? 1 : 0;
    const hazardPossessions: CardInstance[] = [];
    const nonHazardPossessions: CardInstance[] = [];
    for (const id of action.possessions) {
      const hazOwner = ownerOf(id) as string;
      const defId = resolveInstanceId(state, id)!;
      if (hazOwner === (playersAfterRoll[hazardPlayerIndex].id as string)) {
        logDetail(`Discarding hazard ${id as string} to hazard player`);
        hazardPossessions.push({ instanceId: id, definitionId: defId });
      } else {
        nonHazardPossessions.push({ instanceId: id, definitionId: defId });
      }
    }
    if (hazardPossessions.length > 0) {
      playersAfterRoll[hazardPlayerIndex] = {
        ...playersAfterRoll[hazardPlayerIndex],
        discardPile: [...playersAfterRoll[hazardPlayerIndex].discardPile, ...hazardPossessions],
      };
    }

    playersAfterRoll[playerIndex] = {
      ...playersAfterRoll[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      outOfPlayPile: [...player.outOfPlayPile, { instanceId: characterId, definitionId: char.definitionId }],
      discardPile: [...playersAfterRoll[playerIndex].discardPile, ...nonHazardPossessions],
    };
    for (const hazard of char.hazards) {
      logDetail(`Discarding hazard ${hazard.instanceId as string} from eliminated character`);
      const hazOwner = ownerOf(hazard.instanceId);
      let hazOwnerIdx = playersAfterRoll.findIndex(p => p.id === hazOwner);
      if (hazOwnerIdx === -1) hazOwnerIdx = playerIndex === 0 ? 1 : 0;
      playersAfterRoll[hazOwnerIdx] = { ...playersAfterRoll[hazOwnerIdx], discardPile: [...playersAfterRoll[hazOwnerIdx].discardPile, toCardInstance(hazard)] };
    }
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
  const ogDef = defById(state, ogCard.definitionId);
  if (!ogDef) return null;
  const ogEffects = getCardEffects(ogDef);

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
  const handDef = defById(state, handCard.definitionId);
  if (!handDef) return null;
  const hasSkill = getCardEffects(handDef).some(e => (e as { requiredSkill?: string }).requiredSkill === requiredSkill);
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
    discardPile: [...resourcePlayer.discardPile, toCardInstance(handCard)],
  };
  const hazardPlayer = newPlayers[hazardIndex];
  newPlayers[hazardIndex] = {
    ...hazardPlayer,
    discardPile: [...hazardPlayer.discardPile, toCardInstance(ogCard)],
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
  const cardDef = defById(state, discardedCard.definitionId);
  if (!cardDef) {
    return { state, error: 'cancel-influence card definition not found' };
  }

  const allCancelEffects = ('effects' in cardDef && cardDef.effects)
    ? (cardDef.effects as import('../index.js').CardEffect[]).filter(e => e.type === 'cancel-influence')
    : [];
  if (allCancelEffects.length === 0) {
    return { state, error: 'Card has no cancel-influence effect' };
  }

  // Resolve the paying character's race and skills to find the matching effect
  const charDef = resolveDef(state, action.characterId);
  const charRace = charDef && isCharacterCard(charDef) ? charDef.race : undefined;
  const charData = action.characterId ? player.characters[action.characterId as string] : undefined;
  const charSkills = charDef && isCharacterCard(charDef)
    ? [...charDef.skills, ...(charData ? getItemGrantedSkills(state, charData) : [])]
    : [];
  const targetKind = top.kind.type === 'opponent-influence-defend'
    ? top.kind.attempt.targetKind
    : undefined;

  // Pick the first effect that matches the current context (character + targetKind)
  const cancelEffect = allCancelEffects.find(e => {
    if (e.type !== 'cancel-influence') return false;
    if (e.requiredRace && charRace !== e.requiredRace) return false;
    if (e.requiredSkill && !charSkills.includes(e.requiredSkill)) return false;
    if (e.targetKindFilter && e.targetKindFilter.length > 0 && targetKind) {
      if (!e.targetKindFilter.includes(targetKind)) return false;
    }
    return true;
  });
  if (!cancelEffect || cancelEffect.type !== 'cancel-influence') {
    return { state, error: 'No matching cancel-influence effect for this character and target' };
  }

  const newDiscard = [...player.discardPile, toCardInstance(discardedCard)];

  logDetail(`Cancel-influence: ${cardDef.name} played, influence attempt auto-canceled`);

  let resultState: GameState = updatePlayer(state, playerIndex, p => ({ ...p, hand: handCards, discardPile: newDiscard }));
  resultState = dequeueResolution(resultState, top.id);

  if (cancelEffect.cost?.check === 'corruption') {
    const activeCompanyIndex = (state.phaseState as { activeCompanyIndex?: number }).activeCompanyIndex ?? 0;
    const activePlayer = activePlayerState(state);
    const companyId = activePlayer?.companies[activeCompanyIndex]?.id ?? '' as import('../index.js').CompanyId;
    const charName = charDef && 'name' in charDef ? charDef.name : 'cancel-influence';

    const costResult = applyCost(resultState, cancelEffect.cost, action.characterId, {
      playerIndex,
      sourceCardId: action.cardInstanceId,
      companyId,
      checkScopeKind: 'company-site-subphase',
      label: charName,
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
      placeUnderLeaderControl: top.kind.placeUnderLeaderControl,
    },
  };

  // Run the roll. The chain still holds the unresolved influence-attempt
  // entry — find it, mark it resolved, and re-enter chain auto-resolution
  // so the chain can complete normally (handles deferred passives, parent
  // chain restoration, etc.).
  const rollResult = resolveInfluenceAttemptRoll(state, entry);
  const postRoll = dequeueResolution(rollResult.state, top.id);

  return resolveChainEntryAndContinue(
    postRoll,
    e => e.payload.type === 'influence-attempt' && e.card?.instanceId === entry.card.instanceId,
    rollResult.effects,
  );
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

  const def = defById(state, factionDefinitionId);
  if (!def || !isFactionCard(def)) {
    return { state, error: 'Targeted card is not a faction' };
  }

  const unusedGI = effectiveGeneralInfluence(state, owner.id) - owner.generalInfluenceUsed;
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + unusedGI;

  logDetail(`Muster roll: ${def.name} — rolled ${roll.die1} + ${roll.die2} + unused GI ${unusedGI} = ${total} vs 11`);

  const rollEffect = diceRollEffect(owner.name, roll, `Muster: ${def.name}`);

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

  const postRoll = dequeueResolution({ ...state, players: newPlayers, rng, cheatRollTotal }, top.id);

  // Re-enter chain auto-resolution if the chain is still active, marking the
  // muster short-event entry resolved.
  return resolveChainEntryAndContinue(
    postRoll,
    e => e.payload.type === 'short-event' && e.payload.targetFactionInstanceId === factionInstanceId,
    [rollEffect],
  );
}

/**
 * Resolve a queued `flattery-attempt` resolution (Flatter a Foe, td-116).
 * The defending player rolls 2d6; total = roll + unusedDI + diplomatBonus (if
 * the character has the diplomat skill). Success if total > threshold: cancel
 * the current attack and decrease the company's hazard limit by
 * `hazardLimitReduction`.
 */
function applyFlateryAttemptResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'flattery-attempt') {
    return { state, error: `Pending flattery-attempt requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'flattery-attempt') return null;

  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending flattery-attempt' };
  }

  const { characterInstanceId, creatureRace, threshold, diplomatBonus, hazardLimitReduction } = top.kind;

  const actorIndex = getPlayerIndex(state, action.player);
  const player = state.players[actorIndex];

  const charInPlay = player.characters[characterInstanceId as string];
  if (!charInPlay) {
    return { state, error: `Flattery-attempt: character ${characterInstanceId as string} not found` };
  }

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : String(characterInstanceId);
  const isDiplomat = isCharacterCard(charDef) && charDef.skills.includes(Skill.Diplomat);
  const bonus = isDiplomat ? diplomatBonus : 0;
  const unusedDI = availableDI(state, characterInstanceId, player);

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + unusedDI + bonus;
  const success = total > threshold;

  logDetail(`Flattery attempt by ${charName} vs "${creatureRace}": rolled ${roll.die1}+${roll.die2} + DI ${unusedDI}${isDiplomat ? ` + diplomat ${bonus}` : ''} = ${total} vs threshold ${threshold} → ${success ? 'SUCCESS' : 'FAILURE'}`);

  const rollEffect = diceRollEffect(player.name, roll, `Flattery attempt: ${charName} vs ${creatureRace}`);

  const newPlayers = clonePlayers(state);
  newPlayers[actorIndex] = { ...newPlayers[actorIndex], lastDiceRoll: roll };

  let postRoll = dequeueResolution({ ...state, players: newPlayers, rng, cheatRollTotal }, top.id);

  if (success) {
    logDetail(`Flattery attempt succeeded: cancelling attack and reducing hazard limit by ${hazardLimitReduction}`);
    postRoll = resolveCancelAttackEntry(postRoll);

    // Decrease hazard limit snapshot if in the M/H phase
    if (postRoll.phaseState.phase === Phase.MovementHazard) {
      const mh = postRoll.phaseState;
      const current = mh.hazardLimitAtReveal;
      postRoll = {
        ...postRoll,
        phaseState: {
          ...mh,
          hazardLimitAtReveal: Math.max(0, current - hazardLimitReduction),
        },
      };
      logDetail(`Flattery attempt: hazard limit reduced from ${current} to ${postRoll.phaseState.phase === Phase.MovementHazard ? (postRoll.phaseState).hazardLimitAtReveal : '?'}`);
    }
  } else {
    logDetail(`Flattery attempt failed: combat continues`);
  }

  return { state: postRoll, effects: [rollEffect] };
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

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : (targetCharacterId as string);
  const unusedGI = effectiveGeneralInfluence(state, player.id) - player.generalInfluenceUsed;

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2;
  const checkValue = total + unusedGI;
  const passed = checkValue >= threshold;

  const rollEffect = diceRollEffect(player.name, roll, `Call of Home: ${charName}`);
  const effects: GameEffect[] = [rollEffect];
  logDetail(`Call of Home on ${charName}: rolled ${total} + unused GI ${unusedGI} = ${checkValue} vs threshold ${threshold} → ${passed ? 'STAYS' : 'RETURNS TO HAND'}`);

  // Update RNG state and store the roll on the player
  const stateAfterRoll = updatePlayer(state, actorIndex, p => ({ ...p, lastDiceRoll: roll }));
  let postRoll = dequeueResolution({ ...stateAfterRoll, rng, cheatRollTotal }, top.id);

  if (!passed) {
    postRoll = returnCharacterToHand(postRoll, actorIndex, targetCharacterId, charInPlay);
  }

  // Mark the chain entry as resolved and continue auto-resolution.
  return resolveChainEntryAndContinue(
    postRoll,
    e => e.payload.type === 'short-event' && e.payload.targetCharacterId === targetCharacterId,
    effects,
  );
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
    newDiscard.push(toCardInstance(item));
    logDetail(`Call of Home: discarding item ${item.definitionId as string} from returned character`);
  }

  // Discard allies
  for (const ally of charInPlay.allies) {
    newDiscard.push(toCardInstance(ally));
    logDetail(`Call of Home: discarding ally ${ally.definitionId as string} from returned character`);
  }

  // Discard hazards (back to hazard player = opponent)
  for (const hazard of charInPlay.hazards) {
    newOpponentDiscard.push(toCardInstance(hazard));
    logDetail(`Call of Home: discarding hazard ${hazard.definitionId as string} from returned character`);
  }

  // Handle followers — fall to GI if room, otherwise discard
  const newCharacters = { ...player.characters };
  for (const followerId of charInPlay.followers) {
    const follower = newCharacters[followerId as string];
    if (!follower) continue;
    const followerDef = defById(state, follower.definitionId);
    const followerMind = followerDef && isCharacterCard(followerDef) && followerDef.mind !== null ? followerDef.mind : 0;

    const currentGIUsed = Object.values(newCharacters)
      .filter(ch => ch.controlledBy === 'general' && ch.instanceId !== characterId)
      .reduce((sum, ch) => {
        const def = defById(state, ch.definitionId);
        return sum + (def && isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);

    if (currentGIUsed + followerMind <= effectiveGeneralInfluence(state, player.id)) {
      newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      logDetail(`Call of Home: follower ${followerId as string} falls to GI`);
    } else {
      for (const item of follower.items) {
        newDiscard.push(toCardInstance(item));
      }
      for (const ally of follower.allies) {
        newDiscard.push(toCardInstance(ally));
      }
      for (const hazard of follower.hazards) {
        logDetail(`Call of Home: discarding hazard ${hazard.instanceId as string} from discarded follower`);
        const hazOwner = ownerOf(hazard.instanceId);
        if ((newPlayers[opponentIndex].id as string) === hazOwner) {
          newOpponentDiscard.push(toCardInstance(hazard));
        } else {
          newDiscard.push(toCardInstance(hazard));
        }
      }
      newDiscard.push(toCardInstance(follower));
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
  const newHand = [...player.hand, toCardInstance(charInPlay)];

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
    newDiscard.push(toCardInstance(item));
  }
  for (const ally of charInPlay.allies) {
    newDiscard.push(toCardInstance(ally));
  }
  for (const hazard of charInPlay.hazards) {
    newOpponentDiscard.push(toCardInstance(hazard));
  }

  const newCharacters = { ...player.characters };
  for (const followerId of charInPlay.followers) {
    const follower = newCharacters[followerId as string];
    if (!follower) continue;
    const followerDef = defById(state, follower.definitionId);
    const followerMind = followerDef && isCharacterCard(followerDef) && followerDef.mind !== null ? followerDef.mind : 0;
    const currentGIUsed = Object.values(newCharacters)
      .filter(ch => ch.controlledBy === 'general' && ch.instanceId !== characterId)
      .reduce((sum, ch) => {
        const def = defById(state, ch.definitionId);
        return sum + (def && isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);
    if (currentGIUsed + followerMind <= effectiveGeneralInfluence(state, player.id)) {
      newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
    } else {
      for (const item of follower.items) newDiscard.push(toCardInstance(item));
      for (const ally of follower.allies) newDiscard.push(toCardInstance(ally));
      for (const hazard of follower.hazards) newOpponentDiscard.push(toCardInstance(hazard));
      newDiscard.push(toCardInstance(follower));
      delete newCharacters[followerId as string];
    }
  }

  const affectedCompanies = player.companies
    .filter(c => c.characters.includes(characterId))
    .map(c => c.id);

  delete newCharacters[characterId as string];
  const newCompanies = player.companies.map(company => {
    if (!company.characters.includes(characterId)) return company;
    return { ...company, characters: company.characters.filter(id => id !== characterId) };
  });

  // Character card goes to the resource player's discard pile (not hand)
  newDiscard.push(toCardInstance(charInPlay));

  newPlayers[playerIndex] = {
    ...player,
    characters: newCharacters,
    companies: newCompanies,
    discardPile: newDiscard,
  };
  newPlayers[opponentIndex] = { ...opponent, discardPile: newOpponentDiscard };

  const removedDef = defById(state, charInPlay.definitionId);
  const removedIsLeader = !!(removedDef && isCharacterCard(removedDef) && (removedDef.keywords ?? []).includes('Leader'));

  let result: GameState = { ...state, players: newPlayers };
  result = cleanupEmptyCompanies(result);
  result = sweepCompanyMembershipChangedEvents(result, affectedCompanies);
  if (removedIsLeader) {
    logDetail(`discardCharacter: removed character is a Leader — sweeping leader-leaves-company events`);
    result = sweepLeaderLeavesCompanyEvents(result, affectedCompanies);
  }
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

  const charDef = defById(state, charInPlay.definitionId);
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

  const sourceDef = defById(state, sourceDefinitionId);
  const sourceName = sourceDef?.name ?? '?';

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const passed = rollTotal >= effectiveThreshold;

  const rollEffect = diceRollEffect(player.name, roll, `Body check (${sourceName}): ${charName}`);
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
  if (remainingBodyChecks.length === 0) {
    return resolveChainEntryAndContinue(
      postRoll,
      e => e.payload.type === 'short-event' && e.card?.instanceId === top.source,
      [rollEffect],
    );
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

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : (targetCharacterId as string);
  const mind = charDef && isCharacterCard(charDef) && charDef.mind !== null ? charDef.mind : 0;

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2;
  const checkValue = total + mind;
  const passed = checkValue >= threshold;

  const rollEffect = diceRollEffect(player.name, roll, `Seized by Terror: ${charName}`);
  const effects: import('../index.js').GameEffect[] = [rollEffect];
  logDetail(`Seized by Terror on ${charName}: rolled ${total} + mind ${mind} = ${checkValue} vs threshold ${threshold} → ${passed ? 'STAYS' : 'SPLITS OFF TO ORIGIN'}`);

  const stateAfterRoll = updatePlayer(state, actorIndex, p => ({ ...p, lastDiceRoll: roll }));
  let postRoll = dequeueResolution({ ...stateAfterRoll, rng, cheatRollTotal }, top.id);

  if (!passed) {
    postRoll = splitCharacterToOrigin(postRoll, actorIndex, targetCharacterId, originSiteInstanceId);
  }

  return resolveChainEntryAndContinue(
    postRoll,
    e => e.payload.type === 'short-event' && e.payload.targetCharacterId === targetCharacterId,
    effects,
  );
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
    const deckEntry = findById(state.players[playerIndex].siteDeck, originSiteInstanceId);
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
 * gold-ring item is discarded regardless of the result. Then a
 * `ring-play-offer` is enqueued so the player may play a matching special ring.
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

  const { goldRingInstanceId, rollModifier, characterInstanceId } = top.kind;
  const actorIndex = getPlayerIndex(state, action.player);
  const player = state.players[actorIndex];

  // Locate the gold ring. Org-phase store-item path: ring is in killPile (the
  // MP pile). Site-phase auto-test path: ring was just played and sits in a
  // character's items array. Search both locations.
  const ringInKillPile = player.killPile.findIndex(c => c.instanceId === goldRingInstanceId);

  let ringCard: typeof player.killPile[0];
  let stateAfterRing: GameState;
  // True when the ring came from killPile — it was stored at a Darkhaven
  // (Rule 9.22), so the replacement enters play stored rather than attached.
  let storedPlacement: boolean;

  if (ringInKillPile !== -1) {
    ringCard = player.killPile[ringInKillPile];
    const newKillPile = [...player.killPile];
    newKillPile.splice(ringInKillPile, 1);
    stateAfterRing = updatePlayer(state, actorIndex, p => ({
      ...p,
      killPile: newKillPile,
      discardPile: [...p.discardPile, ringCard],
    }));
    storedPlacement = true;
  } else {
    // Site-phase path: find ring in character items.
    let foundCharId: string | null = null;
    let foundItemIdx = -1;
    for (const [charIdStr, char] of Object.entries(player.characters)) {
      const idx = char.items.findIndex(i => i.instanceId === goldRingInstanceId);
      if (idx !== -1) {
        foundCharId = charIdStr;
        foundItemIdx = idx;
        break;
      }
    }
    if (foundCharId === null) {
      return { state: dequeueResolution(state, top.id), error: 'Gold ring not found in out-of-play pile or character items' };
    }
    const char = player.characters[foundCharId];
    ringCard = char.items[foundItemIdx];
    const newItems = [...char.items];
    newItems.splice(foundItemIdx, 1);
    stateAfterRing = updatePlayer(state, actorIndex, p => ({
      ...p,
      characters: {
        ...p.characters,
        [foundCharId]: { ...char, items: newItems },
      },
      discardPile: [...p.discardPile, ringCard],
    }));
    storedPlacement = false;
  }

  const ringDef = defById(state, ringCard.definitionId);
  const ringName = ringDef?.name ?? (ringCard.definitionId as string);

  // Collect check-modifier effects (e.g. Scroll of Isildur) from every character
  // in the company bearing the ring. Uses stateAfterRing so the ring itself is
  // already gone, but Scroll-of-Isildur-style companions are still present.
  let itemCheckModifier = 0;
  if (characterInstanceId) {
    const afterRingPlayer = stateAfterRing.players[actorIndex];
    const company = findCharacterCompany(afterRingPlayer.companies, characterInstanceId);
    if (company) {
      const checkContext = { reason: 'gold-ring-test' };
      for (const compCharId of company.characters) {
        const compChar = afterRingPlayer.characters[compCharId as string];
        if (!compChar) continue;
        const charEffects = collectCharacterEffects(stateAfterRing, compChar, checkContext);
        itemCheckModifier += resolveCheckModifier(charEffects, 'gold-ring-test');
      }
      if (itemCheckModifier !== 0) {
        logDetail(`Gold-ring test: item modifiers from company: ${formatSignedNumber(itemCheckModifier)}`);
      }
    }
  }

  // MEWH §10: "Whenever a Fallen-wizard player tests a hero gold ring item, the
  // roll is modified by -1." A hero gold ring is a `hero-resource-item`; minion
  // gold rings are unaffected.
  const fwGoldRingModifier = player.alignment === 'fallen-wizard'
    && ringDef !== undefined && 'cardType' in ringDef
    && (ringDef as { cardType?: string }).cardType === 'hero-resource-item'
    ? -1 : 0;
  if (fwGoldRingModifier !== 0) {
    logDetail(`Gold-ring test: Fallen-wizard testing a hero gold ring — applying ${formatSignedNumber(fwGoldRingModifier)} (MEWH §10)`);
  }

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + rollModifier + itemCheckModifier + fwGoldRingModifier;
  logDetail(`Gold-ring test: ${ringName} — rolled ${roll.die1} + ${roll.die2} ${formatSignedNumber(rollModifier)}${itemCheckModifier !== 0 ? ` item ${formatSignedNumber(itemCheckModifier)}` : ''}${fwGoldRingModifier !== 0 ? ` fw ${formatSignedNumber(fwGoldRingModifier)}` : ''} = ${total}; ring discarded`);

  const rollEffect = diceRollEffect(player.name, roll, `Gold-ring test: ${ringName}`);

  // Compute eligible categories from the gold ring's ring-test-table effect.
  const effects: readonly unknown[] = ringDef && 'effects' in ringDef
    ? ((ringDef as unknown as { effects?: readonly unknown[] }).effects ?? [])
    : [];
  const tableEffect = effects.find((e): e is RingTestTableEffect => (e as { type?: string }).type === 'ring-test-table');
  const eligibleCategories = tableEffect ? eligibleRingCategories(tableEffect.table, total) : [];
  logDetail(`Gold-ring test: roll total ${total} — eligible categories: ${eligibleCategories.join(', ') || 'none'}`);

  // Collect search categories from ring-test-search effects (e.g. Gleaming Gold Ring
  // lets the player search deck/discard for a lesser-ring when lesser-ring is eligible).
  const searchEffect = effects.find((e): e is RingTestSearchEffect => (e as { type?: string }).type === 'ring-test-search');
  const searchCategories = (searchEffect && (eligibleCategories as readonly string[]).includes(searchEffect.category))
    ? [searchEffect.category] as const
    : undefined;
  if (searchCategories) {
    logDetail(`Gold-ring test: ring-test-search active — player may search deck/discard for ${searchCategories.join(', ')}`);
  }

  const postRoll = dequeueResolution(
    { ...updatePlayer(stateAfterRing, actorIndex, p => ({ ...p, lastDiceRoll: roll })), rng, cheatRollTotal },
    top.id,
  );

  // Always enqueue ring-play-offer so the player can explicitly pass if they
  // hold no eligible rings or choose not to play one.
  const postOffer = enqueueResolution(postRoll, {
    source: goldRingInstanceId,
    actor: action.player,
    scope: top.scope,
    kind: {
      type: 'ring-play-offer',
      characterInstanceId,
      eligibleCategories,
      rollTotal: total,
      storedPlacement,
      ...(searchCategories ? { searchCategories } : {}),
    },
  });

  return { state: postOffer, effects: [rollEffect] };
}

/**
 * Resolve a queued `ring-play-offer` resolution (Rule 9.21).
 *
 * The player either passes (generic `pass` action) or plays a special ring
 * card from hand (`play-ring-after-test` action). The ring is placed on the
 * character who bore the gold ring; if `storedPlacement` is true the ring
 * enters play in stored state (Rule 9.22 Darkhaven path).
 */
function applyRingPlayOfferResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'ring-play-offer') return null;

  if (action.type === 'pass') {
    logDetail(`ring-play-offer: player passes — no replacement ring played`);
    return { state: dequeueResolution(state, top.id) };
  }

  if (action.type !== 'play-ring-after-test') {
    return { state, error: `Pending ring-play-offer requires play-ring-after-test or pass, got '${action.type}'` };
  }

  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending ring-play-offer' };
  }

  const { characterInstanceId, storedPlacement } = top.kind;
  const { ringInstanceId, source = 'hand' } = action;

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // Locate ring in hand, play deck, or discard pile (ring-test-search support)
  let ringCard: typeof player.hand[0];
  let stateAfterRemove: GameState;
  if (source === 'play-deck') {
    const deckIdx = player.playDeck.findIndex(c => c.instanceId === ringInstanceId);
    if (deckIdx < 0) {
      return { state, error: `Ring ${ringInstanceId as string} not found in play deck` };
    }
    ringCard = player.playDeck[deckIdx];
    stateAfterRemove = updatePlayer(state, playerIndex, p => ({
      ...p,
      playDeck: p.playDeck.filter((_, i) => i !== deckIdx),
    }));
    logDetail(`ring-play-offer: found ${ringCard.definitionId as string} in play deck (ring-test-search)`);
  } else if (source === 'discard-pile') {
    const discardIdx = player.discardPile.findIndex(c => c.instanceId === ringInstanceId);
    if (discardIdx < 0) {
      return { state, error: `Ring ${ringInstanceId as string} not found in discard pile` };
    }
    ringCard = player.discardPile[discardIdx];
    stateAfterRemove = updatePlayer(state, playerIndex, p => ({
      ...p,
      discardPile: p.discardPile.filter((_, i) => i !== discardIdx),
    }));
    logDetail(`ring-play-offer: found ${ringCard.definitionId as string} in discard pile (ring-test-search)`);
  } else {
    const handIdx = player.hand.findIndex(c => c.instanceId === ringInstanceId);
    if (handIdx < 0) {
      return { state, error: `Ring ${ringInstanceId as string} not found in hand` };
    }
    ringCard = player.hand[handIdx];
    stateAfterRemove = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: p.hand.filter((_, i) => i !== handIdx),
    }));
  }

  const ringDef = defById(state, ringCard.definitionId);
  const ringName = ringDef?.name ?? (ringCard.definitionId as string);

  // Locate the target character
  const char = stateAfterRemove.players[playerIndex].characters[characterInstanceId as string];
  if (!char) {
    return { state, error: `Character ${characterInstanceId as string} not found for ring placement` };
  }
  const charDef = resolveDef(state, characterInstanceId);
  logDetail(`ring-play-offer: playing ${ringName} (${ringInstanceId as string}) onto ${charDef?.name ?? (characterInstanceId as string)}${storedPlacement ? ' (stored)' : ''}`);

  const newItem: CharacterInPlay['items'][0] = {
    instanceId: ringCard.instanceId,
    definitionId: ringCard.definitionId,
    status: CardStatus.Untapped,
  };

  const updatedChar: CharacterInPlay = {
    ...char,
    items: [...char.items, newItem],
  };

  const stateAfterPlay = updatePlayer(stateAfterRemove, playerIndex, p => ({
    ...p,
    characters: { ...p.characters, [characterInstanceId as string]: updatedChar },
  }));

  return { state: dequeueResolution(stateAfterPlay, top.id) };
}

/**
 * Resolve a `resource-play-offer` pending resolution.
 *
 * The actor either:
 *  - passes (Crown of Flowers stays in play with no paired resource), or
 *  - plays `pair-resource-with-cof` to pair a resource from hand with
 *    the in-play Crown of Flowers. The paired resource enters cardsInPlay
 *    with `linkedInstanceId`, `assumeInPlay: ['Gates of Morning']`, and
 *    `assumeNotInPlay: ['Doors of Night']`. Crown of Flowers is updated to
 *    record the link as well.
 */
function applyResourcePlayOfferResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'resource-play-offer') return null;

  if (action.type === 'pass') {
    logDetail(`resource-play-offer: player passes — CoF has no paired resource`);
    return { state: dequeueResolution(state, top.id) };
  }

  if (action.type !== 'pair-resource-with-cof') {
    return { state, error: `Pending resource-play-offer requires pair-resource-with-cof or pass, got '${action.type}'` };
  }

  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending resource-play-offer' };
  }

  const { cardInstanceId, cofInstanceId } = action;
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // Find the card in hand
  const handIdx = player.hand.findIndex(c => c.instanceId === cardInstanceId);
  if (handIdx < 0) {
    return { state, error: `Card ${cardInstanceId as string} not found in hand` };
  }
  const handCard = player.hand[handIdx];

  // Find CoF in cardsInPlay (may be on either player)
  let cofPlayerIndex = -1;
  for (let pi = 0; pi < 2; pi++) {
    if (state.players[pi].cardsInPlay.some(c => c.instanceId === cofInstanceId)) {
      cofPlayerIndex = pi;
      break;
    }
  }
  if (cofPlayerIndex < 0) {
    return { state, error: `Crown of Flowers ${cofInstanceId as string} not found in play` };
  }

  logDetail(`resource-play-offer: pairing ${handCard.definitionId as string} (${cardInstanceId as string}) with CoF (${cofInstanceId as string})`);

  // Remove the card from hand
  const newHand = player.hand.filter((_, i) => i !== handIdx);

  // Build the paired resource CardInPlay entry
  const pairedCard: CardInPlay = {
    instanceId: handCard.instanceId,
    definitionId: handCard.definitionId,
    status: CardStatus.Untapped,
    linkedInstanceId: cofInstanceId,
    assumeInPlay: ['Gates of Morning'],
    assumeNotInPlay: ['Doors of Night'],
  };

  // Apply state changes: remove from hand, add to cardsInPlay
  let newState = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: newHand,
    cardsInPlay: [...p.cardsInPlay, pairedCard],
  }));

  // Update CoF to link back to the resource (handles same-player and cross-player)
  newState = updatePlayer(newState, cofPlayerIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.map(c =>
      c.instanceId === cofInstanceId
        ? { ...c, linkedInstanceId: cardInstanceId }
        : c,
    ),
  }));

  return { state: dequeueResolution(newState, top.id) };
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

  const wizardDef = defById(state, wizardInst.definitionId);
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

/**
 * Resolve a `select-card-bearer` pending resolution.
 *
 * - `select-card-bearer`: tap the chosen character, attach the card to their
 *   items, and add a `bearer-cannot-untap` constraint.
 * - `pass`: decline the bearer assignment — discard the card from cardsInPlay.
 */
function applySelectCardBearerResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'select-card-bearer') return null;

  const { cardInstanceId, companyId, mode: bearerMode, discardFactionsAtSite: shouldDiscardFactions } = top.kind;

  if (action.type === 'pass') {
    // Player declines bearer assignment — discard the card
    const defIdx = state.players.findIndex(
      p => p.companies.some(co => co.id === companyId),
    );
    if (defIdx < 0) return null;
    logDetail(`select-card-bearer: player declined — discarding card ${cardInstanceId as string}`);
    const cardDefId = resolveInstanceId(state, cardInstanceId);
    const cardLabel = cardName(state, cardDefId!, '?');
    logDetail(`Discarding "${cardLabel}" (no bearer chosen)`);

    let s = state;
    // Remove from any player's cardsInPlay
    for (let pi = 0; pi < 2; pi++) {
      const inPlay = findById(s.players[pi].cardsInPlay, cardInstanceId);
      if (inPlay) {
        s = updatePlayer(s, pi, p => ({
          ...p,
          cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== cardInstanceId),
        }));
        s = updatePlayer(s, defIdx, p => ({
          ...p,
          discardPile: [
            ...p.discardPile,
            toCardInstance(inPlay),
          ],
        }));
        break;
      }
    }
    return { state: dequeueResolution(s, top.id) };
  }

  if (action.type !== 'select-card-bearer') {
    return { state, error: `Pending select-card-bearer requires select-card-bearer or pass, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for select-card-bearer' };
  }

  const { characterId } = action;

  // Find the defending player and character
  const defIdx = state.players.findIndex(
    p => Object.prototype.hasOwnProperty.call(p.characters, characterId as string),
  );
  if (defIdx < 0) return { state, error: `Character ${characterId as string} not found` };
  const defPlayer = state.players[defIdx];
  const ch = defPlayer.characters[characterId as string];
  if (!ch) return { state, error: `Character ${characterId as string} not found` };
  if (ch.status !== CardStatus.Untapped) {
    return { state, error: `Character ${characterId as string} must be untapped to be the bearer` };
  }

  // Find the card in cardsInPlay
  let cardInPlay: import('../types/state-cards.js').CardInPlay | undefined;
  let cardOwnerIdx = -1;
  for (let pi = 0; pi < 2; pi++) {
    const found = findById(state.players[pi].cardsInPlay, cardInstanceId);
    if (found) {
      cardInPlay = found;
      cardOwnerIdx = pi;
      break;
    }
  }
  if (!cardInPlay) return { state, error: `Card ${cardInstanceId as string} not in cardsInPlay` };

  const cardDefId = resolveInstanceId(state, cardInstanceId);
  const cardLabel = cardName(state, cardDefId!, '?');

  const resolvedMode = bearerMode ?? 'attach-with-constraint';

  if (resolvedMode === 'move-to-mp-pile') {
    // Burning Rick, Cot, and Tree mode: tap the character, leave card in cardsInPlay
    // (it already earns MPs there), no untap constraint.
    logDetail(
      `select-card-bearer: "${cardLabel}" assigned to ${characterId as string} — tapping character, card stays in cardsInPlay`,
    );
    let s = updatePlayer(state, defIdx, p => updateCharacter(p, characterId, () => ({
      ...ch,
      status: CardStatus.Tapped,
    })));

    // Discard factions playable at the company's current site if requested
    if (shouldDiscardFactions) {
      const company = s.players[defIdx].companies.find(co => co.id === companyId);
      const currentSiteDef = company?.currentSite
        ? defById(s, company.currentSite.definitionId)
        : undefined;
      const siteName = currentSiteDef && 'name' in currentSiteDef ? (currentSiteDef as { name: string }).name : undefined;
      const siteType = currentSiteDef && 'siteType' in currentSiteDef ? (currentSiteDef as { siteType: string }).siteType : undefined;

      if (siteName || siteType) {
        const factionsToDiscard: import('../types/state-cards.js').CardInPlay[] = [];
        for (const card of s.players[defIdx].cardsInPlay) {
          const fDef = defById(s, card.definitionId);
          if (!isFactionCard(fDef)) continue;
          const playableAt = fDef.playableAt as readonly ({ site?: string; siteType?: string; region?: string })[];
          const matches = playableAt.some(entry =>
            (siteName && 'site' in entry && entry.site === siteName) ||
            (siteType && 'siteType' in entry && entry.siteType === siteType),
          );
          if (matches) {
            factionsToDiscard.push(card);
            logDetail(`select-card-bearer: discarding faction "${fDef.name}" playable at ${siteName ?? siteType ?? '?'}`);
          }
        }
        if (factionsToDiscard.length > 0) {
          const discardIds = new Set(factionsToDiscard.map(c => c.instanceId as string));
          s = updatePlayer(s, defIdx, p => ({
            ...p,
            cardsInPlay: p.cardsInPlay.filter(c => !discardIds.has(c.instanceId as string)),
            discardPile: [...p.discardPile, ...factionsToDiscard.map(toCardInstance)],
          }));
        }
      }
    }

    return { state: dequeueResolution(s, top.id) };
  }

  logDetail(
    `select-card-bearer: "${cardLabel}" assigned to ${characterId as string} — tapping character, adding constraint`,
  );

  // Remove card from cardsInPlay, attach to character's items, tap character
  let s = updatePlayer(state, cardOwnerIdx, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== cardInstanceId),
  }));
  s = updatePlayer(s, defIdx, p => updateCharacter(p, characterId, () => ({
    ...ch,
    status: CardStatus.Tapped,
    items: [
      ...ch.items,
      { instanceId: cardInPlay.instanceId, definitionId: cardInPlay.definitionId, status: CardStatus.Untapped },
    ],
  })));

  // Add bearer-cannot-untap constraint — only when the card declares the untap
  // lock via its play-flag (e.g. Rescue Prisoners tw-315, The Windlord Found Me
  // dm-164). Trigger-attack storable cards without the lock would tap the bearer
  // for the attack but untap normally.
  const cardDef = cardDefId ? defById(s, cardDefId) : undefined;
  if (hasPlayFlag(cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined, 'bearer-cannot-untap-until-stored')) {
    s = addConstraint(s, {
      source: cardInstanceId,
      sourceDefinitionId: (cardDefId ?? cardInstanceId) as import('../types/common.js').CardDefinitionId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId },
      kind: { type: 'bearer-cannot-untap', cardInstanceId },
    });
  }

  return { state: dequeueResolution(s, top.id) };
}

/**
 * Resolve a queued `glamour-hazard-roll` resolution (Glamour of Surpassing
 * Excellance, as-49). The resource player rolls 2d6. If the result strictly
 * exceeds `removalThreshold` (the hazard's `removalNumber` or 8 by default),
 * the hazard permanent-event is discarded from the character it is attached to.
 */
function applyGlamourHazardRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'glamour-hazard-roll') {
    return { state, error: `Pending glamour-hazard-roll requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'glamour-hazard-roll') return null;
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending glamour-hazard-roll' };
  }

  const { hazardInstanceId, hazardDefinitionId, removalThreshold, sourceDefinitionId } = top.kind;
  const actorIndex = getPlayerIndex(state, action.player);
  const player = state.players[actorIndex];

  const hazDef = defById(state, hazardDefinitionId);
  const hazName = hazDef?.name ?? '?';
  const sourceDef = defById(state, sourceDefinitionId);
  const sourceName = sourceDef?.name ?? '?';

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const discarded = rollTotal > removalThreshold;

  const rollEffect = diceRollEffect(player.name, roll, `${sourceName}: ${hazName} (need > ${removalThreshold})`);
  logDetail(`${sourceName} glamour roll for ${hazName}: roll ${rollTotal} vs threshold >${removalThreshold} → ${discarded ? 'DISCARD' : 'KEEP'}`);

  let postRoll = dequeueResolution({ ...state, rng, cheatRollTotal }, top.id);
  postRoll = updatePlayer(postRoll, actorIndex, p => ({ ...p, lastDiceRoll: roll }));

  if (discarded) {
    // Find the hazard instance attached to any character on either player
    let foundOwnerIdx = -1;
    let foundCharId: string | null = null;
    let foundHazardIdx = -1;
    for (let oi = 0; oi < postRoll.players.length; oi++) {
      const chars = postRoll.players[oi].characters;
      for (const charId of Object.keys(chars)) {
        const hIdx = chars[charId].hazards.findIndex(h => h.instanceId === hazardInstanceId);
        if (hIdx !== -1) { foundOwnerIdx = oi; foundCharId = charId; foundHazardIdx = hIdx; break; }
      }
      if (foundOwnerIdx !== -1) break;
    }

    if (foundOwnerIdx !== -1 && foundCharId !== null) {
      const haz = postRoll.players[foundOwnerIdx].characters[foundCharId].hazards[foundHazardIdx];
      const newHazards = postRoll.players[foundOwnerIdx].characters[foundCharId].hazards.filter((_, i) => i !== foundHazardIdx);
      postRoll = updatePlayer(postRoll, foundOwnerIdx, p =>
        updateCharacter(p, foundCharId, c => ({ ...c, hazards: newHazards })),
      );
      // Discard to hazard owner's discard pile (owner resolved by instance ID prefix in production)
      const hazOwner = (haz.instanceId as string).split('-')[0];
      let hazOwnerIdx = postRoll.players.findIndex(p => (p.id as string) === hazOwner);
      if (hazOwnerIdx === -1) hazOwnerIdx = (actorIndex + 1) % postRoll.players.length;
      postRoll = updatePlayer(postRoll, hazOwnerIdx, p => ({
        ...p,
        discardPile: [...p.discardPile, toCardInstance(haz)],
      }));
      logDetail(`${sourceName}: ${hazName} discarded from ${foundCharId}`);
    }
  }

  return { state: postRoll, effects: [rollEffect] };
}

/**
 * Resolve a `discard-one-company-item` pending resolution.
 *
 * The defending player selects one item from any character in the company
 * via a `discard-item-from-company` action. The item is removed from its
 * bearer and moved to the defending player's discard pile.
 */
function applyDiscardOneCompanyItemResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'discard-one-company-item') return null;
  if (action.type !== 'discard-item-from-company') {
    return { state, error: `Pending discard-one-company-item requires discard-item-from-company, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for discard-one-company-item' };
  }

  const { itemInstanceId } = action;
  const { companyId } = top.kind;

  const defIdx = state.players.findIndex(p => p.companies.some(co => co.id === companyId));
  if (defIdx < 0) return { state, error: `Company ${companyId as string} not found` };
  const defPlayer = state.players[defIdx];

  const newCharacters = { ...defPlayer.characters };
  let itemRemoved = false;
  let removedItem: { instanceId: import('../types/common.js').CardInstanceId; definitionId: import('../types/common.js').CardDefinitionId } | null = null;
  for (const [charId, charData] of Object.entries(newCharacters)) {
    const idx = charData.items.findIndex(it => it.instanceId === itemInstanceId);
    if (idx >= 0) {
      const item = charData.items[idx];
      removedItem = toCardInstance(item);
      newCharacters[charId] = { ...charData, items: charData.items.filter((_, i) => i !== idx) };
      itemRemoved = true;
      break;
    }
  }
  if (!itemRemoved || !removedItem) {
    return { state, error: `Item ${itemInstanceId as string} not found in company ${companyId as string}` };
  }

  const itemDef = defById(state, removedItem.definitionId);
  const itemName = itemDef && 'name' in itemDef ? (itemDef as { name: string }).name : (itemInstanceId as string);
  logDetail(`discard-one-company-item: defender discards "${itemName}"`);

  const newPlayers = clonePlayers(state);
  newPlayers[defIdx] = {
    ...defPlayer,
    characters: newCharacters,
    discardPile: [...defPlayer.discardPile, removedItem],
  };

  return { state: dequeueResolution({ ...state, players: newPlayers }, top.id) };
}

/**
 * Resolve a `hazard-event-maintenance` pending resolution.
 *
 * The hazard player pays the maintenance cost for a permanent event with a
 * `hazard-maintenance` effect by dispatching a `pay-hazard-event-maintenance`
 * action. Two payment options are possible:
 *
 * - `discard-self`: the permanent event is removed from cardsInPlay and moved
 *   to the hazard player's discard pile.
 * - `discard-from-hand`: the chosen hand card is moved to the hazard player's
 *   discard pile; the permanent event remains in play.
 *
 * Used by *Thrice Outnumbered* (le-142).
 */
function applyHazardEventMaintenanceResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'hazard-event-maintenance') return null;
  if (action.type !== 'pay-hazard-event-maintenance') {
    return { state, error: `Pending hazard-event-maintenance requires pay-hazard-event-maintenance, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for hazard-event-maintenance' };
  }
  if (action.sourceInstanceId !== top.kind.sourceInstanceId) {
    return { state, error: 'Wrong source instance for hazard-event-maintenance' };
  }

  const actorIdx = state.players.findIndex(p => p.id === action.player);
  if (actorIdx < 0) return { state, error: 'Player not found for hazard-event-maintenance' };
  const actorPlayer = state.players[actorIdx];

  const newPlayers = clonePlayers(state);

  if (action.paymentType === 'discard-self') {
    // Remove permanent event from cardsInPlay, add to discard pile
    const cardIdx = actorPlayer.cardsInPlay.findIndex(c => c.instanceId === action.cardInstanceId);
    if (cardIdx < 0) {
      return { state, error: `Permanent event ${action.cardInstanceId as string} not found in cardsInPlay` };
    }
    const card = actorPlayer.cardsInPlay[cardIdx];
    const cardLabel = cardName(state, card.definitionId);
    logDetail(`hazard-event-maintenance: hazard player discards "${cardLabel}" (discard-self)`);

    const newCardsInPlay = actorPlayer.cardsInPlay.filter((_, i) => i !== cardIdx);
    newPlayers[actorIdx] = {
      ...actorPlayer,
      cardsInPlay: newCardsInPlay,
      discardPile: [...actorPlayer.discardPile, toCardInstance(card)],
    };
  } else {
    // discard-from-hand: validate and verify the hand card matches the filter
    const handIdx = actorPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
    if (handIdx < 0) {
      return { state, error: `Hand card ${action.cardInstanceId as string} not found in hand` };
    }
    const handCard = actorPlayer.hand[handIdx];

    // Verify the card matches the handCardFilter from the source effect
    const maintenanceEff = findHazardMaintenanceEffect(defById(state, top.kind.sourceDefinitionId));
    if (maintenanceEff) {
      const handDef = defById(state, handCard.definitionId);
      if (!handDef || !matchesDefinition(handDef, maintenanceEff.handCardFilter)) {
        return { state, error: `Hand card ${handCard.definitionId as string} does not match hazard-maintenance filter` };
      }
    }

    const cardLabel = cardName(state, handCard.definitionId);
    logDetail(`hazard-event-maintenance: hazard player discards "${cardLabel}" from hand (discard-from-hand)`);

    const newHand = actorPlayer.hand.filter((_, i) => i !== handIdx);
    newPlayers[actorIdx] = {
      ...actorPlayer,
      hand: newHand,
      discardPile: [...actorPlayer.discardPile, toCardInstance(handCard)],
    };
  }

  return { state: dequeueResolution({ ...state, players: newPlayers }, top.id) };
}

/**
 * Resolve a queued `cvcc-ally-discard-roll` resolution (Bow of the Galadhrim, as-68).
 *
 * The attacking player rolls 2d6. If roll > ally.mind + threshold (5),
 * the ally is discarded from the defending company to the ally owner's discard pile.
 */
function applyCvccAllyDiscardRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'cvcc-ally-discard-roll') {
    return { state, error: `Pending cvcc-ally-discard-roll requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'cvcc-ally-discard-roll') return null;
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending cvcc-ally-discard-roll' };
  }

  const { allyInstanceId, allyMind, threshold, allyOwnerPlayerIndex } = top.kind;
  const bowDef = top.kind.sourceItemInstanceId
    ? resolveDef(state, top.kind.sourceItemInstanceId)
    : undefined;
  const bowName = (bowDef as { name?: string })?.name ?? 'Bow of the Galadhrim';

  const allyOwner = state.players[allyOwnerPlayerIndex];
  if (!allyOwner) {
    return { state: dequeueResolution(state, top.id), error: 'Ally owner player not found' };
  }

  // Find the character hosting this ally
  let hostCharId: string | null = null;
  let allyName = allyInstanceId as string;
  for (const [charId, char] of Object.entries(allyOwner.characters)) {
    const ally = char.allies.find(a => a.instanceId === allyInstanceId);
    if (ally) {
      hostCharId = charId;
      const allyDef = defById(state, ally.definitionId);
      allyName = (allyDef as { name?: string })?.name ?? allyName;
      break;
    }
  }

  if (hostCharId === null) {
    logDetail(`${bowName}: ally ${allyName} no longer in play — skipping roll`);
    return { state: dequeueResolution(state, top.id) };
  }

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const discardThreshold = allyMind + threshold;
  const doDiscard = rollTotal > discardThreshold;

  const rollEffect = diceRollEffect(
    allyOwner.name,
    roll,
    `${bowName}: ${allyName} (roll ${rollTotal} vs mind ${allyMind} + ${threshold} = ${discardThreshold})`,
  );

  logDetail(`${bowName}: rolled ${rollTotal} for ally "${allyName}" (mind ${allyMind} + ${threshold} = ${discardThreshold}) → ${doDiscard ? 'DISCARD' : 'SURVIVES'}`);

  const stateAfterRoll = updatePlayer(
    { ...state, rng, cheatRollTotal },
    allyOwnerPlayerIndex,
    p => ({ ...p, lastDiceRoll: roll }),
  );

  let postRoll = dequeueResolution(stateAfterRoll, top.id);

  if (doDiscard) {
    const hostChar = postRoll.players[allyOwnerPlayerIndex].characters[hostCharId];
    if (hostChar) {
      const allyCard = hostChar.allies.find(a => a.instanceId === allyInstanceId);
      if (allyCard) {
        logDetail(`${bowName}: discarding ally "${allyName}" from character ${hostCharId}`);
        postRoll = updatePlayer(postRoll, allyOwnerPlayerIndex, p => ({
          ...p,
          characters: {
            ...p.characters,
             
            [hostCharId]: {
              ...hostChar,
              allies: hostChar.allies.filter(a => a.instanceId !== allyInstanceId),
            },
          },
          discardPile: [...p.discardPile, toCardInstance(allyCard)],
        }));
      }
    }
  }

  return { state: postRoll, effects: [rollEffect] };
}

/**
 * Resolve a `tap-one-character` pending resolution.
 *
 * The resource player selects one untapped character in the company to tap
 * via a `tap-character-by-effect` action, or passes if no untapped characters
 * are available. Used by *Stench of Mordor* (le-141).
 */
function applyTapOneCharacterResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'tap-one-character') return null;

  // pass: no untapped characters available (or player skips)
  if (action.type === 'pass') {
    logDetail('tap-one-character: pass (no untapped character tapped)');
    return { state: dequeueResolution(state, top.id) };
  }

  if (action.type !== 'tap-character-by-effect') {
    return { state, error: `Pending tap-one-character requires tap-character-by-effect or pass, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for tap-one-character' };
  }

  const { characterInstanceId } = action;
  const { companyId } = top.kind;

  const playerIdx = state.players.findIndex(p => p.companies.some(co => co.id === companyId));
  if (playerIdx < 0) return { state, error: `Company ${companyId as string} not found` };
  const player = state.players[playerIdx];

  const char = player.characters[characterInstanceId as string];
  if (!char) return { state, error: `Character ${characterInstanceId as string} not found` };
  if (char.status !== CardStatus.Untapped) {
    return { state, error: `Character ${characterInstanceId as string} is not untapped` };
  }

  const charName = (defById(state, char.definitionId) as { name?: string })?.name ?? (characterInstanceId as string);
  logDetail(`tap-one-character: tapping ${charName} (Stench of Mordor)`);

  const newState = updatePlayer(state, playerIdx, p => ({
    ...p,
    characters: {
      ...p.characters,
      [characterInstanceId as string]: { ...char, status: CardStatus.Tapped },
    },
  }));

  return { state: dequeueResolution(newState, top.id) };
}

/**
 * Resolve a `haven-restore-character` pending resolution (Hall of Fire,
 * dm-134).
 *
 * The controlling player either passes (declines the optional benefit) or
 * selects one tapped or wounded character in the company via a
 * `restore-character-by-effect` action. A tapped character is untapped; a
 * wounded (inverted) character is healed one step to tapped.
 */
function applyHavenRestoreCharacterResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'haven-restore-character') return null;

  // pass: the player declines the optional untap/heal.
  if (action.type === 'pass') {
    logDetail('haven-restore-character: pass (Hall of Fire benefit declined)');
    return { state: dequeueResolution(state, top.id) };
  }

  if (action.type !== 'restore-character-by-effect') {
    return { state, error: `Pending haven-restore-character requires restore-character-by-effect or pass, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for haven-restore-character' };
  }

  const { characterInstanceId } = action;
  const { companyId } = top.kind;

  const playerIdx = state.players.findIndex(p => p.companies.some(co => co.id === companyId));
  if (playerIdx < 0) return { state, error: `Company ${companyId as string} not found` };
  const player = state.players[playerIdx];

  // The character must belong to the eligible company.
  const company = player.companies.find(co => co.id === companyId);
  if (!company || !company.characters.some(id => id === characterInstanceId)) {
    return { state, error: `Character ${characterInstanceId as string} not in company ${companyId as string}` };
  }

  const char = player.characters[characterInstanceId as string];
  if (!char) return { state, error: `Character ${characterInstanceId as string} not found` };

  let nextStatus: CardStatus;
  if (char.status === CardStatus.Tapped) {
    nextStatus = CardStatus.Untapped;
  } else if (char.status === CardStatus.Inverted) {
    nextStatus = CardStatus.Tapped;
  } else {
    return { state, error: `Character ${characterInstanceId as string} is neither tapped nor wounded` };
  }

  const charName = (defById(state, char.definitionId) as { name?: string })?.name ?? (characterInstanceId as string);
  logDetail(`haven-restore-character: Hall of Fire restores ${charName} (${char.status} → ${nextStatus})`);

  const newState = updatePlayer(state, playerIdx, p => ({
    ...p,
    characters: {
      ...p.characters,
      [characterInstanceId as string]: { ...char, status: nextStatus },
    },
  }));

  return { state: dequeueResolution(newState, top.id) };
}

/**
 * Resolve a queued `stay-her-appetite-roll` resolution (Stay Her Appetite, le-140).
 *
 * The hazard player rolls 2d6. If roll + ally.mind > opponent.unusedGI +
 * controllerChar.unusedDI + 5, a second 2d6 roll determines the attack prowess
 * (ally.prowess + roll2), then a detainment attack is initiated against the
 * ally's controlling character. The ally is discarded after combat if the
 * attack was not fully defeated.
 */
function applyStayHerAppetiteRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'stay-her-appetite-roll') {
    return { state, error: `Pending stay-her-appetite-roll requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'stay-her-appetite-roll') return null;
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending stay-her-appetite-roll' };
  }

  const {
    allyInstanceId, allyOwnerPlayerIndex, hostCharacterInstanceId,
    allyMind, allyProwess, opponentUnusedGI, controllerUnusedDI,
    companyId, sourceDefinitionId,
  } = top.kind;

  const sourceName = (defById(state, sourceDefinitionId) as { name?: string })?.name ?? 'Stay Her Appetite';

  // Condition roll
  const { roll: roll1, rng: rng1, cheatRollTotal: cheat1 } = roll2d6(state);
  const roll1Total = roll1.die1 + roll1.die2;
  const threshold = opponentUnusedGI + controllerUnusedDI + 5;
  const conditionMet = (roll1Total + allyMind) > threshold;

  const roll1Effect = diceRollEffect(
    state.players[1 - allyOwnerPlayerIndex].name,
    roll1,
    `${sourceName}: condition roll (${roll1Total} + mind ${allyMind} vs GI ${opponentUnusedGI} + DI ${controllerUnusedDI} + 5 = ${threshold})`,
  );

  logDetail(`${sourceName}: rolled ${roll1Total} + mind ${allyMind} = ${roll1Total + allyMind} vs ${threshold} → ${conditionMet ? 'ATTACK TRIGGERED' : 'no effect'}`);

  const stateAfterRoll1 = updatePlayer(
    { ...state, rng: rng1, cheatRollTotal: cheat1 },
    1 - allyOwnerPlayerIndex,
    p => ({ ...p, lastDiceRoll: roll1 }),
  );

  if (!conditionMet) {
    const postRoll = dequeueResolution(stateAfterRoll1, top.id);
    return resolveChainEntryAndContinue(
      postRoll,
      e => e.payload.type === 'short-event' && e.card?.instanceId === top.source,
      [roll1Effect],
    );
  }

  // Prowess roll
  const { roll: roll2, rng: rng2, cheatRollTotal: cheat2 } = roll2d6(stateAfterRoll1);
  const roll2Total = roll2.die1 + roll2.die2;
  const attackProwess = allyProwess + roll2Total;

  const roll2Effect = diceRollEffect(
    state.players[1 - allyOwnerPlayerIndex].name,
    roll2,
    `${sourceName}: prowess roll (${allyProwess} + ${roll2Total} = ${attackProwess})`,
  );

  logDetail(`${sourceName}: attack prowess = ally ${allyProwess} + roll ${roll2Total} = ${attackProwess}`);

  const stateAfterRoll2 = updatePlayer(
    { ...stateAfterRoll1, rng: rng2, cheatRollTotal: cheat2 },
    1 - allyOwnerPlayerIndex,
    p => ({ ...p, lastDiceRoll: roll2 }),
  );

  // Dequeue resolution then set up combat
  const stateDequeued = dequeueResolution(stateAfterRoll2, top.id);

  const combat: import('../types/state-combat.js').CombatState = {
    attackSource: {
      type: 'stay-her-appetite-attack',
      eventDefinitionId: sourceDefinitionId,
      allyInstanceId,
      allyOwnerPlayerIndex,
      hostCharacterInstanceId,
    },
    companyId,
    defendingPlayerId: state.players[allyOwnerPlayerIndex].id,
    attackingPlayerId: state.players[1 - allyOwnerPlayerIndex].id,
    strikesTotal: 1,
    strikeProwess: attackProwess,
    creatureBody: null,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: true,
    forceSingleTarget: true,
  };

  logDetail(`${sourceName}: initiating detainment attack (${attackProwess} prowess) against character ${hostCharacterInstanceId as string}`);

  // Mark the originating short-event chain entry as resolved and complete the chain
  // so combat can proceed without the chain blocking legal action computation.
  let stateWithCombat = { ...stateDequeued, combat };
  if (stateWithCombat.chain) {
    const chain = stateWithCombat.chain;
    const src = top.source;
    const newEntries = chain.entries.map(e =>
      e.payload.type === 'short-event' && !e.resolved && e.card?.instanceId === src
        ? { ...e, resolved: true } : e,
    );
    stateWithCombat = { ...stateWithCombat, chain: { ...chain, entries: newEntries } };
  }
  const continued = autoResolve(stateWithCombat);

  return {
    state: continued.state,
    effects: [roll1Effect, roll2Effect, ...(continued.effects ?? [])],
  };
}
