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
  CardDefinitionId,
  CompanyId,
  GameEffect,
  CharacterInPlay,
} from '../index.js';
import type { CardInPlay } from '../types/state-cards.js';
import type { ChainEntry } from '../types/state-combat.js';
import type { ReducerResult } from './reducer-utils.js';
import { splitCharacterOffCompany } from './company-split.js';
import { dequeueResolution, enqueueResolution, replaceResolutionKind, removeConstraint, addConstraint, enqueueCorruptionCheck } from './pending.js';
import { advanceMaintenanceChain, discardMaintainedEvent } from './event-maintenance.js';
import { freeOrDiscardFollowers } from './follower-dispersal.js';
import { partitionLeavingTrophies } from './trophy-dispersal.js';
import { shuffle } from '../rng.js';
import { formatSignedNumber } from '../format-helpers.js';
import { getPlayerIndex } from '../state-utils.js';
import { isCharacterCard, isFactionCard, isItemCard, isAllyCard, isSiteCard, printedMind } from '../types/cards.js';
import { CardStatus, Race, Skill } from '../types/common.js';
import { ZERO_EFFECTIVE_STATS } from '../types/state-cards.js';
import { Phase } from '../types/state-phases.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import { resolveDef, getEffectiveSkills, collectCharacterEffects, resolveCheckModifier } from './effects/index.js';
import { hasPlayFlag } from '../effects/index.js';
import { extraGeneralInfluence } from '../alignment-rules.js';
import { makeCombatState, activePlayerState, markPrisonersRescuedAtDolGuldur, cardName, clearPlannedMovement, companyById, deckSearchCancellerFor, classifyCorruptionOutcome, cleanupEmptyCompanies, clonePlayers, defById, discardOrRecyclePlayedEvent, effectiveGeneralInfluence, findById, findCharacterCompany, findEventMaintenanceEffect, riddlingCompanyBonus, gateDeckSearchFetch, getCardEffects, getOnEventEffects, matchesDefinition, nextCompanyId, partitionLeavingAllies, regionAdjacentSwapEligibleSites, removeById, removePrisonerFromHost, roll2d6, rollDiceForPlayer, sweepCompanyMembershipChangedEvents, sweepLeaderLeavesCompanyEvents, toCardInstance, updateCharacter, updatePlayer, wrongActionType } from './reducer-utils.js';
import { applyCost } from './cost-evaluator.js';
import { findCapturingPressGang, capturePressGang } from './press-gang.js';
import { influenceOverflowAmount, influenceOverflowStep } from './influence-overflow.js';
import type { EliminateInsteadOfDiscardHost } from './eliminate-instead-of-discard.js';
import { findEliminateInsteadOfDiscardHost, consumeEliminateInsteadOfDiscardHost } from './eliminate-instead-of-discard.js';
import { findDiscardSubstitutes, substituteCovers, discardCardsFromCompany, enqueueDiscardSubstituteOffer } from './discard-substitute.js';
import { isCharacterRemovalProtected } from './removal-protection.js';
import { placeCardSetAside, removeItemFromSetAside, isSetAsideCard } from './set-aside.js';
import { logDetail, logHeading } from './legal-actions/log.js';
import { oneRingWin } from './reducer-free-council.js';
import {
  resolveInfluenceAttemptRoll,
  resolveOpponentInfluenceDefend,
  applyOnGuardRevealAtResource,
  buildSiteEntryAttackCombat,
  executeDeferredSiteAction,
  handleSitePlayHeroResource,
} from './reducer-site.js';
import { autoResolve, initiateChain } from './chain-reducer.js';
import { recomputeDerived } from './recompute-derived.js';
import { availableDI } from './legal-actions/organization.js';
import { eligibleRingCategories, opposedRollStat, eligibleCompanyDiscardItems } from './legal-actions/pending.js';
import type { RingTestTableEffect, RingTestSearchEffect, TriggeredAction } from '../types/effects.js';
import { applyMove, type MoveContext } from './reducer-move.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { revealInstances, forgetDeckReveals } from './visibility.js';
import { handleRevealAgent } from './mh-hazard-play.js';
import { resolveCancelAttackEntry } from './combat-cancel.js';
import { startGreatHuntReveal, buildGreatHuntCombat } from './great-hunt.js';
import { findHuntCandidates, buildHuntCombat } from './hunt.js';
import { findLongDarkReachCandidates, buildLongDarkReachCombat } from './long-dark-reach.js';
import { afterAttackPlayTargets, afterAttackCharacterPlayTarget } from './post-attack-play.js';
import { handlePlayPermanentEvent } from './reducer-events.js';

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
/**
 * Remove a character that failed its corruption check, routing the character
 * card to the given destination pile and dispersing everything it held. The
 * discard and eliminate outcomes share this entire shape (CoE 7.1) — they
 * differ only in where the character card itself lands: the discard pile
 * (roll within 1 of CP) or the out-of-play pile (hard fail / Wizard avatar).
 *
 * Mutates `playersAfterRoll` in place (the caller's cloned players array) and
 * the caller-built `newCharacters` map (which may already have transfer-check
 * item removal applied):
 * - the character is deleted from `newCharacters` and every company,
 * - its followers are promoted to general influence,
 * - selected possessions are discarded — hazards among them to the hazard
 *   player's discard pile, the rest to the checking player's,
 * - hazards attached to the character are discarded to their owner's pile,
 *   skipping any that were already discarded as a possession (a corruption
 *   hazard appears in both lists and must land in the pile exactly once).
 */
function removeFailedCorruptionCharacter(
  state: GameState,
  playersAfterRoll: PlayerState[],
  playerIndex: number,
  characterId: CardInstanceId,
  char: CharacterInPlay,
  newCharacters: Record<string, CharacterInPlay>,
  possessions: readonly CardInstanceId[],
  destination: 'discard' | 'out-of-play',
): void {
  delete newCharacters[characterId as string];

  const newCompanies = playersAfterRoll[playerIndex].companies.map(c => ({
    ...c,
    characters: c.characters.filter(id => id !== characterId),
  }));

  // Followers lose their controller — revert to general influence with the
  // mind subtraction deferred to the player's next organization phase (CoE
  // 2.II.2.2.3): a corruption check resolves mid-turn, not during org, so the
  // freed follower is not charged to general influence on the spot.
  freeOrDiscardFollowers(state, newCharacters, char, 'corruption-check-removal');

  // Separate hazards (owned by opponent) from non-hazard possessions
  const hazardPlayerIndex = playerIndex === 0 ? 1 : 0;
  const hazardPossessions: CardInstance[] = [];
  const nonHazardPossessions: CardInstance[] = [];
  for (const id of possessions) {
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

  // Relocate trophies per CoE 3.IV.4 — worth MP → the holder's marshalling-
  // point pile, otherwise removed from play — regardless of where the failed
  // character card itself lands, or the creature CardInstance would vanish.
  const { toKillPile: ccTrophyKill, toOutOfPlay: ccTrophyOop } =
    partitionLeavingTrophies(state, char, 'corruption-check removal');

  const characterCard: CardInstance = { instanceId: characterId, definitionId: char.definitionId };
  playersAfterRoll[playerIndex] = destination === 'discard'
    ? {
        ...playersAfterRoll[playerIndex],
        characters: newCharacters,
        companies: newCompanies,
        discardPile: [...playersAfterRoll[playerIndex].discardPile, characterCard, ...nonHazardPossessions],
        killPile: [...playersAfterRoll[playerIndex].killPile, ...ccTrophyKill],
        outOfPlayPile: [...playersAfterRoll[playerIndex].outOfPlayPile, ...ccTrophyOop],
      }
    : {
        ...playersAfterRoll[playerIndex],
        characters: newCharacters,
        companies: newCompanies,
        outOfPlayPile: [...playersAfterRoll[playerIndex].outOfPlayPile, characterCard, ...ccTrophyOop],
        discardPile: [...playersAfterRoll[playerIndex].discardPile, ...nonHazardPossessions],
        killPile: [...playersAfterRoll[playerIndex].killPile, ...ccTrophyKill],
      };

  // A corruption hazard attached to the character (e.g. Lure of the Senses
  // tw-60) contributes corruption points, so it is listed in `possessions` *and*
  // sits in `char.hazards`. It was already routed to its owner's discard pile
  // above; discarding it again here would put the same instance in the pile
  // twice, duplicating a card instance in the game state.
  const alreadyDiscarded = new Set<string>(possessions as readonly string[]);
  const pastTense = destination === 'discard' ? 'discarded' : 'eliminated';
  for (const hazard of char.hazards) {
    if (alreadyDiscarded.has(hazard.instanceId as string)) {
      logDetail(`Hazard ${hazard.instanceId as string} already discarded as a possession — not discarding it twice`);
      continue;
    }
    logDetail(`Discarding hazard ${hazard.instanceId as string} from ${pastTense} character`);
    const hazOwner = ownerOf(hazard.instanceId);
    let hazOwnerIdx = playersAfterRoll.findIndex(p => p.id === hazOwner);
    if (hazOwnerIdx === -1) hazOwnerIdx = playerIndex === 0 ? 1 : 0;
    playersAfterRoll[hazOwnerIdx] = { ...playersAfterRoll[hazOwnerIdx], discardPile: [...playersAfterRoll[hazOwnerIdx].discardPile, toCardInstance(hazard)] };
  }
}

/**
 * Traitor (tw-105): fire any `on-event: corruption-check-failed` +
 * `traitor-attack` trigger after a character failed a corruption check.
 *
 * Every in-play copy carrying the trigger (either player's `cardsInPlay`) is
 * discarded on the one failed check — duplicates have no extra effect (CRF
 * erratum). If the traitor's company still has a character, an attack is made
 * against it: prowess = traitor's printed prowess + `prowessBonus`, same race
 * as the traitor (CRF), `strikes` strikes, no creature body, character body
 * checks modified by `bodyCheckModifier`. The character to be attacked is
 * chosen by the player who does not control the traitor's company — the
 * attack uses the attacker-chooses-defenders machinery with the opponent as
 * the attacking player (a cancel-window still precedes assignment, as with
 * attacker-chooses automatic-attacks).
 *
 * When a combat is already active (e.g. a Corpse-candle pre-defense check
 * failed mid-combat), the attack is queued as a `traitor-attack-queued`
 * constraint that `finalizeCombat` initiates right after the current combat —
 * the CRF "chain immediately following" timing.
 *
 * Called from every failed-check outcome (discard, eliminate, Press-gang
 * capture, discard-ring-only): the trigger keys on the *failed check*, not on
 * how the character left play. Returns the state unchanged when no trigger
 * card is in play.
 */
function applyTraitorTrigger(
  state: GameState,
  traitorOwnerIndex: number,
  traitorDef: import('../index.js').CardDefinition | undefined,
  traitorCompanyId: import('../index.js').CompanyId | undefined,
): GameState {
  type Trigger = { playerIdx: number; card: CardInPlay; apply: import('../types/effects.js').TraitorAttackAction };
  const triggers: Trigger[] = [];
  state.players.forEach((p, idx) => {
    for (const card of p.cardsInPlay) {
      const def = defById(state, card.definitionId);
      for (const oe of getOnEventEffects(def, 'corruption-check-failed')) {
        if (oe.apply.type === 'traitor-attack') {
          triggers.push({ playerIdx: idx, card, apply: oe.apply });
        }
      }
    }
  });
  if (triggers.length === 0) return state;

  let newState = state;
  for (const t of triggers) {
    const name = cardName(newState, t.card.definitionId, '?');
    logDetail(`corruption-check-failed: discarding "${name}" (${t.card.instanceId as string}) — trigger consumed`);
    newState = updatePlayer(newState, t.playerIdx, p => ({
      ...p,
      cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== t.card.instanceId),
      discardPile: [...p.discardPile, toCardInstance(t.card)],
    }));
  }

  const { apply, card } = triggers[0];
  if (!traitorDef || !isCharacterCard(traitorDef)) {
    logDetail('traitor-attack: failed character has no character definition — no attack');
    return newState;
  }
  const defendingPlayer = newState.players[traitorOwnerIndex];
  const company = traitorCompanyId
    ? defendingPlayer.companies.find(c => c.id === traitorCompanyId)
    : undefined;
  if (!company || company.characters.length === 0) {
    logDetail(`traitor-attack: no surviving character in the traitor's company — no attack`);
    return newState;
  }

  const prowess = (traitorDef.prowess ?? 0) + (apply.prowessBonus ?? 10);
  const strikes = apply.strikes ?? 1;
  const bodyCheckModifier = apply.bodyCheckModifier ?? 0;
  const race: Race | undefined = traitorDef.race;
  const defendingPlayerId = defendingPlayer.id;
  const attackingPlayerId = newState.players[1 - traitorOwnerIndex].id;

  if (newState.combat) {
    logDetail(`traitor-attack: combat already active — queuing ${prowess}-prowess attack on company ${company.id as string} for after this combat`);
    return addConstraint(newState, {
      source: card.instanceId,
      sourceDefinitionId: card.definitionId,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: company.id },
      kind: {
        type: 'traitor-attack-queued',
        prowess,
        strikes,
        bodyCheckModifier,
        race,
        traitorDefinitionId: traitorDef.id,
        defendingPlayerId,
        attackingPlayerId,
      },
    });
  }

  logDetail(`traitor-attack: "${traitorDef.name}" turns traitor — ${strikes}-strike ${prowess}-prowess attack against company ${company.id as string}; ${attackingPlayerId as string} chooses the character to be attacked`);
  const combat = makeCombatState(newState, {
    attackSource: { type: 'traitor-attack', eventInstanceId: card.instanceId, traitorDefinitionId: traitorDef.id },
    companyId: company.id,
    defendingPlayerId,
    attackingPlayerId,
    strikesTotal: strikes,
    strikeProwess: prowess,
    creatureBody: null,
    ...(race ? { creatureRace: race } : {}),
    assignmentPhase: 'cancel-window',
    detainment: false,
    attackerChoosesDefenders: true,
    ...(bodyCheckModifier !== 0 ? { bodyCheckModifier } : {}),
  });
  return { ...newState, combat };
}

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

  // Tap-in-support (`allowSupport`, Ren the Unclean tw-83): tap an untapped
  // company mate of the checking character for +1 to the upcoming roll. The
  // +1 rides a one-shot corruption `check-modifier` constraint on the
  // checking character, which the roll action re-reads on the next
  // legal-action cycle and the roll resolution consumes — the same plumbing
  // as reactive short-event boosts. The pending entry stays queued.
  if (action.type === 'support-corruption-check') {
    const topKind = top.kind;
    const topId = top.id;
    const topActor = top.actor;
    const topSource = top.source;
    const supportTargetId = action.targetCharacterId ?? topKind.characterId;
    const supportEntry = state.pendingResolutions.find(r =>
      r.actor === topActor
      && r.kind.type === 'corruption-check'
      && r.kind.characterId === supportTargetId
      && (r.id === topId || (topKind.selectableOrder && r.source === topSource && r.kind.selectableOrder)));
    if (!supportEntry || supportEntry.kind.type !== 'corruption-check') {
      return { state, error: 'support-corruption-check: no matching pending corruption check' };
    }

    // Item-sourced boost (Phial of Galadriel dm-176): a `corruption-check-boost`
    // item taps to add its own flat bonus to its bearer's own check. Distinct
    // from character company-mate support below — not gated by `allowSupport`
    // (a separate rule for CoE 7.1.1 tap-in-support) and legal on the bearer's
    // own check (there is no "cannot support its own check" restriction here).
    if (action.supportingItemInstanceId !== undefined) {
      const boostPlayerIndex = getPlayerIndex(state, action.player);
      const boostPlayer = state.players[boostPlayerIndex];
      const bearer = boostPlayer.characters[supportTargetId];
      if (!bearer) return { state, error: 'support-corruption-check: checking character not found' };
      const itemIndex = bearer.items.findIndex(it => it.instanceId === action.supportingItemInstanceId);
      if (itemIndex < 0) return { state, error: 'support-corruption-check: item not found on checking character' };
      const item = bearer.items[itemIndex];
      if (item.status !== CardStatus.Untapped) return { state, error: 'support-corruption-check: item is not untapped' };
      const itemDef = defById(state, item.definitionId);
      const boostEffect = getCardEffects(itemDef).find(
        (e): e is import('../types/effects.js').CorruptionCheckBoostEffect => e.type === 'corruption-check-boost',
      );
      if (!boostEffect) return { state, error: 'support-corruption-check: item has no corruption-check-boost effect' };
      logDetail(`Support: ${itemDef?.name ?? (item.definitionId as string)} taps for ${formatSignedNumber(boostEffect.value)} to ${cardName(state, resolveInstanceId(state, supportTargetId) ?? bearer.definitionId)}'s corruption check (${supportEntry.kind.reason})`);
      let boostState = updatePlayer(state, boostPlayerIndex, p =>
        updateCharacter(p, supportTargetId, ch => ({
          ...ch,
          items: ch.items.map((it, i) => i === itemIndex ? { ...it, status: CardStatus.Tapped } : it),
        })));
      boostState = addConstraint(boostState, {
        source: item.instanceId,
        sourceDefinitionId: item.definitionId,
        target: { kind: 'character', characterId: supportTargetId },
        kind: { type: 'check-modifier', check: 'corruption', value: boostEffect.value },
        scope: { kind: 'phase', phase: Phase.MovementHazard },
      });
      return { state: boostState };
    }

    if (!supportEntry.kind.allowSupport) {
      return { state, error: 'support-corruption-check: this pending corruption check does not allow tap-in-support' };
    }
    const supPlayerIndex = getPlayerIndex(state, action.player);
    const supPlayer = state.players[supPlayerIndex];
    const supportingCharacterId = action.supportingCharacterId;
    if (supportingCharacterId === undefined) return { state, error: 'support-corruption-check: no supporting character or item specified' };
    const supporter = supPlayer.characters[supportingCharacterId];
    if (!supporter) return { state, error: 'support-corruption-check: supporting character not found' };
    if (supporter.status !== CardStatus.Untapped) return { state, error: 'support-corruption-check: supporting character is not untapped' };
    if (supportingCharacterId === supportTargetId) return { state, error: 'support-corruption-check: a character cannot support its own check' };
    const supportCompany = findCharacterCompany(supPlayer.companies, supportTargetId);
    if (!supportCompany || !supportCompany.characters.includes(supportingCharacterId)) {
      return { state, error: 'support-corruption-check: supporter must be in the checking character\'s company' };
    }
    logDetail(`Support: ${cardName(state, supporter.definitionId)} taps for +1 to ${cardName(state, resolveInstanceId(state, supportTargetId) ?? supporter.definitionId)}'s corruption check (${supportEntry.kind.reason})`);
    let supState = updatePlayer(state, supPlayerIndex, p =>
      updateCharacter(p, supportingCharacterId, ch => ({ ...ch, status: CardStatus.Tapped })));
    supState = addConstraint(supState, {
      source: supporter.instanceId,
      sourceDefinitionId: supporter.definitionId,
      target: { kind: 'character', characterId: supportTargetId },
      kind: { type: 'check-modifier', check: 'corruption', value: 1 },
      scope: { kind: 'phase', phase: Phase.MovementHazard },
    });
    return { state: supState };
  }

  // Selectable order (Ren the Unclean tw-83): the actor may resolve any of
  // their same-source queued checks, not just the head — swap `top` for the
  // sibling entry matching the rolled character.
  if (action.type === 'corruption-check'
    && top.kind.selectableOrder
    && action.characterId !== top.kind.characterId) {
    const sibling = state.pendingResolutions.find(r =>
      r.actor === top.actor
      && r.kind.type === 'corruption-check'
      && r.source === top.source
      && r.kind.selectableOrder
      && r.kind.characterId === action.characterId);
    if (sibling) {
      logDetail(`Selectable corruption-check order: resolving sibling entry ${sibling.id} instead of head ${top.id}`);
      top = sibling;
    }
  }
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
  // Captured before any removal: on a failed check the Traitor trigger needs
  // to know which company the (possibly removed) character belonged to.
  const traitorCompanyId = player.companies.find(c => c.characters.includes(characterId))?.id;

  // Roll 2d6 + modifier
  const { roll, rollEffect, state: rolledState } = rollDiceForPlayer(state, playerIndex, `Corruption: ${charName}`);
  const total = roll.die1 + roll.die2 + modifier;
  const modStr = modifier !== 0 ? ` ${formatSignedNumber(modifier)}` : '';
  logDetail(`Corruption check for ${charName} (${reason}): rolled ${roll.die1} + ${roll.die2}${modStr} = ${total} vs CP ${cp}`);

  // Consume one-shot check-modifier constraints for this character. Any
  // constraint kind `check-modifier` with `check === 'corruption'` targeting
  // this character (or, for a player-scoped constraint, this character's
  // controller — Nenya tw-291) contributed to the modifier above and is now
  // cleared. A constraint carrying `autoPass: true` (Ancient Black Axe as-122;
  // Nenya) instead forces the check to succeed unconditionally, regardless of
  // the roll. A player-scoped constraint's `when` (if present) is re-checked
  // here against the checking character's current site, since it narrows
  // which character's check the constraint actually consumes on.
  //
  // A `lasting` constraint (Shifter of Hues wh-115) still applies but is never
  // consumed — it stands until its scope sweeps it. Company-targeted
  // constraints were never consumed here either (they are matched by company,
  // not by character, in the modifier computation).
  const playersAfterRoll = clonePlayers(rolledState);
  let postRollState: GameState = { ...rolledState, players: playersAfterRoll };
  let autoPass = false;
  // Player-scoped check-modifier constraints (Nenya tw-291) apply to any
  // character of the player, gated by the checking character's current site
  // type via `kind.when`. Computed once, lazily, since most checks have none.
  const checkCompany = findCharacterCompany(player.companies, characterId);
  const checkSiteDef = checkCompany?.currentSite ? defById(state, checkCompany.currentSite.definitionId) : undefined;
  const checkSiteCtx = { target: { siteType: (checkSiteDef as { siteType?: string } | undefined)?.siteType } } as Record<string, unknown>;
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'check-modifier' || constraint.kind.check !== 'corruption') continue;
    const isOwnCharacterConstraint = constraint.target.kind === 'character' && constraint.target.characterId === characterId;
    const isPlayerConstraint = constraint.target.kind === 'player' && constraint.target.playerId === player.id;
    if (!isOwnCharacterConstraint && !isPlayerConstraint) continue;
    if (isPlayerConstraint && constraint.kind.when && !matchesCondition(constraint.kind.when, checkSiteCtx)) {
      logDetail(`Player-scoped check-modifier constraint ${constraint.id} does not apply to ${charName} (site condition not met)`);
      continue;
    }
    if (constraint.kind.autoPass) autoPass = true;
    if (constraint.kind.lasting) {
      logDetail(`Lasting check-modifier constraint ${constraint.id} (corruption ${formatSignedNumber(constraint.kind.value)}) applied, not consumed`);
      continue;
    }
    logDetail(`Consuming one-shot check-modifier constraint ${constraint.id} (corruption ${formatSignedNumber(constraint.kind.value)}${constraint.kind.autoPass ? ', auto-pass' : ''})`);
    postRollState = removeConstraint(postRollState, constraint.id);
  }

  // Classify against the controlling player's alignment (CoE 7.1 / 7.1.F1): a
  // minion character or the Fallen-wizard avatar *taps and succeeds* on a roll
  // of CP or CP-1 rather than being discarded.
  let outcome = classifyCorruptionOutcome(charDef, player.alignment, total, cp);
  if (autoPass && outcome !== 'success') {
    logDetail(`Corruption check for ${charName} auto-passed (check-modifier autoPass constraint) — overriding outcome '${outcome}' to 'success'`);
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
      stateAfterDequeue = oneRingWin(stateAfterDequeue, player.id, winCard ?? null, onSuccess.destroysOneRing);
    }
    // A Malady Without Healing (le-159): a target that survives the corruption
    // check must then make a body check (modified by +1 if tapped). Enqueue it
    // as a standalone dice-check on the still-in-play target: the roller (the
    // caster) rolls 2d6; if the modified roll exceeds the target's body the
    // character is eliminated (CoE 3.I.2.1). The +1-if-tapped modifier is folded
    // into the threshold (eliminate when roll > body - tapMod) from the target's
    // current status.
    if (onSuccess?.type === 'enqueue-body-check') {
      const survivor = stateAfterDequeue.players[playerIndex].characters[characterId];
      const survivorDef = survivor ? defById(stateAfterDequeue, survivor.definitionId) : undefined;
      if (survivor && survivorDef && isCharacterCard(survivorDef)) {
        const body = survivorDef.body ?? 9;
        const tapped = survivor.status !== CardStatus.Untapped;
        const tapMod = onSuccess.plusOneIfTapped && tapped ? 1 : 0;
        const bodyLabel = onSuccess.reason ?? 'Body check';
        logDetail(`le-159: ${charName} passed corruption check — enqueuing body check (body ${body}${tapMod ? ', +1 tapped' : ''}) rolled by ${onSuccess.rollerPlayerId as string}`);
        stateAfterDequeue = enqueueResolution(stateAfterDequeue, {
          source: top.source,
          actor: onSuccess.rollerPlayerId,
          scope: { kind: 'phase', phase: stateAfterDequeue.phaseState.phase },
          kind: {
            type: 'dice-check',
            label: `${bodyLabel}: ${charName}`,
            modifiers: [],
            threshold: body - tapMod,
            comparison: 'gt',
            onPass: { type: 'eliminate-character', awardKillMpTo: onSuccess.awardKillMpTo },
            continuation: { kind: 'dequeue-only' },
            requireTargetPresent: true,
            targetCharacterId: characterId,
          },
        });
      }
    }
    // Token of Goodwill (dm-160): the diplomat survived his corruption check —
    // raise a `goodwill-attempt` resolution so he can discard a company item
    // of the listed rank and roll to cancel the attack.
    if (onSuccess?.type === 'enqueue-goodwill-attempt') {
      logDetail(`dm-160: ${charName} passed corruption check — enqueuing goodwill-attempt (item ${onSuccess.itemSubtype}, threshold ${onSuccess.threshold})`);
      stateAfterDequeue = enqueueResolution(stateAfterDequeue, {
        source: top.source,
        actor: player.id,
        scope: top.scope,
        kind: {
          type: 'goodwill-attempt',
          characterInstanceId: characterId,
          companyId: onSuccess.companyId,
          itemSubtype: onSuccess.itemSubtype,
          threshold: onSuccess.threshold,
        },
      });
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
    // The check still FAILED (only the failure consequence was softened) —
    // the Traitor trigger fires; the still-in-play character may itself be
    // chosen as the target of the attack.
    const ringOnlyState = dequeueResolution({ ...postRollState, players: playersAfterRoll }, top.id);
    return {
      state: applyTraitorTrigger(ringOnlyState, playerIndex, charDef, traitorCompanyId),
      effects: [rollEffect],
    };
  }

  // Failed — discard or eliminate the character
  const newCharacters = { ...player.characters };
  /** Set when an `eliminate-instead-of-discard` host turned this discard into an elimination. */
  let elimHost: EliminateInsteadOfDiscardHost | null = null;

  // For transfer/store checks the item already physically moved — to the new
  // bearer (transfer), the player's marshalling-point pile (store), or an
  // item cache's set-aside slot (Armory dm-116 store). The failed check means
  // the move didn't stick, so the item must be pulled back out of wherever it
  // landed before it is routed to the discard pile, or the same instance
  // would exist in two places at once (e.g. a failed store left the item in
  // the kill pile — still scoring its MP — while also pushing a copy into
  // the discard pile).
  //
  // `transferredItemPreDiscarded` marks the store/cache cases, where the pull
  // and the discard both happen right here — the possessions list passed to
  // `removeFailedCorruptionCharacter` is filtered so the item is not
  // discarded a second time. In the transfer case the item is only pulled
  // off the new bearer here (via `newCharacters`) and the possessions route
  // performs the discard as before.
  let transferredItemPreDiscarded = false;
  let transferredItemOnBearer = false;
  if (transferredItemId) {
    for (const [cid, cData] of Object.entries(newCharacters)) {
      if (cid === characterId as string) continue;
      const itemIdx = cData.items.findIndex(i => i.instanceId === transferredItemId);
      if (itemIdx >= 0) {
        newCharacters[cid as CardInstanceId] = { ...cData, items: cData.items.filter(i => i.instanceId !== transferredItemId) };
        transferredItemOnBearer = true;
        break;
      }
    }
    if (!transferredItemOnBearer) {
      const itemCard: CardInstance = { instanceId: transferredItemId, definitionId: resolveInstanceId(state, transferredItemId)! };
      if (playersAfterRoll[playerIndex].killPile.some(c => c.instanceId === transferredItemId)) {
        logDetail(`Failed store: pulling ${transferredItemId as string} back out of the marshalling-point pile → discard`);
        playersAfterRoll[playerIndex] = {
          ...playersAfterRoll[playerIndex],
          killPile: playersAfterRoll[playerIndex].killPile.filter(c => c.instanceId !== transferredItemId),
          discardPile: [...playersAfterRoll[playerIndex].discardPile, itemCard],
        };
        transferredItemPreDiscarded = true;
      } else if (playersAfterRoll.some(p => p.cardsInPlay.some(c => c.instanceId === transferredItemId))) {
        logDetail(`Failed store: pulling ${transferredItemId as string} back out of its item-cache set-aside slot → discard`);
        const pulled = removeItemFromSetAside({ ...postRollState, players: playersAfterRoll }, transferredItemId);
        playersAfterRoll[0] = pulled.players[0];
        playersAfterRoll[1] = pulled.players[1];
        playersAfterRoll[playerIndex] = {
          ...playersAfterRoll[playerIndex],
          discardPile: [...playersAfterRoll[playerIndex].discardPile, itemCard],
        };
        transferredItemPreDiscarded = true;
      }
    }
  }
  let failedPossessions = transferredItemPreDiscarded
    ? action.possessions.filter(id => id !== transferredItemId)
    : action.possessions;

  // The Precious (tw-98): on failure, also discard a named item borne by a
  // *different* company member (the checking character is "not the bearer").
  // Pull it off its real bearer here — `removeFailedCorruptionCharacter`
  // only ever deletes `characterId`'s own entry — then fold it into the
  // possessions list so it rides the same discard-pile routing below.
  const alsoDiscardItemId = top.kind.alsoDiscardItemId;
  if (alsoDiscardItemId) {
    for (const [cid, cData] of Object.entries(newCharacters)) {
      if (cid === characterId as string) continue;
      const itemIdx = cData.items.findIndex(i => i.instanceId === alsoDiscardItemId);
      if (itemIdx >= 0) {
        newCharacters[cid as CardInstanceId] = { ...cData, items: cData.items.filter(i => i.instanceId !== alsoDiscardItemId) };
        logDetail(`Corruption check failed: also discarding ${alsoDiscardItemId as string} from ${cid} (The Precious)`);
        failedPossessions = [...failedPossessions, alsoDiscardItemId];
        break;
      }
    }
  }

  if (outcome === 'discard') {
    // Press-gang (ba-22): redirect the would-be discard to the opponent's
    // Press-gang, if one is in play.
    let stateAfterRoll: GameState = { ...postRollState, players: playersAfterRoll };
    const pressHost = findCapturingPressGang(stateAfterRoll, playerIndex);
    if (pressHost) {
      // Press-gang replaces only the character's own discard with a capture —
      // the failed transfer still doesn't stick. The pull-off-the-new-bearer
      // edit above lives in `newCharacters`, which this path never applies,
      // so pull the item off the bearer and discard it here. (The store/cache
      // cases were already fully handled in `playersAfterRoll` above.)
      if (transferredItemId && transferredItemOnBearer) {
        const players = [...stateAfterRoll.players] as typeof playersAfterRoll;
        const holder = players[playerIndex];
        const bearerEntry = Object.entries(holder.characters)
          .find(([cid, cData]) => cid !== (characterId as string)
            && cData.items.some(i => i.instanceId === transferredItemId));
        if (bearerEntry) {
          const [bearerId, bearerData] = bearerEntry;
          logDetail(`Failed transfer (press-gang capture): pulling ${transferredItemId as string} off ${bearerId} → discard`);
          players[playerIndex] = {
            ...holder,
            characters: {
              ...holder.characters,
              [bearerId]: { ...bearerData, items: bearerData.items.filter(i => i.instanceId !== transferredItemId) },
            },
            discardPile: [...holder.discardPile, { instanceId: transferredItemId, definitionId: resolveInstanceId(state, transferredItemId)! }],
          };
          stateAfterRoll = { ...stateAfterRoll, players };
        }
      }
      const captured = capturePressGang(stateAfterRoll, playerIndex, characterId, pressHost);
      const capturedState = dequeueResolution(captured, top.id);
      return {
        state: applyTraitorTrigger(capturedState, playerIndex, charDef, traitorCompanyId),
        effects: [rollEffect],
      };
    }

    // Pallando the Soul-keeper (as-17): a matching character that would be
    // discarded from play is instead eliminated to its owner's out-of-play pile.
    elimHost = findEliminateInsteadOfDiscardHost(stateAfterRoll, charDef);
    if (elimHost) {
      logDetail(`Corruption check FAILED (${total} within 1 of ${cp}) — ${charName} is eliminated instead of discarded, and ${action.possessions.length} possession(s) discarded`);
      removeFailedCorruptionCharacter(state, playersAfterRoll, playerIndex, characterId, char, newCharacters, failedPossessions, 'out-of-play');
    } else {
      // Roll == CP or CP - 1 on a hero character: it + possessions discarded (not followers)
      logDetail(`Corruption check FAILED (${total} within 1 of ${cp}) — discarding ${charName} and ${action.possessions.length} possession(s)`);
      removeFailedCorruptionCharacter(state, playersAfterRoll, playerIndex, characterId, char, newCharacters, failedPossessions, 'discard');
    }
  } else {
    // outcome === 'eliminate': hard fail (≥2 below CP) or a Wizard avatar on any
    // failure — character eliminated, possessions discarded.
    logDetail(`Corruption check FAILED (outcome eliminate, ${total} vs CP ${cp}) — eliminating ${charName}, discarding ${action.possessions.length} possession(s)`);
    removeFailedCorruptionCharacter(state, playersAfterRoll, playerIndex, characterId, char, newCharacters, failedPossessions, 'out-of-play');

    // A Malady Without Healing (le-159): a hero target eliminated by this
    // corruption check credits the caster the hero's kill marshalling points.
    const awardKillMpTo = top.kind.awardKillMpTo;
    if (awardKillMpTo && charDef && isCharacterCard(charDef) && charDef.cardType === 'hero-character') {
      const casterIdx = playersAfterRoll.findIndex(p => p.id === awardKillMpTo);
      if (casterIdx >= 0) {
        const killMp = charDef.marshallingPoints ?? 0;
        playersAfterRoll[casterIdx] = {
          ...playersAfterRoll[casterIdx],
          bonusKillMarshallingPoints: (playersAfterRoll[casterIdx].bonusKillMarshallingPoints ?? 0) + killMp,
        };
        logDetail(`le-159: hero ${charName} eliminated by corruption check — awarding ${killMp} kill MP to ${awardKillMpTo as string}`);
      }
    }
  }

  let cleanedState = cleanupEmptyCompanies({
    ...postRollState,
    players: playersAfterRoll,
  });
  if (elimHost) cleanedState = consumeEliminateInsteadOfDiscardHost(cleanedState, elimHost);
  // The failed character just left its company (discarded or eliminated) — sweep
  // any company-bound permanent event (e.g. Fellowship tw-240) that must be
  // discarded when company membership changes (CoE — card text).
  if (traitorCompanyId) {
    cleanedState = sweepCompanyMembershipChangedEvents(cleanedState, [traitorCompanyId]);
  }

  const failedState = dequeueResolution(cleanedState, top.id);
  return {
    state: applyTraitorTrigger(failedState, playerIndex, charDef, traitorCompanyId),
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

  const g = guardResolution(state, action, top, 'opponent-influence-defend', 'opponent-influence-defend');
  if (!g.ok) return g.result;

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
    ? (charData ? [...getEffectiveSkills(state, charData, charDef)] : [...charDef.skills])
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

  logDetail(`Cancel-influence: ${cardDef.name} played, influence attempt auto-canceled`);

  // A magic cancel-influence card (e.g. Poisonous Despair le-219) cast by a
  // player whose Ringwraith is Akhôrahil (le-51) is shuffled back into their
  // play deck instead of discarded (see `discardOrRecyclePlayedEvent`).
  let resultState: GameState = updatePlayer(state, playerIndex, p => ({ ...p, hand: handCards }));
  resultState = discardOrRecyclePlayedEvent(resultState, playerIndex, toCardInstance(discardedCard));
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
      bonusModifier: top.kind.bonusModifier,
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

/** `ok` with the validated actor + `action`/`kind` narrowed, or the early-return the caller propagates. */
type ResolutionGuard<K extends PendingResolution['kind']['type'], A extends GameAction['type']> =
  | {
    readonly ok: true;
    readonly actorIndex: number;
    readonly player: PlayerState;
    readonly action: Extract<GameAction, { readonly type: A }>;
    readonly kind: Extract<PendingResolution['kind'], { readonly type: K }>;
  }
  | { readonly ok: false; readonly result: ReducerResult | null };

/**
 * Shared entry guard for the pending-resolution reducers: check the action
 * type, defer (`null`) unless this kind heads the queue, reject a wrong
 * player, and return the actor with `action` and `kind` narrowed (no
 * re-narrowing at the call site).
 */
function guardResolution<K extends PendingResolution['kind']['type'], A extends GameAction['type']>(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
  actionType: A,
  kindType: K,
): ResolutionGuard<K, A> {
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
    action: action as Extract<GameAction, { readonly type: A }>,
    kind: top.kind as Extract<PendingResolution['kind'], { readonly type: K }>,
  };
}

