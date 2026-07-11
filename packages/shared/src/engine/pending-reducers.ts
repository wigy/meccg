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
  PlayerState,
  CardInstance,
  CardInstanceId,
  GameEffect,
  CharacterInPlay,
  TwoDiceSix,
} from '../index.js';
import type { CardInPlay } from '../types/state-cards.js';
import type { ChainEntry } from '../types/state-combat.js';
import type { ReducerResult } from './reducer-utils.js';
import { dequeueResolution, enqueueResolution, removeConstraint, addConstraint } from './pending.js';
import { shuffle } from '../rng.js';
import { formatSignedNumber } from '../format-helpers.js';
import { getPlayerIndex } from '../state-utils.js';
import { isCharacterCard, isFactionCard } from '../types/cards.js';
import { CardStatus, Skill } from '../types/common.js';
import { ZERO_EFFECTIVE_STATS } from '../types/state-cards.js';
import { Phase } from '../types/state-phases.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import { resolveDef, getItemGrantedSkills, collectCharacterEffects, resolveCheckModifier } from './effects/index.js';
import { hasPlayFlag } from '../effects/index.js';
import { makeCombatState, activePlayerState, cardName, classifyCorruptionOutcome, cleanupEmptyCompanies, clonePlayers, defById, diceRollEffect, effectiveGeneralInfluence, generalInfluenceControlLimit, findById, findCharacterCompany, findHazardMaintenanceEffect, getCardEffects, matchesDefinition, nextCompanyId, removeById, roll2d6, sweepCompanyMembershipChangedEvents, sweepLeaderLeavesCompanyEvents, toCardInstance, updateCharacter, updatePlayer, wrongActionType } from './reducer-utils.js';
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
import type { RingTestTableEffect, RingTestSearchEffect, TriggeredAction } from '../types/effects.js';
import { applyMove, type MoveContext } from './reducer-move.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { revealInstances } from './visibility.js';
import { resolveCancelAttackEntry } from './combat-cancel.js';
import { startGreatHuntReveal, buildGreatHuntCombat } from './great-hunt.js';

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
export function applyCorruptionCheckResolution(
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
  const char = player.characters[characterId];
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
  // this character contributed to the modifier above and is now cleared. A
  // constraint carrying `autoPass: true` (Ancient Black Axe as-122) instead
  // forces the check to succeed unconditionally, regardless of the roll.
  let postRollState: GameState = { ...state, players: playersAfterRoll, rng, cheatRollTotal };
  let autoPass = false;
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type === 'check-modifier'
        && constraint.kind.check === 'corruption'
        && constraint.target.kind === 'character'
        && constraint.target.characterId === characterId) {
      if (constraint.kind.autoPass) autoPass = true;
      logDetail(`Consuming one-shot check-modifier constraint ${constraint.id} (corruption ${formatSignedNumber(constraint.kind.value)}${constraint.kind.autoPass ? ', auto-pass' : ''})`);
      postRollState = removeConstraint(postRollState, constraint.id);
    }
  }

  // Classify against the controlling player's alignment (CoE 7.1 / 7.1.F1): a
  // minion character or the Fallen-wizard avatar *taps and succeeds* on a roll
  // of CP or CP-1 rather than being discarded.
  let outcome = classifyCorruptionOutcome(charDef, player.alignment, total, cp);
  if (autoPass && outcome !== 'success') {
    logDetail(`Corruption check for ${charName} auto-passed (Ancient Black Axe) — overriding outcome '${outcome}' to 'success'`);
    outcome = 'success';
  }
  // The Roving Eye (le-135): an outcome that would normally eliminate the
  // character is instead downgraded to a discard (character + non-follower
  // possessions to the discard pile, followers freed to general influence).
  if (outcome === 'eliminate' && top.kind.failureMode === 'discard-instead-of-eliminate') {
    logDetail(`Corruption check for ${charName}: failureMode discard-instead-of-eliminate — downgrading 'eliminate' to 'discard'`);
    outcome = 'discard';
  }

  if (outcome === 'success' || outcome === 'tap-success') {
    let successState: GameState = postRollState;
    if (outcome === 'tap-success') {
      // The character taps but stays in play; the check counts as a success.
      // Only an untapped character changes state — an already-tapped or wounded
      // character stays as it is (you cannot tap it "further").
      const tappedPlayers = clonePlayers(postRollState);
      const tappedChars = { ...tappedPlayers[playerIndex].characters };
      const tappedChar = tappedChars[characterId];
      if (tappedChar && tappedChar.status === CardStatus.Untapped) {
        tappedChars[characterId] = { ...tappedChar, status: CardStatus.Tapped };
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
    const currentChar = newCharacters[characterId];
    if (currentChar && ringIds.size > 0) {
      newCharacters[characterId] = {
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
        newCharacters[cid as CardInstanceId] = { ...cData, items: cData.items.filter(i => i.instanceId !== transferredItemId) };
        break;
      }
    }
  }

  if (outcome === 'discard') {
    // Roll == CP or CP - 1 on a hero character: it + possessions discarded (not followers)
    logDetail(`Corruption check FAILED (${total} within 1 of ${cp}) — discarding ${charName} and ${action.possessions.length} possession(s)`);

    delete newCharacters[characterId];

    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== characterId),
    }));

    // Followers lose their controller — promote to general influence
    for (const followerId of char.followers) {
      const follower = newCharacters[followerId];
      if (follower) {
        newCharacters[followerId] = { ...follower, controlledBy: 'general' };
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

    delete newCharacters[characterId];

    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== characterId),
    }));

    for (const followerId of char.followers) {
      const follower = newCharacters[followerId];
      if (follower) {
        newCharacters[followerId] = { ...follower, controlledBy: 'general' };
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

export function applyOrderEffectsResolution(
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

export function applyOnGuardWindowResolution(
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
export function applyOpponentInfluenceDefendResolution(
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
  const charData = action.characterId ? player.characters[action.characterId] : undefined;
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
    const charName = charDef?.name ?? 'cancel-influence';

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
export function applyFactionInfluenceRollResolution(
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

/** `ok` with the validated actor + `kind` narrowed to `K`, or the early-return the caller propagates. */
type RollGuard<K extends PendingResolution['kind']['type']> =
  | { readonly ok: true; readonly actorIndex: number; readonly player: PlayerState; readonly kind: Extract<PendingResolution['kind'], { readonly type: K }> }
  | { readonly ok: false; readonly result: ReducerResult | null };

/**
 * Shared entry guard for the 2d6 roll-resolution reducers: check the action
 * type, defer (`null`) unless this kind heads the queue, reject a wrong
 * player, and return the actor with `kind` narrowed to `K` (no re-narrowing).
 */
function guardRollResolution<K extends PendingResolution['kind']['type']>(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
  actionType: GameAction['type'],
  kindType: K,
): RollGuard<K> {
  if (action.type !== actionType) {
    return { ok: false, result: { state, error: `Pending ${kindType} requires '${actionType}', got '${action.type}'` } };
  }
  if (top.kind.type !== kindType) return { ok: false, result: null };
  if (action.player !== top.actor) {
    return { ok: false, result: { state, error: `Wrong player for pending ${kindType}` } };
  }
  const actorIndex = getPlayerIndex(state, action.player);
  return {
    ok: true,
    actorIndex,
    player: state.players[actorIndex],
    kind: top.kind as Extract<PendingResolution['kind'], { readonly type: K }>,
  };
}

/**
 * Roll 2d6 for a resolution: build the {@link diceRollEffect} toast and store
 * the roll as `rollerIndex`'s `lastDiceRoll` (advancing the RNG / cheat roll).
 * The caller applies any modifier, compares to its threshold, and dequeues.
 */
function rollForResolution(
  state: GameState,
  rollerIndex: number,
  label: string,
): { readonly roll: TwoDiceSix; readonly total: number; readonly rollEffect: GameEffect; readonly state: GameState } {
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2;
  const rollEffect = diceRollEffect(state.players[rollerIndex].name, roll, label);
  const rolledState = updatePlayer({ ...state, rng, cheatRollTotal }, rollerIndex, p => ({ ...p, lastDiceRoll: roll }));
  return { roll, total, rollEffect, state: rolledState };
}

/** True when the `dice-check` kind's referenced target still exists. */
function diceCheckTargetPresent(
  state: GameState,
  kind: Extract<PendingResolution['kind'], { readonly type: 'dice-check' }>,
): boolean {
  if (kind.targetCharacterId) {
    return state.players.some(p => !!p.characters[kind.targetCharacterId!]);
  }
  if (kind.targetInstanceId) {
    return resolveInstanceId(state, kind.targetInstanceId) !== null;
  }
  return true;
}

/** Build the chain-entry matcher for a `dice-check` continuation. */
function diceCheckChainMatcher(
  match: 'target-faction' | 'target-character' | 'source',
  top: PendingResolution,
  kind: Extract<PendingResolution['kind'], { readonly type: 'dice-check' }>,
): (entry: ChainEntry) => boolean {
  switch (match) {
    case 'target-faction':
      return e => e.payload.type === 'short-event' && e.payload.targetFactionInstanceId === kind.targetInstanceId;
    case 'target-character':
      return e => e.payload.type === 'short-event' && e.payload.targetCharacterId === kind.targetCharacterId;
    case 'source':
      return e => e.card?.instanceId === top.source;
  }
}

/**
 * Run a `dice-check` onPass/onFail {@link TriggeredAction} in resolution
 * context. Delegates to the shared engine helpers ({@link applyMove}, …) rather
 * than the grant/chain dispatchers (which are bound to other contexts). Handles
 * the verbs the collapsed roll kinds need; a `move` whose target can't be
 * located fizzles (matching the originals' no-op on an already-gone target).
 */
function applyDiceCheckBranch(
  state: GameState,
  branch: TriggeredAction,
  ctx: {
    readonly targetCharacterId?: CardInstanceId;
    readonly targetInstanceId?: CardInstanceId;
    readonly source: CardInstanceId | null;
    readonly rollerIndex: number;
  },
): ReducerResult {
  if (branch.type === 'sequence') {
    let s = state;
    for (const sub of branch.apps ?? []) {
      const r = applyDiceCheckBranch(s, sub, ctx);
      if ('error' in r) return r;
      s = r.state;
    }
    return { state: s };
  }
  // `when` guard (leaf verbs): evaluate against the target character's
  // race/status so e.g. a "tap if untapped" branch leaves wounded/inverted
  // characters untouched (body-check). Skipped when the branch has no `when`.
  if (branch.when && ctx.targetCharacterId) {
    const tChar = state.players[ctx.rollerIndex]?.characters[ctx.targetCharacterId];
    const tDef = tChar ? defById(state, tChar.definitionId) : undefined;
    const guardCtx = {
      target: {
        race: tDef && isCharacterCard(tDef) ? tDef.race : '',
        status: tChar?.status,
      },
    };
    if (!matchesCondition(branch.when, guardCtx)) {
      return { state };
    }
  }
  if (branch.type === 'move') {
    const moveCtx: MoveContext = {
      // sourceCardId is only consulted for select:'self'/'self-location' moves;
      // the dice-check moves use select:'target', so a missing source is inert.
      sourceCardId: ctx.source ?? ('' as CardInstanceId),
      sourcePlayerIndex: ctx.rollerIndex,
      ...(ctx.targetInstanceId ? { targetCardId: ctx.targetInstanceId } : {}),
      ...(ctx.targetCharacterId ? { targetCharacterId: ctx.targetCharacterId } : {}),
    };
    const r = applyMove(state, branch, moveCtx);
    if ('error' in r) {
      logDetail(`dice-check move fizzled (${r.error}) — target already gone`);
      return { state };
    }
    return { state: r.state };
  }
  if (branch.type === 'return-character-to-hand') {
    if (!ctx.targetCharacterId) {
      logDetail(`dice-check return-character-to-hand: no target character — no-op`);
      return { state };
    }
    // The target may belong to a different player than the roller (Pilfer
    // Anything Unwatched: the hazard player rolls, the returned character is the
    // opponent's), so locate the actual owner rather than assuming the roller.
    const ownerIndex = state.players.findIndex(p => !!p.characters[ctx.targetCharacterId!]);
    if (ownerIndex === -1) {
      logDetail(`dice-check return-character-to-hand: ${ctx.targetCharacterId as string} no longer in play — no-op`);
      return { state };
    }
    const charInPlay = state.players[ownerIndex].characters[ctx.targetCharacterId];
    const allowItemTransfer = branch.allowItemTransfer === true;
    return { state: returnCharacterToHand(state, ownerIndex, ctx.targetCharacterId, charInPlay, allowItemTransfer, ctx.source) };
  }
  if (branch.type === 'discard-character') {
    if (!ctx.targetCharacterId) return { state };
    const charInPlay = state.players[ctx.rollerIndex]?.characters[ctx.targetCharacterId];
    if (!charInPlay) return { state };
    return { state: discardCharacter(state, ctx.rollerIndex, ctx.targetCharacterId, charInPlay) };
  }
  if (branch.type === 'eliminate-character') {
    if (!ctx.targetCharacterId) return { state };
    // The target may belong to a different player than the roller (Evil Things
    // Lingering ba-45: the *opponent* rolls, but the eliminated character is the
    // ally's controller — the roller's opponent), so locate the actual owner.
    const ownerIndex = state.players.findIndex(p => !!p.characters[ctx.targetCharacterId!]);
    if (ownerIndex === -1) {
      logDetail(`dice-check eliminate-character: ${ctx.targetCharacterId as string} no longer in play — no-op`);
      return { state };
    }
    const charInPlay = state.players[ownerIndex].characters[ctx.targetCharacterId];
    return { state: eliminateCharacter(state, ownerIndex, ctx.targetCharacterId, charInPlay) };
  }
  if (branch.type === 'set-character-status') {
    if (!ctx.targetCharacterId || !branch.status) return { state };
    const statusEnum = branch.status === 'untapped' ? CardStatus.Untapped
      : branch.status === 'tapped' ? CardStatus.Tapped : CardStatus.Inverted;
    const targetCharacterId = ctx.targetCharacterId;
    return { state: updatePlayer(state, ctx.rollerIndex, p => updateCharacter(p, targetCharacterId, c => ({ ...c, status: statusEnum }))) };
  }
  if (branch.type === 'counter-cancel-attack') {
    // Black Vapour (ba-14) onPass: negate the targeted cancel entry so the
    // attack survives, and add the effect's prowess bonus to the attack.
    const chain = state.chain;
    const combat = state.combat;
    if (!chain || !combat || !ctx.targetInstanceId) {
      logDetail('dice-check counter-cancel-attack: no chain/combat/target — no-op');
      return { state };
    }
    const idx = chain.entries.findIndex(
      e => e.card?.instanceId === ctx.targetInstanceId && !e.resolved && !e.negated,
    );
    if (idx === -1) {
      logDetail(`dice-check counter-cancel-attack: target ${ctx.targetInstanceId as string} not an unresolved chain entry — no-op`);
      return { state };
    }
    const bonus = branch.prowessBonus ?? 0;
    const newEntries = chain.entries.map((e, i) => (i === idx ? { ...e, negated: true } : e));
    logDetail(`dice-check counter-cancel-attack: negating cancel entry ${ctx.targetInstanceId as string}; attack prowess ${combat.strikeProwess} → ${combat.strikeProwess + bonus}`);
    return {
      state: {
        ...state,
        chain: { ...chain, entries: newEntries },
        combat: { ...combat, strikeProwess: combat.strikeProwess + bonus },
      },
    };
  }
  logDetail(`dice-check: branch verb "${branch.type}" not handled in resolution context — no-op`);
  return { state };
}

/**
 * Resolve a generic `dice-check` resolution (P08): roll 2d6, sum the kind's
 * modifiers, compare to its threshold, then run onPass/onFail via
 * {@link applyDiceCheckBranch} and apply the continuation. Replaces the former
 * per-kind roll reducers (muster first).
 */
export function applyDiceCheckResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardRollResolution(state, action, top, 'resolve-dice-check', 'dice-check');
  if (!g.ok) return g.result;
  const { kind } = g;
  const rollerIndex = getPlayerIndex(state, kind.roller ?? top.actor);

  // Pre-roll skip: kinds that don't roll when the target is gone (no RNG/cheat
  // consumed, no chain continuation) — preserves cvcc/call-of-home/body-check.
  if (kind.requireTargetPresent && !diceCheckTargetPresent(state, kind)) {
    logDetail(`${kind.label}: target absent — skipping roll`);
    return { state: dequeueResolution(state, top.id) };
  }

  const rolled = rollForResolution(state, rollerIndex, kind.label);
  let mod = 0;
  for (const m of kind.modifiers) {
    if (m.kind === 'constant') {
      mod += m.value;
    } else {
      const pi = getPlayerIndex(state, m.player);
      mod += effectiveGeneralInfluence(state, m.player) - state.players[pi].generalInfluenceUsed;
    }
  }
  const total = rolled.total + mod;
  const passed = kind.comparison === 'gt' ? total > kind.threshold : total >= kind.threshold;
  logDetail(`${kind.label}: rolled ${rolled.total}${mod ? ` ${mod >= 0 ? '+' : ''}${mod}` : ''} = ${total} ${kind.comparison === 'gt' ? '>' : '>='} ${kind.threshold} → ${passed ? 'PASS' : 'FAIL'}`);

  let post = dequeueResolution(rolled.state, top.id);
  const branch = passed ? kind.onPass : kind.onFail;
  if (branch) {
    const r = applyDiceCheckBranch(post, branch, {
      targetCharacterId: kind.targetCharacterId,
      targetInstanceId: kind.targetInstanceId,
      source: top.source,
      rollerIndex,
    });
    if ('error' in r) return r;
    post = r.state;
  }

  if (kind.continuation.kind === 'chain-entry') {
    // drainSameSource: wait until all same-source dice-checks have resolved
    // before continuing the chain (body-check's per-company-member rolls).
    if (kind.continuation.drainSameSource
      && post.pendingResolutions.some(r => r.kind.type === 'dice-check' && r.source === top.source)) {
      return { state: post, effects: [rolled.rollEffect] };
    }
    return resolveChainEntryAndContinue(post, diceCheckChainMatcher(kind.continuation.match, top, kind), [rolled.rollEffect]);
  }
  return { state: post, effects: [rolled.rollEffect] };
}

/**
 * Resolve a queued `transfer-returned-item` resolution (Pilfer Anything
 * Unwatched, as-33). The returned character's owner either transfers one of the
 * discarded items to a company-mate, or declines; the remaining items stay in
 * the discard pile either way. No card instance is lost — the transferred item
 * moves discard → the mate's item list, and the rest remain in the discard.
 */
export function applyTransferReturnedItemResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'transfer-returned-item') {
    return { state, error: `Pending transfer-returned-item requires 'transfer-returned-item', got '${action.type}'` };
  }
  if (top.kind.type !== 'transfer-returned-item') return null;
  if (action.player !== top.actor) {
    return { state, error: `Wrong player for pending transfer-returned-item` };
  }
  const kind = top.kind;
  const post = dequeueResolution(state, top.id);

  // Decline (either field omitted): remaining items stay discarded.
  if (!action.itemInstanceId || !action.targetCharacterId) {
    logDetail(`Transfer-returned-item: owner declines — all items remain discarded`);
    return { state: post };
  }

  if (!kind.itemInstanceIds.includes(action.itemInstanceId)) {
    return { state, error: `Item ${action.itemInstanceId as string} is not among the returned character's items` };
  }

  const ownerIndex = kind.ownerPlayerIndex;
  const owner = post.players[ownerIndex];
  const company = owner.companies.find(c => c.id === kind.companyId);
  if (!company || !company.characters.includes(action.targetCharacterId)) {
    return { state, error: `Target character ${action.targetCharacterId as string} is not in the returning character's company` };
  }

  const itemInDiscard = owner.discardPile.find(c => c.instanceId === action.itemInstanceId);
  if (!itemInDiscard) {
    return { state, error: `Item ${action.itemInstanceId as string} not in owner's discard pile` };
  }

  const itemName = defById(state, itemInDiscard.definitionId)?.name ?? (itemInDiscard.definitionId as string);
  const targetName = defById(state, owner.characters[action.targetCharacterId].definitionId)?.name ?? (action.targetCharacterId as string);
  logDetail(`Transfer-returned-item: moving ${itemName} from discard onto ${targetName}`);

  const targetCharacterId = action.targetCharacterId;
  const itemInstanceId = action.itemInstanceId;
  const newState = updatePlayer(post, ownerIndex, p => {
    const withItem = updateCharacter(p, targetCharacterId, c => ({
      ...c,
      items: [...c.items, { instanceId: itemInstanceId, definitionId: itemInDiscard.definitionId, status: CardStatus.Untapped }],
    }));
    return { ...withItem, discardPile: withItem.discardPile.filter(c => c.instanceId !== itemInstanceId) };
  });

  return { state: newState };
}

/**
 * Resolve a queued `flattery-attempt` resolution (Flatter a Foe, td-116).
 * The defending player rolls 2d6; total = roll + unusedDI + diplomatBonus (if
 * the character has the diplomat skill). Success if total > threshold: cancel
 * the current attack and decrease the company's hazard limit by
 * `hazardLimitReduction`.
 */
export function applyFlateryAttemptResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardRollResolution(state, action, top, 'flattery-attempt', 'flattery-attempt');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const { characterInstanceId, creatureRace, threshold, diplomatBonus, hazardLimitReduction } = kind;

  const charInPlay = player.characters[characterInstanceId];
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
 * Return a character to the player's hand, discarding all attached cards.
 * Items, allies, and hazards are discarded to their respective owners'
 * discard piles. Followers fall to GI if room, otherwise are discarded.
 */
function returnCharacterToHand(
  state: GameState,
  playerIndex: number,
  characterId: import('../index.js').CardInstanceId,
  charInPlay: import('../index.js').CharacterInPlay,
  allowItemTransfer = false,
  sourceInstanceId: import('../index.js').CardInstanceId | null = null,
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
    const follower = newCharacters[followerId];
    if (!follower) continue;
    const followerDef = defById(state, follower.definitionId);
    const followerMind = followerDef && isCharacterCard(followerDef) && followerDef.mind !== null ? followerDef.mind : 0;

    const currentGIUsed = Object.values(newCharacters)
      .filter(ch => ch.controlledBy === 'general' && ch.instanceId !== characterId)
      .reduce((sum, ch) => {
        const def = defById(state, ch.definitionId);
        return sum + (def && isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);

    if (currentGIUsed + followerMind <= generalInfluenceControlLimit(state, player.id)) {
      newCharacters[followerId] = { ...follower, controlledBy: 'general' };
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
      delete newCharacters[followerId];
      logDetail(`Call of Home: follower ${followerId as string} discarded (no GI room)`);
    }
  }

  // Remove the target character from characters map
  delete newCharacters[characterId];

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

  // Pilfer Anything Unwatched (as-33): "one item may be transferred to another
  // character in the same company." The character's items were just discarded;
  // if any remain reachable in the discard pile and a company-mate is still in
  // play, offer the owner a `transfer-returned-item` resolution to pull one
  // item back onto a mate before the rest stay discarded.
  if (allowItemTransfer && sourceInstanceId && charInPlay.items.length > 0) {
    const company = player.companies.find(c => c.characters.includes(characterId));
    const remainingMates = company
      ? company.characters.filter(id => id !== characterId)
      : [];
    if (company && remainingMates.length > 0) {
      const srcDefId = resolveInstanceId(state, sourceInstanceId);
      logDetail(`Pilfer Anything Unwatched: offering item transfer of ${charInPlay.items.length} item(s) to a company-mate in ${company.id as string}`);
      result = enqueueResolution(result, {
        source: sourceInstanceId,
        actor: player.id,
        scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
        kind: {
          type: 'transfer-returned-item',
          itemInstanceIds: charInPlay.items.map(i => i.instanceId),
          companyId: company.id,
          ownerPlayerIndex: playerIndex,
          sourceDefinitionId: srcDefId ?? charInPlay.definitionId,
        },
      });
    }
  }

  return result;
}

/**
 * Discard a character to their owner's discard pile (body check / hazard discard).
 * Items and allies are discarded to the resource player's discard pile; hazards
 * go to the hazard player's discard pile. Followers fall to GI if room, else discarded.
 *
 * `characterDestination` controls where the character *card itself* lands:
 * `'discard'` (the default — a plain discard) or `'out-of-play'` (elimination,
 * per CoE: an eliminated character is removed from the game rather than
 * discarded). Its possessions/followers are handled identically either way.
 */
function discardCharacter(
  state: GameState,
  playerIndex: number,
  characterId: import('../index.js').CardInstanceId,
  charInPlay: import('../index.js').CharacterInPlay,
  characterDestination: 'discard' | 'out-of-play' = 'discard',
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
    const follower = newCharacters[followerId];
    if (!follower) continue;
    const followerDef = defById(state, follower.definitionId);
    const followerMind = followerDef && isCharacterCard(followerDef) && followerDef.mind !== null ? followerDef.mind : 0;
    const currentGIUsed = Object.values(newCharacters)
      .filter(ch => ch.controlledBy === 'general' && ch.instanceId !== characterId)
      .reduce((sum, ch) => {
        const def = defById(state, ch.definitionId);
        return sum + (def && isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);
    if (currentGIUsed + followerMind <= generalInfluenceControlLimit(state, player.id)) {
      newCharacters[followerId] = { ...follower, controlledBy: 'general' };
    } else {
      for (const item of follower.items) newDiscard.push(toCardInstance(item));
      for (const ally of follower.allies) newDiscard.push(toCardInstance(ally));
      for (const hazard of follower.hazards) newOpponentDiscard.push(toCardInstance(hazard));
      newDiscard.push(toCardInstance(follower));
      delete newCharacters[followerId];
    }
  }

  const affectedCompanies = player.companies
    .filter(c => c.characters.includes(characterId))
    .map(c => c.id);

  delete newCharacters[characterId];
  const newCompanies = player.companies.map(company => {
    if (!company.characters.includes(characterId)) return company;
    return { ...company, characters: company.characters.filter(id => id !== characterId) };
  });

  // The character card itself: discarded (default) or eliminated to the owner's
  // out-of-play pile. Its possessions were already pushed to newDiscard above.
  const newOutOfPlay = characterDestination === 'out-of-play'
    ? [...player.outOfPlayPile, toCardInstance(charInPlay)]
    : player.outOfPlayPile;
  if (characterDestination === 'discard') {
    newDiscard.push(toCardInstance(charInPlay));
  }

  newPlayers[playerIndex] = {
    ...player,
    characters: newCharacters,
    companies: newCompanies,
    discardPile: newDiscard,
    outOfPlayPile: newOutOfPlay,
  };
  newPlayers[opponentIndex] = { ...opponent, discardPile: newOpponentDiscard };

  const removedDef = defById(state, charInPlay.definitionId);
  const removedIsLeader = !!(removedDef && isCharacterCard(removedDef) && (removedDef.keywords ?? []).includes('leader'));

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
 * Eliminate a character (CoE): remove it from its company and send the character
 * card to its owner's out-of-play pile, discarding its possessions (allies/items
 * to the owner's discard, hazards to the hazard owner) and freeing its followers
 * to general influence. Thin wrapper over {@link discardCharacter} with the
 * character-card destination set to the out-of-play pile. Used by the dice-check
 * `eliminate-character` branch (Evil Things Lingering ba-45).
 */
export function eliminateCharacter(
  state: GameState,
  playerIndex: number,
  characterId: import('../index.js').CardInstanceId,
  charInPlay: import('../index.js').CharacterInPlay,
): GameState {
  return discardCharacter(state, playerIndex, characterId, charInPlay, 'out-of-play');
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
export function applySeizedByTerrorRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardRollResolution(state, action, top, 'seized-by-terror-roll', 'seized-by-terror-roll');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const { targetCharacterId, threshold, originSiteInstanceId } = kind;
  const charInPlay = player.characters[targetCharacterId];
  if (!charInPlay) {
    return { state: dequeueResolution(state, top.id), error: 'Target character not found' };
  }

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : (targetCharacterId as string);
  const mind = charDef && isCharacterCard(charDef) && charDef.mind !== null ? charDef.mind : 0;

  const rolled = rollForResolution(state, actorIndex, `Seized by Terror: ${charName}`);
  const checkValue = rolled.total + mind;
  const passed = checkValue >= threshold;
  logDetail(`Seized by Terror on ${charName}: rolled ${rolled.total} + mind ${mind} = ${checkValue} vs threshold ${threshold} → ${passed ? 'STAYS' : 'SPLITS OFF TO ORIGIN'}`);

  let postRoll = dequeueResolution(rolled.state, top.id);

  if (!passed) {
    postRoll = splitCharacterToOrigin(postRoll, actorIndex, targetCharacterId, originSiteInstanceId);
  }

  return resolveChainEntryAndContinue(
    postRoll,
    e => e.payload.type === 'short-event' && e.payload.targetCharacterId === targetCharacterId,
    [rolled.rollEffect],
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
export function applyGoldRingTestResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardRollResolution(state, action, top, 'gold-ring-test-roll', 'gold-ring-test');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const { goldRingInstanceId, rollModifier, characterInstanceId } = kind;

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
    const char = player.characters[foundCharId as CardInstanceId];
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
        const compChar = afterRingPlayer.characters[compCharId];
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
export function applyRingPlayOfferResolution(
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
  const char = stateAfterRemove.players[playerIndex].characters[characterInstanceId];
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
export function applyResourcePlayOfferResolution(
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
export function applyWizardSearchOnStoreResolution(
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
export function applySelectCardBearerResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'select-card-bearer') return null;

  const { cardInstanceId, companyId, mode: bearerMode, discardFactionsAtSite: shouldDiscardFactions, returnFactionsAtSite: shouldReturnFactions } = top.kind;

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
  const ch = defPlayer.characters[characterId];
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

    // The card is kept in the marshalling-point pile — activate any ongoing
    // effects that were suppressed while its self-inflicted attacks resolved
    // (Descent through Fire ba-56). Clear the pending flag on the kept card.
    s = updatePlayer(s, cardOwnerIdx, p => ({
      ...p,
      cardsInPlay: p.cardsInPlay.map(c => c.instanceId === cardInstanceId && c.pendingTriggerAttack
        ? (() => { const { pendingTriggerAttack: _drop, ...rest } = c; return rest; })()
        : c),
    }));

    // Discard factions playable at the company's current site if requested
    if (shouldDiscardFactions) {
      const company = s.players[defIdx].companies.find(co => co.id === companyId);
      const currentSiteDef = company?.currentSite
        ? defById(s, company.currentSite.definitionId)
        : undefined;
      const siteName = currentSiteDef?.name;
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

    // Return each unique faction (of either player) playable at the company's
    // current site to its owner's hand (Tempest of Fire ba-77). Unlike
    // `discardFactionsAtSite`, this scans both players' cardsInPlay, is limited
    // to unique factions, and returns to hand rather than discarding.
    if (shouldReturnFactions) {
      const company = s.players[defIdx].companies.find(co => co.id === companyId);
      const currentSiteDef = company?.currentSite
        ? defById(s, company.currentSite.definitionId)
        : undefined;
      const siteName = currentSiteDef?.name;
      const siteType = currentSiteDef && 'siteType' in currentSiteDef ? (currentSiteDef as { siteType: string }).siteType : undefined;

      if (siteName || siteType) {
        // Collect every unique faction in play (either player's cardsInPlay)
        // that is playable at the site, then remove each from where it sits and
        // hand it back to its true owner (instance-id prefix — normally the
        // holder, but an influenced-away faction returns to its deck owner).
        for (let pi = 0; pi < 2; pi++) {
          const factionsToReturn: import('../types/state-cards.js').CardInPlay[] = [];
          for (const card of s.players[pi].cardsInPlay) {
            const fDef = defById(s, card.definitionId);
            if (!fDef || !isFactionCard(fDef)) continue;
            if (fDef.unique !== true) continue;
            const playableAt = fDef.playableAt as readonly ({ site?: string; siteType?: string; region?: string })[];
            const matches = playableAt.some(entry =>
              (siteName && 'site' in entry && entry.site === siteName) ||
              (siteType && 'siteType' in entry && entry.siteType === siteType),
            );
            if (matches) factionsToReturn.push(card);
          }
          if (factionsToReturn.length === 0) continue;
          const returnIds = new Set(factionsToReturn.map(c => c.instanceId as string));
          s = updatePlayer(s, pi, p => ({
            ...p,
            cardsInPlay: p.cardsInPlay.filter(c => !returnIds.has(c.instanceId as string)),
          }));
          for (const card of factionsToReturn) {
            const ownerIdx = getPlayerIndex(s, ownerOf(card.instanceId));
            const fName = defById(s, card.definitionId)?.name ?? (card.definitionId as string);
            logDetail(`select-card-bearer: returning unique faction "${fName}" to owner ${s.players[ownerIdx].id as string}'s hand — playable at ${siteName ?? siteType ?? '?'}`);
            s = updatePlayer(s, ownerIdx, p => ({ ...p, hand: [...p.hand, toCardInstance(card)] }));
          }
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
 * Resolve a `discard-one-company-item` pending resolution.
 *
 * The defending player selects one item from any character in the company
 * via a `discard-item-from-company` action. The item is removed from its
 * bearer and moved to the defending player's discard pile.
 */
export function applyDiscardOneCompanyItemResolution(
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
      newCharacters[charId as CardInstanceId] = { ...charData, items: charData.items.filter((_, i) => i !== idx) };
      itemRemoved = true;
      break;
    }
  }
  if (!itemRemoved || !removedItem) {
    return { state, error: `Item ${itemInstanceId as string} not found in company ${companyId as string}` };
  }

  const itemDef = defById(state, removedItem.definitionId);
  const itemName = itemDef?.name ?? (itemInstanceId as string);
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
 * Resolve a `force-discard-card` pending resolution. The actor (the card-player's
 * opponent) discards one chosen card, moving it to their discard pile.
 *
 * - Fixed-candidate mode (Rolled down to the Sea wh-29): the chosen card must be
 *   one of the pre-computed candidate rings, located in the actor's hand or
 *   among the items held by one of their in-play characters.
 * - Any-from-hand mode (Khamûl the Easterling tw-47): the chosen card must be in
 *   the actor's hand. After each discard, `remaining` is decremented; while it
 *   stays above 0 and the hand still has cards, the resolution is kept (with the
 *   decremented count) so the actor discards again. It clears once `remaining`
 *   hits 0 or the hand empties.
 */
export function applyForceDiscardCardResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'force-discard-card') return null;
  if (action.type !== 'force-discard-card') {
    return { state, error: `Pending force-discard-card requires force-discard-card, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for force-discard-card' };
  }
  const { cardInstanceId } = action;
  const anyFromHand = !!top.kind.anyFromHand;

  const actorIdx = state.players.findIndex(p => p.id === action.player);
  if (actorIdx < 0) return { state, error: 'Player not found for force-discard-card' };
  const actorPlayer = state.players[actorIdx];

  if (anyFromHand) {
    if (!actorPlayer.hand.some(c => c.instanceId === cardInstanceId)) {
      return { state, error: `Card ${cardInstanceId as string} is not in hand` };
    }
  } else if (!top.kind.candidateInstanceIds.includes(cardInstanceId)) {
    return { state, error: `Card ${cardInstanceId as string} is not a valid card to discard` };
  }

  // Locate the chosen card: first the hand, then any character's items.
  let removed: CardInstance | null = null;
  const handIdx = actorPlayer.hand.findIndex(c => c.instanceId === cardInstanceId);
  let newHand = actorPlayer.hand;
  const newCharacters = { ...actorPlayer.characters };
  if (handIdx >= 0) {
    removed = toCardInstance(actorPlayer.hand[handIdx]);
    newHand = actorPlayer.hand.filter((_, i) => i !== handIdx);
  } else {
    for (const [charId, charData] of Object.entries(newCharacters)) {
      const idx = charData.items.findIndex(it => it.instanceId === cardInstanceId);
      if (idx >= 0) {
        removed = toCardInstance(charData.items[idx]);
        newCharacters[charId as CardInstanceId] = {
          ...charData,
          items: charData.items.filter((_, i) => i !== idx),
        };
        break;
      }
    }
  }
  if (!removed) {
    return { state, error: `Card ${cardInstanceId as string} not found in hand or company` };
  }

  const cardDef = defById(state, removed.definitionId);
  const cardName = cardDef?.name ?? (cardInstanceId as string);
  logDetail(`force-discard-card: ${actorPlayer.name} discards "${cardName}"`);

  const newPlayers = clonePlayers(state);
  newPlayers[actorIdx] = {
    ...actorPlayer,
    hand: newHand,
    characters: newCharacters,
    discardPile: [...actorPlayer.discardPile, removed],
  };
  const stateAfter = { ...state, players: newPlayers };

  // Any-from-hand: keep the resolution alive until the required count is met or
  // the hand runs out.
  if (anyFromHand) {
    const remainingAfter = (top.kind.remaining ?? 1) - 1;
    if (remainingAfter > 0 && newHand.length > 0) {
      logDetail(`force-discard-card: ${actorPlayer.name} must still discard ${remainingAfter} card(s)`);
      const updated = stateAfter.pendingResolutions.map(r =>
        r.id === top.id ? { ...r, kind: { ...top.kind, remaining: remainingAfter } } : r,
      );
      return { state: { ...stateAfter, pendingResolutions: updated } };
    }
  }

  return { state: dequeueResolution(stateAfter, top.id) };
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
export function applyHazardEventMaintenanceResolution(
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
 * Resolve a `tap-one-character` pending resolution.
 *
 * The resource player selects one untapped character in the company to tap
 * via a `tap-character-by-effect` action, or passes if no untapped characters
 * are available. Used by *Stench of Mordor* (le-141).
 */
export function applyTapOneCharacterResolution(
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

  const char = player.characters[characterInstanceId];
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
export function applyHavenRestoreCharacterResolution(
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

  const char = player.characters[characterInstanceId];
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
 * Resolve an `arrange-deck-top` pending resolution (Revealed to all Watchers,
 * dm-85).
 *
 * The player picks the next-highest card among the set-aside cards a
 * `cycle-hand` effect placed on top of their play deck, one `arrange-deck-top-card`
 * action at a time. Each pick appends to the resolution's `orderedInstanceIds`.
 * Once every top card has been chosen, the top `count` cards of the play deck
 * are reordered to match the chosen sequence (index 0 = top) and the resolution
 * is cleared.
 */
export function applyArrangeDeckTopResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'arrange-deck-top') return null;

  if (action.type !== 'arrange-deck-top-card') {
    return { state, error: `Pending arrange-deck-top requires arrange-deck-top-card, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for arrange-deck-top' };
  }

  const { count, orderedInstanceIds } = top.kind;
  const playerIdx = getPlayerIndex(state, action.player);
  const player = state.players[playerIdx];
  const topCards = player.playDeck.slice(0, count);

  // The chosen card must be one of the top cards and not already placed.
  const chosenCard = topCards.find(c => c.instanceId === action.cardInstanceId);
  if (!chosenCard || orderedInstanceIds.includes(action.cardInstanceId)) {
    return { state, error: `Card ${action.cardInstanceId as string} is not an available top-of-deck card` };
  }

  const newOrdered = [...orderedInstanceIds, action.cardInstanceId];
  const chosenName = cardName(state, chosenCard.definitionId);

  // Not finished yet — record the pick in the resolution's accumulator.
  if (newOrdered.length < count) {
    logDetail(`arrange-deck-top: placed "${chosenName}" at position ${newOrdered.length}/${count}`);
    const updated = state.pendingResolutions.map(r =>
      r.id === top.id
        ? { ...r, kind: { ...top.kind, orderedInstanceIds: newOrdered } }
        : r,
    );
    return { state: { ...state, pendingResolutions: updated } };
  }

  // Final pick — reorder the top `count` cards to match the chosen sequence.
  const orderedCards = newOrdered.map(id => topCards.find(c => c.instanceId === id)!);
  const rest = player.playDeck.slice(count);
  const newDeck = [...orderedCards, ...rest];
  logDetail(`arrange-deck-top: placed "${chosenName}" at position ${count}/${count} — deck top finalized`);
  const newState = updatePlayer(state, playerIdx, p => ({ ...p, playDeck: newDeck }));
  return { state: dequeueResolution(newState, top.id) };
}

/**
 * Resolve a `reveal-choose-to-hand` pending resolution (Eyes of Mandos, dm-126).
 *
 * The player picks one of the revealed top-of-deck cards via a
 * `choose-revealed-card` action. The chosen card is removed from the play deck
 * and placed in their hand; the remaining play deck is then shuffled (folding
 * the un-chosen revealed cards back in, per "shuffle the remaining ones into
 * your play deck"). The choice is mandatory, so no pass path exists.
 */
export function applyRevealChooseToHandResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'reveal-choose-to-hand') return null;

  if (action.type !== 'choose-revealed-card') {
    return { state, error: `Pending reveal-choose-to-hand requires choose-revealed-card, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for reveal-choose-to-hand' };
  }

  const { revealedInstanceIds } = top.kind;
  if (!revealedInstanceIds.includes(action.cardInstanceId)) {
    return { state, error: `Card ${action.cardInstanceId as string} was not among the revealed cards` };
  }

  const playerIdx = getPlayerIndex(state, action.player);
  const player = state.players[playerIdx];
  const chosen = player.playDeck.find(c => c.instanceId === action.cardInstanceId);
  if (!chosen) {
    return { state, error: `Revealed card ${action.cardInstanceId as string} not found in play deck` };
  }

  // Remove the chosen card, shuffle the rest of the deck (the un-chosen revealed
  // cards fold back into the play deck), and hand the chosen card to the player.
  const remaining = player.playDeck.filter(c => c.instanceId !== action.cardInstanceId);
  const [shuffledDeck, nextRng] = shuffle(remaining, state.rng);
  const chosenName = cardName(state, chosen.definitionId);
  logDetail(
    `reveal-choose-to-hand: ${action.player as string} takes "${chosenName}" into hand, ` +
    `shuffling ${shuffledDeck.length} card(s) back into the play deck`,
  );
  const newState = updatePlayer({ ...state, rng: nextRng }, playerIdx, p => ({
    ...p,
    hand: [...p.hand, chosen],
    playDeck: shuffledDeck,
  }));
  return { state: dequeueResolution(newState, top.id) };
}

/**
 * Resolve a `reveal-remove-from-discard` pending resolution (Aware of their
 * Ways, dm-46).
 *
 * The card-player picks one of the revealed non-unique cards in the opponent's
 * discard pile via a `remove-revealed-card` action (moving it to the opponent's
 * out-of-play pile — removed from the game), or declines with `pass`. Either
 * way the remaining revealed cards stay in the discard pile. The choice is
 * optional ("You may choose…").
 */
export function applyRevealRemoveFromDiscardResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'reveal-remove-from-discard') return null;

  if (action.type === 'pass') {
    if (action.player !== top.actor) {
      return { state, error: 'Wrong player for reveal-remove-from-discard' };
    }
    logDetail('reveal-remove-from-discard: card-player declines — no card removed from play');
    return { state: dequeueResolution(state, top.id) };
  }
  if (action.type !== 'remove-revealed-card') {
    return { state, error: `Pending reveal-remove-from-discard requires remove-revealed-card or pass, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for reveal-remove-from-discard' };
  }

  const { removableInstanceIds, opponentId } = top.kind;
  if (!removableInstanceIds.includes(action.cardInstanceId)) {
    return { state, error: `Card ${action.cardInstanceId as string} is not a removable revealed card` };
  }

  const opponentIdx = getPlayerIndex(state, opponentId);
  const opponent = state.players[opponentIdx];
  const chosen = opponent.discardPile.find(c => c.instanceId === action.cardInstanceId);
  if (!chosen) {
    return { state, error: `Revealed card ${action.cardInstanceId as string} not found in discard pile` };
  }

  const chosenName = cardName(state, chosen.definitionId);
  logDetail(
    `reveal-remove-from-discard: ${action.player as string} removes "${chosenName}" from play ` +
    `(${opponent.name}'s discard → out-of-play)`,
  );
  // Move the chosen card from the opponent's discard pile to their out-of-play
  // pile (removed from the game). No instance is lost.
  const newState = updatePlayer(state, opponentIdx, p => ({
    ...p,
    discardPile: p.discardPile.filter(c => c.instanceId !== action.cardInstanceId),
    outOfPlayPile: [...p.outOfPlayPile, chosen],
  }));
  return { state: dequeueResolution(newState, top.id) };
}

/**
 * Resolve a `desire-belly-choose-card` pending resolution (Desire All for Thy
 * Belly, ba-16, step 1): the card-player chooses one of the revealed
 * top-of-deck cards to show to the opponent. The choice is mandatory. On
 * resolution a `desire-belly-choose-penalty` resolution is enqueued for the
 * opponent.
 */
export function applyDesireBellyChooseCardResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'desire-belly-choose-card') return null;
  if (action.type !== 'desire-choose-shown-card') {
    return { state, error: `Pending desire-belly-choose-card requires desire-choose-shown-card, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for desire-belly-choose-card' };
  }
  const { revealedInstanceIds, opponentId, cardPlayerId, sourceDefinitionId } = top.kind;
  if (!revealedInstanceIds.includes(action.cardInstanceId)) {
    return { state, error: `Card ${action.cardInstanceId as string} is not one of the revealed cards` };
  }

  // Show the chosen card to the opponent (the whole set was already revealed to
  // the card-player when the effect resolved).
  const opponentIdx = getPlayerIndex(state, opponentId);
  const chosen = state.players[opponentIdx].playDeck.find(c => c.instanceId === action.cardInstanceId);
  let newState = state;
  if (chosen) {
    newState = revealInstances(newState, [chosen]);
    logDetail(`Desire All for Thy Belly: card-player shows "${cardName(newState, chosen.definitionId)}" to the opponent`);
  }

  // Hand off to the opponent's forced penalty choice.
  newState = dequeueResolution(newState, top.id);
  newState = enqueueResolution(newState, {
    source: top.source,
    actor: opponentId,
    scope: { kind: 'phase', phase: Phase.MovementHazard },
    kind: {
      type: 'desire-belly-choose-penalty',
      chosenInstanceId: action.cardInstanceId,
      revealedInstanceIds,
      opponentId,
      cardPlayerId,
      sourceDefinitionId,
    },
  });
  return { state: newState };
}

/**
 * Resolve a `desire-belly-choose-penalty` pending resolution (Desire All for
 * Thy Belly, ba-16, step 2): the opponent must choose to either remove the
 * shown card from the game or permanently reduce his hand size by one. Either
 * way the remaining revealed cards are shuffled back on top of his play deck.
 * The choice is mandatory.
 */
export function applyDesireBellyChoosePenaltyResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'desire-belly-choose-penalty') return null;
  if (action.type !== 'desire-choose-penalty') {
    return { state, error: `Pending desire-belly-choose-penalty requires desire-choose-penalty, got '${action.type}'` };
  }
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for desire-belly-choose-penalty' };
  }
  const { chosenInstanceId, revealedInstanceIds, opponentId } = top.kind;
  const sourceId = top.source;
  if (!sourceId) {
    return { state, error: 'desire-belly-choose-penalty resolution is missing its source card' };
  }
  const opponentIdx = getPlayerIndex(state, opponentId);
  const deck = state.players[opponentIdx].playDeck;
  const revealedSet = new Set(revealedInstanceIds as readonly string[] as string[]);

  // The rest of the deck (everything below the revealed cards), order preserved.
  const rest = deck.filter(c => !revealedSet.has(c.instanceId as string));

  let newState = state;
  if (action.penalty === 'remove-from-game') {
    const chosen = deck.find(c => c.instanceId === chosenInstanceId);
    if (!chosen) {
      return { state, error: `Shown card ${chosenInstanceId as string} not found in the play deck` };
    }
    // The other revealed cards (all revealed except the removed one) are
    // shuffled and placed back on top of the play deck.
    const remainingRevealed = deck.filter(
      c => revealedSet.has(c.instanceId as string) && c.instanceId !== chosenInstanceId,
    );
    const [shuffled, nextRng] = shuffle(remainingRevealed, state.rng);
    newState = { ...newState, rng: nextRng };
    newState = updatePlayer(newState, opponentIdx, p => ({
      ...p,
      playDeck: [...shuffled, ...rest],
      outOfPlayPile: [...p.outOfPlayPile, chosen],
    }));
    logDetail(
      `Desire All for Thy Belly: opponent removes "${cardName(newState, chosen.definitionId)}" from the game; ` +
      `${shuffled.length} card(s) shuffled back on top of the deck`,
    );
  } else {
    // Reduce hand size by one for the rest of the game: a permanent (until-cleared)
    // player-scoped hand-size-modifier constraint of -1 on the opponent.
    newState = addConstraint(newState, {
      source: sourceId,
      sourceDefinitionId: top.kind.sourceDefinitionId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: opponentId },
      kind: { type: 'hand-size-modifier', value: -1 },
    });
    // All revealed cards (including the shown one) are shuffled back on top.
    const allRevealed = deck.filter(c => revealedSet.has(c.instanceId as string));
    const [shuffled, nextRng] = shuffle(allRevealed, state.rng);
    newState = { ...newState, rng: nextRng };
    newState = updatePlayer(newState, opponentIdx, p => ({
      ...p,
      playDeck: [...shuffled, ...rest],
    }));
    logDetail(
      `Desire All for Thy Belly: opponent reduces hand size by 1 for the rest of the game; ` +
      `${shuffled.length} revealed card(s) shuffled back on top of the deck`,
    );
  }

  return { state: dequeueResolution(newState, top.id) };
}

/**
 * Resolve a `agent-play-manifestation-offer` pending resolution (My Precious
 * dm-29): after My Precious attacks and fails but survives, the defender may tap
 * a character in the target company to play Gollum from hand — discarding My
 * Precious — or pass (he stays in play).
 */
export function applyAgentPlayManifestationResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'agent-play-manifestation-offer') return null;

  if (action.type === 'pass') {
    logDetail('agent-play-manifestation: defender declines — My Precious stays in play');
    return { state: dequeueResolution(state, top.id) };
  }
  if (action.type !== 'play-agent-manifestation') {
    return { state, error: `Pending agent-play-manifestation-offer requires play-agent-manifestation or pass, got '${action.type}'` };
  }
  if (action.player !== top.actor) return { state, error: 'Wrong player for agent-play-manifestation' };

  const { agentId, companyId } = top.kind;
  const defIdx = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defIdx];
  const company = defPlayer.companies.find(co => co.id === companyId);
  if (!company || !company.characters.some(id => id === action.characterId)) {
    return { state, error: `Character ${action.characterId as string} not in company ${companyId as string}` };
  }
  const char = defPlayer.characters[action.characterId];
  if (!char || char.status !== CardStatus.Untapped) return { state, error: 'Target character is not untapped' };
  const gollum = findById(defPlayer.hand, action.manifestationCardInstanceId);
  if (!gollum) return { state, error: 'Manifestation card not in defender hand' };

  const gollumName = (defById(state, gollum.definitionId) as { name?: string })?.name ?? 'manifestation';
  logDetail(`agent-play-manifestation: ${defPlayer.name} taps ${action.characterId as string} to play ${gollumName}; My Precious discarded`);

  // Tap the character, attach Gollum as an ally on it, remove Gollum from hand.
  let newState = updatePlayer(state, defIdx, p => ({
    ...p,
    hand: p.hand.filter(c => c.instanceId !== action.manifestationCardInstanceId),
    characters: {
      ...p.characters,
      [action.characterId as string]: {
        ...p.characters[action.characterId],
        status: CardStatus.Tapped,
        allies: [...p.characters[action.characterId].allies, { instanceId: gollum.instanceId, definitionId: gollum.definitionId, status: CardStatus.Untapped }],
      },
    },
  }));

  // Discard My Precious (the attacking agent).
  const hazardIdx = 1 - defIdx;
  const agent = newState.players[hazardIdx].agents.find(a => a.id === agentId);
  if (agent) {
    newState = updatePlayer(newState, hazardIdx, p => ({
      ...p,
      agents: p.agents.filter(a => a.id !== agentId),
      discardPile: [...p.discardPile, toCardInstance(agent.character)],
      siteDeck: [...p.siteDeck, ...agent.siteStack],
    }));
  }

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
export function applyStayHerAppetiteRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardRollResolution(state, action, top, 'stay-her-appetite-roll', 'stay-her-appetite-roll');
  if (!g.ok) return g.result;
  const {
    allyInstanceId, allyOwnerPlayerIndex, hostCharacterInstanceId,
    allyMind, allyProwess, opponentUnusedGI, controllerUnusedDI,
    companyId, sourceDefinitionId,
  } = g.kind;

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

  const combat: import('../types/state-combat.js').CombatState = makeCombatState({
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
    assignmentPhase: 'defender',
    detainment: true,
    forceSingleTarget: true,
  });

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

/**
 * Resolve a `great-hunt-source` pending resolution (The Great Hunt wh-91): the
 * controller chose which of the opponent's piles to reveal. Kicks off the
 * reveal-and-attack sequence (initiating the first creature's attack), or — if
 * the controller passed because both piles were empty — clears the resolution.
 */
export function applyGreatHuntSourceResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'great-hunt-source') return null;
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for great-hunt-source' };
  }
  const { greatHuntInstanceId, maxCreatures, opponentId, companyId } = top.kind;
  const cleared = dequeueResolution(state, top.id);

  if (action.type === 'pass') {
    logDetail(`great-hunt-source: nothing to reveal — passing`);
    return { state: cleared };
  }
  if (action.type !== 'choose-great-hunt-source') {
    return { state, error: `Pending great-hunt-source requires choose-great-hunt-source, got '${action.type}'` };
  }
  const next = startGreatHuntReveal(cleared, greatHuntInstanceId, action.source, maxCreatures, opponentId, companyId, action.player);
  return { state: next };
}

/**
 * Resolve a `great-hunt-discard-attack` pending resolution (The Great Hunt
 * wh-91 ongoing trigger): the controller may have the discarded creature attack
 * their Alatar company, or pass. The creature stays in the opponent's discard
 * pile either way (it was already recorded as processed by the sweep).
 */
export function applyGreatHuntDiscardAttackResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'great-hunt-discard-attack') return null;
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for great-hunt-discard-attack' };
  }
  const { greatHuntInstanceId, creatureInstanceId, opponentId, companyId } = top.kind;
  const cleared = dequeueResolution(state, top.id);

  if (action.type === 'pass') {
    logDetail(`great-hunt-discard-attack: ${action.player as string} declines the attack`);
    return { state: cleared };
  }
  if (action.type !== 'great-hunt-attack-with-creature') {
    return { state, error: `Pending great-hunt-discard-attack requires great-hunt-attack-with-creature, got '${action.type}'` };
  }
  if (action.creatureInstanceId !== creatureInstanceId) {
    return { state, error: 'Great Hunt: creature mismatch' };
  }
  const combat = buildGreatHuntCombat(cleared, greatHuntInstanceId, creatureInstanceId, action.player, opponentId, companyId, 'none');
  if (!combat) {
    logDetail(`great-hunt-discard-attack: creature could not attack (missing definition/company)`);
    return { state: cleared };
  }
  return { state: { ...cleared, combat } };
}