/**
 * {@link guardResolution} variant for the kinds whose actor may also decline
 * with a generic `pass`: a pass logs `passMessage` (a string, or a function of
 * the narrowed kind when the message needs its fields) and yields the dequeued
 * state as the early-return `result`. All other checks and the `ok` payload
 * match {@link guardResolution}.
 */
function guardResolutionOrPass<K extends PendingResolution['kind']['type'], A extends GameAction['type']>(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
  actionType: A,
  kindType: K,
  passMessage: string | ((kind: Extract<PendingResolution['kind'], { readonly type: K }>) => string),
): ResolutionGuard<K, A> {
  if (top.kind.type !== kindType) return { ok: false, result: null };
  const kind = top.kind as Extract<PendingResolution['kind'], { readonly type: K }>;
  if (action.type === 'pass') {
    logDetail(typeof passMessage === 'string' ? passMessage : passMessage(kind));
    return { ok: false, result: { state: dequeueResolution(state, top.id) } };
  }
  if (action.type !== actionType) {
    return { ok: false, result: { state, error: `Pending ${kindType} requires '${actionType}' or pass, got '${action.type}'` } };
  }
  if (action.player !== top.actor) {
    return { ok: false, result: { state, error: `Wrong player for pending ${kindType}` } };
  }
  const actorIndex = getPlayerIndex(state, action.player);
  return {
    ok: true,
    actorIndex,
    player: state.players[actorIndex],
    action: action as Extract<GameAction, { readonly type: A }>,
    kind,
  };
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
    readonly targetCompanyId?: CompanyId;
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
    // Owner-agnostic like `eliminate-character` below: the roller need not be
    // the target's controller (A Lie in Your Eyes as-23 has the card-player
    // roll against the opponent's character).
    const targetId = ctx.targetCharacterId;
    const ownerIndex = state.players.findIndex(p => !!p.characters[targetId]);
    if (ownerIndex === -1) {
      logDetail(`dice-check discard-character: ${targetId as string} no longer in play — no-op`);
      return { state };
    }
    const charInPlay = state.players[ownerIndex].characters[targetId];
    return { state: discardCharacter(state, ownerIndex, targetId, charInPlay) };
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
    let afterElim = eliminateCharacter(state, ownerIndex, ctx.targetCharacterId, charInPlay);
    // A prisoner eliminated by a periodic body check (Spells of the
    // Barrow-wights dm-90's `untapBodyCheck`) must drop out of its hazard
    // host's prisoner bookkeeping too — a no-op for any non-prisoner target.
    afterElim = removePrisonerFromHost(afterElim, ctx.targetCharacterId);
    // A Malady Without Healing (le-159): a hero eliminated by the standalone
    // body check credits the caster the hero's kill marshalling points.
    if (branch.awardKillMpTo) {
      const elimDef = defById(state, charInPlay.definitionId);
      const awardTo = branch.awardKillMpTo;
      if (elimDef && isCharacterCard(elimDef) && elimDef.cardType === 'hero-character') {
        const casterIdx = afterElim.players.findIndex(p => p.id === awardTo);
        if (casterIdx >= 0) {
          const killMp = elimDef.marshallingPoints ?? 0;
          afterElim = updatePlayer(afterElim, casterIdx, p => ({
            ...p,
            bonusKillMarshallingPoints: (p.bonusKillMarshallingPoints ?? 0) + killMp,
          }));
          logDetail(`le-159: hero ${elimDef.name} eliminated by body check — awarding ${killMp} kill MP to ${awardTo as string}`);
        }
      }
    }
    return { state: afterElim };
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
  if (branch.type === 'cancel-current-attack') {
    // Roll-to-cancel (Going Ever Under Dark ba-37): the check passed, so cancel
    // the combat currently in progress. Fizzles harmlessly if combat is gone.
    return { state: resolveCancelAttackEntry(state) };
  }
  if (branch.type === 'wound-or-eliminate') {
    // Crowned with Storm (ba-54): "wounded or, if already wounded, eliminated".
    // Owner-agnostic — the target may belong to either company in the CvCC, so
    // locate the actual owner rather than assuming the roller.
    if (ctx.targetCharacterId) {
      const targetId = ctx.targetCharacterId;
      const ownerIndex = state.players.findIndex(p => !!p.characters[targetId]);
      if (ownerIndex === -1) {
        logDetail(`wound-or-eliminate: character ${targetId as string} no longer in play — no-op`);
        return { state };
      }
      const charInPlay = state.players[ownerIndex].characters[targetId];
      if (charInPlay.status === CardStatus.Inverted) {
        logDetail(`wound-or-eliminate: character ${targetId as string} already wounded → eliminated`);
        return { state: eliminateCharacter(state, ownerIndex, targetId, charInPlay) };
      }
      logDetail(`wound-or-eliminate: character ${targetId as string} wounded`);
      return {
        state: updatePlayer(state, ownerIndex, p =>
          updateCharacter(p, targetId, c => ({ ...c, status: CardStatus.Inverted }))),
      };
    }
    if (ctx.targetInstanceId) {
      const allyId = ctx.targetInstanceId;
      for (let pi = 0; pi < state.players.length; pi++) {
        const p = state.players[pi];
        for (const key of Object.keys(p.characters)) {
          const charId = key as import('../index.js').CardInstanceId;
          const host = p.characters[charId];
          const ally = host.allies.find(a => a.instanceId === allyId);
          if (!ally) continue;
          if (ally.status === CardStatus.Inverted) {
            logDetail(`wound-or-eliminate: ally ${allyId as string} already wounded → eliminated (discarded)`);
            return {
              state: updatePlayer(state, pi, pp => {
                const withAllyRemoved = updateCharacter(pp, charId, c => ({
                  ...c,
                  allies: c.allies.filter(a => a.instanceId !== allyId),
                }));
                return { ...withAllyRemoved, discardPile: [...withAllyRemoved.discardPile, toCardInstance(ally)] };
              }),
            };
          }
          logDetail(`wound-or-eliminate: ally ${allyId as string} wounded`);
          return {
            state: updatePlayer(state, pi, pp =>
              updateCharacter(pp, charId, c => ({
                ...c,
                allies: c.allies.map(a => (a.instanceId === allyId ? { ...a, status: CardStatus.Inverted } : a)),
              }))),
          };
        }
      }
      logDetail(`wound-or-eliminate: ally ${allyId as string} no longer in play — no-op`);
      return { state };
    }
    logDetail('wound-or-eliminate: no target character/instance in context — no-op');
    return { state };
  }
  if (branch.type === 'lock-company-movement') {
    // Siege (tw-87): the end-of-organization-phase roll failed, so "the company
    // may not move this turn" — drop any destination it declared earlier in the
    // organization phase (returning the site card to its location deck) and
    // install a turn-scoped `company-cannot-move` constraint, which also bars a
    // fresh declaration should the company get another chance to plan movement.
    if (!ctx.targetCompanyId) {
      logDetail('lock-company-movement: no target company in context — no-op');
      return { state };
    }
    const companyId = ctx.targetCompanyId;
    const ownerIndex = state.players.findIndex(p => p.companies.some(c => c.id === companyId));
    if (ownerIndex === -1) {
      logDetail(`lock-company-movement: company ${companyId as string} no longer exists — no-op`);
      return { state };
    }
    logDetail(`lock-company-movement: company ${companyId as string} may not move this turn`);
    const cleared = clearPlannedMovement(state, ownerIndex, companyId);
    return {
      state: addConstraint(cleared, {
        source: ctx.source ?? ('' as CardInstanceId),
        sourceDefinitionId: (ctx.source ? resolveInstanceId(cleared, ctx.source) : null) as CardDefinitionId,
        scope: { kind: 'turn' },
        target: { kind: 'company', companyId },
        kind: { type: 'company-cannot-move' },
      }),
    };
  }
  if (branch.type === 'split-into-own-company') {
    // Turning Hope to Despair (as-41): the mind roll failed, so peel this
    // character off his company into his own (or, if he was alone, flag his
    // company for a separate M/H phase) via the shared helper.
    if (!ctx.targetCharacterId || !ctx.targetCompanyId) {
      logDetail('split-into-own-company: missing target character/company — no-op');
      return { state };
    }
    const targetCompanyId = ctx.targetCompanyId;
    const ownerIndex = state.players.findIndex(p => p.companies.some(c => c.id === targetCompanyId));
    if (ownerIndex === -1) {
      logDetail(`split-into-own-company: company ${targetCompanyId as string} no longer exists — no-op`);
      return { state };
    }
    return { state: splitCharacterOffCompany(state, ownerIndex, ctx.targetCharacterId, targetCompanyId) };
  }
  if (branch.type === 'untap-site') {
    // Fireworks (dm-130): the roll passed, so untap the site the target
    // character's company occupies. Owner-agnostic — locate the character's
    // actual owner rather than assuming the roller (the roller is always the
    // owner here, but stay consistent with the other verbs).
    if (!ctx.targetCharacterId) {
      logDetail('untap-site: no target character in context — no-op');
      return { state };
    }
    const targetId = ctx.targetCharacterId;
    const ownerIndex = state.players.findIndex(p => !!p.characters[targetId]);
    if (ownerIndex === -1) {
      logDetail(`untap-site: character ${targetId as string} no longer in play — no-op`);
      return { state };
    }
    const owner = state.players[ownerIndex];
    const company = owner.companies.find(c => c.characters.includes(targetId));
    const siteInstance = company?.currentSite;
    if (!company || !siteInstance) {
      logDetail(`untap-site: ${targetId as string} has no current site — no-op`);
      return { state };
    }
    if (siteInstance.status === CardStatus.Untapped) {
      logDetail(`untap-site: site ${siteInstance.definitionId as string} already untapped — no-op`);
      return { state };
    }
    const siteName = defById(state, siteInstance.definitionId)?.name ?? '?';
    logDetail(`untap-site: untapping site ${siteName} for company ${company.id as string}`);
    return {
      state: updatePlayer(state, ownerIndex, p => ({
        ...p,
        companies: p.companies.map(c =>
          c.id === company.id
            ? { ...c, currentSite: { ...siteInstance, status: CardStatus.Untapped } }
            : c),
      })),
    };
  }
  if (branch.type === 'site-entry-attack') {
    // Doubled Vigilance (dm-51): the entry roll failed, so the company facing
    // the gate must face the effect's attack now — the site step is parked at
    // `site-entry-attack`, i.e. ahead of every automatic-attack.
    if (state.phaseState.phase !== Phase.Site) {
      logDetail('site-entry-attack: not in the site phase — no-op');
      return { state };
    }
    if (!ctx.source) {
      logDetail('site-entry-attack: no source card in context — no-op');
      return { state };
    }
    const combat = buildSiteEntryAttackCombat(
      state, ctx.rollerIndex, state.phaseState, branch.attack, ctx.source,
    );
    if (!combat) {
      logDetail('site-entry-attack: company has no characters left — no attack');
      return { state };
    }
    return { state: { ...state, combat } };
  }
  if (branch.type === 'offer-swap-new-site') {
    // Chance of Being Lost (dm-49): the roll-then-swap check passed. Compute
    // the eligible replacement sites — the hazard player's own siteDeck
    // entries in the destination site's region or an adjacent region,
    // excluding the destination's own name — and, if any exist, enqueue a
    // `swap-new-site-choice` resolution so the hazard player picks one.
    if (!ctx.targetCompanyId) {
      logDetail('offer-swap-new-site: no target company in context — no-op');
      return { state };
    }
    const companyId = ctx.targetCompanyId;
    const owner = state.players.find(p => companyById(p.companies, companyId));
    const company = owner ? companyById(owner.companies, companyId) : undefined;
    const destination = company?.destinationSite;
    if (!destination) {
      logDetail(`offer-swap-new-site: company ${companyId as string} is no longer moving — no-op`);
      return { state };
    }
    const destDef = defById(state, destination.definitionId);
    if (!destDef || !isSiteCard(destDef)) {
      logDetail('offer-swap-new-site: destination site definition not found — no-op');
      return { state };
    }
    const hazardPlayer = state.players[ctx.rollerIndex];
    const eligible = regionAdjacentSwapEligibleSites(state, hazardPlayer.siteDeck, destDef);
    if (eligible.length === 0) {
      logDetail(`offer-swap-new-site: no eligible replacement for "${destDef.name}" in ${hazardPlayer.name}'s location deck — the "must replace" clause has no effect`);
      return { state };
    }
    logDetail(`offer-swap-new-site: ${eligible.length} eligible replacement site(s) for "${destDef.name}" — enqueuing swap-new-site-choice for ${hazardPlayer.name}`);
    return {
      state: enqueueResolution(state, {
        source: ctx.source,
        actor: hazardPlayer.id,
        scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
        kind: { type: 'swap-new-site-choice', companyId },
      }),
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
  const g = guardResolution(state, action, top, 'resolve-dice-check', 'dice-check');
  if (!g.ok) return g.result;
  const { kind } = g;
  const rollerIndex = getPlayerIndex(state, kind.roller ?? top.actor);

  // Pre-roll skip: kinds that don't roll when the target is gone (no RNG/cheat
  // consumed) — preserves cvcc/call-of-home/body-check. A chain continuation
  // must still fire: the skipped check may be what an unresolved chain entry
  // (e.g. Call of Home) is waiting on, and nothing else can ever resolve it.
  if (kind.requireTargetPresent && !diceCheckTargetPresent(state, kind)) {
    logDetail(`${kind.label}: target absent — skipping roll`);
    const skipped = dequeueResolution(state, top.id);
    if (kind.continuation.kind === 'chain-entry'
      && !(kind.continuation.drainSameSource
        && skipped.pendingResolutions.some(r => r.kind.type === 'dice-check' && r.source === top.source))) {
      return resolveChainEntryAndContinue(skipped, diceCheckChainMatcher(kind.continuation.match, top, kind), []);
    }
    return { state: skipped };
  }

  const rolled = rollDiceForPlayer(state, rollerIndex, kind.label);
  let mod = 0;
  for (const m of kind.modifiers) {
    if (m.kind === 'constant') {
      mod += m.value;
    } else {
      const pi = getPlayerIndex(state, m.player);
      // Rules 1.55/1.56 (CoE 1.12.R1 / 1.12.B1): a Ringwraith or Balrog player's
      // unused general influence for this kind of check — Muster Disperses
      // tw-67, Call of Home — includes their flat +5 that "cannot be used to
      // control characters ... added on top of available general influence".
      mod += effectiveGeneralInfluence(state, m.player) - state.players[pi].generalInfluenceUsed
        + extraGeneralInfluence(state.players[pi].alignment);
    }
  }
  const total = rolled.total + mod;
  const rawFail = kind.alwaysFailRolls?.includes(rolled.total) ?? false;
  // Matched totals take a dedicated branch instead of pass/fail — the
  // Orc/Troll printed discard numbers (CoE 3.I.3): the modified total landing
  // exactly on a discard number discards, while a higher total is an ordinary
  // failed check with the ordinary consequence.
  const matched = !rawFail && (kind.matchOutcome?.values.includes(total) ?? false);
  const passed = !rawFail && !matched && (kind.comparison === 'gt' ? total > kind.threshold : total >= kind.threshold);
  logDetail(`${kind.label}: rolled ${rolled.total}${mod ? ` ${mod >= 0 ? '+' : ''}${mod}` : ''} = ${total} ${kind.comparison === 'gt' ? '>' : '>='} ${kind.threshold}${rawFail ? ` (raw roll ${rolled.total} always fails)` : ''} → ${matched ? `MATCH (${kind.matchOutcome!.values.join(',')})` : passed ? 'PASS' : 'FAIL'}`);

  let post = dequeueResolution(rolled.state, top.id);
  const branch = matched ? kind.matchOutcome!.action : passed ? kind.onPass : kind.onFail;
  if (branch) {
    const r = applyDiceCheckBranch(post, branch, {
      targetCharacterId: kind.targetCharacterId,
      targetInstanceId: kind.targetInstanceId,
      targetCompanyId: kind.targetCompanyId,
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
 * Resolve a queued `swap-new-site-choice` resolution (Chance of Being Lost,
 * dm-49), following a passed roll-then-swap dice-check. Mirrors
 * `handleSwapNewSite`'s (`mh-hazard-play.ts`) core swap — the company's
 * original destination site returns, untapped, to its own owner's location
 * deck (only declared, never entered); the chosen replacement is pulled from
 * the hazard player's own `siteDeck` and becomes the company's new untapped
 * `destinationSite`; the M/H phase state's cached `destinationSiteName` /
 * `destinationSiteType` are refreshed to describe the replacement — except
 * gated by same-or-adjacent **region** (via `regionAdjacentSwapEligibleSites`)
 * rather than a static site-path region-type requirement, and reached via a
 * pending resolution rather than chosen up front at play time.
 */
export function applySwapNewSiteChoiceResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, action, top, 'swap-new-site-choice', 'swap-new-site-choice');
  if (!g.ok) return g.result;
  const { actorIndex, player, action: choiceAction, kind } = g;
  const { companyId } = kind;

  const ownerIndex = state.players.findIndex(p => companyById(p.companies, companyId));
  if (ownerIndex === -1) {
    logDetail(`swap-new-site-choice: company ${companyId as string} no longer exists — no-op`);
    return { state: dequeueResolution(state, top.id) };
  }
  const owner = state.players[ownerIndex];
  const company = companyById(owner.companies, companyId);
  const destination = company?.destinationSite;
  if (!company || !destination) {
    logDetail(`swap-new-site-choice: company ${companyId as string} is no longer moving — no-op`);
    return { state: dequeueResolution(state, top.id) };
  }
  const destDef = defById(state, destination.definitionId);
  if (!destDef || !isSiteCard(destDef)) {
    return { state, error: 'Destination site definition not found' };
  }

  const replacement = findById(player.siteDeck, choiceAction.replacementSiteInstanceId);
  if (!replacement) return { state, error: 'Replacement site not found in your location deck' };
  const replacementDef = defById(state, replacement.definitionId);
  if (!replacementDef || !isSiteCard(replacementDef)) return { state, error: 'Replacement site definition not found' };
  const eligible = regionAdjacentSwapEligibleSites(state, player.siteDeck, destDef);
  if (!eligible.some(inst => inst.instanceId === replacement.instanceId)) {
    return { state, error: `Chance of Being Lost: "${replacementDef.name}" is not a different site in the same or an adjacent region as "${destDef.name}"` };
  }

  logDetail(`Chance of Being Lost: replacing "${destDef.name}" (company ${companyId as string}'s new site) with "${replacementDef.name}" from ${player.name}'s location deck`);

  let newState = dequeueResolution(state, top.id);
  newState = updatePlayer(newState, actorIndex, p => ({
    ...p,
    siteDeck: removeById(p.siteDeck, replacement.instanceId),
  }));
  newState = updatePlayer(newState, ownerIndex, p => ({
    ...p,
    siteDeck: [...p.siteDeck, toCardInstance(destination)],
    companies: p.companies.map(c => c.id === companyId
      ? {
          ...c,
          destinationSite: {
            instanceId: replacement.instanceId,
            definitionId: replacement.definitionId,
            status: CardStatus.Untapped,
          },
        }
      : c),
  }));

  if (newState.phaseState.phase === Phase.MovementHazard) {
    newState = {
      ...newState,
      phaseState: {
        ...newState.phaseState,
        destinationSiteName: replacementDef.name,
        destinationSiteType: replacementDef.siteType,
      },
    };
  }

  return { state: newState };
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'transfer-returned-item', 'transfer-returned-item');
  if (!g.ok) return g.result;
  const { action, kind } = g;
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
 * Resolve a queued `remove-corruption-offer` resolution (Elf-song, tw-223).
 * The eligible character's controller either removes one of the character's
 * corruption cards — back to that card's own owner's discard pile, exactly
 * like `discard-target-corruption-card` (`grant-action-apply.ts`) — or
 * declines; any remaining corruption cards stay attached either way.
 */
export function applyRemoveCorruptionOfferResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'remove-corruption-offer', 'remove-corruption-offer');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const { characterId } = kind;
  const post = dequeueResolution(state, top.id);

  if (!action.corruptionInstanceId) {
    logDetail(`Remove-corruption-offer: declined for ${characterId as string}`);
    return { state: post };
  }

  let ownerIndex = -1;
  let char: CharacterInPlay | undefined;
  for (let pi = 0; pi < post.players.length; pi++) {
    const c = post.players[pi].characters[characterId];
    if (c) { ownerIndex = pi; char = c; break; }
  }
  if (ownerIndex < 0 || !char) {
    return { state, error: `Character ${characterId as string} is not in play` };
  }

  const corruption = char.hazards.find(h => h.instanceId === action.corruptionInstanceId);
  if (!corruption) {
    return { state, error: `Corruption card ${action.corruptionInstanceId as string} not found on ${characterId as string}` };
  }

  const corruptionOwnerIdx = getPlayerIndex(post, ownerOf(corruption.instanceId));
  const corruptionName = defById(post, corruption.definitionId)?.name ?? (corruption.definitionId as string);
  const charName = cardName(post, char.definitionId);
  logDetail(`Remove-corruption-offer: removing "${corruptionName}" from ${charName}`);

  const corruptionInstanceId = action.corruptionInstanceId;
  const newState = updatePlayer(post, ownerIndex, p => updateCharacter(p, characterId, c => ({
    ...c,
    hazards: c.hazards.filter(h => h.instanceId !== corruptionInstanceId),
  })));
  const finalState = updatePlayer(newState, corruptionOwnerIdx, p => ({
    ...p,
    discardPile: [...p.discardPile, toCardInstance(corruption)],
  }));

  return { state: finalState };
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
  const g = guardResolution(state, action, top, 'flattery-attempt', 'flattery-attempt');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const { characterInstanceId, creatureRace, threshold, diplomatBonus, hazardLimitReduction } = kind;

  const charInPlay = player.characters[characterInstanceId];
  if (!charInPlay) {
    // The character left play before the roll (e.g. eliminated by a chain
    // response) — the attempt fails without a roll and the chain resumes.
    logDetail(`Flattery attempt: character no longer in play — the attempt fails, combat continues`);
    const fizzled = dequeueResolution(state, top.id);
    return resolveChainEntryAndContinue(fizzled, e => e.card?.instanceId === top.source, []);
  }

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : String(characterInstanceId);
  const isDiplomat = isCharacterCard(charDef) && charDef.skills.includes(Skill.Diplomat);
  const bonus = isDiplomat ? diplomatBonus : 0;
  const unusedDI = availableDI(state, characterInstanceId, player);

  const { roll, rollEffect, state: rolledState } = rollDiceForPlayer(state, actorIndex, `Flattery attempt: ${charName} vs ${creatureRace}`);
  const total = roll.die1 + roll.die2 + unusedDI + bonus;
  const success = total > threshold;

  logDetail(`Flattery attempt by ${charName} vs "${creatureRace}": rolled ${roll.die1}+${roll.die2} + DI ${unusedDI}${isDiplomat ? ` + diplomat ${bonus}` : ''} = ${total} vs threshold ${threshold} → ${success ? 'SUCCESS' : 'FAILURE'}`);

  let postRoll = dequeueResolution(rolledState, top.id);

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

  // The flattery-attempt resolution paused the chain (needsInput) without
  // marking the originating Flatter a Foe entry resolved — mirror the
  // dice-check `continuation: { kind: 'chain-entry' }` path so the chain
  // actually resumes instead of being left stuck in 'resolving' mode with
  // no legal actions for either player.
  return resolveChainEntryAndContinue(postRoll, e => e.card?.instanceId === top.source, [rollEffect]);
}

/**
 * Resolve a queued `burglary-attempt` resolution (Burglary, td-103). The
 * player rolls 2d6; total = roll + `scoutBonus` if the character has the
 * Scout skill + `hobbitBonus` if he is a Hobbit. Success (total > threshold)
 * skips the company's automatic-attacks entirely for this site-phase slot
 * (`SitePhaseState.autoAttacksSkipped`) and unlocks an item play with the
 * character (`SitePhaseState.burglaryItemUnlock`). Failure marks the
 * character as the sole defender of the company's automatic-attacks
 * (`SitePhaseState.soloAutoAttackCharacterId`) — threaded into every
 * automatic-attack `CombatState` built for this slot as
 * `soloDefenderInstanceId`.
 */
export function applyBurglaryAttemptResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, action, top, 'burglary-attempt', 'burglary-attempt');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const { characterInstanceId, threshold, scoutBonus, hobbitBonus } = kind;

  const charInPlay = player.characters[characterInstanceId];
  if (!charInPlay) {
    // The character left play before the roll — the attempt fizzles: no
    // auto-attack skip, no solo-defender mark, automatic-attacks proceed
    // normally.
    logDetail(`Burglary attempt: character no longer in play — the attempt fails with no further effect`);
    return { state: dequeueResolution(state, top.id) };
  }
  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : String(characterInstanceId);
  const isScout = isCharacterCard(charDef) && charDef.skills.includes(Skill.Scout);
  const isHobbit = isCharacterCard(charDef) && charDef.race === Race.Hobbit;
  const bonus = (isScout ? scoutBonus : 0) + (isHobbit ? hobbitBonus : 0);

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + bonus;
  const success = total > threshold;

  logDetail(`Burglary attempt by ${charName}: rolled ${roll.die1}+${roll.die2}${isScout ? ` +${scoutBonus} scout` : ''}${isHobbit ? ` +${hobbitBonus} hobbit` : ''} = ${total} vs threshold ${threshold} → ${success ? 'SUCCESS' : 'FAILURE'}`);

  const newPlayers = clonePlayers(state);
  newPlayers[actorIndex] = { ...newPlayers[actorIndex], lastDiceRoll: roll };

  const postRoll = dequeueResolution({ ...state, players: newPlayers, rng, cheatRollTotal }, top.id);

  if (postRoll.phaseState.phase !== Phase.Site) {
    logDetail('Burglary attempt resolved outside the site phase — no-op beyond the roll');
    return { state: postRoll };
  }
  const siteState = postRoll.phaseState;

  if (success) {
    logDetail(`Burglary attempt succeeded: automatic-attacks skipped; an item may be played with ${charName}`);
    return {
      state: {
        ...postRoll,
        phaseState: { ...siteState, autoAttacksSkipped: true, burglaryItemUnlock: characterInstanceId },
      },
    };
  }

  logDetail(`Burglary attempt failed: ${charName} must face all automatic-attacks alone`);
  return {
    state: {
      ...postRoll,
      phaseState: { ...siteState, soloAutoAttackCharacterId: characterInstanceId },
    },
  };
}

/**
 * Resolve a queued `riddling-attempt` resolution (Riddling Talk, td-148).
 * The defending player rolls 2d6; total = roll + sageBonus per Sage in the
 * company + hobbitBonus per Hobbit in the company. Success if total >
 * threshold: enqueue a `riddling-guess` resolution for the naming step (the
 * attack is not cancelled here — a correct guess is still required).
 */
export function applyRiddlingAttemptResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  // Reactive short-event plays (Wit td-168: "Modify one riddling roll by
  // +3") are legal while this roll is awaiting resolution — return null so
  // the dispatcher falls through to the per-phase reducer, which runs the
  // normal `play-short-event` handler. The pending resolution stays queued;
  // the next legal-action cycle re-emits the roll action with any
  // freshly-added check-modifier constraint factored in. Mirrors
  // `applyCorruptionCheckResolution`'s identical carve-out.
  if (action.type === 'play-short-event') return null;
  const g = guardResolution(state, action, top, 'riddling-attempt', 'riddling-attempt');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const { characterInstanceId, creatureRace, threshold, sageBonus, hobbitBonus, hazardLimitReduction } = kind;

  const charInPlay = player.characters[characterInstanceId];
  if (!charInPlay) {
    // The character left play before the roll — the attempt fails without a
    // roll and the chain resumes.
    logDetail(`Riddling attempt: character no longer in play — the attempt fails, combat continues`);
    const fizzled = dequeueResolution(state, top.id);
    return resolveChainEntryAndContinue(fizzled, e => e.card?.instanceId === top.source, []);
  }
  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : String(characterInstanceId);

  const { sages, hobbits, bonus } = riddlingCompanyBonus(state, player, characterInstanceId, sageBonus, hobbitBonus);

  // One-shot `check-modifier` constraints keyed to `riddling` and targeting
  // this character (Wit td-168: "Modify one riddling roll by +3") — summed
  // into the roll and consumed below, mirroring the corruption-check path.
  let checkModifierBonus = 0;
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type === 'check-modifier'
        && constraint.kind.check === 'riddling'
        && constraint.target.kind === 'character'
        && constraint.target.characterId === characterInstanceId) {
      checkModifierBonus += constraint.kind.value;
    }
  }

  const { roll, rollEffect, state: rolledState } = rollDiceForPlayer(state, actorIndex, `Riddling attempt: ${charName} vs ${creatureRace}`);
  const total = roll.die1 + roll.die2 + bonus + checkModifierBonus;
  const success = total > threshold;

  logDetail(`Riddling attempt by ${charName} vs "${creatureRace}": rolled ${roll.die1}+${roll.die2} + ${sages} sage(s) x${sageBonus} + ${hobbits} hobbit(s) x${hobbitBonus} + check-modifier ${checkModifierBonus} = ${total} vs threshold ${threshold} → ${success ? 'SUCCESS' : 'FAILURE'}`);

  let postRoll = dequeueResolution(rolledState, top.id);

  // Consume the one-shot check-modifier constraints that contributed above.
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type === 'check-modifier'
        && constraint.kind.check === 'riddling'
        && constraint.target.kind === 'character'
        && constraint.target.characterId === characterInstanceId) {
      logDetail(`Consuming one-shot check-modifier constraint ${constraint.id} (riddling ${formatSignedNumber(constraint.kind.value)})`);
      postRoll = removeConstraint(postRoll, constraint.id);
    }
  }

  if (success) {
    logDetail(`Riddling attempt succeeded: player may now name a card to guess`);
    postRoll = enqueueResolution(postRoll, {
      source: top.source,
      actor: top.actor,
      scope: top.scope,
      kind: {
        type: 'riddling-guess',
        hazardLimitReduction,
      },
    });
    return { state: postRoll };
  }

  logDetail(`Riddling attempt failed: combat continues`);
  return resolveChainEntryAndContinue(postRoll, e => e.card?.instanceId === top.source, [rollEffect]);
}

/**
 * Resolve a queued `riddling-guess` resolution (Riddling Talk, td-148),
 * following a successful riddling roll. The player names a card; the
 * opponent's hand is revealed (recorded in `GameState.revealedInstances`).
 * If a card with the named definition name is found there, the attack is
 * cancelled and the company hazard limit is decreased by
 * `hazardLimitReduction`. Otherwise the attack proceeds normally.
 */
export function applyRiddlingGuessResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'riddling-guess', 'riddling-guess');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const { hazardLimitReduction } = kind;

  const actorIndex = getPlayerIndex(state, action.player);
  const opponentIndex = actorIndex === 0 ? 1 : 0;
  const opponent = state.players[opponentIndex];

  const handInstances = opponent.hand.map(c => toCardInstance(c));
  let next = revealInstances(state, handInstances);

  const found = opponent.hand.some(c => defById(state, c.definitionId)?.name === action.guessedCardName);

  logDetail(`Riddling guess "${action.guessedCardName}": opponent hand revealed — ${found ? 'FOUND' : 'not found'}`);

  next = dequeueResolution(next, top.id);

  if (found) {
    logDetail(`Riddling guess succeeded: cancelling attack and reducing hazard limit by ${hazardLimitReduction}`);
    next = resolveCancelAttackEntry(next);

    if (next.phaseState.phase === Phase.MovementHazard) {
      const mh = next.phaseState;
      const current = mh.hazardLimitAtReveal;
      next = {
        ...next,
        phaseState: {
          ...mh,
          hazardLimitAtReveal: Math.max(0, current - hazardLimitReduction),
        },
      };
      logDetail(`Riddling guess: hazard limit reduced from ${current} to ${next.phaseState.phase === Phase.MovementHazard ? (next.phaseState).hazardLimitAtReveal : '?'}`);
    }
  } else {
    logDetail(`Riddling guess failed: combat continues`);
  }

  return resolveChainEntryAndContinue(next, e => e.card?.instanceId === top.source, []);
}

/**
 * Resolve a queued `goodwill-attempt` resolution (Token of Goodwill, dm-160).
 * The player picks a company item of the queued rank; it is discarded and
 * the defending diplomat rolls 2d6 + unused DI in the same action (CRF 22:
 * the discard is the cost that enables the roll, paid regardless of the
 * outcome). Success (total > threshold) cancels the attack and offers to
 * fetch one resource card from the play deck or discard pile into hand.
 */
export function applyGoodwillAttemptResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, action, top, 'goodwill-attempt', 'goodwill-attempt');
  if (!g.ok) return g.result;
  if (action.type !== 'goodwill-attempt') return { state, error: 'Pending goodwill-attempt requires goodwill-attempt action' };
  const { actorIndex, player, kind } = g;
  const { characterInstanceId, companyId, itemSubtype, threshold } = kind;

  const charInPlay = player.characters[characterInstanceId];
  const company = charInPlay ? companyById(player.companies, companyId) : null;
  const { itemInstanceId } = action;
  if (!charInPlay || !company || !itemInstanceId) {
    // The diplomat left play, the company disbanded, or no qualifying item
    // remained to pay the cost (the emitter offers a cost-less fizzle action
    // without `itemInstanceId` in that case) — the attempt fails without a
    // roll, and the originating chain entry is resolved so the chain resumes.
    logDetail(`Goodwill attempt: character/company/item no longer available — the attempt fails with no further effect`);
    const fizzled = dequeueResolution(state, top.id);
    return resolveChainEntryAndContinue(fizzled, e => e.card?.instanceId === top.source, []);
  }
  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : String(characterInstanceId);
  let bearerCharId: CardInstanceId | null = null;
  let removedItem: CardInstance | null = null;
  for (const charId of company.characters) {
    const bearer = player.characters[charId];
    if (!bearer) continue;
    const found = bearer.items.find(it => it.instanceId === itemInstanceId);
    if (found) {
      bearerCharId = charId;
      removedItem = toCardInstance(found);
      break;
    }
  }
  const itemDef = removedItem ? defById(state, removedItem.definitionId) : undefined;
  if (!bearerCharId || !removedItem || !itemDef || !isItemCard(itemDef) || itemDef.subtype !== itemSubtype) {
    return { state, error: `Goodwill-attempt: item ${itemInstanceId as string} of subtype "${itemSubtype}" not found in company ${companyId as string}` };
  }
  const itemName = itemDef.name;

  const unusedDI = availableDI(state, characterInstanceId, player);

  const { roll, rollEffect, state: rolledState } = rollDiceForPlayer(state, actorIndex, `Goodwill attempt: ${charName}`);
  const total = roll.die1 + roll.die2 + unusedDI;
  const success = total > threshold;

  logDetail(`Goodwill attempt by ${charName}: discarded "${itemName}" (${itemSubtype}), rolled ${roll.die1}+${roll.die2} + DI ${unusedDI} = ${total} vs threshold ${threshold} → ${success ? 'SUCCESS' : 'FAILURE'}`);

  // Discard the item regardless of the roll's outcome — the discard is the
  // cost that enables the roll (CRF 22 erratum), not a reward for success.
  const discardedItem = removedItem;
  const itemBearerId = bearerCharId;
  const stateAfterDiscard = updatePlayer(rolledState, actorIndex, p => {
    const bearer = p.characters[itemBearerId];
    return {
      ...p,
      characters: {
        ...p.characters,
        [itemBearerId]: { ...bearer, items: bearer.items.filter(it => it.instanceId !== itemInstanceId) },
      },
      discardPile: [...p.discardPile, discardedItem],
    };
  });

  let postRoll = dequeueResolution(stateAfterDiscard, top.id);

  if (success && top.source) {
    logDetail(`Goodwill attempt succeeded: cancelling attack`);
    postRoll = resolveCancelAttackEntry(postRoll);

    const fetchEffect = gateDeckSearchFetch(postRoll, player.id, {
      type: 'fetch-to-deck',
      source: ['deck', 'discard-pile'],
      filter: { cardType: { $in: ['hero-resource-item', 'hero-resource-ally', 'hero-resource-faction', 'hero-resource-event'] } },
      count: 1,
      shuffle: true,
      to: 'hand',
    });
    if (fetchEffect) {
      logDetail(`Goodwill attempt: offering play-deck/discard-pile resource fetch to ${player.name}`);
      postRoll = {
        ...postRoll,
        pendingEffects: [
          ...postRoll.pendingEffects,
          {
            type: 'card-effect',
            cardInstanceId: top.source,
            actor: player.id,
            effect: fetchEffect,
            skipDiscard: true,
          },
        ],
      };
    }
  } else if (success) {
    logDetail(`Goodwill attempt succeeded: cancelling attack (no source card — resource fetch skipped)`);
    postRoll = resolveCancelAttackEntry(postRoll);
  } else {
    logDetail(`Goodwill attempt failed: combat continues`);
  }

  // The goodwill-attempt resolution paused the chain (needsInput) without
  // marking the originating Token of Goodwill entry resolved — mirror the
  // flattery-attempt path so the chain actually resumes instead of being
  // left stuck in 'resolving' mode with no legal actions for either player.
  return resolveChainEntryAndContinue(postRoll, e => e.card?.instanceId === top.source, [rollEffect]);
}

/**
 * Return a character to the player's hand, discarding all attached cards.
 * Items, allies, and hazards are discarded to their respective owners'
 * discard piles. Followers fall to GI if room, otherwise are discarded.
 *
 * Two callers: the `return-character-to-hand` dice-check branch (Call of Home
 * and friends) and the CoE 3.47 influence overflow, which sends a character
 * brought into play during the just-ended organization phase back to hand
 * rather than to the discard pile.
 */
export function returnCharacterToHand(
  state: GameState,
  playerIndex: number,
  characterId: import('../index.js').CardInstanceId,
  charInPlay: import('../index.js').CharacterInPlay,
  allowItemTransfer = false,
  sourceInstanceId: import('../index.js').CardInstanceId | null = null,
): GameState {
  // Tookish Blood (tw-104) resource mode: a character protected this turn
  // "cannot be … returned to its owner's hand for any reason" — fizzle.
  if (isCharacterRemovalProtected(state, characterId)) {
    logDetail(`return-character-to-hand: ${characterId as string} is removal-protected this turn (Tookish Blood) — no-op`);
    return state;
  }

  const newPlayers = clonePlayers(state);
  const player = newPlayers[playerIndex];
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  const opponent = newPlayers[opponentIndex];
  const newDiscard = [...player.discardPile];
  const newOpponentDiscard = [...opponent.discardPile];

  // Discard items to owning player's discard pile
  for (const item of charInPlay.items) {
    newDiscard.push(toCardInstance(item));
    logDetail(`return-character-to-hand: discarding item ${item.definitionId as string} from returned character`);
  }

  // Discard allies
  for (const ally of charInPlay.allies) {
    newDiscard.push(toCardInstance(ally));
    logDetail(`return-character-to-hand: discarding ally ${ally.definitionId as string} from returned character`);
  }

  // Discard hazards (back to hazard player = opponent)
  for (const hazard of charInPlay.hazards) {
    newOpponentDiscard.push(toCardInstance(hazard));
    logDetail(`return-character-to-hand: discarding hazard ${hazard.definitionId as string} from returned character`);
  }

  // Handle followers — revert to general influence, deferred (CoE 2.II.2.2.3)
  const newCharacters = { ...player.characters };
  freeOrDiscardFollowers(state, newCharacters, charInPlay, 'return-character-to-hand');

  // A trophy cannot return to hand with its bearer (CoE 3.IV.1 — a trophy
  // "cannot be transferred"); it is discarded per CoE 3.IV.4 — worth MP → the
  // holder's marshalling-point pile, otherwise removed from play — or the
  // creature CardInstance would vanish with the returned character.
  const { toKillPile: retTrophyKill, toOutOfPlay: retTrophyOop } =
    partitionLeavingTrophies(state, charInPlay, 'return-character-to-hand');

  // Remove the target character from characters map
  delete newCharacters[characterId];

  const affectedCompanies = player.companies
    .filter(c => c.characters.includes(characterId))
    .map(c => c.id);

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
    killPile: [...player.killPile, ...retTrophyKill],
    outOfPlayPile: [...player.outOfPlayPile, ...retTrophyOop],
  };
  newPlayers[opponentIndex] = { ...opponent, discardPile: newOpponentDiscard };

  const removedDef = defById(state, charInPlay.definitionId);
  const removedIsLeader = !!(removedDef && isCharacterCard(removedDef) && (removedDef.keywords ?? []).includes('leader'));

  let result: GameState = { ...state, players: newPlayers };
  result = cleanupEmptyCompanies(result);
  result = sweepCompanyMembershipChangedEvents(result, affectedCompanies);
  if (removedIsLeader) {
    logDetail(`return-character-to-hand: removed character is a Leader — sweeping leader-leaves-company events`);
    result = sweepLeaderLeavesCompanyEvents(result, affectedCompanies);
  }

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
 * A return to the owner's *hand* is a distinct path — see
 * {@link returnCharacterToHand}.
 */
function discardCharacter(
  state: GameState,
  playerIndex: number,
  characterId: import('../index.js').CardInstanceId,
  charInPlay: import('../index.js').CharacterInPlay,
  characterDestination: 'discard' | 'out-of-play' = 'discard',
): GameState {
  // Tookish Blood (tw-104) resource mode: a protected character "cannot be
  // discarded … for any reason" this turn. Only the discard path is guarded —
  // an elimination (out-of-play) is a distinct removal and is untouched.
  if (characterDestination === 'discard' && isCharacterRemovalProtected(state, characterId)) {
    logDetail(`discard-character: ${characterId as string} is removal-protected this turn (Tookish Blood) — no-op`);
    return state;
  }

  // Press-gang (ba-22): a character that would otherwise be *discarded* from
  // play is instead held off to the side by an opponent's Press-gang. Only the
  // discard path is intercepted — an elimination (out-of-play) is untouched.
  if (characterDestination === 'discard') {
    const host = findCapturingPressGang(state, playerIndex);
    if (host) return capturePressGang(state, playerIndex, characterId, host);
  }

  // Pallando the Soul-keeper (as-17): a character that would be discarded from
  // play is instead *eliminated* — only the character card's destination
  // changes; its possessions and followers are dispersed exactly as before.
  let destination = characterDestination;
  const elimHost = destination === 'discard'
    ? findEliminateInsteadOfDiscardHost(state, defById(state, charInPlay.definitionId))
    : null;
  if (elimHost) destination = 'out-of-play';

  const newPlayers = clonePlayers(state);
  const player = newPlayers[playerIndex];
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  const opponent = newPlayers[opponentIndex];
  const newDiscard = [...player.discardPile];
  const newHand = [...player.hand];
  const newOpponentDiscard = [...opponent.discardPile];

  for (const item of charInPlay.items) {
    newDiscard.push(toCardInstance(item));
  }
  // An ally that "may return to hand … if its controlling character leaves
  // active play" (Radagast's Black Bird wh-114) goes to its owner's hand
  // instead of the discard pile.
  {
    const { toHand, toDiscard } = partitionLeavingAllies(state, charInPlay.allies);
    newHand.push(...toHand);
    newDiscard.push(...toDiscard);
  }
  for (const hazard of charInPlay.hazards) {
    newOpponentDiscard.push(toCardInstance(hazard));
  }

  const newCharacters = { ...player.characters };
  freeOrDiscardFollowers(state, newCharacters, charInPlay, 'discard-character');

  // Relocate trophies per CoE 3.IV.4 — worth MP → the holder's marshalling-
  // point pile, otherwise removed from play — or the creature CardInstance
  // would vanish with the deleted character.
  const { toKillPile: trophiesToKillPile, toOutOfPlay: trophiesToOutOfPlay } =
    partitionLeavingTrophies(state, charInPlay, 'discard-character');

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
  const newOutOfPlay = destination === 'out-of-play'
    ? [...player.outOfPlayPile, ...trophiesToOutOfPlay, toCardInstance(charInPlay)]
    : [...player.outOfPlayPile, ...trophiesToOutOfPlay];
  if (destination === 'discard') {
    newDiscard.push(toCardInstance(charInPlay));
  }

  newPlayers[playerIndex] = {
    ...player,
    characters: newCharacters,
    companies: newCompanies,
    hand: newHand,
    discardPile: newDiscard,
    outOfPlayPile: newOutOfPlay,
    killPile: [...player.killPile, ...trophiesToKillPile],
  };
  newPlayers[opponentIndex] = { ...opponent, discardPile: newOpponentDiscard };

  const removedDef = defById(state, charInPlay.definitionId);
  const removedIsLeader = !!(removedDef && isCharacterCard(removedDef) && (removedDef.keywords ?? []).includes('leader'));

  let result: GameState = { ...state, players: newPlayers };
  if (elimHost) result = consumeEliminateInsteadOfDiscardHost(result, elimHost);
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
 * Discard a character to their owner's discard pile (recyclable), sending its
 * possessions to the discard pile and freeing its followers to general
 * influence. Thin wrapper over {@link discardCharacter} with the default
 * discard destination. Used by Urlurtsu Nurn (le-409)'s end-of-M/H sweep for a
 * reanimated character that failed to move to a different site than the
 * Ringwraith.
 */
export function discardCharacterToDiscardPile(
  state: GameState,
  playerIndex: number,
  characterId: import('../index.js').CardInstanceId,
  charInPlay: import('../index.js').CharacterInPlay,
): GameState {
  return discardCharacter(state, playerIndex, characterId, charInPlay, 'discard');
}

/**
 * Resolve one step of an `influence-overflow-discard` resolution (CoE 3.47):
 * the active player, having left their organization phase over their general
 * influence, removes one non-avatar character from play.
 *
 * The chosen character must be in the tier {@link influenceOverflowStep}
 * currently offers — the rule prescribes the order, so the player's freedom is
 * limited to picking within the highest-priority tier that still has a member.
 * A tier-1 character (brought into play during the phase that just ended) goes
 * back to hand; every other one is discarded.
 *
 * The resolution stays queued while an overflow remains and something removable
 * is left; it clears the moment the player is back within their pool, or when
 * only avatars and influence-free characters remain (an overflow the rule
 * cannot resolve must not deadlock the queue).
 */
export function applyInfluenceOverflowDiscardResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'influence-overflow-discard', 'influence-overflow-discard');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const actorIndex = state.players.findIndex(p => p.id === action.player);
  if (actorIndex < 0) return { state, error: 'Player not found for influence-overflow-discard' };

  const { playedThisTurnIds, uncontrolledIds } = kind;
  const step = influenceOverflowStep(state, action.player, playedThisTurnIds, uncontrolledIds);
  if (!step) return { state: dequeueResolution(state, top.id) };
  if (!step.candidateIds.includes(action.characterInstanceId)) {
    return { state, error: `Character ${action.characterInstanceId as string} is not removable at the '${step.tier}' step of the influence overflow` };
  }
  const charInPlay = state.players[actorIndex].characters[action.characterInstanceId];
  if (!charInPlay) return { state, error: `Character ${action.characterInstanceId as string} is not in play` };

  const charName = cardName(state, charInPlay.definitionId);
  logDetail(`Influence overflow: ${state.players[actorIndex].name} removes "${charName}" (${step.tier}) → ${step.destination} (CoE 3.47)`);
  const removed = step.destination === 'hand'
    ? returnCharacterToHand(state, actorIndex, action.characterInstanceId, charInPlay)
    : discardCharacterToDiscardPile(state, actorIndex, action.characterInstanceId, charInPlay);
  const after = recomputeDerived(removed);

  const next = influenceOverflowStep(after, action.player, playedThisTurnIds, uncontrolledIds);
  if (next) {
    logDetail(`Influence overflow: still ${influenceOverflowAmount(after, action.player)} over general influence — ${next.candidateIds.length} candidate(s) at the '${next.tier}' step`);
    return { state: after };
  }
  return { state: dequeueResolution(after, top.id) };
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
  const g = guardResolution(state, action, top, 'seized-by-terror-roll', 'seized-by-terror-roll');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const { targetCharacterId, threshold, originSiteInstanceId } = kind;
  const charInPlay = player.characters[targetCharacterId];
  if (!charInPlay) {
    // The target left play before the roll — nothing to seize. Resolve the
    // source chain entry so the chain resumes instead of erroring out (an
    // error result is a rejection: the dequeue would never commit and the
    // game would deadlock on the unresolvable pending roll).
    logDetail(`Seized by Terror: target character no longer in play — no effect`);
    return resolveChainEntryAndContinue(
      dequeueResolution(state, top.id),
      e => e.payload.type === 'short-event' && e.payload.targetCharacterId === targetCharacterId,
      [],
    );
  }

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : (targetCharacterId as string);
  const mind = printedMind(charDef);

  const rolled = rollDiceForPlayer(state, actorIndex, `Seized by Terror: ${charName}`);
  const checkValue = rolled.total + mind;
  const passed = checkValue >= threshold;
  logDetail(`Seized by Terror on ${charName}: rolled ${rolled.total} + mind ${mind} = ${checkValue} vs threshold ${threshold} → ${passed ? 'STAYS' : 'SPLITS OFF TO ORIGIN'}`);

  let postRoll = dequeueResolution(rolled.state, top.id);

  if (!passed) {
    postRoll = splitCharacterToOrigin(postRoll, actorIndex, targetCharacterId, originSiteInstanceId, top.source, kind.hazardDefinitionId);
  }

  return resolveChainEntryAndContinue(
    postRoll,
    e => e.payload.type === 'short-event' && e.payload.targetCharacterId === targetCharacterId,
    [rolled.rollEffect],
  );
}

/**
 * Resolve one roll of a queued `company-tap-roll` resolution (Heedless
 * Revelry le-114). The company's controller rolls 2d6 for the head of the
 * `remaining` list; if roll + modifier is strictly greater than the
 * character's effective mind, the character becomes tapped. With characters
 * still left to roll, the resolution is requeued minus the rolled character;
 * after the last roll the source chain entry resolves and the chain
 * continues.
 */
export function applyCompanyTapRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, action, top, 'company-tap-roll', 'company-tap-roll');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const next = kind.remaining[0];
  if (!next || action.type !== 'company-tap-roll' || action.targetCharacterId !== next.characterId) {
    return { state, error: 'company-tap-roll: action does not match the next character to roll' };
  }

  const charInPlay = player.characters[next.characterId];
  if (!charInPlay) {
    // The next roller left play (e.g. eliminated by an earlier resolution of
    // the same hazard chain) — skip their roll and advance to the rest of the
    // list, or resolve the source chain entry if they were the last. An error
    // result here would be a rejection and deadlock the pending queue.
    logDetail(`${defById(state, kind.hazardDefinitionId)?.name ?? '?'}: character no longer in play — skipping their roll`);
    const skippedRest = kind.remaining.slice(1);
    const dequeued = dequeueResolution(state, top.id);
    if (skippedRest.length > 0) {
      return {
        state: enqueueResolution(dequeued, {
          source: top.source,
          actor: top.actor,
          scope: top.scope,
          kind: { ...kind, remaining: skippedRest },
        }),
      };
    }
    return resolveChainEntryAndContinue(
      dequeued,
      e => e.payload.type === 'short-event' && e.card?.instanceId === top.source,
      [],
    );
  }
  const charDef = defById(state, charInPlay.definitionId);
  const charName = charDef?.name ?? (next.characterId as string);
  const mind = charDef && isCharacterCard(charDef)
    ? (charInPlay.effectiveStats.mind ?? charDef.mind ?? 0)
    : 0;
  const hazardName = defById(state, kind.hazardDefinitionId)?.name ?? '?';

  const rolled = rollDiceForPlayer(state, actorIndex, `${hazardName}: ${charName}`);
  const total = rolled.total + next.modifier;
  const taps = total > mind && charInPlay.status === CardStatus.Untapped;
  logDetail(`${hazardName} on ${charName}: rolled ${rolled.total}${next.modifier !== 0 ? ` ${next.modifier > 0 ? '+' : ''}${next.modifier}` : ''} = ${total} vs mind ${mind} → ${taps ? 'TAPPED' : 'stays untapped'}`);

  let postRoll = rolled.state;
  if (taps) {
    postRoll = updatePlayer(postRoll, actorIndex, p =>
      updateCharacter(p, next.characterId, c => ({ ...c, status: CardStatus.Tapped })),
    );
  }

  const rest = kind.remaining.slice(1);
  postRoll = dequeueResolution(postRoll, top.id);
  if (rest.length > 0) {
    // More characters to roll — requeue with the rolled character removed.
    return {
      state: enqueueResolution(postRoll, {
        source: top.source,
        actor: top.actor,
        scope: top.scope,
        kind: { ...kind, remaining: rest },
      }),
      effects: [rolled.rollEffect],
    };
  }

  // Last roll — resolve the source chain entry and continue the chain.
  return resolveChainEntryAndContinue(
    postRoll,
    e => e.payload.type === 'short-event' && e.card?.instanceId === top.source,
    [rolled.rollEffect],
  );
}

/**
 * Apply one {@link OpposedRollOutcome} of a resolved opposed-roll contest.
 *
 * `discard-attached` routes every matching hazard permanent-event on the named
 * roller to its **owner's** discard pile, reusing the shared `move` primitive's
 * `hazards-on-target` locator (the same path The Sun Unveiled as-56 takes).
 *
 * `stat-modifier` installs an `until-cleared` `character-stat-modifier`
 * constraint on the named roller, flagged `requiresSourceBorne` so the bonus
 * lasts exactly as long as the source card stays attached to that character.
 */
function applyOpposedRollOutcome(
  state: GameState,
  outcome: import('../types/effects.js').OpposedRollOutcome,
  ctx: {
    readonly sourceInstanceId: CardInstanceId;
    readonly sourceDefinitionId: import('../types/common.js').CardDefinitionId;
    readonly sourcePlayerIndex: number;
    readonly challengerId: CardInstanceId;
    readonly opponentId: CardInstanceId;
    readonly label: string;
  },
): GameState {
  const targetId = outcome.on === 'challenger' ? ctx.challengerId : ctx.opponentId;
  if (outcome.type === 'discard-attached') {
    const moveEffect: import('../types/effects.js').MoveEffect = {
      type: 'move',
      select: 'filter-all',
      from: 'hazards-on-target',
      to: 'discard',
      toOwner: 'source-owner',
      ...(outcome.filter ? { filter: outcome.filter } : {}),
    };
    const moveCtx: MoveContext = {
      sourceCardId: ctx.sourceInstanceId,
      sourcePlayerIndex: ctx.sourcePlayerIndex,
      targetCharacterId: targetId,
    };
    logDetail(`${ctx.label}: discarding matching attached hazards on ${resolveDef(state, targetId)?.name ?? (targetId as string)}`);
    const r = applyMove(state, moveEffect, moveCtx);
    if ('error' in r) {
      logDetail(`${ctx.label}: discard-attached failed (${r.error}) — no cards removed`);
      return state;
    }
    return r.state;
  }
  logDetail(
    `${ctx.label}: ${resolveDef(state, targetId)?.name ?? (targetId as string)} receives `
    + `${formatSignedNumber(outcome.value)} ${outcome.stat} while the card stays attached`,
  );
  return addConstraint(state, {
    source: ctx.sourceInstanceId,
    sourceDefinitionId: ctx.sourceDefinitionId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'character', characterId: targetId },
    kind: {
      type: 'character-stat-modifier',
      stat: outcome.stat,
      value: outcome.value,
      characterId: targetId,
      requiresSourceBorne: true,
    },
  });
}

/**
 * Resolve one roll of a queued `opposed-roll` resolution (No More Nonsense
 * le-210). The challenger rolls first — their total is stored on the requeued
 * resolution. On the opponent's roll both totals get their `addStat` added and
 * are compared; the source card's `onWin` (challenger's total beats the
 * opponent's) or `onLose` outcomes are then applied and the resolution is
 * dequeued.
 *
 * A roller who has left play since the card was played forfeits: the contest is
 * dropped with no outcome rather than resolving against a missing character.
 */
export function applyOpposedRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  // A pass abandons the contest, but ONLY while a roller has left play (the
  // stale case the legal-action emitter offers the pass for) — with both
  // rollers present the opposed roll is mandatory.
  if (top.kind.type === 'opposed-roll' && action.type === 'pass' && action.player === top.actor) {
    const passPlayer = state.players[getPlayerIndex(state, action.player)];
    if (!passPlayer.characters[top.kind.challengerId] || !passPlayer.characters[top.kind.opponentId]) {
      logDetail(`${defById(state, top.kind.sourceDefinitionId)?.name ?? '?'}: a roller has left play — opposed roll abandoned`);
      return { state: dequeueResolution(state, top.id) };
    }
    return { state, error: 'opposed-roll: both rollers are in play — the roll must be made' };
  }
  const g = guardResolution(state, action, top, 'opposed-roll', 'opposed-roll');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const rolling = kind.challengerRoll === undefined ? kind.challengerId : kind.opponentId;
  if (action.type !== 'opposed-roll' || action.characterId !== rolling) {
    return { state, error: 'opposed-roll: action does not match the character due to roll' };
  }
  const sourceName = defById(state, kind.sourceDefinitionId)?.name ?? '?';
  if (!player.characters[kind.challengerId] || !player.characters[kind.opponentId]) {
    logDetail(`${sourceName}: a roller has left play — opposed roll abandoned`);
    return { state: dequeueResolution(state, top.id) };
  }

  const rollerName = resolveDef(state, rolling)?.name ?? (rolling as string);
  const rolled = rollDiceForPlayer(state, actorIndex, `${sourceName}: ${rollerName}`);
  let next = rolled.state;

  // First roll — record the challenger's total and requeue for the opponent.
  if (kind.challengerRoll === undefined) {
    logDetail(`${sourceName}: ${rollerName} (challenger) rolled ${rolled.total}`);
    next = dequeueResolution(next, top.id);
    return {
      state: enqueueResolution(next, {
        source: top.source,
        actor: top.actor,
        scope: top.scope,
        kind: { ...kind, challengerRoll: rolled.total },
      }),
      effects: [rolled.rollEffect],
    };
  }

  // Second roll — compare and apply the outcome branch.
  const challengerStat = opposedRollStat(next, next.players[actorIndex], kind.challengerId, kind.addStat);
  const opponentStat = opposedRollStat(next, next.players[actorIndex], kind.opponentId, kind.addStat);
  const challengerTotal = kind.challengerRoll + challengerStat;
  const opponentTotal = rolled.total + opponentStat;
  const won = kind.comparison === 'gte' ? challengerTotal >= opponentTotal : challengerTotal > opponentTotal;
  logDetail(
    `${sourceName}: ${resolveDef(next, kind.challengerId)?.name ?? '?'} ${kind.challengerRoll}+${challengerStat}=${challengerTotal} `
    + `vs ${rollerName} ${rolled.total}+${opponentStat}=${opponentTotal} → challenger ${won ? 'WINS' : 'LOSES'}`,
  );

  const sourceDef = defById(next, kind.sourceDefinitionId);
  const effect = getCardEffects(sourceDef).find(
    (e): e is import('../types/effects.js').OpposedRollEffect => e.type === 'opposed-roll',
  );
  const outcomes = (won ? effect?.onWin : effect?.onLose) ?? [];
  for (const outcome of outcomes) {
    next = applyOpposedRollOutcome(next, outcome, {
      sourceInstanceId: kind.sourceInstanceId,
      sourceDefinitionId: kind.sourceDefinitionId,
      sourcePlayerIndex: actorIndex,
      challengerId: kind.challengerId,
      opponentId: kind.opponentId,
      label: sourceName,
    });
  }

  return { state: dequeueResolution(next, top.id), effects: [rolled.rollEffect] };
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
  hazardSource: import('../index.js').CardInstanceId | null,
  hazardDefinitionId: import('../index.js').CardDefinitionId,
): GameState {
  const initialPlayer = state.players[playerIndex];
  const initialCompanyIndex = initialPlayer.companies.findIndex(c =>
    c.characters.some(id => id === characterId),
  );
  if (initialCompanyIndex < 0) return state;

  if (initialPlayer.companies[initialCompanyIndex].characters.length <= 1) {
    // Character is alone — whole company returns to origin. The planned
    // destination was physically drawn out of the site deck by
    // `plan-movement`, so it must go back there, not just be nulled out —
    // `clearPlannedMovement` returns it (unless a sibling company still
    // holds the same instance) exactly as the cancel-movement action does.
    logDetail(`Seized by Terror: ${characterId as string} is alone — company returns to site of origin`);
    return clearPlannedMovement(state, playerIndex, initialPlayer.companies[initialCompanyIndex].id);
  }

  const newPlayers = clonePlayers(state);
  const player = newPlayers[playerIndex];
  const sourceCompanyIndex = initialCompanyIndex;
  const sourceCompany = player.companies[sourceCompanyIndex];

  // Find the origin site in play. When it has to be taken from the site
  // deck, remove it from the deck — leaving it there while also placing it
  // as the new company's current site would duplicate the instance.
  let originSite: import('../index.js').SiteInPlay | null = sourceCompany.currentSite;
  let newSiteDeck = player.siteDeck;
  if (sourceCompany.currentSite?.instanceId !== originSiteInstanceId) {
    const deckEntry = findById(player.siteDeck, originSiteInstanceId);
    if (deckEntry) {
      originSite = { instanceId: deckEntry.instanceId, definitionId: deckEntry.definitionId, status: CardStatus.Untapped };
      newSiteDeck = removeById(player.siteDeck, originSiteInstanceId);
    }
  }

  const updatedCompanies = [...player.companies];

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

  newPlayers[playerIndex] = { ...player, companies: updatedCompanies, siteDeck: newSiteDeck };
  let result: GameState = { ...state, players: newPlayers };
  result = cleanupEmptyCompanies(result);

  // Rule 2.IV.4: a company "returned to its site of origin" during the
  // movement/hazard phase has its M/H phase end immediately — no more
  // actions (including hazards) can be taken against it — and its player
  // "cannot initiate any actions during that company's site phase" either.
  // The split-off company is born already in that state (ICE Rules Digest
  // #86: its M/H phase never starts), so mark it handled before
  // `select-company` can ever offer it this phase, and block its upcoming
  // site phase the same way `company-return-to-origin` cards do.
  if (result.phaseState.phase === Phase.MovementHazard) {
    result = {
      ...result,
      phaseState: {
        ...result.phaseState,
        handledCompanyIds: [...result.phaseState.handledCompanyIds, newCompany.id],
      },
    };
  }
  if (hazardSource) {
    result = addConstraint(result, {
      source: hazardSource,
      sourceDefinitionId: hazardDefinitionId,
      scope: { kind: 'company-site-phase', companyId: newCompany.id },
      target: { kind: 'company', companyId: newCompany.id },
      kind: { type: 'site-phase-do-nothing' },
    });
  }
  return result;
}

/**
 * Resolve a queued `gold-ring-test` resolution (Rule 9.21 / 9.22).
 *
 * The ring's owner rolls 2d6 and the test's roll modifier (plus company
 * check-modifiers and the MEWH §10 Fallen-wizard penalty) is applied. A test
 * with `rollCount > 1` (Wizard's Test tw-365: "make two rolls and choose one
 * result to use for the test") stays queued, in place, accumulating one total
 * per roll; once every roll is in, the player resolves it with a
 * `choose-gold-ring-test-roll` action naming the total to use. Single-roll
 * tests — every other producer — finalize on their one roll.
 *
 * Finalization ({@link finalizeGoldRingTest}) discards the gold-ring item
 * regardless of the result and enqueues a `ring-play-offer` so the player may
 * play a matching special ring.
 */
export function applyGoldRingTestResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'gold-ring-test') return null;
  const rolledTotals = top.kind.rolledTotals ?? [];

  // Multi-roll variant: the player picks which of the rolled totals is used.
  if (action.type === 'choose-gold-ring-test-roll') {
    if (action.player !== top.actor) {
      return { state, error: 'Wrong player for pending gold-ring-test' };
    }
    if (!rolledTotals.includes(action.rollTotal)) {
      return { state, error: `Pending gold-ring-test: ${action.rollTotal} is not one of the rolled totals (${rolledTotals.join(', ')})` };
    }
    logDetail(`Gold-ring test: player chose ${action.rollTotal} from rolls (${rolledTotals.join(', ')})`);
    return finalizeGoldRingTest(state, getPlayerIndex(state, action.player), top, top.kind, action.rollTotal, []);
  }

  const g = guardResolution(state, action, top, 'gold-ring-test-roll', 'gold-ring-test');
  if (!g.ok) return g.result;
  const { actorIndex, player, kind } = g;
  const { goldRingInstanceId, rollModifier, characterInstanceId } = kind;
  const rollCount = kind.rollCount ?? 1;

  const ringCardForRoll = findTestedGoldRing(player, goldRingInstanceId);
  if (!ringCardForRoll) {
    return { state: dequeueResolution(state, top.id), error: 'Gold ring not found in out-of-play pile or character items' };
  }
  const ringDefForRoll = defById(state, ringCardForRoll.definitionId);
  const ringNameForRoll = ringDefForRoll?.name ?? (ringCardForRoll.definitionId as string);

  // Check-modifier effects (e.g. Scroll of Isildur) from every character in the
  // company bearing the ring. The ring under test is excluded from the sweep —
  // a ring may not modify its own test.
  const itemCheckModifier = goldRingTestCompanyModifier(
    state, actorIndex, characterInstanceId, goldRingInstanceId,
  );

  // MEWH §10: "Whenever a Fallen-wizard player tests a hero gold ring item, the
  // roll is modified by -1." A hero gold ring is a `hero-resource-item`; minion
  // gold rings are unaffected.
  const fwGoldRingModifier = player.alignment === 'fallen-wizard'
    && ringDefForRoll !== undefined && 'cardType' in ringDefForRoll
    && (ringDefForRoll as { cardType?: string }).cardType === 'hero-resource-item'
    ? -1 : 0;
  if (fwGoldRingModifier !== 0) {
    logDetail(`Gold-ring test: Fallen-wizard testing a hero gold ring — applying ${formatSignedNumber(fwGoldRingModifier)} (MEWH §10)`);
  }

  const rolled = rollDiceForPlayer(state, actorIndex, `Gold-ring test: ${ringNameForRoll}`);
  const total = rolled.total + rollModifier + itemCheckModifier + fwGoldRingModifier;
  const rollLabel = rollCount > 1 ? ` (roll ${rolledTotals.length + 1} of ${rollCount})` : '';
  logDetail(`Gold-ring test: ${ringNameForRoll}${rollLabel} — rolled ${rolled.roll.die1} + ${rolled.roll.die2} ${formatSignedNumber(rollModifier)}${itemCheckModifier !== 0 ? ` item ${formatSignedNumber(itemCheckModifier)}` : ''}${fwGoldRingModifier !== 0 ? ` fw ${formatSignedNumber(fwGoldRingModifier)}` : ''} = ${total}`);

  // Multi-roll test: record the total and keep the resolution queued (in place,
  // so anything the same card enqueued behind it cannot jump ahead) until the
  // remaining rolls are made and the player chooses between the results.
  if (rollCount > 1) {
    const nextTotals = [...rolledTotals, total];
    logDetail(nextTotals.length < rollCount
      ? `Gold-ring test: ${nextTotals.length} of ${rollCount} rolls made — roll again`
      : `Gold-ring test: rolls complete (${nextTotals.join(', ')}) — choose which result the test uses`);
    return {
      state: replaceResolutionKind(rolled.state, top.id, { ...kind, rolledTotals: nextTotals }),
      effects: [rolled.rollEffect],
    };
  }

  return finalizeGoldRingTest(rolled.state, actorIndex, top, kind, total, [rolled.rollEffect]);
}

/**
 * Locate the gold-ring item under test. Org-phase store-item path: the ring is
 * in `killPile` (the MP pile). Site-phase / event paths: the ring sits in a
 * character's items array.
 */
function findTestedGoldRing(
  player: PlayerState,
  goldRingInstanceId: CardInstanceId,
): CardInstance | CardInPlay | undefined {
  const stored = player.killPile.find(c => c.instanceId === goldRingInstanceId);
  if (stored) return stored;
  for (const char of Object.values(player.characters)) {
    const borne = char.items.find(i => i.instanceId === goldRingInstanceId);
    if (borne) return borne;
  }
  return undefined;
}

/**
 * Sum the `gold-ring-test` {@link resolveCheckModifier} contributions of every
 * character in the ring-bearer's company (e.g. Scroll of Isildur).
 *
 * The ring being tested is dropped from its bearer's items for the sweep: a
 * gold ring may not modify its own test.
 */
function goldRingTestCompanyModifier(
  state: GameState,
  actorIndex: number,
  characterInstanceId: CardInstanceId,
  goldRingInstanceId: CardInstanceId,
): number {
  const player = state.players[actorIndex];
  const company = findCharacterCompany(player.companies, characterInstanceId);
  if (!company) return 0;
  const checkContext = { reason: 'gold-ring-test' };
  let modifier = 0;
  for (const compCharId of company.characters) {
    const compChar = player.characters[compCharId];
    if (!compChar) continue;
    const swept = compChar.items.some(i => i.instanceId === goldRingInstanceId)
      ? { ...compChar, items: compChar.items.filter(i => i.instanceId !== goldRingInstanceId) }
      : compChar;
    modifier += resolveCheckModifier(collectCharacterEffects(state, swept, checkContext), 'gold-ring-test');
  }
  if (modifier !== 0) {
    logDetail(`Gold-ring test: item modifiers from company: ${formatSignedNumber(modifier)}`);
  }
  return modifier;
}

/**
 * Apply the outcome of a gold-ring test once its final roll total is known:
 * discard the gold ring, map the total to the eligible ring categories through
 * the ring's own `ring-test-table`, and enqueue the `ring-play-offer` (plus, if
 * a Leaf Brooch-style `discard-substitute` covers the ring, the substitution
 * offer behind it).
 *
 * Shared by the single-roll path and the `choose-gold-ring-test-roll` path, so
 * both produce identical consequences for the same total.
 */
function finalizeGoldRingTest(
  state: GameState,
  actorIndex: number,
  top: PendingResolution,
  kind: Extract<PendingResolution['kind'], { readonly type: 'gold-ring-test' }>,
  total: number,
  effects: readonly GameEffect[],
): ReducerResult {
  const player = state.players[actorIndex];
  const { goldRingInstanceId, characterInstanceId } = kind;

  // Locate the gold ring. Org-phase store-item path: ring is in killPile (the
  // MP pile). Site-phase auto-test path: ring was just played and sits in a
  // character's items array. Search both locations.
  const ringInKillPile = player.killPile.findIndex(c => c.instanceId === goldRingInstanceId);

  let ringCard: typeof player.killPile[0];
  let stateAfterRing: GameState;
  // True when the ring came from killPile — it was stored at a Darkhaven
  // (Rule 9.22), so the replacement enters play stored rather than attached.
  let storedPlacement: boolean;
  // Character bearing the ring on the site-phase path (undefined when stored):
  // only a ring still borne in a company can be saved by a `discard-substitute`.
  let ringBearerId: CardInstanceId | undefined;

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
    ringBearerId = foundCharId as CardInstanceId;
  }

  const ringDef = defById(state, ringCard.definitionId);
  const ringName = ringDef?.name ?? (ringCard.definitionId as string);
  logDetail(`Gold-ring test: ${ringName} — test resolves on ${total}; ring discarded`);

  // Compute eligible categories from the gold ring's ring-test-table effect.
  const ringEffects: readonly unknown[] = ringDef && 'effects' in ringDef
    ? ((ringDef as unknown as { effects?: readonly unknown[] }).effects ?? [])
    : [];
  const tableEffect = ringEffects.find((e): e is RingTestTableEffect => (e as { type?: string }).type === 'ring-test-table');
  const eligibleCategories = tableEffect ? eligibleRingCategories(tableEffect.table, total) : [];
  logDetail(`Gold-ring test: roll total ${total} — eligible categories: ${eligibleCategories.join(', ') || 'none'}`);

  // Collect search categories from ring-test-search effects (e.g. Gleaming Gold Ring
  // lets the player search deck/discard for a lesser-ring when lesser-ring is eligible).
  const searchEffect = ringEffects.find((e): e is RingTestSearchEffect => (e as { type?: string }).type === 'ring-test-search');
  const searchCategories = (searchEffect && (eligibleCategories as readonly string[]).includes(searchEffect.category))
    ? [searchEffect.category] as const
    : undefined;
  if (searchCategories) {
    logDetail(`Gold-ring test: ring-test-search active — player may search deck/discard for ${searchCategories.join(', ')}`);
  }

  // Leaf Brooch (dm-171), per CRF 22: the tested ring's discard may be replaced
  // by discarding a `discard-substitute` item borne in the ring-bearer's
  // company — "the bearer of the gold ring item gets the special ring item, not
  // the bearer of the Leaf Brooch", so the ring-play offer is unaffected. Only
  // a ring still borne in a company qualifies (a ring stored at a Darkhaven is
  // not "in the company"), and the substitution offer is queued *behind* the
  // ring-play offer so the owner decides knowing what the test produced. Until
  // then the ring stays where it was — `stateAfterRing` (which already moved it
  // to the discard pile) is dropped in that case.
  const ringCompanyId = ringBearerId !== undefined
    ? findCharacterCompany(player.companies, ringBearerId)?.id
    : undefined;
  const ringSubstitutable = ringCompanyId !== undefined
    && findDiscardSubstitutes(state, actorIndex, ringCompanyId, new Set([goldRingInstanceId]))
      .some(s => substituteCovers(s, ringDef));

  const postRoll = dequeueResolution(ringSubstitutable ? state : stateAfterRing, top.id);

  // Always enqueue ring-play-offer so the player can explicitly pass if they
  // hold no eligible rings or choose not to play one.
  const postOffer = enqueueResolution(postRoll, {
    source: goldRingInstanceId,
    actor: top.actor,
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

  if (ringSubstitutable && ringCompanyId) {
    const offered = enqueueDiscardSubstituteOffer(postOffer, {
      source: goldRingInstanceId,
      owner: top.actor,
      scope: top.scope,
      companyId: ringCompanyId,
      requiredInstanceIds: [goldRingInstanceId],
      sourceName: `Gold-ring test (${ringName})`,
    });
    if (offered) return { state: offered, effects: [...effects] };
  }

  return { state: postOffer, effects: [...effects] };
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'play-ring-after-test', 'ring-play-offer',
    'ring-play-offer: player passes — no replacement ring played');
  if (!g.ok) return g.result;
  const { action, kind, actorIndex: playerIndex, player } = g;

  const { characterInstanceId, storedPlacement } = kind;
  const { ringInstanceId, source = 'hand' } = action;

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
  } else if (source === 'set-aside') {
    const cached = player.cardsInPlay.find(c => c.instanceId === ringInstanceId && isSetAsideCard(c));
    if (!cached) {
      return { state, error: `Ring ${ringInstanceId as string} not found in set-aside cache` };
    }
    ringCard = cached;
    stateAfterRemove = removeItemFromSetAside(state, ringInstanceId);
    logDetail(`ring-play-offer: found ${ringCard.definitionId as string} in set-aside cache (Rumours of Rings)`);
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
 * Resolve a queued `named-card-play-offer` resolution (Fury of the Iron
 * Crown, tw-492): the actor either passes (generic `pass` action) or plays
 * the one eligible card from hand (`play-named-card-offer` action) onto a
 * character in the offer's company. The card attaches as an item, the same
 * way {@link applyRingPlayOfferResolution} places a replacement ring.
 */
export function applyNamedCardPlayOfferResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'play-named-card-offer', 'named-card-play-offer',
    'named-card-play-offer: player passes — no card played');
  if (!g.ok) return g.result;
  const { action, actorIndex: playerIndex, player } = g;

  const { cardInstanceId, targetCharacterId } = action;
  const handIdx = player.hand.findIndex(c => c.instanceId === cardInstanceId);
  if (handIdx < 0) {
    return { state, error: `Card ${cardInstanceId as string} not found in hand` };
  }
  const card = player.hand[handIdx];
  const stateAfterRemove = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: p.hand.filter((_, i) => i !== handIdx),
  }));

  const def = defById(state, card.definitionId);
  const cardDefName = def?.name ?? (card.definitionId as string);

  const char = stateAfterRemove.players[playerIndex].characters[targetCharacterId];
  if (!char) {
    return { state, error: `Character ${targetCharacterId as string} not found for named-card-play-offer placement` };
  }
  logDetail(`named-card-play-offer: playing ${cardDefName} (${cardInstanceId as string}) onto ${defById(state, char.definitionId)?.name ?? (targetCharacterId as string)}`);

  const newItem: CharacterInPlay['items'][0] = {
    instanceId: card.instanceId,
    definitionId: card.definitionId,
    status: CardStatus.Untapped,
  };
  const updatedChar: CharacterInPlay = { ...char, items: [...char.items, newItem] };

  const stateAfterPlay = updatePlayer(stateAfterRemove, playerIndex, p => ({
    ...p,
    characters: { ...p.characters, [targetCharacterId as string]: updatedChar },
  }));

  return { state: dequeueResolution(stateAfterPlay, top.id) };
}

/**
 * Resolve a queued `dragon-ambush-offer` resolution (Rumor of Wealth td-58).
 *
 * The hazard player either passes (generic `pass` action — the
 * `dragon-ambush-window` constraint stays armed for a later qualifying item
 * play this same site phase) or plays a Dragon hazard creature straight from
 * hand (`play-dragon-ambush-creature`), which consumes the constraint and
 * initiates a creature combat against the ambushed company directly —
 * bypassing the normal M/H keying pipeline entirely, exactly the way a
 * revealed on-guard creature is initiated during the site phase
 * (`reducer-site.ts`'s resolve-attacks step). Because the combat is started
 * with the 4-argument form of {@link initiateChain}, it never touches
 * `hazardsPlayedThisCompany` — the play does not count against the hazard
 * limit, per the card's text.
 */
export function applyDragonAmbushOfferResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'play-dragon-ambush-creature', 'dragon-ambush-offer',
    'dragon-ambush-offer: hazard player passes — dragon-ambush-window stays armed');
  if (!g.ok) return g.result;
  const { action, kind, player, actorIndex } = g;

  const creatureCard = findById(player.hand, action.cardInstanceId);
  if (!creatureCard) {
    return { state, error: `Dragon creature ${action.cardInstanceId as string} not found in hand` };
  }
  const def = defById(state, creatureCard.definitionId);
  logDetail(`dragon-ambush-offer: playing "${def?.name ?? (creatureCard.definitionId as string)}" against company ${kind.companyId as string} — bypasses hazard limit`);

  let newState = updatePlayer(state, actorIndex, p => ({
    ...p,
    hand: removeById(p.hand, creatureCard.instanceId),
  }));
  newState = removeConstraint(newState, kind.constraintId);
  newState = dequeueResolution(newState, top.id);

  const cardInstance = toCardInstance(creatureCard);
  newState = initiateChain(newState, action.player, cardInstance, { type: 'creature' });

  return { state: newState };
}

/**
 * Handle a `pair-resource-with-cof` organization-phase action.
 *
 * Crown of Flowers (dm-121) sits in play as an environment with no effect
 * until the active player plays one resource "with it". That pairing is a
 * non-blocking organization-phase action (offered by
 * `cofPairResourceActions` in `legal-actions/organization.ts`) rather than a
 * blocking pending resolution — the player may organize freely and pair a
 * resource at any point while an unlinked Crown of Flowers is in play.
 *
 * The paired resource is moved from hand into `cardsInPlay` with
 * `linkedInstanceId` plus the `assumeInPlay` / `assumeNotInPlay` name lists
 * declared by the pairing card's `offer-resource-play` effect (Crown of
 * Flowers: Gates of Morning in, Doors of Night out). Crown of Flowers is
 * updated to record the reciprocal link so the cascade discard (either card
 * leaving play discards the other) works in both directions.
 */
export function applyPairResourceWithCof(
  state: GameState,
  action: GameAction,
): ReducerResult {
  if (action.type !== 'pair-resource-with-cof') {
    return { state, error: `Expected pair-resource-with-cof, got '${action.type}'` };
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

  logDetail(`pair-resource-with-cof: pairing ${handCard.definitionId as string} (${cardInstanceId as string}) with CoF (${cofInstanceId as string})`);

  // Remove the card from hand
  const newHand = player.hand.filter((_, i) => i !== handIdx);

  // The environment reinterpretation the paired resource plays under comes
  // from the pairing card's own `offer-resource-play` effect (Crown of
  // Flowers dm-121 declares assumeInPlay: ["Gates of Morning"] and
  // assumeNotInPlay: ["Doors of Night"]) rather than from engine hardcode.
  const cofInPlay = state.players[cofPlayerIndex].cardsInPlay.find(c => c.instanceId === cofInstanceId);
  const cofDef = cofInPlay ? defById(state, cofInPlay.definitionId) : undefined;
  const offerEffect = getOnEventEffects(cofDef, 'self-enters-play')
    .map(e => e.apply)
    .find((a): a is Extract<typeof a, { type: 'offer-resource-play' }> => a.type === 'offer-resource-play');

  // Build the paired resource CardInPlay entry
  const pairedCard: CardInPlay = {
    instanceId: handCard.instanceId,
    definitionId: handCard.definitionId,
    status: CardStatus.Untapped,
    linkedInstanceId: cofInstanceId,
    ...(offerEffect?.assumeInPlay ? { assumeInPlay: offerEffect.assumeInPlay } : {}),
    ...(offerEffect?.assumeNotInPlay ? { assumeNotInPlay: offerEffect.assumeNotInPlay } : {}),
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

  return { state: newState };
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'wizard-search-on-store') return null;

  if (rawAction.type === 'skip-wizard-search') {
    if (rawAction.player !== top.actor) {
      return { state, error: 'Wrong player for wizard-search-on-store' };
    }
    logDetail('Wizard-search: skipped by player');
    return { state: dequeueResolution(state, top.id) };
  }

  const g = guardResolution(state, rawAction, top, 'play-wizard-from-search', 'wizard-search-on-store');
  if (!g.ok) return g.result;
  const { action, actorIndex, player } = g;

  const { companyId } = top.kind;
  const { wizardDefinitionId, source } = action;

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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'select-card-bearer') return null;

  const { cardInstanceId, companyId, mode: bearerMode, discardFactionsAtSite: shouldDiscardFactions, returnFactionsAtSite: shouldReturnFactions, discardUniqueFactionsAtSite: shouldDiscardUniqueFactions } = top.kind;

  if (rawAction.type === 'pass') {
    // Player declines bearer assignment — discard the card. The company may
    // no longer exist (every member eliminated while this resolution waited
    // in the queue); the card is then discarded to whichever player holds it
    // in cardsInPlay instead of to the vanished company's owner. Returning
    // null here would leave the resolution queued forever — the pass is the
    // only action the emitter offers in that state.
    const defIdx = state.players.findIndex(
      p => p.companies.some(co => co.id === companyId),
    );
    logDetail(`select-card-bearer: player declined — discarding card ${cardInstanceId as string}`);
    const cardDefId = resolveInstanceId(state, cardInstanceId);
    const cardLabel = cardName(state, cardDefId!, '?');
    logDetail(`Discarding "${cardLabel}" (no bearer chosen)`);

    let s = state;
    // Remove from any player's cardsInPlay
    for (let pi = 0; pi < 2; pi++) {
      const inPlay = findById(s.players[pi].cardsInPlay, cardInstanceId);
      if (inPlay) {
        const discardIdx = defIdx >= 0 ? defIdx : pi;
        s = updatePlayer(s, pi, p => ({
          ...p,
          cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== cardInstanceId),
        }));
        s = updatePlayer(s, discardIdx, p => ({
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

  const g = guardResolution(state, rawAction, top, 'select-card-bearer', 'select-card-bearer');
  if (!g.ok) return g.result;
  const { action } = g;

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

    // Discard every unique faction (of either player) playable at the
    // company's current site (Invade Their Domain ba-64, Lord and Usurper
    // ba-65: "discard all unique factions playable at the site"). Unlike
    // `discardFactionsAtSite` (active player, all factions), this scans both
    // players' cardsInPlay and is limited to unique factions.
    if (shouldDiscardUniqueFactions) {
      const company = s.players[defIdx].companies.find(co => co.id === companyId);
      const currentSiteDef = company?.currentSite
        ? defById(s, company.currentSite.definitionId)
        : undefined;
      const siteName = currentSiteDef?.name;
      const siteType = currentSiteDef && 'siteType' in currentSiteDef ? (currentSiteDef as { siteType: string }).siteType : undefined;

      if (siteName || siteType) {
        for (let pi = 0; pi < 2; pi++) {
          const factionsToDiscard: import('../types/state-cards.js').CardInPlay[] = [];
          for (const card of s.players[pi].cardsInPlay) {
            const fDef = defById(s, card.definitionId);
            if (!fDef || !isFactionCard(fDef)) continue;
            if (fDef.unique !== true) continue;
            const playableAt = fDef.playableAt as readonly ({ site?: string; siteType?: string; region?: string })[];
            const matches = playableAt.some(entry =>
              (siteName && 'site' in entry && entry.site === siteName) ||
              (siteType && 'siteType' in entry && entry.siteType === siteType),
            );
            if (matches) factionsToDiscard.push(card);
          }
          if (factionsToDiscard.length === 0) continue;
          const discardIds = new Set(factionsToDiscard.map(c => c.instanceId as string));
          // Each faction returns to its true owner's discard pile (instance-id
          // prefix), matching how an influenced-away faction is tracked.
          s = updatePlayer(s, pi, p => ({
            ...p,
            cardsInPlay: p.cardsInPlay.filter(c => !discardIds.has(c.instanceId as string)),
          }));
          for (const card of factionsToDiscard) {
            const ownerIdx = getPlayerIndex(s, ownerOf(card.instanceId));
            const fName = defById(s, card.definitionId)?.name ?? (card.definitionId as string);
            logDetail(`select-card-bearer: discarding unique faction "${fName}" playable at ${siteName ?? siteType ?? '?'}`);
            s = updatePlayer(s, ownerIdx, p => ({ ...p, discardPile: [...p.discardPile, toCardInstance(card)] }));
          }
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

  // Remove card from cardsInPlay, attach to character's items, tap character.
  // Stamp the company's current site as `playedAtSiteDefId` so a site-scoped
  // `duplication-limit` (e.g. Rescue Prisoners tw-315) is checked against
  // where the card was played, not wherever the bearer later travels.
  const bearerCompany = defPlayer.companies.find(co => co.id === companyId);
  const playedAtSiteDefId = bearerCompany?.currentSite
    ? resolveInstanceId(state, bearerCompany.currentSite.instanceId)
    : undefined;

  let s = updatePlayer(state, cardOwnerIdx, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== cardInstanceId),
  }));
  s = updatePlayer(s, defIdx, p => updateCharacter(p, characterId, () => ({
    ...ch,
    status: CardStatus.Tapped,
    items: [
      ...ch.items,
      {
        instanceId: cardInPlay.instanceId,
        definitionId: cardInPlay.definitionId,
        status: CardStatus.Untapped,
        ...(playedAtSiteDefId ? { playedAtSiteDefId } : {}),
      },
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

  // A bearer was assigned, so the card was *kept* — the play succeeded. When the
  // kept card frees prisoners (Rescue Prisoners tw-315) and the company stands
  // at Dol Guldur, this opens the tap window for Pass the Doors of Dol Guldur
  // (dm-154) for the rest of this site phase. The declined (`pass`) branch above
  // discards the card instead and deliberately does not mark it.
  if (hasPlayFlag(cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined, 'rescues-prisoners')) {
    s = markPrisonersRescuedAtDolGuldur(s, bearerCompany);
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'discard-one-company-item') return null;

  // A pass dismisses the resolution ONLY when the forced discard is
  // unsatisfiable — the company is gone, or none of its characters bears a
  // genuine item passing the source card's filter (attachments may be
  // permanent events placed "with" a character, e.g. Thrall of the Voice).
  // The emitter offers the pass in exactly those situations, and shares
  // `eligibleCompanyDiscardItems` with this check so the two cannot drift.
  // With an eligible item present the discard stays forced and a pass is
  // rejected.
  if (rawAction.type === 'pass' && rawAction.player === top.actor) {
    if (eligibleCompanyDiscardItems(state, top.kind).length > 0) {
      return { state, error: 'An eligible item exists — the forced discard cannot be declined' };
    }
    logDetail(`discard-one-company-item: no eligible item in company ${top.kind.companyId as string} — resolution dismissed`);
    return { state: dequeueResolution(state, top.id) };
  }

  const g = guardResolution(state, rawAction, top, 'discard-item-from-company', 'discard-one-company-item');
  if (!g.ok) return g.result;
  const { action, kind } = g;

  const { itemInstanceId } = action;
  const { companyId, characterId, itemFilter } = kind;

  const defIdx = state.players.findIndex(p => p.companies.some(co => co.id === companyId));
  if (defIdx < 0) return { state, error: `Company ${companyId as string} not found` };
  const defPlayer = state.players[defIdx];

  const newCharacters = { ...defPlayer.characters };
  let itemRemoved = false;
  let removedItem: { instanceId: import('../types/common.js').CardInstanceId; definitionId: import('../types/common.js').CardDefinitionId } | null = null;
  for (const [charId, charData] of Object.entries(newCharacters)) {
    // Narrowed resolutions (tw-46) may only give up the named character's items.
    if (characterId && charId !== (characterId as string)) continue;
    const idx = charData.items.findIndex(it => it.instanceId === itemInstanceId);
    if (idx >= 0) {
      const chosenDef = defById(state, charData.items[idx].definitionId);
      if (itemFilter && (!chosenDef || !matchesDefinition(chosenDef, itemFilter))) {
        return { state, error: `Item ${itemInstanceId as string} is excluded by the source card's item filter` };
      }
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

  // Leaf Brooch (dm-171) and friends: a `discard-substitute` borne in the same
  // company may be thrown away in place of the chosen item. Hand the discard
  // over to the offer resolution — it owns the card movement either way.
  const dequeued = dequeueResolution(state, top.id);
  const offered = enqueueDiscardSubstituteOffer(dequeued, {
    source: top.source,
    owner: defPlayer.id,
    scope: top.scope,
    companyId,
    requiredInstanceIds: [itemInstanceId],
    sourceName: `discard-one-company-item ("${itemName}")`,
  });
  if (offered) return { state: offered };

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
 * Resolve a `discard-substitute-offer` pending resolution (Leaf Brooch dm-171).
 *
 * This resolution owns the forced discard that queued it. Two outcomes:
 *
 * - **Use** (`itemInstanceId` present) — the named card is struck off the
 *   doomed list and the substitute is discarded in its place. If another
 *   substitute is still borne in the company *and* doomed cards remain, the
 *   resolution stays queued (with the next substitute) so a company holding
 *   two Leaf Brooches can save two items from the same requirement.
 * - **Decline** (`itemInstanceId` omitted) — every remaining doomed card is
 *   discarded, exactly as if no substitute had been in play.
 */
export function applyDiscardSubstituteOfferResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'use-discard-substitute', 'discard-substitute-offer');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const ownerIndex = getPlayerIndex(state, top.actor);
  if (ownerIndex < 0) return { state, error: `Player ${top.actor as string} not found` };

  // Decline: the requirement is fulfilled the ordinary way.
  if (!action.itemInstanceId) {
    logDetail(`${kind.sourceName}: substitution declined — discarding ${kind.requiredInstanceIds.length} card(s) as required`);
    const discarded = discardCardsFromCompany(state, ownerIndex, kind.requiredInstanceIds, kind.sourceName);
    return { state: dequeueResolution(discarded, top.id) };
  }

  const saved = action.itemInstanceId;
  if (!kind.requiredInstanceIds.includes(saved)) {
    return { state, error: `Card ${saved as string} is not among the cards being discarded` };
  }

  const substitute = findDiscardSubstitutes(state, ownerIndex, kind.companyId)
    .find(s => s.instanceId === kind.substituteInstanceId);
  if (!substitute) {
    return { state, error: `Substitute ${kind.substituteInstanceId as string} is no longer in the company` };
  }
  const savedDef = defById(state, resolveInstanceId(state, saved) ?? ('' as CardDefinitionId));
  if (!substituteCovers(substitute, savedDef)) {
    return { state, error: `${substitute.name} cannot be discarded in place of ${savedDef?.name ?? (saved as string)}` };
  }

  logDetail(`${kind.sourceName}: ${substitute.name} discarded instead of ${savedDef?.name ?? (saved as string)}`);
  let working = discardCardsFromCompany(state, ownerIndex, [substitute.instanceId], `${kind.sourceName} (substitution)`);

  const remaining = kind.requiredInstanceIds.filter(id => id !== saved);
  if (remaining.length > 0) {
    // Another substitute in the company may still save one more card.
    const next = findDiscardSubstitutes(working, ownerIndex, kind.companyId, new Set(remaining))
      .find(s => remaining.some(id => substituteCovers(s, defById(working, resolveInstanceId(working, id) ?? ('' as CardDefinitionId)))));
    if (next) {
      logDetail(`${kind.sourceName}: ${next.name} may still be discarded instead of one of ${remaining.length} remaining card(s)`);
      return {
        state: {
          ...working,
          pendingResolutions: working.pendingResolutions.map(r =>
            r.id === top.id
              ? { ...r, kind: { ...kind, substituteInstanceId: next.instanceId, requiredInstanceIds: remaining } }
              : r,
          ),
        },
      };
    }
    working = discardCardsFromCompany(working, ownerIndex, remaining, kind.sourceName);
  }

  return { state: dequeueResolution(working, top.id) };
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'force-discard-card', 'force-discard-card');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const { cardInstanceId } = action;
  const fdKind = kind;
  const anyFromHand = !!fdKind.anyFromHand;

  const actorIdx = state.players.findIndex(p => p.id === action.player);
  if (actorIdx < 0) return { state, error: 'Player not found for force-discard-card' };
  const actorPlayer = state.players[actorIdx];

  if (anyFromHand) {
    if (!actorPlayer.hand.some(c => c.instanceId === cardInstanceId)) {
      return { state, error: `Card ${cardInstanceId as string} is not in hand` };
    }
  } else if (!kind.candidateInstanceIds.includes(cardInstanceId)) {
    return { state, error: `Card ${cardInstanceId as string} is not a valid card to discard` };
  }

  // Locate the chosen card: the hand first, then `cardsInPlay` (stage
  // permanent-events and stage factions — Echoes of the Song wh-17), then any
  // character's items (a ring, or a stage permanent-event played on a
  // character) and allies.
  let removed: CardInstance | null = null;
  const handIdx = actorPlayer.hand.findIndex(c => c.instanceId === cardInstanceId);
  let newHand = actorPlayer.hand;
  let newCardsInPlay = actorPlayer.cardsInPlay;
  let newKillPile = actorPlayer.killPile;
  const newCharacters = { ...actorPlayer.characters };
  if (handIdx >= 0) {
    removed = toCardInstance(actorPlayer.hand[handIdx]);
    newHand = actorPlayer.hand.filter((_, i) => i !== handIdx);
  } else if (actorPlayer.cardsInPlay.some(c => c.instanceId === cardInstanceId)) {
    removed = toCardInstance(actorPlayer.cardsInPlay.find(c => c.instanceId === cardInstanceId)!);
    newCardsInPlay = actorPlayer.cardsInPlay.filter(c => c.instanceId !== cardInstanceId);
  } else if (actorPlayer.killPile.some(c => c.instanceId === cardInstanceId)) {
    // CoE 2.II.4.1 (rule 3.33): a *stored* Stage resource sits in the
    // marshalling-point pile and "may be discarded while stored if their player
    // must discard a Stage resource" — so a candidate may legitimately be found
    // there rather than in play.
    removed = actorPlayer.killPile.find(c => c.instanceId === cardInstanceId)!;
    newKillPile = actorPlayer.killPile.filter(c => c.instanceId !== cardInstanceId);
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
      const allyIdx = charData.allies.findIndex(a => a.instanceId === cardInstanceId);
      if (allyIdx >= 0) {
        removed = toCardInstance(charData.allies[allyIdx]);
        newCharacters[charId as CardInstanceId] = {
          ...charData,
          allies: charData.allies.filter((_, i) => i !== allyIdx),
        };
        break;
      }
    }
  }
  if (!removed) {
    return { state, error: `Card ${cardInstanceId as string} not found in hand, in play, stored or in the company` };
  }

  const cardDef = defById(state, removed.definitionId);
  const cardName = cardDef?.name ?? (cardInstanceId as string);
  logDetail(`force-discard-card: ${actorPlayer.name} discards "${cardName}"`);

  const newPlayers = clonePlayers(state);
  newPlayers[actorIdx] = {
    ...actorPlayer,
    hand: newHand,
    cardsInPlay: newCardsInPlay,
    killPile: newKillPile,
    characters: newCharacters,
    discardPile: [...actorPlayer.discardPile, removed],
  };
  // Discarding a stage card changes the actor's stage-point total, which is
  // derived — recompute so the drop is reflected immediately.
  const stateAfter = recomputeDerived({ ...state, players: newPlayers });

  // Any-from-hand: keep the resolution alive until the required count is met or
  // the hand runs out.
  if (anyFromHand) {
    const remainingAfter = (fdKind.remaining ?? 1) - 1;
    if (remainingAfter > 0 && newHand.length > 0) {
      logDetail(`force-discard-card: ${actorPlayer.name} must still discard ${remainingAfter} card(s)`);
      const updated = stateAfter.pendingResolutions.map(r =>
        r.id === top.id ? { ...r, kind: { ...fdKind, remaining: remainingAfter } } : r,
      );
      return { state: { ...stateAfter, pendingResolutions: updated } };
    }
  }

  return { state: dequeueResolution(stateAfter, top.id) };
}

/**
 * Resolve one step of an `event-maintenance` pending resolution — the upkeep
 * exchange over an in-play event carrying an `event-maintenance` effect
 * (*Thrice Outnumbered* le-142, *Balance Between Powers* dm-118).
 *
 * Three payment types, dispatched as `pay-event-maintenance`:
 *
 * - `discard-self` (`upkeep` stage only) — the controller gives the event up:
 *   it leaves `cardsInPlay` for their discard pile and the exchange ends.
 * - `discard-from-hand` — one qualifying hand card is discarded towards the
 *   current stage's cost. While cards are still due the resolution stays
 *   queued with `remainingToPay` decremented; when the last one is paid, the
 *   bidding war passes to the other side (see `advanceMaintenanceChain`).
 * - `decline` (`challenge` / `counter` stages) — bid nothing. Declining a
 *   challenge leaves the event in play; declining to counter one discards it.
 */
export function applyEventMaintenanceResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'pay-event-maintenance', 'event-maintenance');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  if (action.sourceInstanceId !== kind.sourceInstanceId) {
    return { state, error: 'Wrong source instance for event-maintenance' };
  }
  const { stage, remainingToPay, stageCount, controllerId, sourceInstanceId } = kind;

  const actorIdx = state.players.findIndex(p => p.id === action.player);
  if (actorIdx < 0) return { state, error: 'Player not found for event-maintenance' };
  const actorPlayer = state.players[actorIdx];

  // The opt-out is only on the table before any card of this stage is paid.
  if (action.paymentType !== 'discard-from-hand' && remainingToPay !== stageCount) {
    return { state, error: `event-maintenance: ${action.paymentType} unavailable after paying part of the ${stage} cost` };
  }

  if (action.paymentType === 'discard-self') {
    if (stage !== 'upkeep') {
      return { state, error: `event-maintenance: discard-self is only available at the upkeep stage (got '${stage}')` };
    }
    if (!actorPlayer.cardsInPlay.some(c => c.instanceId === action.cardInstanceId)) {
      return { state, error: `Permanent event ${action.cardInstanceId as string} not found in cardsInPlay` };
    }
    logDetail(`event-maintenance (upkeep): ${actorPlayer.name} declines to pay`);
    const discarded = discardMaintainedEvent(state, controllerId, sourceInstanceId);
    return { state: dequeueResolution(discarded, top.id) };
  }

  if (action.paymentType === 'decline') {
    if (stage === 'counter') {
      logDetail(`event-maintenance (counter): ${actorPlayer.name} declines to counter — the card is discarded`);
      const discarded = discardMaintainedEvent(state, controllerId, sourceInstanceId);
      return { state: dequeueResolution(discarded, top.id) };
    }
    logDetail(`event-maintenance (challenge): ${actorPlayer.name} declines to bid — the card stays in play`);
    return { state: dequeueResolution(state, top.id) };
  }

  // discard-from-hand: validate and verify the hand card matches the filter
  const handIdx = actorPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (handIdx < 0) {
    return { state, error: `Hand card ${action.cardInstanceId as string} not found in hand` };
  }
  const handCard = actorPlayer.hand[handIdx];

  // Verify the card matches the handCardFilter from the source effect
  const maintenanceEff = findEventMaintenanceEffect(defById(state, kind.sourceDefinitionId));
  if (maintenanceEff) {
    const handDef = defById(state, handCard.definitionId);
    if (!handDef || !matchesDefinition(handDef, maintenanceEff.handCardFilter)) {
      return { state, error: `Hand card ${handCard.definitionId as string} does not match event-maintenance filter` };
    }
  }

  const stillDue = remainingToPay - 1;
  logDetail(
    `event-maintenance (${stage}): ${actorPlayer.name} discards "${cardName(state, handCard.definitionId)}" `
    + `from hand (${stillDue} of ${stageCount} still due)`,
  );

  const newPlayers = clonePlayers(state);
  newPlayers[actorIdx] = {
    ...actorPlayer,
    hand: actorPlayer.hand.filter((_, i) => i !== handIdx),
    discardPile: [...actorPlayer.discardPile, toCardInstance(handCard)],
  };
  const paid: GameState = { ...state, players: newPlayers };

  // Part-paid: keep the same resolution queued for the rest of the cost.
  if (stillDue > 0) {
    return {
      state: {
        ...paid,
        pendingResolutions: paid.pendingResolutions.map(r =>
          r.id === top.id ? { ...r, kind: { ...kind, remainingToPay: stillDue } } : r,
        ),
      },
    };
  }

  return { state: advanceMaintenanceChain(dequeueResolution(paid, top.id), top, stage) };
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  // pass: no untapped characters available (or player skips)
  const g = guardResolutionOrPass(state, rawAction, top, 'tap-character-by-effect', 'tap-one-character',
    'tap-one-character: pass (no untapped character tapped)');
  if (!g.ok) return g.result;
  const { action, kind } = g;

  const { characterInstanceId } = action;
  const { companyId } = kind;

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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  // pass: the player declines the optional untap/heal.
  const g = guardResolutionOrPass(state, rawAction, top, 'restore-character-by-effect', 'haven-restore-character',
    'haven-restore-character: pass (Hall of Fire benefit declined)');
  if (!g.ok) return g.result;
  const { action, kind } = g;

  const { characterInstanceId } = action;
  const { companyId } = kind;

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
 * Resolve a `left-behind-rejoin` pending resolution (Left Behind, td-41).
 *
 * The controlling player either passes (the separate "left behind" company
 * stays separate, its flags cleared) or folds it back into its original company
 * via a `left-behind-rejoin` action — the characters, on-guard cards and hazards
 * of the left-behind company are merged into the original and the now-empty
 * left-behind company is removed.
 */
export function applyLeftBehindRejoinResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'left-behind-rejoin') return null;
  const { companyId, originCompanyId } = top.kind;

  const playerIdx = state.players.findIndex(p => p.id === top.actor);
  if (playerIdx < 0) return { state, error: 'Left Behind rejoin: actor not found' };

  const clearFlags = (st: GameState): GameState => updatePlayer(st, playerIdx, p => ({
    ...p,
    companies: p.companies.map(c => c.id === companyId
      ? { ...c, leftBehind: undefined, leftBehindOriginCompanyId: undefined, leftBehindExtraPhasePending: undefined }
      : c),
  }));

  // pass: keep the company separate, but clear its left-behind flags.
  if (rawAction.type === 'pass') {
    logDetail(`left-behind-rejoin: pass — company ${companyId as string} stays separate`);
    return { state: dequeueResolution(clearFlags(state), top.id) };
  }

  const g = guardResolution(state, rawAction, top, 'left-behind-rejoin', 'left-behind-rejoin');
  if (!g.ok) return g.result;
  if (g.action.companyId !== companyId) {
    return { state, error: 'left-behind-rejoin: company mismatch' };
  }

  const player = state.players[playerIdx];
  const b = player.companies.find(c => c.id === companyId);
  const origin = player.companies.find(c => c.id === originCompanyId);
  if (!b || !origin) {
    // One of the companies vanished — nothing to merge; clear flags and dequeue.
    return { state: dequeueResolution(clearFlags(state), top.id) };
  }
  if (!b.currentSite || !origin.currentSite || b.currentSite.instanceId !== origin.currentSite.instanceId) {
    return { state, error: 'left-behind-rejoin: companies are not at the same site' };
  }

  logDetail(`left-behind-rejoin: folding ${companyId as string} back into ${originCompanyId as string}`);
  const merged = updatePlayer(state, playerIdx, p => {
    const companies = p.companies
      .map(c => c.id === originCompanyId
        ? {
            ...c,
            characters: [...c.characters, ...b.characters],
            onGuardCards: [...c.onGuardCards, ...b.onGuardCards],
            hazards: [...c.hazards, ...b.hazards],
            siteCardOwned: c.siteCardOwned || b.siteCardOwned,
          }
        : c)
      .filter(c => c.id !== companyId);
    return { ...p, companies };
  });

  return { state: dequeueResolution(merged, top.id) };
}

/**
 * Resolve a `hand-discard-recycle-offer` pending resolution (Enduring Tales,
 * dm-125).
 *
 * The card has already landed in the discarding player's discard pile by the
 * time this resolution is enqueued (`hand-discard-recycle-trigger.ts` detects
 * the hand→discardPile transition after the fact). Accepting
 * (`recycle-hand-discard`) moves that exact instance to the top of the
 * player's play deck instead; `pass` leaves it discarded.
 */
export function applyHandDiscardRecycleOfferResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'recycle-hand-discard', 'hand-discard-recycle-offer',
    kind => `${kind.sourceName}: declines to recycle the discarded card to the top of the play deck`);
  if (!g.ok) return g.result;
  const { action, kind, actorIndex: playerIdx, player } = g;

  if (action.cardInstanceId !== kind.instanceId) {
    return { state, error: `hand-discard-recycle-offer: card mismatch (expected ${kind.instanceId as string})` };
  }
  const idx = player.discardPile.findIndex(c => c.instanceId === kind.instanceId);
  if (idx < 0) {
    return { state, error: `hand-discard-recycle-offer: card ${kind.instanceId as string} no longer in discard pile` };
  }
  const card = player.discardPile[idx];
  logDetail(`${kind.sourceName}: ${cardName(state, card.definitionId)} moved from ${player.name}'s discard pile to the top of their play deck (face down)`);

  const newState = forgetDeckReveals(
    updatePlayer(state, playerIdx, p => ({
      ...p,
      discardPile: p.discardPile.filter((_, i) => i !== idx),
      playDeck: [card, ...p.playDeck],
    })),
    playerIdx,
  );
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'arrange-deck-top-card', 'arrange-deck-top');
  if (!g.ok) return g.result;
  const { action, kind, actorIndex: playerIdx, player } = g;

  const { count, orderedInstanceIds } = kind;
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
        ? { ...r, kind: { ...kind, orderedInstanceIds: newOrdered } }
        : r,
    );
    return { state: { ...state, pendingResolutions: updated } };
  }

  // Final pick — reorder the top `count` cards to match the chosen sequence.
  const orderedCards = newOrdered.map(id => topCards.find(c => c.instanceId === id)!);
  const rest = player.playDeck.slice(count);
  const newDeck = [...orderedCards, ...rest];
  logDetail(`arrange-deck-top: placed "${chosenName}" at position ${count}/${count} — deck top finalized`);
  // The cards go face-down in an order the player chose in secret (dm-85) —
  // their reveal-time identities must not stay unmasked at these exact deck
  // positions in the opponent's projected view.
  const newState = forgetDeckReveals(
    updatePlayer(state, playerIdx, p => ({ ...p, playDeck: newDeck })),
    playerIdx,
  );
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'choose-revealed-card', 'reveal-choose-to-hand');
  if (!g.ok) return g.result;
  const { action, kind, actorIndex: playerIdx, player } = g;

  const { revealedInstanceIds } = kind;
  if (!revealedInstanceIds.includes(action.cardInstanceId)) {
    return { state, error: `Card ${action.cardInstanceId as string} was not among the revealed cards` };
  }

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
  const newState = forgetDeckReveals(
    updatePlayer({ ...state, rng: nextRng }, playerIdx, p => ({
      ...p,
      hand: [...p.hand, chosen],
      playDeck: shuffledDeck,
    })),
    playerIdx,
  );
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'remove-revealed-card', 'reveal-remove-from-discard',
    'reveal-remove-from-discard: card-player declines — no card removed from play');
  if (!g.ok) return g.result;
  const { action, kind } = g;

  const { removableInstanceIds, opponentId } = kind;
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
 * Resolve a `reveal-hazards-choice` pending resolution (Here Is a Snake!
 * dm-137). Three actions apply against it:
 *
 *  - `reveal-hazard-for-snake` — reveal one more hazard card from hand
 *    (recorded in `revealedInstances` immediately) and append it to the
 *    resolution's accumulator; repeatable, resolution stays queued.
 *  - `tap-reveal-agent-for-snake` — only legal while nothing has been
 *    revealed yet. Resolves exactly like `reveal-agent` (rule 9.04 home-site
 *    placement, movement-history and uniqueness checks — `handleRevealAgent`)
 *    and, if the agent survived the reveal, additionally taps it. No
 *    constraint is added; the resolution simply dequeues.
 *  - `pass` — finalizes with whatever has accumulated (even nothing) as an
 *    `only-revealed-hazards-on-company` constraint on the target company for
 *    the rest of its M/H phase.
 */
export function applyRevealHazardsChoiceResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'reveal-hazards-choice') return null;

  if (action.type === 'reveal-hazard-for-snake') {
    if (action.player !== top.actor) {
      return { state, error: 'Wrong player for reveal-hazards-choice' };
    }
    const playerIdx = getPlayerIndex(state, action.player);
    const handCard = findById(state.players[playerIdx].hand, action.cardInstanceId);
    if (!handCard) {
      return { state, error: `Card ${action.cardInstanceId as string} not in hand` };
    }
    const def = defById(state, handCard.definitionId);
    if (!def || (def.cardType !== 'hazard-creature' && def.cardType !== 'hazard-event')) {
      return { state, error: `Card ${action.cardInstanceId as string} is not a hazard card` };
    }
    if (top.kind.revealedIds.includes(action.cardInstanceId)) {
      return { state, error: `Card ${action.cardInstanceId as string} already revealed` };
    }
    const newRevealed = [...top.kind.revealedIds, action.cardInstanceId];
    logDetail(`reveal-hazards-choice: ${action.player as string} reveals "${def.name}" (${newRevealed.length} revealed so far)`);
    const revealedState = revealInstances(state, [handCard]);
    const newState = {
      ...revealedState,
      pendingResolutions: revealedState.pendingResolutions.map(r =>
        r.id === top.id ? { ...r, kind: { ...top.kind, revealedIds: newRevealed } } : r,
      ),
    };
    return { state: newState };
  }

  if (action.type === 'tap-reveal-agent-for-snake') {
    if (action.player !== top.actor) {
      return { state, error: 'Wrong player for reveal-hazards-choice' };
    }
    if (top.kind.revealedIds.length > 0) {
      return { state, error: 'Cannot tap-reveal an agent after revealing hazards' };
    }
    const revealResult = handleRevealAgent(state, {
      type: 'reveal-agent',
      player: action.player,
      agentId: action.agentId,
      ...(action.homeSiteInstanceId ? { homeSiteInstanceId: action.homeSiteInstanceId } : {}),
    });
    if (revealResult.error) return revealResult;

    const playerIdx = getPlayerIndex(revealResult.state, action.player);
    const revealedAgent = revealResult.state.players[playerIdx].agents.find(a => a.id === action.agentId);
    let finalState = revealResult.state;
    if (revealedAgent && revealedAgent.revealed) {
      finalState = updatePlayer(finalState, playerIdx, p => ({
        ...p,
        agents: p.agents.map(a =>
          a.id === action.agentId ? { ...a, character: { ...a.character, status: CardStatus.Tapped } } : a,
        ),
      }));
      logDetail(`reveal-hazards-choice: ${action.player as string} taps and reveals a face-down agent instead of revealing hazards — no restriction applied`);
    } else {
      logDetail(`reveal-hazards-choice: ${action.player as string}'s agent was discarded on reveal (illegal movement history or uniqueness conflict) — no restriction applied`);
    }
    return { state: dequeueResolution(finalState, top.id), effects: revealResult.effects };
  }

  if (action.type === 'pass') {
    if (action.player !== top.actor) {
      return { state, error: 'Wrong player for reveal-hazards-choice' };
    }
    const { companyId, revealedIds } = top.kind;
    const sourceDefinitionId = top.source ? resolveInstanceId(state, top.source) : undefined;
    if (!top.source || !sourceDefinitionId) {
      logDetail('reveal-hazards-choice: source card not found — finalizing with no constraint');
      return { state: dequeueResolution(state, top.id) };
    }
    logDetail(`reveal-hazards-choice: ${action.player as string} finalizes with ${revealedIds.length} hazard(s) revealed — company ${companyId as string} restricted to the revealed set for the rest of its M/H phase`);
    const newState = addConstraint(state, {
      source: top.source,
      sourceDefinitionId,
      scope: { kind: 'company-mh-phase', companyId },
      target: { kind: 'company', companyId },
      kind: { type: 'only-revealed-hazards-on-company', allowedInstanceIds: revealedIds },
    });
    return { state: dequeueResolution(newState, top.id) };
  }

  return { state, error: `Pending reveal-hazards-choice requires reveal-hazard-for-snake, tap-reveal-agent-for-snake, or pass, got '${action.type}'` };
}

/**
 * Resolve a `play-or-discard-fetched-item` pending resolution (Dwarven Ring
 * of Bávor's Tribe tw-214): the item found by the ring's search must be
 * played immediately at the bearer's site or discarded — no other action is
 * legal in the meantime.
 *
 * The "play" branch is an ordinary `play-hero-resource` action for the
 * fetched instance: delegates to {@link handleSitePlayHeroResource} (the
 * normal site-phase item-play reducer) unchanged, so every existing
 * item-play precedent applies, then dequeues this resolution. The "discard"
 * branch moves the card from hand straight to the discard pile. Either way,
 * a deferred corruption check on the bearer (if the search effect carried
 * one) is enqueued once the choice resolves — CoE precedent has the check
 * follow the found item's resolution, not the search itself.
 */
export function applyPlayOrDiscardFetchedItemResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'play-or-discard-fetched-item') return null;
  const { cardInstanceId, postCorruptionCheck } = top.kind;

  const enqueuePostCheck = (s: GameState): GameState => {
    if (!postCorruptionCheck) return s;
    return enqueueCorruptionCheck(s, {
      source: top.source,
      actor: top.actor,
      scope: { kind: 'phase', phase: s.phaseState.phase },
      characterId: postCorruptionCheck.characterId,
      modifier: postCorruptionCheck.modifier,
      reason: 'card effect',
    });
  };

  if (action.type === 'play-hero-resource' && action.cardInstanceId === cardInstanceId) {
    if (action.player !== top.actor) return { state, error: 'Wrong player for play-or-discard-fetched-item' };
    if (state.phaseState.phase !== Phase.Site) {
      return { state, error: 'play-or-discard-fetched-item: not in site phase' };
    }
    const playResult = handleSitePlayHeroResource(state, action, state.phaseState);
    if (playResult.error) return playResult;
    logDetail('play-or-discard-fetched-item: item played — resolution consumed');
    return { state: enqueuePostCheck(dequeueResolution(playResult.state, top.id)), effects: playResult.effects };
  }

  if (action.type === 'discard-card' && action.cardInstanceId === cardInstanceId) {
    if (action.player !== top.actor) return { state, error: 'Wrong player for play-or-discard-fetched-item' };
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    const handCard = findById(player.hand, cardInstanceId);
    if (!handCard) return { state, error: `Card ${cardInstanceId as string} not in hand` };
    const def = defById(state, handCard.definitionId);
    logDetail(`play-or-discard-fetched-item: ${player.name} discards "${def?.name ?? cardInstanceId as string}" instead of playing it`);
    const newState = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: removeById(p.hand, cardInstanceId),
      discardPile: [...p.discardPile, handCard],
    }));
    return { state: enqueuePostCheck(dequeueResolution(newState, top.id)) };
  }

  return { state, error: `Pending play-or-discard-fetched-item requires 'play-hero-resource' or 'discard-card' for ${cardInstanceId as string}, got '${action.type}'` };
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'desire-choose-shown-card', 'desire-belly-choose-card');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const { revealedInstanceIds, opponentId, cardPlayerId, sourceDefinitionId } = kind;
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'desire-choose-penalty', 'desire-belly-choose-penalty');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const { chosenInstanceId, revealedInstanceIds, opponentId } = kind;
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
      sourceDefinitionId: kind.sourceDefinitionId,
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
 * Resolve a `great-secrets-choose-item` pending resolution (Great Secrets
 * Buried There, dm-63): the deck owner chooses one of the revealed eligible
 * items to place off to the side under the host card. The choice is
 * mandatory. The remaining revealed cards (every revealed card except the
 * chosen one) are shuffled and returned to the top of the deck.
 */
export function applyGreatSecretsChooseItemResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'choose-set-aside-item', 'great-secrets-choose-item');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const { revealedInstanceIds, eligibleInstanceIds, deckOwnerId, hostInstanceId } = kind;
  if (!eligibleInstanceIds.includes(action.cardInstanceId)) {
    return { state, error: `Card ${action.cardInstanceId as string} is not one of the eligible items` };
  }

  const deckOwnerIdx = getPlayerIndex(state, deckOwnerId);
  const deck = state.players[deckOwnerIdx].playDeck;
  const chosen = deck.find(c => c.instanceId === action.cardInstanceId);
  if (!chosen) {
    return { state, error: `Chosen item ${action.cardInstanceId as string} not found in ${deckOwnerId as string}'s play deck` };
  }

  const revealedSet = new Set(revealedInstanceIds as readonly string[] as string[]);
  const rest = deck.filter(c => !revealedSet.has(c.instanceId as string));
  const remainingRevealed = deck.filter(
    c => revealedSet.has(c.instanceId as string) && c.instanceId !== action.cardInstanceId,
  );
  const [shuffled, nextRng] = shuffle(remainingRevealed, state.rng);

  let newState: GameState = {
    ...updatePlayer(state, deckOwnerIdx, p => ({
      ...p,
      playDeck: [...shuffled, ...rest],
    })),
    rng: nextRng,
  };
  newState = placeCardSetAside(newState, hostInstanceId, chosen, false, true);
  logDetail(
    `Great Secrets Buried There: ${deckOwnerId as string} sets aside "${cardName(newState, chosen.definitionId)}" ` +
    `under the host; ${shuffled.length} card(s) shuffled back on top of the deck`,
  );

  return { state: dequeueResolution(newState, top.id) };
}

/**
 * Resolve a `tap-or-roll-choice` pending resolution (A Lie in Your Eyes,
 * as-23): the defending player picks tap-character, tap-ally, or roll.
 *
 * - `tap-character` / `tap-ally` resolve immediately: tap the chosen target
 *   and mark the source chain entry resolved (matching by `targetCharacterId`,
 *   same as {@link diceCheckChainMatcher}'s `'target-character'` mode).
 * - `roll` enqueues a follow-up generic `dice-check` resolution (roller = the
 *   card-player) whose `onPass` discards the character; that dice-check's own
 *   `'chain-entry'` continuation marks the chain entry resolved once it rolls.
 */
export function applyTapOrRollChoiceResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'choose-tap-or-roll', 'tap-or-roll-choice');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const { characterInstanceId, rollingPlayer, rollAddend } = kind;
  const ownerIndex = state.players.findIndex(p => !!p.characters[characterInstanceId]);
  if (ownerIndex === -1) {
    logDetail(`A Lie in Your Eyes: target character ${characterInstanceId as string} no longer in play — no-op`);
    return { state: dequeueResolution(state, top.id) };
  }
  const character = state.players[ownerIndex].characters[characterInstanceId];
  const chainMatcher = (e: ChainEntry): boolean =>
    e.payload.type === 'short-event' && e.payload.targetCharacterId === characterInstanceId;

  if (action.choice === 'tap-character') {
    logDetail(`A Lie in Your Eyes: opponent taps the character instead`);
    const post = dequeueResolution(state, top.id);
    const tapped = updatePlayer(post, ownerIndex, p =>
      updateCharacter(p, characterInstanceId, c => ({ ...c, status: CardStatus.Tapped })));
    return resolveChainEntryAndContinue(tapped, chainMatcher, []);
  }

  if (action.choice === 'tap-ally') {
    if (!action.allyInstanceId) {
      return { state, error: 'choose-tap-or-roll: tap-ally requires allyInstanceId' };
    }
    const ally = character.allies.find(a => a.instanceId === action.allyInstanceId);
    if (!ally || ally.status !== CardStatus.Untapped) {
      return { state, error: `Ally ${action.allyInstanceId as string} is not an untapped ally of the target character` };
    }
    const allyInstanceId = action.allyInstanceId;
    logDetail(`A Lie in Your Eyes: opponent taps ${cardName(state, ally.definitionId)} instead`);
    const post = dequeueResolution(state, top.id);
    const tapped = updatePlayer(post, ownerIndex, p =>
      updateCharacter(p, characterInstanceId, c => ({
        ...c,
        allies: c.allies.map(a => (a.instanceId === allyInstanceId ? { ...a, status: CardStatus.Tapped } : a)),
      })));
    return resolveChainEntryAndContinue(tapped, chainMatcher, []);
  }

  // 'roll': let the card-player roll — the character's owner did not avert it.
  const mind = character.effectiveStats.mind ?? printedMind(defById(state, character.definitionId));
  const threshold = mind + rollAddend;
  const charName = cardName(state, character.definitionId);
  logDetail(`A Lie in Your Eyes: opponent lets ${rollingPlayer as string} roll (discard if > mind ${mind} + ${rollAddend})`);
  const post = dequeueResolution(state, top.id);
  const withRoll = enqueueResolution(post, {
    source: top.source,
    actor: rollingPlayer,
    scope: top.scope,
    kind: {
      type: 'dice-check',
      label: `A Lie in Your Eyes: ${charName}`,
      roller: rollingPlayer,
      modifiers: [],
      threshold,
      comparison: 'gt',
      onPass: { type: 'discard-character' },
      continuation: { kind: 'chain-entry', match: 'target-character' },
      requireTargetPresent: true,
      targetCharacterId: characterInstanceId,
    },
  });
  return { state: withRoll };
}

/**
 * Resolve a `agent-play-manifestation-offer` pending resolution (My Precious
 * dm-29): after My Precious attacks and fails but survives, the defender may tap
 * a character in the target company to play Gollum from hand — discarding My
 * Precious — or pass (he stays in play).
 */
export function applyAgentPlayManifestationResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'play-agent-manifestation', 'agent-play-manifestation-offer',
    'agent-play-manifestation: defender declines — My Precious stays in play');
  if (!g.ok) return g.result;
  const { action, kind, actorIndex: defIdx, player: defPlayer } = g;

  const { agentId, companyId } = kind;
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
  const g = guardResolution(state, action, top, 'stay-her-appetite-roll', 'stay-her-appetite-roll');
  if (!g.ok) return g.result;
  const {
    allyInstanceId, allyOwnerPlayerIndex, hostCharacterInstanceId,
    allyMind, allyProwess, opponentUnusedGI, controllerUnusedDI,
    companyId, sourceDefinitionId,
  } = g.kind;

  const sourceName = (defById(state, sourceDefinitionId) as { name?: string })?.name ?? 'Stay Her Appetite';

  // Condition roll
  const threshold = opponentUnusedGI + controllerUnusedDI + 5;
  const { total: roll1Total, rollEffect: roll1Effect, state: stateAfterRoll1 } = rollDiceForPlayer(
    state,
    1 - allyOwnerPlayerIndex,
    (_roll, total) => `${sourceName}: condition roll (${total} + mind ${allyMind} vs GI ${opponentUnusedGI} + DI ${controllerUnusedDI} + 5 = ${threshold})`,
  );
  const conditionMet = (roll1Total + allyMind) > threshold;

  logDetail(`${sourceName}: rolled ${roll1Total} + mind ${allyMind} = ${roll1Total + allyMind} vs ${threshold} → ${conditionMet ? 'ATTACK TRIGGERED' : 'no effect'}`);

  if (!conditionMet) {
    const postRoll = dequeueResolution(stateAfterRoll1, top.id);
    return resolveChainEntryAndContinue(
      postRoll,
      e => e.payload.type === 'short-event' && e.card?.instanceId === top.source,
      [roll1Effect],
    );
  }

  // Prowess roll
  const { total: roll2Total, rollEffect: roll2Effect, state: stateAfterRoll2 } = rollDiceForPlayer(
    stateAfterRoll1,
    1 - allyOwnerPlayerIndex,
    (_roll, total) => `${sourceName}: prowess roll (${allyProwess} + ${total} = ${allyProwess + total})`,
  );
  const attackProwess = allyProwess + roll2Total;

  logDetail(`${sourceName}: attack prowess = ally ${allyProwess} + roll ${roll2Total} = ${attackProwess}`);

  // Dequeue resolution then set up combat
  const stateDequeued = dequeueResolution(stateAfterRoll2, top.id);

  const combat: import('../types/state-combat.js').CombatState = makeCombatState(stateDequeued, {
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
 * Resolve a `choose-peek-deck` pending resolution (Mirror of Galadriel tw-282).
 *
 * The card-player names the play deck they look at (`'self'` / `'opponent'`) or
 * declines with `pass`. On a choice the top `count` cards of that deck are
 * shuffled among themselves and returned to the top — the same modelling the
 * certified Palantír of Minas Tirith (tw-299 / le-333) uses. The look itself is
 * intentionally not recorded in `revealedInstances`: that map is public to both
 * players, so recording it would show the cards to the wrong player.
 */
export function applyChoosePeekDeckResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'choose-peek-deck', 'choose-peek-deck',
    k => `${cardName(state, k.sourceDefinitionId)}: ${rawAction.player as string} declines to look at any play deck`);
  if (!g.ok) return g.result;
  const { action, kind, actorIndex } = g;

  const { count, deckChoice, sourceDefinitionId } = kind;
  const sourceName = cardName(state, sourceDefinitionId);
  const cleared = dequeueResolution(state, top.id);

  if (deckChoice !== 'any' && deckChoice !== action.deckOwner) {
    return { state, error: `${sourceName}: deck choice '${action.deckOwner}' not allowed (deckChoice '${deckChoice}')` };
  }
  // An in-play `cancel-deck-search` (Bane of the Ithil-stone tw-13 / Lady of
  // the Golden Wood as-13) cancels looking at the actor's own play deck; the
  // opponent's deck is not covered by those cards.
  if (action.deckOwner === 'self') {
    const canceller = deckSearchCancellerFor(state, action.player);
    if (canceller) {
      return { state, error: `${sourceName}: "${canceller}" cancels looking at your own play deck` };
    }
  }

  const targetIndex = action.deckOwner === 'self' ? actorIndex : 1 - actorIndex;
  const targetPlayer = cleared.players[targetIndex];
  const sliceSize = Math.min(count, targetPlayer.playDeck.length);
  if (sliceSize === 0) {
    logDetail(`${sourceName}: chosen play deck is empty — nothing to look at`);
    return { state: cleared };
  }
  const [shuffledTop, nextRng] = shuffle(targetPlayer.playDeck.slice(0, sliceSize), cleared.rng);
  logDetail(
    `${sourceName}: ${action.player as string} looks at the top ${sliceSize} card(s) of ` +
    `${targetPlayer.id as string}'s play deck, shuffles them and returns them to the top`,
  );
  const newState = updatePlayer({ ...cleared, rng: nextRng }, targetIndex, p => ({
    ...p,
    playDeck: [...shuffledTop, ...p.playDeck.slice(sliceSize)],
  }));
  return { state: newState };
}

/**
 * Resolve a `great-hunt-source` pending resolution (The Great Hunt wh-91): the
 * controller chose which of the opponent's piles to reveal. Kicks off the
 * reveal-and-attack sequence (initiating the first creature's attack), or — if
 * the controller passed because both piles were empty — clears the resolution.
 */
export function applyGreatHuntSourceResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'choose-great-hunt-source', 'great-hunt-source',
    'great-hunt-source: nothing to reveal — passing');
  if (!g.ok) return g.result;
  const { action, kind } = g;

  const { greatHuntInstanceId, maxCreatures, opponentId, companyId } = kind;
  const cleared = dequeueResolution(state, top.id);
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
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'great-hunt-attack-with-creature', 'great-hunt-discard-attack',
    () => `great-hunt-discard-attack: ${rawAction.player as string} declines the attack`);
  if (!g.ok) return g.result;
  const { action, kind } = g;

  const { greatHuntInstanceId, creatureInstanceId, opponentId, companyId } = kind;
  const cleared = dequeueResolution(state, top.id);

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

/**
 * Resolve a `hunt-target-choice` pending resolution (The Hunt dm-143): the
 * controller named a hazard-creature instance among the opponent's
 * revealed-and-known piles, or passed because none exists. No attack occurs
 * on `pass` — the bearer is only tapped once an actual `hunt-attack` combat
 * concludes (see `tapHuntBearerAfterwards`), so a fizzled naming leaves the
 * bearer untouched.
 */
export function applyHuntTargetChoiceResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'choose-hunt-target', 'hunt-target-choice',
    () => `hunt-target-choice: ${rawAction.player as string} has no hazard creature to name — The Hunt fizzles`);
  if (!g.ok) return g.result;
  const { action, kind } = g;

  const { huntInstanceId, bearerInstanceId, opponentId, companyId } = kind;
  const cleared = dequeueResolution(state, top.id);
  const candidate = findHuntCandidates(cleared, opponentId).find(c => c.instanceId === action.creatureInstanceId);
  if (!candidate) {
    return { state, error: 'The Hunt: named creature is no longer a valid candidate' };
  }
  const { state: withReshuffle, combat } = buildHuntCombat(
    cleared, huntInstanceId, candidate, bearerInstanceId, action.player, opponentId, companyId,
  );
  if (!combat) {
    logDetail(`hunt-target-choice: named creature could not attack (missing definition/company)`);
    return { state: withReshuffle };
  }
  return { state: { ...withReshuffle, combat } };
}

/**
 * Resolve a `reveal-deck-choose-attacker` pending resolution (Long Dark
 * Reach, dm-70): the card-player names one of the eligible revealed
 * creatures to immediately attack the target company. The choice is
 * mandatory. Builds the `long-dark-reach-attack` combat (which also shuffles
 * the unused revealed cards back to the top of the card-player's deck).
 */
export function applyRevealDeckChooseAttackerResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolution(state, rawAction, top, 'choose-long-dark-reach-attacker', 'reveal-deck-choose-attacker');
  if (!g.ok) return g.result;
  const { action, kind } = g;
  const { revealedInstanceIds, eligibleInstanceIds, cardPlayerId, targetCompanyId, defendingPlayerId, sourceInstanceId } = kind;
  if (!eligibleInstanceIds.includes(action.cardInstanceId)) {
    return { state, error: `Card ${action.cardInstanceId as string} is not an eligible Long Dark Reach candidate` };
  }

  const cleared = dequeueResolution(state, top.id);
  const candidate = findLongDarkReachCandidates(cleared, revealedInstanceIds, cardPlayerId)
    .find(c => c.instanceId === action.cardInstanceId);
  if (!candidate) {
    return { state, error: `Card ${action.cardInstanceId as string} is no longer a valid Long Dark Reach candidate` };
  }
  const { state: withReshuffle, combat } = buildLongDarkReachCombat(
    cleared, sourceInstanceId, candidate, revealedInstanceIds, cardPlayerId, defendingPlayerId, targetCompanyId,
  );
  if (!combat) {
    logDetail(`Long Dark Reach: named creature could not attack (missing definition/company)`);
    return { state: withReshuffle };
  }
  return { state: { ...withReshuffle, combat } };
}

/**
 * Resolve a `post-attack-play-offer` pending resolution (No News of Our Riding
 * le-211): the defending player either plays one of the matched resource
 * permanent-events on a character of the company that just faced the attack, or
 * declines. Either way the window closes — the offer is dequeued.
 *
 * The play itself is delegated to {@link handlePlayPermanentEvent}, so it routes
 * through the ordinary chain: the opponent keeps their response window, and the
 * chain resolution applies the card's `play-target` tap cost and attaches it to
 * the chosen character.
 */
export function applyPostAttackPlayOfferResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'play-permanent-event', 'post-attack-play-offer',
    'post-attack-play-offer: declined — after-attack window closes');
  if (!g.ok) return g.result;
  const { action, kind, player } = g;

  const { companyId, cardInstanceIds } = kind;
  if (!cardInstanceIds.includes(action.cardInstanceId)) {
    return { state, error: 'Card was not offered by this after-attack window' };
  }
  const company = player.companies.find(co => co.id === companyId);
  if (!company) return { state, error: `Company ${companyId as string} not found` };

  const handCard = findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'After-attack play card not in hand' };
  const def = defById(state, handCard.definitionId);
  if (!def) return { state, error: 'After-attack play card definition not found' };

  // Cards with no character play-target (e.g. Mount Slain as-50) resolve
  // against a programmatically-found target, not a chosen bearer — no
  // targetCharacterId is expected.
  if (afterAttackCharacterPlayTarget(def)) {
    if (!action.targetCharacterId || !company.characters.some(id => id === action.targetCharacterId)) {
      return { state, error: 'After-attack play requires a target character in the company that faced the attack' };
    }
    if (afterAttackPlayTargets(state, player, company, def).every(id => id !== action.targetCharacterId)) {
      return { state, error: 'Target character is not a legal bearer for this card' };
    }
  }

  logDetail(`post-attack-play-offer: playing ${def.name ?? action.cardInstanceId as string} on ${action.targetCharacterId as string}`);
  // Dequeue first: the play opens a chain, and the closed window must not be
  // re-offered while that chain resolves.
  const dequeued = dequeueResolution(state, top.id);
  return handlePlayPermanentEvent(dequeued, action);
}

/**
 * Resolve an `influence-reveal-play-offer` pending resolution (CoE 10.13): the
 * attacker plays the identical card they revealed for a successful influence
 * attempt, with the influencing character — or declines with `pass`, leaving it
 * in hand.
 *
 * The placement is done here rather than by routing to the normal play handlers
 * because the rule waives exactly the things those handlers exist to enforce:
 * the site tap, the resource-per-site allowance, and the card's own playability
 * restrictions. What the card *does* on entering play is unaffected — its
 * effects are collected from wherever it now sits, the same as for a card
 * played the ordinary way, which is why the recompute at the end is enough.
 *
 * Where the card lands follows its type: an item or ally attaches to the
 * influencing character, a character joins that character's company under the
 * controller named by the action, and a faction enters play. A revealed card
 * whose type is none of these is refused rather than silently dropped — no
 * `CardInstance` may go missing.
 */
export function applyInfluenceRevealPlayOfferResolution(
  state: GameState,
  rawAction: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  const g = guardResolutionOrPass(state, rawAction, top, 'play-revealed-card', 'influence-reveal-play-offer',
    'influence-reveal-play-offer: declined — the revealed card stays in hand (CoE 10.13)');
  if (!g.ok) return g.result;
  const { action, kind, actorIndex: playerIdx, player } = g;

  const { revealedInstanceId, influencerId } = kind;
  if (action.cardInstanceId !== revealedInstanceId) {
    return { state, error: 'Only the revealed card may be played by this offer' };
  }

  const handCard = findById(player.hand, revealedInstanceId);
  if (!handCard) return { state, error: 'Revealed card is not in hand' };
  const def = defById(state, handCard.definitionId);
  if (!def) return { state, error: 'Revealed card definition not found' };
  const influencer = player.characters[influencerId];
  if (!influencer) return { state, error: 'Influencing character is no longer in play' };

  const newHand = removeById(player.hand, revealedInstanceId);
  const attached = { instanceId: revealedInstanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped };
  const influencerName = cardName(state, influencer.definitionId, '?');
  let updated: GameState;

  if (isItemCard(def)) {
    logDetail(`influence-reveal-play (CoE 10.13): ${def.name} enters play on ${influencerName} — site not tapped`);
    updated = updatePlayer(state, playerIdx, p => ({
      ...updateCharacter({ ...p, hand: newHand }, influencerId, c => ({ ...c, items: [...c.items, attached] })),
    }));
  } else if (isAllyCard(def)) {
    logDetail(`influence-reveal-play (CoE 10.13): ${def.name} enters play with ${influencerName} — site not tapped`);
    updated = updatePlayer(state, playerIdx, p => ({
      ...updateCharacter({ ...p, hand: newHand }, influencerId, c => ({ ...c, allies: [...c.allies, attached] })),
    }));
  } else if (isFactionCard(def)) {
    // No second influence check — the successful attempt is what brought it in.
    logDetail(`influence-reveal-play (CoE 10.13): ${def.name} enters play — no influence check`);
    updated = updatePlayer(state, playerIdx, p => ({ ...p, hand: newHand, cardsInPlay: [...p.cardsInPlay, attached] }));
  } else if (isCharacterCard(def)) {
    const controlledBy = action.controlledBy;
    if (controlledBy === undefined) {
      return { state, error: 'Playing a revealed character requires a controller (general or direct influence)' };
    }
    if (controlledBy !== 'general' && !player.characters[controlledBy]) {
      return { state, error: 'Named direct-influence controller is not in play' };
    }
    const company = findCharacterCompany(player.companies, influencerId);
    if (!company) return { state, error: 'Influencing character is not in a company' };
    // Playability restrictions on the character card are not applied here
    // (CoE 10.13, "i.e. a Hobbit may be played in this way") — the character
    // joins the influencer's company wherever that company happens to stand.
    logDetail(`influence-reveal-play (CoE 10.13): ${def.name} joins ${influencerName}'s company under ${controlledBy === 'general' ? 'general influence' : `${cardName(state, player.characters[controlledBy].definitionId, '?')}'s direct influence`} — home-site restrictions waived`);
    const newChar: CharacterInPlay = {
      instanceId: revealedInstanceId,
      definitionId: handCard.definitionId,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      hazards: [],
      followers: [],
      controlledBy,
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
    updated = updatePlayer(state, playerIdx, p => {
      const withFollower = controlledBy === 'general'
        ? p.characters
        : { ...p.characters, [controlledBy as string]: { ...p.characters[controlledBy], followers: [...p.characters[controlledBy].followers, revealedInstanceId] } };
      return {
        ...p,
        hand: newHand,
        characters: { ...withFollower, [revealedInstanceId as string]: newChar },
        companies: p.companies.map(co =>
          co.id === company.id ? { ...co, characters: [...co.characters, revealedInstanceId] } : co),
      };
    });
  } else {
    return { state, error: `Revealed ${def.cardType} cannot be played by the influence-reveal offer` };
  }

  return { state: recomputeDerived(dequeueResolution(updated, top.id)) };
}
