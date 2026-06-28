/**
 * @module reducer-combat
 *
 * Combat handlers for the game reducer. Covers strike assignment,
 * strike resolution, support strikes, body checks, and combat finalization.
 */

import type { GameState, CombatState, StrikeAssignment, GameAction, GameEffect, CardInstanceId, CardDefinitionId, CardDefinition, HazardHost } from '../index.js';
import type { PlayerState } from '../types/state-player.js';
import type { CharacterInPlay, ItemInPlay } from '../types/state-cards.js';
import { formatSignedNumber } from '../format-helpers.js';
import { shuffle } from '../rng.js';
import { getPlayerIndex } from '../state-utils.js';
import { isSiteCard, isCharacterCard, isHalfOrc } from '../types/cards.js';
import { CardStatus, Alignment, Race } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import type { ModifyAttackEffect, StrikeModifierEffect, HalveStrikesEffect, TakePrisonerEffect, AbsorbWoundEffect, TriggerAttackOnPlayEffect, CombatTapCompanyBoostEffect } from '../types/effects.js';
import { getActiveAutoAttacks } from './manifestations.js';
import { matchesCondition, matchesContext } from '../effects/condition-matcher.js';
import type { MovementHazardPhaseState } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { findAllyInCompany, findItemInCompany } from './legal-actions/combat.js';
import { allyEffectiveProwess, allyEffectiveBody } from './ally-stats.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { cardName, clonePlayers, companyById, companySubphaseScope, defById, diceRollEffect, findById, getCardEffects, getOnEventEffects, matchesDefinition, playerById, removeAttachment, removeById, roll2d6, sweepLeaderLeavesCompanyEvents, toCardInstance, updateAttachment, updateCharacter, updatePlayer, wrongActionType } from './reducer-utils.js';
import { applyCost } from './cost-evaluator.js';
import { resolveEnemyBody, isWardedAgainst, resolveAttackProwess, resolveAttackStrikes, resolveAttackBody, normalizeCreatureRace, resolveDef } from './effects/index.js';
import { isDetainmentAttack, defenderAlignmentLabel } from './detainment.js';
import { computeCombatProwess, buildInPlayNames } from './recompute-derived.js';
import { enqueueCorruptionCheck, addConstraint, enqueueResolution, sweepExpired, removeConstraint } from './pending.js';
import { initiateOrPushChain } from './chain-reducer.js';
import { handlePlayResourceShortEvent } from './reducer-events.js';

/**
 * When a follower character leaves play, removes their ID from their leader's
 * followers list. This prevents stale follower references after elimination.
 */
function pruneLeaderFollowers(
  chars: Record<string, CharacterInPlay>,
  eliminatedId: CardInstanceId,
  controlledBy: 'general' | CardInstanceId,
): Record<string, CharacterInPlay> {
  if (controlledBy === 'general') return chars;
  const leaderId = controlledBy as string;
  const leader = chars[leaderId];
  if (!leader) return chars;
  return { ...chars, [leaderId]: { ...leader, followers: leader.followers.filter(f => f !== eliminatedId) } };
}

/**
 * Dispatch a combat action to the appropriate handler based on the
 * current combat sub-phase.
 */
/**
 * Signature shared by every combat-active action handler. Each handler takes
 * the full {@link GameAction} union and re-narrows internally; `combat` is the
 * guaranteed-present {@link CombatState}. Handlers that don't need the combat
 * state (the resource short-event handler) simply ignore the argument.
 */
type CombatActionHandler = (state: GameState, action: GameAction, combat: CombatState) => ReducerResult;

/**
 * Single source of truth mapping each combat-active action type to its handler.
 * Both the combat dispatcher ({@link handleCombatAction}) and the top-level
 * reducer's routing predicate ({@link COMBAT_ACTION_TYPES}) derive from this
 * map, so adding a combat action means adding exactly one entry here — the two
 * can no longer drift. (Previously the reducer kept a hand-maintained parallel
 * array of these type strings far from this dispatch switch, a misroute
 * footgun.)
 */
const COMBAT_HANDLERS: Partial<Record<GameAction['type'], CombatActionHandler>> = {
  'assign-strike': handleAssignStrike,
  'allocate-cvcc-excess': handleAllocateCvccExcess,
  'pass': handleCombatPass,
  'choose-strike-order': handleChooseStrikeOrder,
  'resolve-strike': handleResolveStrike,
  'agent-strike-roll': handleAgentStrikeRoll,
  'support-strike': handleSupportStrike,
  'body-check-roll': handleBodyCheckRoll,
  'shield-discard-roll': handleShieldDiscardRoll,
  'cancel-attack': handleCancelAttack,
  'convert-creature-to-ally': handleConvertCreatureToAlly,
  'cancel-by-tap': handleCancelByTap,
  'play-strike-event': handlePlayStrikeEvent,
  'cancel-strike': handleCancelStrike,
  'protect-from-assignment': handleProtectFromStrikeAssignment,
  'halve-strikes': handleHalveStrikes,
  'tap-item-for-strike': handleTapItemForStrike,
  'tap-ally-combat-boost': handleTapAllyCombatBoost,
  'modify-attack': handleModifyAttack,
  'salvage-item': handleSalvageItem,
  'discard-item-from-company': handleDiscardItemFromCompany,
  'play-hazard': handleCombatPlayHazard,
  'haven-join-attack': handleHavenJoinAttack,
  // Rule 3.iv / 3.iv.5: resource short-events may be played between strike
  // sequences or during step 5 if they affect the current strike. The event
  // handler applies its effects without touching the combat state.
  'play-short-event': handlePlayResourceShortEvent,
  'take-trophy': handleTakeTrophy,
};

/**
 * The combat-active action types the top-level reducer routes to
 * {@link handleCombatAction}, derived from {@link COMBAT_HANDLERS}. Excludes
 * `pass`, which is only a combat action in specific combat phases and so is
 * routed separately (and phase-gated) by the reducer.
 */
export const COMBAT_ACTION_TYPES: ReadonlySet<string> = new Set(
  Object.keys(COMBAT_HANDLERS).filter((type) => type !== 'pass'),
);

export function handleCombatAction(state: GameState, action: GameAction): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No combat active' };

  const handler = COMBAT_HANDLERS[action.type];
  if (!handler) return { state, error: `Unexpected action '${action.type}' during combat` };
  return handler(state, action, combat);
}

/**
 * Accept a pending haven-join-attack offer.
 *
 * Removes the character from their haven company and inserts them into
 * the attacked company, optionally discarding their allies, marking them
 * as a forced strike target, and scheduling post-attack side-effects.
 * The offer is consumed so it cannot be accepted twice.
 *
 * Implements the reusable side of `on-event: creature-attack-begins` +
 * `apply: offer-char-join-attack` — composable for any card with this pattern
 * (currently Alatar, tw-117).
 */
function handleHavenJoinAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'haven-join-attack') return wrongActionType(state, action, 'haven-join-attack');
  const offers = combat.havenJumpOffers ?? [];
  const offer = offers.find(o => o.characterId === action.characterId && o.bearerPlayerId === action.player);
  if (!offer) return { state, error: 'No matching haven-join offer' };

  const playerIdx = state.players.findIndex(p => p.id === action.player);
  if (playerIdx < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIdx];

  const originCompany = companyById(player.companies, offer.originCompanyId);
  const targetCompany = companyById(player.companies, offer.targetCompanyId);
  if (!originCompany || !targetCompany) return { state, error: 'Company not found' };

  const charInPlay = player.characters[action.characterId as string];
  if (!charInPlay) return { state, error: 'Character not in play' };

  // Discard attached allies if configured
  let updatedChar = charInPlay;
  let discardedAllies: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] = [];
  if (offer.discardOwnedAllies && charInPlay.allies.length > 0) {
    discardedAllies = charInPlay.allies.map(a => (toCardInstance(a)));
    updatedChar = { ...charInPlay, allies: [] };
    logDetail(`Haven-join: discarding ${discardedAllies.length} ally card(s) attached to joiner`);
  }

  // Move character: remove from origin company, append to target company.
  const newCompanies = player.companies.map(c => {
    if (c.id === offer.originCompanyId) {
      return { ...c, characters: c.characters.filter(id => id !== action.characterId) };
    }
    if (c.id === offer.targetCompanyId) {
      return { ...c, characters: [...c.characters, action.characterId] };
    }
    return c;
  });

  const newCharacters = { ...player.characters, [action.characterId as string]: updatedChar };

  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIdx] = {
    ...player,
    companies: newCompanies,
    characters: newCharacters,
    discardPile: [...player.discardPile, ...discardedAllies],
  };

  logDetail(`Haven-join: character ${action.characterId as string} moved from company ${offer.originCompanyId as string} to attacked company ${offer.targetCompanyId as string}`);

  const newForcedTargets = offer.forceStrike
    ? [...(combat.forcedStrikeTargets ?? []), action.characterId]
    : combat.forcedStrikeTargets;
  const newPostAttack = offer.postAttackEffects.length > 0
    ? [...(combat.postAttackEffects ?? []), ...offer.postAttackEffects]
    : combat.postAttackEffects;
  const newOrigins = [...(combat.havenJumpOrigins ?? []), {
    characterId: action.characterId,
    originCompanyId: offer.originCompanyId,
  }];

  // Consume this offer
  const remainingOffers = offers.filter(o => o !== offer);

  const newCombat: CombatState = {
    ...combat,
    havenJumpOffers: remainingOffers.length > 0 ? remainingOffers : undefined,
    forcedStrikeTargets: newForcedTargets && newForcedTargets.length > 0 ? newForcedTargets : undefined,
    postAttackEffects: newPostAttack && newPostAttack.length > 0 ? newPostAttack : undefined,
    havenJumpOrigins: newOrigins,
  };

  return { state: { ...state, players: newPlayers, combat: newCombat } };
}

/**
 * Compute the next combat phase after all strikes are assigned or a strike finishes resolving.
 * If multiple unresolved strikes remain, enters choose-strike-order so the defender picks.
 * If exactly one remains, auto-selects it and goes to resolve-strike.
 * Returns null if all strikes are resolved (caller should finalize combat).
 */
function nextStrikePhase(combat: CombatState): Partial<CombatState> | null {
  const unresolvedIndices: number[] = [];
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    if (!combat.strikeAssignments[i].resolved) unresolvedIndices.push(i);
  }
  if (unresolvedIndices.length === 0) return null;
  if (unresolvedIndices.length === 1) {
    logDetail(`One unresolved strike remaining (index ${unresolvedIndices[0]}) — auto-selecting`);
    // Reset the attacker's Step 1 window and agent roll for the new strike sequence.
    return { phase: 'resolve-strike', currentStrikeIndex: unresolvedIndices[0], bodyCheckTarget: null, attackerStep1Done: false, agentRollTotal: undefined };
  }
  logDetail(`${unresolvedIndices.length} unresolved strikes — defender chooses order`);
  return { phase: 'choose-strike-order', bodyCheckTarget: null };
}

/** Handle the defender choosing which strike to resolve next. */
function handleChooseStrikeOrder(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'choose-strike-order') return wrongActionType(state, action, 'choose-strike-order');

  const idx = action.strikeIndex;
  logDetail(`Defender chose to resolve strike ${idx} (character ${combat.strikeAssignments[idx].characterId as string})`);
  // Entering a new strike sequence — reset the attacker's Step 1 window and agent roll.
  return {
    state: { ...state, combat: { ...combat, phase: 'resolve-strike', currentStrikeIndex: idx, attackerStep1Done: false, agentRollTotal: undefined } },
  };
}

/** Assign a strike to a defending character. */
function handleAssignStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'assign-strike') return wrongActionType(state, action, 'assign-strike');

  const existingIdx = combat.strikeAssignments.findIndex(a => a.characterId === action.characterId);

  let newAssignments: StrikeAssignment[];

  // Force-single-target (multi-attack): auto-assign all strikes to the chosen character
  if (combat.forceSingleTarget && combat.strikeAssignments.length === 0 && existingIdx < 0) {
    newAssignments = [];
    for (let i = 0; i < combat.strikesTotal; i++) {
      newAssignments.push({
        characterId: action.characterId,
        excessStrikes: 0,
        resolved: false,
      });
    }
    logDetail(`Multi-attack: all ${combat.strikesTotal} strikes auto-assigned to ${action.characterId as string}`);

    let newCombatState: CombatState = { ...combat, strikeAssignments: newAssignments };

    // If cancel-by-tap is available, transition to cancel-by-tap sub-phase
    if (combat.cancelByTapRemaining && combat.cancelByTapRemaining > 0) {
      logDetail(`Cancel-by-tap window: defender may cancel up to ${combat.cancelByTapRemaining} attack(s)`);
      newCombatState = { ...newCombatState, assignmentPhase: 'cancel-by-tap' };
      return { state: { ...state, combat: newCombatState } };
    }

    // Otherwise proceed to strike resolution
    const next = nextStrikePhase(newCombatState);
    newCombatState = { ...newCombatState, assignmentPhase: 'done', ...next };
    return { state: { ...state, combat: newCombatState } };
  }

  // CvCC assignment: no excess strikes — each attacker character backs one strike
  if (combat.isCvCC) {
    newAssignments = handleCvCCAssignment(combat, action);
    logDetail(`CvCC: assignment updated — ${newAssignments.length} assignment(s), attacker ${action.attackingCharacterId as string} → defender ${action.characterId as string}`);

    // Count how many attacking characters have been committed
    const pairedCount = countCvCCPairedAttackers(combat, newAssignments);
    const allPaired = pairedCount >= combat.strikesTotal;

    // In defender-any, also auto-transition when no unassigned defenders remain
    // (remaining unpaired attackers become excess, handled during strike sequence Step 2).
    let noMoreDefenderAny = false;
    if (!allPaired && combat.assignmentPhase === 'defender-any') {
      const assignedDefIds = new Set(newAssignments.map(a => a.characterId as string));
      const defPlayer = playerById(state, combat.defendingPlayerId);
      const atkSrc = combat.attackSource;
      const defCompany = defPlayer && atkSrc.type === 'company-attack'
        ? companyById(defPlayer.companies, combat.companyId)
        : null;
      noMoreDefenderAny = defCompany
        ? defCompany.characters.every(id => assignedDefIds.has(id as string))
        : false;
      if (noMoreDefenderAny) {
        logDetail('CvCC defender-any: no unassigned defenders left, skipping remaining unpaired attackers to excess');
      }
    }

    let newCombatState: CombatState = { ...combat, strikeAssignments: newAssignments };
    if (allPaired || noMoreDefenderAny) {
      // Compute excess pool: attackers beyond 1 per unique defending character
      const uniqueDefs = new Set(newAssignments.map(a => a.characterId as string)).size;
      const excessPool = combat.strikesTotal - uniqueDefs;
      const next = nextStrikePhase(newCombatState);
      newCombatState = { ...newCombatState, assignmentPhase: 'done', cvccExcessPool: excessPool > 0 ? excessPool : undefined, ...next };
    }
    return { state: { ...state, combat: newCombatState } };
  }

  if (existingIdx >= 0) {
    newAssignments = combat.strikeAssignments.map((a, i) =>
      i === existingIdx ? { ...a, excessStrikes: a.excessStrikes + 1 } : a,
    );
    logDetail(`Excess strike assigned to ${action.characterId as string} (now ${newAssignments[existingIdx].excessStrikes} excess)`);
  } else {
    // Normal assignment: new strike to this character
    newAssignments = [...combat.strikeAssignments, {
      characterId: action.characterId,
      excessStrikes: 0,
      resolved: false,
    }];
    logDetail(`Strike assigned to ${action.characterId as string} (${newAssignments.length}/${combat.strikesTotal})`);
  }

  const newTotalAllocated = newAssignments.length
    + newAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  const allAssigned = newTotalAllocated >= combat.strikesTotal;

  let newCombatState: CombatState = { ...combat, strikeAssignments: newAssignments };
  if (allAssigned) {
    const next = nextStrikePhase(newCombatState);
    newCombatState = { ...newCombatState, assignmentPhase: 'done', ...next };
  }

  return { state: { ...state, combat: newCombatState } };
}

/**
 * Counts how many attacking characters have been paired with a defender in CvCC.
 * A paired attacker appears as `attackingCharacterId` on at least one assignment.
 */
function countCvCCPairedAttackers(
  _combat: CombatState,
  assignments: readonly StrikeAssignment[],
): number {
  const paired = new Set(
    assignments
      .map(a => a.attackingCharacterId)
      .filter(Boolean),
  );
  return paired.size;
}

/**
 * Apply a CvCC strike assignment action to the current assignments array.
 *
 * Every CvCC assignment always has both `characterId` AND `attackingCharacterId`
 * set — there are no blind reservations. Both the defender phase (defender picks
 * their char AND the attacker) and the attacker/defender-any phases create
 * fully-paired entries directly.
 */
function handleCvCCAssignment(
  combat: CombatState,
  action: { readonly characterId: CardInstanceId; readonly attackingCharacterId?: CardInstanceId },
): StrikeAssignment[] {
  // Always create a new fully-paired entry (no reservation path)
  return [...combat.strikeAssignments, {
    characterId: action.characterId,
    attackingCharacterId: action.attackingCharacterId,
    excessStrikes: 0,
    resolved: false,
  }];
}

/** CvCC rule 3.V.ii: attacker allocates one excess strike as -1 to current strike's defender. */
function handleAllocateCvccExcess(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'allocate-cvcc-excess') return wrongActionType(state, action, 'allocate-cvcc-excess');
  const pool = combat.cvccExcessPool ?? 0;
  if (pool <= 0) return { state, error: 'No excess strikes left to allocate' };
  const sa = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!sa) return { state, error: 'No current strike to apply excess to' };
  const updatedAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex ? { ...a, excessStrikes: a.excessStrikes + 1 } : a,
  );
  logDetail(`CvCC excess allocation: -1 applied to strike ${combat.currentStrikeIndex} (${pool - 1} remaining in pool)`);
  return {
    state: { ...state, combat: { ...combat, strikeAssignments: updatedAssignments, cvccExcessPool: pool - 1 || undefined } },
  };
}

/** Defender passes during strike assignment — attacker assigns remaining. */


function handleCombatPass(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass');

  // CoE rule 3.iv.1 — attacker ends their Step 1 priority window, allowing
  // the defender to proceed with strike resolution (Steps 2-7).
  if (combat.phase === 'resolve-strike' && action.player === combat.attackingPlayerId && !combat.attackerStep1Done) {
    logDetail('Attacker passed Step 1 (hazard play window) — defender may resolve the strike');
    return {
      state: { ...state, combat: { ...combat, attackerStep1Done: true } },
    };
  }

  // Pass during trophy-offer: defending player declines to take a trophy.
  if (combat.phase === 'trophy-offer') {
    return finalizeCombatFromTrophyOffer(state, combat);
  }

  // Pass during item-salvage: player declines further transfers, discard remaining items
  if (combat.phase === 'item-salvage') {
    logDetail('Defender passed item-salvage — discarding remaining items');
    const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
    const salvageItems = combat.salvageItems ?? [];
    for (const item of salvageItems) {
      logDetail(`Discarding unsalvaged item ${item.instanceId as string}`);
    }
    const nextState = updatePlayer(state, defIdx, p => ({
      ...p,
      discardPile: [
        ...p.discardPile,
        ...salvageItems.map(item => (toCardInstance(item))),
      ],
    }));
    return finishSalvage(nextState, combat);
  }

  // Pass during cancel-by-tap sub-phase: proceed to strike resolution
  if (combat.phase === 'assign-strikes' && combat.assignmentPhase === 'cancel-by-tap') {
    logDetail('Defender passed cancel-by-tap — proceeding to strike resolution');
    const next = nextStrikePhase(combat);
    return {
      state: { ...state, combat: { ...combat, assignmentPhase: 'done', ...next } },
    };
  }

  // Pass during cancel-window: defender declined to cancel. If the window was
  // entered due to attacker-chooses-defenders, the attacker assigns next; if
  // it was entered solely for a haven-jump offer (no attacker-chooses), the
  // defender is the normal next assigner. Pending haven-jump offers are
  // consumed on pass — the player declined.
  if (combat.phase === 'assign-strikes' && combat.assignmentPhase === 'cancel-window') {
    const next = combat.attackerChoosesDefenders ? 'attacker' : 'defender';
    logDetail(`Defender passed cancel window — transitioning to ${next} assignment`);
    return {
      state: { ...state, combat: { ...combat, assignmentPhase: next, havenJumpOffers: undefined } },
    };
  }

  // CvCC phase transitions (rule 8.38 three-phase assignment)
  if (combat.isCvCC && combat.phase === 'assign-strikes') {
    if (combat.assignmentPhase === 'defender') {
      // Defender done — attacker assigns their untapped characters
      logDetail('CvCC: defender passed phase 1 — transitioning to attacker assignment');
      return {
        state: { ...state, combat: { ...combat, assignmentPhase: 'attacker' } },
      };
    }

    if (combat.assignmentPhase === 'attacker') {
      // Attacker done — check if any unpaired attackers remain
      const pairedCount = countCvCCPairedAttackers(combat, combat.strikeAssignments);
      if (pairedCount < combat.strikesTotal) {
        // Only enter defender-any if there are unassigned defending characters left.
        // If all defenders already have an assignment, excess attackers are resolved
        // as a prowess pool (Step 2 of each strike sequence) — skip defender-any.
        const assignedDefIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
        const defPlayer = playerById(state, combat.defendingPlayerId);
        const defCompany = defPlayer
          ? companyById(defPlayer.companies, combat.companyId)
          : null;
        const hasUnassignedDefs = defCompany
          ? defCompany.characters.some(id => !assignedDefIds.has(id as string))
          : false;
        if (hasUnassignedDefs) {
          logDetail(`CvCC: attacker passed phase 2 — ${combat.strikesTotal - pairedCount} unpaired attacker(s), entering defender-any`);
          return {
            state: { ...state, combat: { ...combat, assignmentPhase: 'defender-any' } },
          };
        }
        logDetail(`CvCC: attacker passed phase 2 — unpaired attackers are excess (no unassigned defenders), skipping defender-any`);
      }
      // All attackers paired (or no unassigned defenders remain) — proceed to resolve
      const uniqueDefs = new Set(combat.strikeAssignments.map(a => a.characterId as string)).size;
      const excessPool = combat.strikesTotal - uniqueDefs;
      logDetail('CvCC: transitioning to resolve');
      const next = nextStrikePhase(combat);
      return {
        state: { ...state, combat: { ...combat, assignmentPhase: 'done', cvccExcessPool: excessPool > 0 ? excessPool : undefined, ...next } },
      };
    }
  }

  const totalAllocated = combat.strikeAssignments.length
    + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  const strikesRemaining = combat.strikesTotal - totalAllocated;

  // If no strikes remain, transition to resolve (via choose-strike-order if multiple)
  if (strikesRemaining <= 0) {
    logDetail('Defender passed with all strikes assigned — transitioning to resolve');
    const next = nextStrikePhase(combat);
    return {
      state: { ...state, combat: { ...combat, assignmentPhase: 'done', ...next } },
    };
  }

  logDetail(`Defender passed — ${strikesRemaining} strike(s) remaining, attacker assigns`);
  return {
    state: { ...state, combat: { ...combat, assignmentPhase: 'attacker' } },
  };
}

/**
 * Computes the per-strike prowess adjustment a creature gains against the
 * specific defending character based on its own `stat-modifier` self-effects
 * that are gated on the defender's race (e.g. Old Man Willow's "15 prowess
 * against Hobbits", encoded as `+2 when defender.race = hobbit`).
 *
 * Such modifiers cannot be folded into `combat.strikeProwess` at combat
 * initiation: the struck character — and therefore its race — is not known
 * until strike assignment. The defending company's *alignment* IS known at
 * initiation, so alignment-gated self-modifiers (e.g. Elf-lord Revealed in
 * Wrath's "+4 vs Ringwraith") are already baked into `strikeProwess`. To avoid
 * double-counting them, a modifier contributes here only when it matches the
 * struck character's race context but did NOT already match the race-less
 * (initiation-equivalent) context.
 *
 * Returns the extra prowess for this strike (0 when the source is not a
 * creature hazard, or no defender-race-gated modifier matches).
 */
function creatureDefenderProwessDelta(
  state: GameState,
  combat: CombatState,
  charDef: CardDefinition | undefined,
): number {
  if (combat.attackSource.type !== 'creature') return 0;
  if (!charDef || !isCharacterCard(charDef)) return 0;
  const creatureDefId = resolveInstanceId(state, combat.attackSource.instanceId);
  const creatureDef = creatureDefId ? defById(state, creatureDefId) : undefined;
  if (!creatureDef) return 0;
  const effects = getCardEffects(creatureDef);
  if (!effects.length) return 0;

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defenderAlignment = defenderAlignmentLabel(state.players[defPlayerIndex].alignment);
  const enemy = { race: combat.creatureRace ?? '', name: creatureDef.name ?? '', prowess: combat.strikeProwess, body: combat.creatureBody };
  // Race-less context mirrors what was available at combat initiation: the
  // defending company's alignment is known, an individual character's race is not.
  const baseCtx = {
    reason: 'combat' as const,
    inPlay: buildInPlayNames(state),
    enemy,
    defender: { alignment: defenderAlignment },
  };
  // Context augmented with the struck character's race.
  const raceCtx = { ...baseCtx, defender: { alignment: defenderAlignment, race: charDef.race } };

  let delta = 0;
  for (const effect of effects) {
    if (effect.type !== 'stat-modifier' || effect.stat !== 'prowess') continue;
    if (effect.target) continue; // company/all-* scoped modifiers are not the creature's own strike bonus
    if (!effect.when) continue; // unconditional modifiers are already in strikeProwess
    if (typeof effect.value !== 'number') continue;
    if (matchesContext(effect.when, raceCtx) && !matchesContext(effect.when, baseCtx)) {
      delta += effect.value;
      logDetail(`Creature "${creatureDef.name}" prowess ${formatSignedNumber(effect.value)} against ${charDef.race}${charDef.name ? ` (${charDef.name})` : ''}`);
    }
  }
  return delta;
}

/**
 * Core strike resolution shared by `resolve-strike`, `play-dodge`, and
 * `play-reroll-strike`.
 *
 * Rolls 2d6 + prowess vs strike prowess, determines the outcome, applies
 * tap/wound to the character or ally, and advances combat to body-check or
 * the next strike. The four resolution modes differ only in:
 * - prowess modifier (stay-untapped takes -3; tap, dodge, and reroll are full)
 * - whether the character taps on success/tie (reroll taps like tap mode)
 * - dodge adds a body penalty for the resulting body check
 * - reroll makes two 2d6 rolls and keeps the better total
 *
 * `preAppliedDefender` lets callers pre-mutate the defender (e.g. dodge
 * discards a card from hand before resolving); this must NOT alter
 * characters or companies, only piles.
 */
function resolveStrikeCore(
  state: GameState,
  combat: CombatState,
  mode: 'tap' | 'untap' | 'dodge' | 'reroll',
  dodgeBodyPenalty: number,
  preAppliedDefender: PlayerState | null,
): ReducerResult {
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike || strike.resolved) return { state, error: 'Current strike already resolved' };

  // Look up combatant stats — may be a character or an ally (CoE rule 2.V.2.2)
  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = preAppliedDefender ?? state.players[defPlayerIndex];
  const charData = defPlayer.characters[strike.characterId as string];
  const company = companyById(defPlayer.companies, combat.companyId);
  const allyMatch = !charData && company
    ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
    : undefined;
  if (!charData && !allyMatch) return { state, error: 'Character not found' };

  const targetDefId = charData?.definitionId ?? allyMatch!.ally.definitionId;
  const targetStatus = charData?.status ?? allyMatch!.ally.status;
  const charDef = defById(state, targetDefId);

  // Compute effective prowess
  let prowess: number;
  if (combat.defenderProwessFromMind && !allyMatch && charDef && isCharacterCard(charDef) && charDef.mind !== null) {
    // Neeker-breekers: use the character's mind attribute as base prowess
    prowess = charDef.mind;
    logDetail(`Defender prowess from mind: ${charDef.mind} (${charDef.name ?? targetDefId as string})`);
  } else if (allyMatch) {
    prowess = allyEffectiveProwess(state, allyMatch.ally);
  } else if (combat.creatureRace && charDef && isCharacterCard(charDef)) {
    prowess = computeCombatProwess(state, charData, charDef, combat.creatureRace);
  } else {
    prowess = charData.effectiveStats.prowess;
  }
  if (mode === 'untap') prowess -= 3; // Stay untapped penalty
  if (targetStatus === CardStatus.Tapped) prowess -= 1;
  if (targetStatus === CardStatus.Inverted) prowess -= 2; // Wounded
  if (strike.excessStrikes > 0) prowess -= strike.excessStrikes;
  const supportBonus = strike.supportCount ?? 0;
  prowess += supportBonus; // CoE rule 3.iv.4: +1 per supporting character/ally
  const modifyStrikeBonus = strike.strikeProwessBonus ?? 0;
  if (modifyStrikeBonus !== 0) {
    logDetail(`Strike event prowess modifier: ${formatSignedNumber(modifyStrikeBonus)}`);
    prowess += modifyStrikeBonus;
  }

  // Roll dice. Reroll mode makes two rolls and keeps the better total; the
  // discarded roll is logged and emitted as an effect so both rolls appear
  // in history.
  let roll;
  let rng;
  let cheatRollTotal;
  const rollLabel = mode === 'dodge' ? 'Strike (dodge)' : mode === 'reroll' ? 'Strike (reroll)' : 'Strike';
  const charLabel = charDef?.name ?? (targetDefId as string);
  const effects: GameEffect[] = [];

  if (mode === 'reroll') {
    const r1 = roll2d6(state);
    const r2 = roll2d6({ ...state, rng: r1.rng, cheatRollTotal: r1.cheatRollTotal });
    const t1 = r1.roll.die1 + r1.roll.die2;
    const t2 = r2.roll.die1 + r2.roll.die2;
    const firstBetter = t1 >= t2;
    const kept = firstBetter ? r1 : r2;
    const discarded = firstBetter ? r2 : r1;
    roll = kept.roll;
    rng = r2.rng;
    cheatRollTotal = r2.cheatRollTotal;
    logDetail(`${rollLabel}: rolled ${r1.roll.die1}+${r1.roll.die2}=${t1} and ${r2.roll.die1}+${r2.roll.die2}=${t2} → keeping ${kept.roll.die1}+${kept.roll.die2}=${kept.roll.die1 + kept.roll.die2}`);
    effects.push(diceRollEffect(defPlayer.name, discarded.roll, `${rollLabel} (discarded): ${charLabel}`));
    effects.push(diceRollEffect(defPlayer.name, kept.roll, `${rollLabel}: ${charLabel}`));
  } else {
    const single = roll2d6(state);
    roll = single.roll;
    rng = single.rng;
    cheatRollTotal = single.cheatRollTotal;
    effects.push(diceRollEffect(defPlayer.name, roll, `${rollLabel}: ${charLabel}`));
  }

  const rollTotal = roll.die1 + roll.die2;
  const characterTotal = rollTotal + prowess;
  // For agent attacks, compare against the agent's rolled total (rule 3.iv.6.1).
  // A creature may gain prowess against the specific character it strikes
  // (e.g. Old Man Willow's "15 prowess against Hobbits"). This depends on the
  // defender's race, unknown until now, so it is applied per strike here.
  const defenderProwessDelta = combat.attackSource.type === 'agent' ? 0 : creatureDefenderProwessDelta(state, combat, charDef);
  const effectiveProwess = (combat.attackSource.type === 'agent' && combat.agentRollTotal !== undefined
    ? combat.agentRollTotal
    : combat.strikeProwess) + defenderProwessDelta;
  logDetail(`${rollLabel} resolution: ${targetDefId as string} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${prowess} = ${characterTotal} vs ${combat.attackSource.type === 'agent' ? `agent roll ${effectiveProwess}` : `creature prowess ${effectiveProwess}`}`);

  // Determine outcome
  let result: 'success' | 'wounded' | 'eliminated';
  let bodyCheckTarget: 'character' | 'creature' | null = null;
  if (characterTotal > effectiveProwess) {
    result = 'success';
    if (combat.creatureBody !== null) bodyCheckTarget = 'creature';
    logDetail(`Character defeats strike — ${bodyCheckTarget ? 'body check vs creature' : 'creature has no body'}`);
  } else if (characterTotal < effectiveProwess) {
    result = 'wounded';
    if (combat.detainment) {
      logDetail('Strike succeeds — detainment: character tapped, no body check');
    } else {
      bodyCheckTarget = 'character';
      logDetail('Strike succeeds — character wounded, body check vs character');
    }
  } else {
    result = 'success';
    logDetail(`Tie — ineffectual${mode === 'dodge' ? ' (dodge: no tap)' : ', character taps'}`);
  }

  // An Article Missing (dm-43): on a successful agent strike the defender is not
  // wounded; the company must instead discard one item of their choice.
  const discardItemEffect = result === 'wounded' && !combat.detainment && combat.strikeEffect === 'discard-item';
  if (discardItemEffect) {
    logDetail('An Article Missing: successful strike — character not wounded; company must discard one item');
    result = 'success';
    bodyCheckTarget = null;
  }

  // take-prisoner (e.g. Flies and Spiders dm-58): if the strike succeeds
  // against a character (not an ally) who has a hazard with a take-prisoner
  // effect, the character is taken prisoner instead of wounded.
  // Rule 8.35: allies cannot be taken prisoner — this only fires for characters.
  const takePrisonerResult = result === 'wounded' && !combat.detainment && !allyMatch && !discardItemEffect && charData
    ? findTakePrisonerHazard(state, defPlayerIndex, charData.hazards)
    : null;

  // Troll-purse (dm-95): a successful strike from a re-faced automatic-attack
  // takes the character prisoner at the bound site instead of wounding. Carried
  // on the combat as `trollPursePrisoner` (set by buildSiteReFaceCombat).
  const trollPursePrisoner = result === 'wounded' && !combat.detainment && !allyMatch && !discardItemEffect && !takePrisonerResult && charData
    ? combat.trollPursePrisoner ?? null
    : null;

  // absorb-wound (e.g. Sable Shield le-341): if a successful strike would wound
  // the bearer (not an ally, not detainment, not already handled), check if any
  // item on the character has an absorb-wound effect. If so, the wound is
  // prevented; the combat transitions to shield-discard-roll so the attacker
  // rolls to determine whether the shield is discarded.
  const absorbWoundItem = result === 'wounded' && !combat.detainment && !allyMatch && !discardItemEffect && !takePrisonerResult && !trollPursePrisoner && charData
    ? charData.items.find(item => {
        const def = state.cardPool[item.definitionId as string] as { effects?: readonly AbsorbWoundEffect[] } | undefined;
        return (def?.effects ?? []).some(e => e.type === 'absorb-wound');
      })
    : null;

  if (absorbWoundItem) {
    logDetail(`absorb-wound: ${absorbWoundItem.instanceId as string} absorbs strike — ${strike.characterId as string} not wounded`);
    // Use 'success' locally so the character taps (not wounds) in the status
    // application block below. The assignment records 'absorbed' so finalizeCombat
    // does not count this as a creature defeat.
    result = 'success';
    bodyCheckTarget = null;
  }

  // Whether the combatant taps on a non-wounded outcome:
  //  - tap:    always (success or tie)
  //  - reroll: always (same as tap)
  //  - untap:  only on tie
  //  - dodge:  never
  const tapOnNonWounded =
    mode === 'tap' ||
    mode === 'reroll' ||
    (mode === 'untap' && characterTotal === effectiveProwess);

  // Record strike assignment. Dodge tags the strike so the body check picks
  // up the body penalty (CoE rule 3.I +1 for already-wounded still applies).
  // absorb-wound: record 'absorbed' (not 'success') so finalizeCombat does not
  // treat the absorb as a creature defeat.
  const wasAlreadyWounded = targetStatus === CardStatus.Inverted;
  const assignmentResult = absorbWoundItem ? ('absorbed' as const) : result;
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? {
          ...a,
          resolved: true,
          result: assignmentResult,
          wasAlreadyWounded,
          ...(mode === 'dodge' ? { dodged: true, dodgeBodyPenalty } : {}),
        }
      : a,
  );

  // wound-eliminates (Shelob's Lair spider, le-402): a wound dealt by this
  // attack eliminates the combatant immediately — no body check. Effects that
  // replace the wound entirely (absorb-wound and discard-item set result to
  // 'success'; take-prisoner is excluded explicitly) were handled above, so
  // only a genuine wound reaches here. Detainment strikes tap, never wound.
  if (combat.woundEliminates && result === 'wounded' && !combat.detainment && !takePrisonerResult && !trollPursePrisoner) {
    logDetail(`wound-eliminates: ${strike.characterId as string} wounded by ${combat.creatureRace ?? 'attack'} — immediately eliminated (no body check)`);
    return eliminateCombatantFromStrike(
      { ...state, rng, cheatRollTotal },
      { ...combat, strikeAssignments: newAssignments },
      effects,
    );
  }

  // Apply tap/wound to character or ally
  const newPlayers = clonePlayers(state);
  if (preAppliedDefender) newPlayers[defPlayerIndex] = preAppliedDefender;
  const workingDefender = newPlayers[defPlayerIndex];
  const newCharacters = { ...workingDefender.characters };

  if (allyMatch) {
    const hostChar = newCharacters[allyMatch.hostCharId as string];
    if (hostChar) {
      let newAllyStatus = allyMatch.ally.status;
      if (tapOnNonWounded && newAllyStatus === CardStatus.Untapped) {
        newAllyStatus = CardStatus.Tapped;
      }
      if (result === 'wounded' && !combat.detainment) {
        newAllyStatus = CardStatus.Inverted;
      } else if (result === 'wounded' && combat.detainment) {
        newAllyStatus = CardStatus.Tapped;
      }
      const newAllies = hostChar.allies.map(a =>
        a.instanceId === strike.characterId ? { ...a, status: newAllyStatus } : a,
      );
      newCharacters[allyMatch.hostCharId as string] = { ...hostChar, allies: newAllies };
    }
  } else {
    if (takePrisonerResult || trollPursePrisoner) {
      // take-prisoner: character is not wounded; instead they become a prisoner.
      // Status stays as-is (not tapped, not wounded). Rule 8.35.
      const captor = takePrisonerResult?.hostCard.instanceId ?? trollPursePrisoner?.hostInstanceId;
      logDetail(`take-prisoner: ${strike.characterId as string} is taken prisoner by ${captor as string}`);
    } else {
      if (tapOnNonWounded && charData.status === CardStatus.Untapped) {
        newCharacters[strike.characterId as string] = { ...charData, status: CardStatus.Tapped };
      }
      if (result === 'wounded' && !combat.detainment) {
        newCharacters[strike.characterId as string] = {
          ...(newCharacters[strike.characterId as string] ?? charData),
          status: CardStatus.Inverted,
        };
      } else if (result === 'wounded' && combat.detainment) {
        newCharacters[strike.characterId as string] = {
          ...(newCharacters[strike.characterId as string] ?? charData),
          status: CardStatus.Tapped,
        };
      }

      // tap-low-mind (e.g. Wisp of Pale Sheen dm-113): "Any character facing a
      // strike whose mind is equal to or lower than the strike's prowess must
      // tap if untapped following the strike." Applies to characters (not
      // allies) regardless of strike outcome; wounded characters are now
      // inverted (not untapped) so are unaffected, as are avatars (mind null).
      if (combat.tapLowMindAfterStrike && charDef && isCharacterCard(charDef) && charDef.mind !== null) {
        const finalChar = newCharacters[strike.characterId as string] ?? charData;
        if (charDef.mind <= combat.strikeProwess && finalChar.status === CardStatus.Untapped) {
          logDetail(`tap-low-mind: ${charLabel} mind ${charDef.mind} ≤ strike prowess ${combat.strikeProwess} — tapping following the strike`);
          newCharacters[strike.characterId as string] = { ...finalChar, status: CardStatus.Tapped };
        }
      }
    }
  }
  newPlayers[defPlayerIndex] = { ...workingDefender, characters: newCharacters, lastDiceRoll: roll };

  // Apply prisoner-taking: discard non-ring items, revert followers to GI,
  // add character-is-prisoner constraint, create HazardHost record.
  let postPrisonerState: GameState = { ...state, players: newPlayers, rng, cheatRollTotal };

  if (takePrisonerResult && charData) {
    postPrisonerState = applyTakePrisoner(
      postPrisonerState,
      defPlayerIndex,
      strike.characterId,
      takePrisonerResult,
    );
    // Override result and bodyCheckTarget: prisoner-taking skips wound/body-check
    bodyCheckTarget = null;
  } else if (trollPursePrisoner && charData) {
    postPrisonerState = applyTakePrisonerAtSite(
      postPrisonerState,
      defPlayerIndex,
      strike.characterId,
      trollPursePrisoner.hostInstanceId,
      trollPursePrisoner.siteInstanceId,
    );
    bodyCheckTarget = null;
  }

  // absorb-wound: shield absorbed the strike; transition to shield-discard-roll
  // so the attacking player rolls to determine if the shield is discarded.
  if (absorbWoundItem) {
    const combatWithShieldRoll: CombatState = {
      ...combat,
      strikeAssignments: newAssignments,
      phase: 'shield-discard-roll',
      shieldAbsorbItemId: absorbWoundItem.instanceId,
    };
    return { state: { ...postPrisonerState, combat: combatWithShieldRoll }, effects };
  }

  // Advance combat: body check, next strike, or finalize
  let newCombat: CombatState;
  if (bodyCheckTarget) {
    newCombat = { ...combat, strikeAssignments: newAssignments, phase: 'body-check', bodyCheckTarget };
    return { state: { ...postPrisonerState, combat: newCombat }, effects };
  } else {
    const combatWithAssignments = { ...combat, strikeAssignments: newAssignments };

    // An Article Missing: enter discard-item-from-company phase so the defender
    // must choose one item to discard before combat continues.
    if (discardItemEffect) {
      const companyCharIds = company?.characters ?? [];
      const allItems: ItemInPlay[] = companyCharIds.flatMap(charId => {
        const ch = newPlayers[defPlayerIndex].characters[charId as string];
        return ch ? [...ch.items] : [];
      });
      if (allItems.length > 0) {
        logDetail(`Entering discard-item-from-company phase: ${allItems.length} item(s) available`);
        newCombat = { ...combatWithAssignments, phase: 'discard-item-from-company', discardItemOptions: allItems };
        return { state: { ...postPrisonerState, combat: newCombat }, effects };
      }
      logDetail('An Article Missing: no items in company — discard-item effect skipped');
    }

    const next = nextStrikePhase(combatWithAssignments);
    if (!next) {
      return finalizeCombat({ ...postPrisonerState, combat: combatWithAssignments }, effects);
    }
    newCombat = { ...combatWithAssignments, ...next };
  }

  return {
    state: { ...postPrisonerState, combat: newCombat },
    effects,
  };
}

/**
 * Eliminate the combatant (character or ally) targeted by the current strike,
 * regardless of any body check. Shared by the failed-body-check path
 * (`effectiveRoll > body`) and by "immediate elimination" attack rules such as
 * the Spider at Shelob's Lair (le-402, `wound-eliminates`). Per CoE rule 3.i.5
 * any remaining unresolved strikes against the same combatant auto-resolve as
 * successful; per CoE rule 3.I.2 each unwounded companion may salvage one of the
 * eliminated character's items. Allies are eliminated to the out-of-play pile
 * (CoE 2.V.2.2); their host's other cards are untouched.
 *
 * The current strike assignment is marked `'eliminated'`; the caller is
 * responsible for having already recorded it as `resolved` if needed.
 *
 * @param state - Current game state. For body checks this is the post-roll
 *   state; for immediate elimination it is the post-strike state.
 * @param combat - The active combat state (its `strikeAssignments` are rewritten).
 * @param effects - Accumulated game effects (e.g. dice rolls) to thread through.
 */
function eliminateCombatantFromStrike(
  state: GameState,
  combat: CombatState,
  effects: GameEffect[],
): ReducerResult {
  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  const charData = defPlayer.characters[strike.characterId as string];
  const company = companyById(defPlayer.companies, combat.companyId);
  const allyMatch = !charData && company
    ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
    : undefined;

  // Per CoE rule 3.i.5: remaining unresolved strikes assigned to the same
  // combatant are considered successful (defeated by the defender).
  const newAssignments = combat.strikeAssignments.map((a, i) => {
    if (i === combat.currentStrikeIndex) return { ...a, resolved: true, result: 'eliminated' as const };
    if (!a.resolved && a.characterId === strike.characterId) {
      logDetail(`Strike ${i} auto-resolved as successful (eliminated combatant, CoE 3.i.5)`);
      return { ...a, resolved: true, result: 'success' as const };
    }
    return a;
  });

  const newPlayers2 = clonePlayers(state);
  const newPlayerData = { ...defPlayer };
  const combatWithElim = { ...combat, strikeAssignments: newAssignments };

  if (allyMatch) {
    // Ally eliminated — remove from host character and send to eliminated pile.
    const hostChar = newPlayerData.characters[allyMatch.hostCharId as string];
    if (hostChar) {
      const newAllies = hostChar.allies.filter(a => a.instanceId !== strike.characterId);
      newPlayerData.characters = {
        ...newPlayerData.characters,
        [allyMatch.hostCharId as string]: { ...hostChar, allies: newAllies },
      };
    }
    newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, {
      instanceId: strike.characterId,
      definitionId: allyMatch.ally.definitionId,
    }];
    newPlayers2[defPlayerIndex] = newPlayerData;

    const next2a = nextStrikePhase(combatWithElim);
    if (next2a) {
      return { state: { ...state, players: newPlayers2, combat: { ...combatWithElim, ...next2a } }, effects };
    }
    return finalizeCombat({ ...state, players: newPlayers2, combat: combatWithElim }, effects);
  }

  // Character eliminated — remove from company and add to eliminated pile
  if (company) {
    newPlayerData.companies = newPlayerData.companies.map(c =>
      c.id === combat.companyId
        ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
        : c,
    );
  }
  const elimCharDefId = resolveInstanceId(state, strike.characterId);
  newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, { instanceId: strike.characterId, definitionId: elimCharDefId! }];

  // Discard allies on the eliminated character immediately; hazards go to opposing (hazard) player
  for (const ally of charData.allies) {
    logDetail(`Discarding ally ${ally.instanceId as string} from eliminated character`);
    newPlayerData.discardPile = [...newPlayerData.discardPile, toCardInstance(ally)];
  }
  newPlayers2[defPlayerIndex] = newPlayerData;
  const hazardPlayerElim = newPlayers2[1 - defPlayerIndex];
  let hazardDiscardElim = [...hazardPlayerElim.discardPile];
  for (const hazard of charData.hazards) {
    logDetail(`Discarding hazard ${hazard.instanceId as string} from eliminated character`);
    hazardDiscardElim = [...hazardDiscardElim, toCardInstance(hazard)];
  }
  newPlayers2[1 - defPlayerIndex] = { ...hazardPlayerElim, discardPile: hazardDiscardElim };

  const { [strike.characterId as string]: _, ...remainingChars } = newPlayers2[defPlayerIndex].characters;
  const prunedChars = pruneLeaderFollowers(remainingChars, strike.characterId, charData.controlledBy);
  newPlayers2[defPlayerIndex] = { ...newPlayers2[defPlayerIndex], characters: prunedChars };

  // Per CoE rule 3.I.2: for each unwounded character in the same company,
  // an item the eliminated character controlled may be transferred (one per recipient).
  const salvageItems = charData.items;
  const unwoundedRecipients: CardInstanceId[] = company
    ? company.characters
      .filter(ch => ch !== strike.characterId)
      .filter(ch => {
        const cd = newPlayerData.characters[ch as string];
        return cd && cd.status !== CardStatus.Inverted;
      })
    : [];

  if (salvageItems.length > 0 && unwoundedRecipients.length > 0) {
    logDetail(`Entering item-salvage phase: ${salvageItems.length} item(s) available, ${unwoundedRecipients.length} unwounded recipient(s)`);
    const combatWithSalvage: CombatState = {
      ...combatWithElim,
      phase: 'item-salvage',
      salvageItems,
      salvageRecipients: unwoundedRecipients,
    };
    return { state: { ...state, players: newPlayers2, combat: combatWithSalvage }, effects };
  }

  // No items or no recipients — discard all items immediately
  for (const item of salvageItems) {
    logDetail(`Discarding item ${item.instanceId as string} (no salvage possible)`);
    newPlayers2[defPlayerIndex] = {
      ...newPlayers2[defPlayerIndex],
      discardPile: [...newPlayers2[defPlayerIndex].discardPile, toCardInstance(item)],
    };
  }

  // Advance to next strike or finalize
  const next2 = nextStrikePhase(combatWithElim);
  if (next2) {
    return { state: { ...state, players: newPlayers2, combat: { ...combatWithElim, ...next2 } }, effects };
  }
  return finalizeCombat({ ...state, players: newPlayers2, combat: combatWithElim }, effects);
}

/** Resolve the current strike — roll dice and determine outcome. */
function handleResolveStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'resolve-strike') return wrongActionType(state, action, 'resolve-strike');

  // CvCC two-step sub-phase
  if (combat.isCvCC) {
    const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
    if (!currentStrike) return { state, error: 'No current strike' };

    if (currentStrike.attackerTapToFight === undefined) {
      // Sub-step 1: attacker declares their -3 choice
      logDetail(`CvCC sub-step 1: attacker ${action.tapToFight ? 'taps' : 'stays untapped (-3)'}`);
      const newAssignments = combat.strikeAssignments.map((a, i) =>
        i === combat.currentStrikeIndex
          ? { ...a, attackerTapToFight: action.tapToFight }
          : a,
      );
      return {
        state: { ...state, combat: { ...combat, strikeAssignments: newAssignments } },
      };
    }

    // Sub-step 2: defender resolves — both sides roll and compare
    return resolveStrikeCvCC(state, combat, action.tapToFight);
  }

  return resolveStrikeCore(state, combat, action.tapToFight ? 'tap' : 'untap', 0, null);
}

/**
 * CvCC dual-roll strike resolution (rule 8.38–8.39).
 *
 * Both sides roll 2d6 + prowess. Higher total wins; the loser is wounded
 * (body check). On a tie, both tap (unless they chose to stay untapped).
 *
 * Attacker's tap choice was already stored in `attackerTapToFight`.
 * Defender's tap choice is passed as `defenderTapToFight`.
 *
 * Prowess modifiers:
 * - Attacker: effectiveStats.prowess, −3 if !attackerTapToFight, −1 if tapped, −2 if wounded
 * - Defender: effectiveStats.prowess, −3 if !defenderTapToFight, −1 if tapped, −2 if wounded
 * - Support bonus applied to each side separately via supportCount
 */
function resolveStrikeCvCC(
  state: GameState,
  combat: CombatState,
  defenderTapToFight: boolean,
): ReducerResult {
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike || strike.resolved) return { state, error: 'Current strike already resolved or missing' };
  if (strike.attackingCharacterId == null) return { state, error: 'CvCC strike has no attacking character' };
  if (strike.attackerTapToFight === undefined) return { state, error: 'Attacker has not declared -3 choice' };

  const atkSource = combat.attackSource;
  if (atkSource.type !== 'company-attack') return { state, error: 'Not a CvCC attack' };

  // Look up attacker character
  const atkPlayerIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const atkPlayer = state.players[atkPlayerIdx];
  const atkCharData = atkPlayer.characters[strike.attackingCharacterId as string];
  if (!atkCharData) return { state, error: `Attacking character ${strike.attackingCharacterId as string} not found` };
  const atkCharDef = defById(state, atkCharData.definitionId);
  const atkCharName = (atkCharDef as { name?: string } | undefined)?.name ?? (strike.attackingCharacterId as string);

  // Look up defender character
  const defPlayerIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIdx];
  const defCharData = defPlayer.characters[strike.characterId as string];
  if (!defCharData) return { state, error: `Defending character ${strike.characterId as string} not found` };
  const defCharDef = defById(state, defCharData.definitionId);
  const defCharName = (defCharDef as { name?: string } | undefined)?.name ?? (strike.characterId as string);

  // Compute attacker prowess
  let atkProwess = atkCharData.effectiveStats.prowess;
  if (!strike.attackerTapToFight) atkProwess -= 3;
  if (atkCharData.status === CardStatus.Tapped) atkProwess -= 1;
  if (atkCharData.status === CardStatus.Inverted) atkProwess -= 2;

  // Compute defender prowess
  let defProwess = defCharData.effectiveStats.prowess;
  if (!defenderTapToFight) defProwess -= 3;
  if (defCharData.status === CardStatus.Tapped) defProwess -= 1;
  if (defCharData.status === CardStatus.Inverted) defProwess -= 2;
  defProwess += (strike.supportCount ?? 0);
  defProwess += (strike.strikeProwessBonus ?? 0);

  // Roll for attacker
  const atkRollResult = roll2d6(state);
  const atkRoll = atkRollResult.roll;
  const atkTotal = atkRoll.die1 + atkRoll.die2 + atkProwess;

  // Roll for defender using updated RNG state
  const defState = { ...state, rng: atkRollResult.rng, cheatRollTotal: atkRollResult.cheatRollTotal };
  const defRollResult = roll2d6(defState);
  const defRoll = defRollResult.roll;
  const defTotal = defRoll.die1 + defRoll.die2 + defProwess;

  logDetail(`CvCC dual-roll: ${atkCharName} (${atkPlayer.name}) rolls ${atkRoll.die1}+${atkRoll.die2}=${atkRoll.die1 + atkRoll.die2} + prowess ${atkProwess} = ${atkTotal} (lastDiceRoll → players[${atkPlayerIdx}])`);
  logDetail(`CvCC dual-roll: ${defCharName} (${defPlayer.name}) rolls ${defRoll.die1}+${defRoll.die2}=${defRoll.die1 + defRoll.die2} + prowess ${defProwess} = ${defTotal} (lastDiceRoll → players[${defPlayerIdx}])`);

  const effects: GameEffect[] = [
    diceRollEffect(atkPlayer.name, atkRoll, `CvCC Strike: ${atkCharName}`, atkTotal),
    diceRollEffect(defPlayer.name, defRoll, `CvCC Strike: ${defCharName}`, defTotal),
  ];

  // Determine outcome
  const newPlayers = clonePlayers(state);
  // Store dice rolls so the UI can display them in the text log
  newPlayers[atkPlayerIdx] = { ...newPlayers[atkPlayerIdx], lastDiceRoll: atkRoll };
  newPlayers[defPlayerIdx] = { ...newPlayers[defPlayerIdx], lastDiceRoll: defRoll };

  let defResult: 'success' | 'wounded' | 'eliminated';
  let atkResult: 'success' | 'wounded' | 'eliminated';
  let bodyCheckTarget: 'character' | 'attacker-character' | null = null;
  const defWasAlreadyWounded = defCharData.status === CardStatus.Inverted;

  if (atkTotal > defTotal) {
    // Attacker wins: defender wounded, attacker taps (unless -3)
    defResult = 'wounded';
    atkResult = 'success';
    bodyCheckTarget = 'character';
    logDetail(`CvCC: attacker wins (${atkTotal} > ${defTotal}) — defender wounded`);
    if (strike.attackerTapToFight && atkCharData.status === CardStatus.Untapped) {
      newPlayers[atkPlayerIdx] = updatePlayerCharacterStatus(newPlayers[atkPlayerIdx], strike.attackingCharacterId, CardStatus.Tapped);
      logDetail(`CvCC: attacker taps`);
    }
  } else if (defTotal > atkTotal) {
    // Defender wins: attacker wounded, defender taps (unless -3)
    defResult = 'success';
    atkResult = 'wounded';
    bodyCheckTarget = 'attacker-character';
    logDetail(`CvCC: defender wins (${defTotal} > ${atkTotal}) — attacker wounded`);
    if (defenderTapToFight && defCharData.status === CardStatus.Untapped) {
      newPlayers[defPlayerIdx] = updatePlayerCharacterStatus(newPlayers[defPlayerIdx], strike.characterId, CardStatus.Tapped);
      logDetail(`CvCC: defender taps`);
    }
  } else {
    // Tie: both tap unless -3, no wound, no body check
    defResult = 'success';
    atkResult = 'success';
    bodyCheckTarget = null;
    logDetail(`CvCC: tie (${atkTotal} = ${defTotal}) — both tap (unless -3)`);
    if (strike.attackerTapToFight && atkCharData.status === CardStatus.Untapped) {
      newPlayers[atkPlayerIdx] = updatePlayerCharacterStatus(newPlayers[atkPlayerIdx], strike.attackingCharacterId, CardStatus.Tapped);
    }
    if (defenderTapToFight && defCharData.status === CardStatus.Untapped) {
      newPlayers[defPlayerIdx] = updatePlayerCharacterStatus(newPlayers[defPlayerIdx], strike.characterId, CardStatus.Tapped);
    }
  }

  // Apply wound to loser
  if (defResult === 'wounded') {
    newPlayers[defPlayerIdx] = updatePlayerCharacterStatus(newPlayers[defPlayerIdx], strike.characterId, CardStatus.Inverted);
    logDetail(`CvCC: defending character ${defCharName} is wounded`);
  }
  if (atkResult === 'wounded') {
    newPlayers[atkPlayerIdx] = updatePlayerCharacterStatus(newPlayers[atkPlayerIdx], strike.attackingCharacterId, CardStatus.Inverted);
    logDetail(`CvCC: attacking character ${atkCharName} is wounded`);
  }

  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? {
          ...a,
          resolved: bodyCheckTarget === null,
          result: defResult,
          attackerResult: atkResult,
          wasAlreadyWounded: defWasAlreadyWounded,
        }
      : a,
  );

  const combatWithAssignments: CombatState = {
    ...combat,
    strikeAssignments: newAssignments,
    bodyCheckTarget,
    rng: defRollResult.rng,
    cheatRollTotal: defRollResult.cheatRollTotal,
  } as CombatState & { rng: unknown; cheatRollTotal: unknown };

  const stateWithRoll: GameState = {
    ...state,
    rng: defRollResult.rng,
    cheatRollTotal: defRollResult.cheatRollTotal,
    players: newPlayers,
    combat: combatWithAssignments,
  };

  if (bodyCheckTarget !== null) {
    const combatInBodyCheck: CombatState = { ...combatWithAssignments, phase: 'body-check', bodyCheckTarget };
    return { state: { ...stateWithRoll, combat: combatInBodyCheck }, effects };
  }

  // No body check — advance to next strike
  const next = nextStrikePhase(combatWithAssignments);
  if (!next) {
    return finalizeCombat({ ...stateWithRoll, combat: combatWithAssignments }, effects);
  }
  return { state: { ...stateWithRoll, combat: { ...combatWithAssignments, ...next } }, effects };
}

/** Update a player's character to a new status (inline utility for CvCC). */
function updatePlayerCharacterStatus(
  player: import('../types/state-player.js').PlayerState,
  charId: CardInstanceId,
  status: CardStatus,
): import('../types/state-player.js').PlayerState {
  const ch = player.characters[charId as string];
  if (!ch) return player;
  return {
    ...player,
    characters: {
      ...player.characters,
      [charId as string]: { ...ch, status },
    },
  };
}

/**
 * Attacker rolls 2d6 for the agent's strike (rule 3.iv.6.1).
 * The total (2d6 + agent's modified prowess) is stored as `agentRollTotal`
 * and becomes the effective prowess the defender must beat.
 */
function handleAgentStrikeRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'agent-strike-roll') return wrongActionType(state, action, 'agent-strike-roll');
  if (combat.attackSource.type !== 'agent') return { state, error: 'agent-strike-roll only valid for agent attacks' };

  const atkPlayerIndex = getPlayerIndex(state, combat.attackingPlayerId);
  const atkPlayer = state.players[atkPlayerIndex];

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const agentRollTotal = rollTotal + combat.strikeProwess;

  // Resolve agent name for the log label
  const agentDefId = resolveInstanceId(state, combat.attackSource.instanceId);
  const agentName = agentDefId ? cardName(state, agentDefId, 'Agent') : 'Agent';

  logDetail(`Agent strike roll: ${agentName} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${combat.strikeProwess} = ${agentRollTotal}`);

  const effect = diceRollEffect(atkPlayer.name, roll, `Agent Strike: ${agentName}`);

  return {
    state: { ...state, rng, cheatRollTotal, combat: { ...combat, agentRollTotal } },
    effects: [effect],
  };
}

/** Tap a supporting character for +1 prowess on the current strike. */
function handleSupportStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'support-strike') return wrongActionType(state, action, 'support-strike');

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];

  // Bump the supportCount on the current strike so the +1 modifier is
  // visible to the legal-action computer (updates the displayed "need")
  // and applied by `resolveStrikeCore` when the dice are actually rolled.
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? { ...a, supportCount: (a.supportCount ?? 0) + 1 }
      : a,
  );
  const newSupportCount = (currentStrike?.supportCount ?? 0) + 1;
  const newCombat: CombatState = { ...combat, strikeAssignments: newAssignments };

  // Check if supporter is a character
  const supporterChar = defPlayer.characters[action.supportingCharacterId as string];
  if (supporterChar) {
    const nextState = updatePlayer(state, defPlayerIndex, p =>
      updateCharacter(p, action.supportingCharacterId, c => ({ ...c, status: CardStatus.Tapped })),
    );
    logDetail(`${action.supportingCharacterId as string} taps to support — +1 prowess (total support: +${newSupportCount})`);
    return { state: { ...nextState, combat: newCombat } };
  }

  // Check if supporter is an ally
  const tappedAlly = updateAttachment(defPlayer, 'allies', action.supportingCharacterId, a => ({ ...a, status: CardStatus.Tapped }));
  if (tappedAlly) {
    const nextState = updatePlayer(state, defPlayerIndex, () => tappedAlly.player);
    logDetail(`Ally ${action.supportingCharacterId as string} taps to support — +1 prowess (total support: +${newSupportCount})`);
    return { state: { ...nextState, combat: newCombat } };
  }

  return { state, error: 'Supporting character or ally not found' };
}

/**
 * Cancel the current strike by having another character in the company
 * tap. The strike is marked resolved with result 'canceled' and combat
 * advances to the next strike or finalizes.
 */
function handleCancelStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-strike') return wrongActionType(state, action, 'cancel-strike');

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];

  const cancellerChar = defPlayer.characters[action.cancellerInstanceId as string];
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];

  let nextState: GameState;
  if (cancellerChar) {
    const cancellerName = cardName(state, cancellerChar.definitionId, action.cancellerInstanceId as string);
    logDetail(`${cancellerName} taps to cancel strike against ${currentStrike.characterId as string}`);

    nextState = updatePlayer(state, defPlayerIndex, p =>
      updateCharacter(p, action.cancellerInstanceId, c => ({ ...c, status: CardStatus.Tapped })),
    );
  } else {
    // The canceller may be an item or ally attached to the struck character (e.g.
    // Enruned Shield taps to cancel a strike against its Warrior bearer, or
    // Noble Steed taps to cancel a non-auto-attack strike against its bearer).
    const tap = <A extends { status: CardStatus }>(a: A): A => ({ ...a, status: CardStatus.Tapped });
    const tapped = updateAttachment(defPlayer, 'items', action.cancellerInstanceId, tap)
      ?? updateAttachment(defPlayer, 'allies', action.cancellerInstanceId, tap);
    if (!tapped) {
      return { state, error: 'Canceller not found as character, item, or ally' };
    }
    const cancellerLabel = cardName(state, tapped.attachment.definitionId);
    logDetail(`${cancellerLabel} taps to cancel strike against ${currentStrike.characterId as string}`);
    nextState = updatePlayer(state, defPlayerIndex, () => tapped.player);
  }

  const newAssignments = [...combat.strikeAssignments];
  newAssignments[combat.currentStrikeIndex] = { ...currentStrike, resolved: true, result: 'canceled' };

  const combatWithAssignments = { ...combat, strikeAssignments: newAssignments };
  const next = nextStrikePhase(combatWithAssignments);
  if (!next) {
    return finalizeCombat({ ...nextState, combat: combatWithAssignments });
  }
  return {
    state: { ...nextState, combat: { ...combatWithAssignments, ...next } },
  };
}

/**
 * Play a `strike-modifier` short event from hand during resolve-strike.
 * Covers three resolution modes driven by the card's effect flags:
 *
 * - **dodge** (`effect.dodge`): moves the card to discard, initiates a chain
 *   (opponent may respond), and on resolution calls `resolveChainStrikeModifier`
 *   in dodge mode — the character resolves without tapping.
 * - **reroll** (`effect.reroll`): moves the card to discard and immediately
 *   calls `resolveChainStrikeModifier` in reroll mode — two rolls, better wins.
 * - **default**: accumulates prowess/body bonuses on the current strike assignment
 *   immediately. `requiredSkillEventPlayed` is set at declaration time (CoE 3.iv.5).
 */
function handlePlayStrikeEvent(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'play-strike-event') return { state, error: 'Expected play-strike-event' };

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const handCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Card not found in hand' };
  const cardDef = defById(state, handCard.definitionId);
  const effects = (cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
  const strikeEffect = effects.find((e): e is StrikeModifierEffect => e.type === 'strike-modifier');
  if (!strikeEffect) return { state, error: 'Card has no strike-modifier effect' };

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (strikeEffect.requiredSkill && currentStrike?.requiredSkillEventPlayed) {
    return { state, error: 'Only one resource that requires a skill may be played per strike (CoE 3.iv.5)' };
  }

  const cardLabel = cardName(state, handCard.definitionId);
  logDetail(`Playing strike event ${cardLabel} (mode: ${strikeEffect.dodge ? 'dodge' : strikeEffect.reroll ? 'reroll' : 'modify'})`);

  let resultState = updatePlayer(state, defPlayerIndex, p => ({
    ...p,
    hand: removeById(p.hand, handCard.instanceId),
    discardPile: [...p.discardPile, toCardInstance(handCard)],
  }));

  if (strikeEffect.dodge) {
    // Dodge mode: initiate chain so opponent may respond; resolution applies the dodge effect.
    const payload: import('../index.js').ChainEntryPayload = { type: 'short-event' };
    resultState = initiateOrPushChain(resultState, action.player, handCard, payload);
    return { state: resultState };
  }

  if (strikeEffect.reroll) {
    // Reroll mode: resolve immediately — two rolls, better result used.
    return resolveChainStrikeModifier(resultState, strikeEffect);
  }

  // Default mode: accumulate prowess/body bonuses on the current strike.
  // Set requiredSkillEventPlayed at declaration time (CoE 3.iv.5).
  if (strikeEffect.requiredSkill) {
    const newAssignments = combat.strikeAssignments.map((a, i) =>
      i === combat.currentStrikeIndex ? { ...a, requiredSkillEventPlayed: true } : a,
    );
    resultState = { ...resultState, combat: { ...combat, strikeAssignments: newAssignments } };
  }
  return resolveChainStrikeModifier(resultState, strikeEffect);
}

/** Roll body check — attacker rolls 2d6 vs body value. */
/**
 * Sums `body-check-modifier` effect values from all items attached to the
 * character being body-checked (CoE rule 2.V.2.2). A negative total lowers
 * the effective roll, protecting the bearer. Backs Helm of Fear (as-126):
 * "All body checks against the bearer are modified by -1." Returns 0 when no
 * such item is attached.
 */
function bodyCheckRollModifier(state: GameState, charData: CharacterInPlay): number {
  const charDef = defById(state, charData.definitionId);
  const bearerRace = isCharacterCard(charDef) ? charDef.race : undefined;
  let total = 0;
  for (const item of charData.items) {
    const itemDef = defById(state, item.definitionId);
    if (!itemDef) continue;
    for (const effect of getCardEffects(itemDef)) {
      if (effect.type !== 'body-check-modifier') continue;
      if (effect.when && !matchesCondition(effect.when, { bearer: { race: bearerRace } })) continue;
      logDetail(`Body-check modifier ${formatSignedNumber(effect.value)} from ${(itemDef as { name?: string }).name ?? (item.definitionId as string)}`);
      total += effect.value;
    }
  }
  return total;
}

function handleBodyCheckRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'body-check-roll') return wrongActionType(state, action, 'body-check-roll');

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const atkPlayerIndex = getPlayerIndex(state, combat.attackingPlayerId);
  const roller = combat.bodyCheckTarget === 'attacker-character' ? combat.defendingPlayerId : combat.attackingPlayerId;
  logDetail(`Body check roll: target=${combat.bodyCheckTarget} roller=${roller as string} roll=${roll.die1}+${roll.die2}=${rollTotal} (lastDiceRoll stored on attacker ${combat.attackingPlayerId as string})`);
  const effects: GameEffect[] = [diceRollEffect(state.players[atkPlayerIndex].name, roll, `Body check: ${combat.bodyCheckTarget}`)];

  // Update lastDiceRoll on the attacking player
  const stateWithRoll: GameState = {
    ...updatePlayer(state, atkPlayerIndex, p => ({ ...p, lastDiceRoll: roll })),
    rng,
    cheatRollTotal,
  };

  if (combat.bodyCheckTarget === 'creature') {
    // Body check against creature — apply enemy-modifier effects (e.g. Éowyn halves Nazgûl body)
    let body = combat.creatureBody ?? 0;
    const strike2 = combat.strikeAssignments[combat.currentStrikeIndex];
    if (strike2 && combat.creatureRace) {
      const defIdx2 = getPlayerIndex(stateWithRoll, combat.defendingPlayerId);
      const charData2 = stateWithRoll.players[defIdx2].characters[strike2.characterId as string];
      if (charData2) {
        const inPlayNames2 = buildInPlayNames(stateWithRoll);
        const enemy2 = { race: combat.creatureRace, name: '', prowess: combat.strikeProwess, body: combat.creatureBody };
        const modifiedBody = resolveEnemyBody(stateWithRoll, charData2, enemy2, body, inPlayNames2);
        if (modifiedBody !== body) {
          logDetail(`Enemy body modified by character effects: ${body} → ${modifiedBody}`);
          body = modifiedBody;
        }
      }
    }
    logDetail(`Body check vs creature: roll ${rollTotal} vs body ${body}`);
    // CoE 3.iv.7: the strike is defeated only if the body check FAILS (roll >
    // body). If the body check passes, the strike was not defeated and the
    // creature survives. Record 'survived' (vs the parry's 'success') so
    // finalizeCombat does not count this strike toward defeating the creature.
    let combatAfterBodyCheck = combat;
    if (rollTotal > body) {
      logDetail('Creature body check failed — strike defeated');
    } else {
      logDetail('Creature body check passed — creature survives');
      const survivedAssignments = combat.strikeAssignments.map((a, i) =>
        i === combat.currentStrikeIndex ? { ...a, result: 'survived' as const } : a,
      );
      combatAfterBodyCheck = { ...combat, strikeAssignments: survivedAssignments };
    }

    // Advance to next strike or finalize
    const next1 = nextStrikePhase(combatAfterBodyCheck);
    if (next1) {
      return { state: { ...stateWithRoll, combat: { ...combatAfterBodyCheck, ...next1 } }, effects };
    }
    return finalizeCombat({ ...stateWithRoll, combat: combatAfterBodyCheck }, effects);
  }

  if (combat.bodyCheckTarget === 'character') {
    // Body check against character or ally (CoE rule 2.V.2.2)
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const defPlayerIndex = getPlayerIndex(stateWithRoll, combat.defendingPlayerId);
    const defPlayer = stateWithRoll.players[defPlayerIndex];
    const charData = defPlayer.characters[strike.characterId as string];
    const company = companyById(defPlayer.companies, combat.companyId);
    const allyMatch = !charData && company
      ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
      : undefined;
    if (!charData && !allyMatch) return { state, error: 'Character not found for body check' };

    const targetDefId = charData?.definitionId ?? allyMatch!.ally.definitionId;
    const charDef2 = stateWithRoll.cardPool[targetDefId as string] as { body?: number } | undefined;
    // Allies with an instance stat override (e.g. a creature converted by
    // Ready to His Will) use that body; otherwise fall back to the definition.
    const allyOverrideBody = allyMatch ? allyEffectiveBody(stateWithRoll, allyMatch.ally) : undefined;
    let body = allyOverrideBody ?? charDef2?.body ?? 9; // Default body if not specified
    // Dodge body penalty: if the character was dodging and got wounded, apply body modifier
    if (strike.dodged && strike.dodgeBodyPenalty) {
      logDetail(`Dodge body penalty: body ${body} + (${strike.dodgeBodyPenalty}) = ${body + strike.dodgeBodyPenalty}`);
      body = body + strike.dodgeBodyPenalty;
    }
    // Modify-strike body penalty (e.g. Risky Blow's -1).
    if (strike.strikeBodyPenalty) {
      logDetail(`Strike event body penalty: body ${body} + (${strike.strikeBodyPenalty}) = ${body + strike.strikeBodyPenalty}`);
      body = body + strike.strikeBodyPenalty;
    }
    const woundedBonus = strike.wasAlreadyWounded ? 1 : 0;
    // Attack-level body-check modifier (e.g. Cruel Caradhras td-9: +1 to any
    // resulting body check). Positive values make elimination more likely.
    const attackBodyCheckModifier = combat.bodyCheckModifier ?? 0;
    // Item-granted body-check modifiers (e.g. Helm of Fear -1) only apply to
    // characters (allies do not bear items).
    const itemBodyMod = charData && !allyMatch ? bodyCheckRollModifier(stateWithRoll, charData) : 0;
    const effectiveRoll = rollTotal + woundedBonus + attackBodyCheckModifier + itemBodyMod;

    logDetail(`Body check vs ${allyMatch ? 'ally' : 'character'}: roll ${rollTotal}${woundedBonus ? '+1(wounded)' : ''}${attackBodyCheckModifier ? ` ${formatSignedNumber(attackBodyCheckModifier)}(attack)` : ''}${itemBodyMod ? `${formatSignedNumber(itemBodyMod)}(item)` : ''} = ${effectiveRoll} vs body ${body}`);

    // MELE §8.R1: if the *unmodified* roll is exactly 7 or 8 and the target is a
    // Ringwraith avatar, the Ringwraith returns to hand instead of being eliminated.
    if (charData && !allyMatch && (rollTotal === 7 || rollTotal === 8)) {
      const rwDef = defById(stateWithRoll, charData.definitionId);
      if (rwDef && isCharacterCard(rwDef) && rwDef.race === Race.Ringwraith) {
        logDetail(`Ringwraith body check roll is ${rollTotal} (7 or 8 unmodified) — Ringwraith returned to hand (MELE §8.R1)`);
        const newAssignmentsRW = combat.strikeAssignments.map((a, i) => {
          if (i === combat.currentStrikeIndex) return { ...a, result: 'eliminated' as const };
          if (!a.resolved && a.characterId === strike.characterId) {
            logDetail(`Strike ${i} auto-resolved (Ringwraith returned to hand, CoE 3.i.5)`);
            return { ...a, resolved: true, result: 'success' as const };
          }
          return a;
        });
        const newPlayersRW = clonePlayers(stateWithRoll);
        const newPlayerDataRW = { ...defPlayer };
        const combatWithRW = { ...combat, strikeAssignments: newAssignmentsRW };

        // Remove from company
        if (company) {
          newPlayerDataRW.companies = newPlayerDataRW.companies.map(c =>
            c.id === combat.companyId
              ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
              : c,
          );
        }
        // Move the Ringwraith card instance to the player's hand (not eliminated)
        const rwInstance = toCardInstance(charData);
        newPlayerDataRW.hand = [...newPlayerDataRW.hand, rwInstance];
        // Discard allies, items, and hazards on the returned Ringwraith
        for (const ally of charData.allies) {
          logDetail(`Discarding ally ${ally.instanceId as string} from returned Ringwraith`);
          newPlayerDataRW.discardPile = [...newPlayerDataRW.discardPile, toCardInstance(ally)];
        }
        for (const item of charData.items) {
          logDetail(`Discarding item ${item.instanceId as string} from returned Ringwraith`);
          newPlayerDataRW.discardPile = [...newPlayerDataRW.discardPile, toCardInstance(item)];
        }
        const hazardPlayerRW = newPlayersRW[1 - defPlayerIndex];
        let hazardDiscardRW = [...hazardPlayerRW.discardPile];
        for (const hazard of charData.hazards) {
          logDetail(`Discarding hazard ${hazard.instanceId as string} from returned Ringwraith`);
          hazardDiscardRW = [...hazardDiscardRW, toCardInstance(hazard)];
        }
        newPlayersRW[1 - defPlayerIndex] = { ...hazardPlayerRW, discardPile: hazardDiscardRW };
        const { [strike.characterId as string]: _rw, ...remainingCharsRW } = newPlayerDataRW.characters;
        // Revert followers to general influence
        const updatedCharsRW = { ...remainingCharsRW };
        for (const followerId of charData.followers) {
          const follower = updatedCharsRW[followerId as string];
          if (follower) updatedCharsRW[followerId as string] = { ...follower, controlledBy: 'general' };
        }
        newPlayerDataRW.characters = pruneLeaderFollowers(updatedCharsRW, strike.characterId, charData.controlledBy);
        // Record the returned Ringwraith's definition ID for reveal restrictions
        newPlayerDataRW.ringwraithReturnedToHand = charData.definitionId;
        newPlayersRW[defPlayerIndex] = newPlayerDataRW;

        const nextRW = nextStrikePhase(combatWithRW);
        if (nextRW) {
          return { state: { ...stateWithRoll, players: newPlayersRW, combat: { ...combatWithRW, ...nextRW } }, effects };
        }
        return finalizeCombat({ ...stateWithRoll, players: newPlayersRW, combat: combatWithRW }, effects);
      }
    }

    // Check if the character's printed discard number (discardBodyCheck) is triggered.
    // When the body check roll matches a value in the character's discardBodyCheck array,
    // the character is discarded to the discard pile (not eliminated).
    // protect-from-body-check on an attached item suppresses this discard, leaving the character wounded.
    // Allies cannot benefit from this protection.
    if (!allyMatch && charData) {
      const charDefForDiscard = defById(stateWithRoll, charData.definitionId);
      const discardBodyCheckValues = isCharacterCard(charDefForDiscard) && charDefForDiscard.cardType === 'minion-character' && charDefForDiscard.discardBodyCheck != null
        ? charDefForDiscard.discardBodyCheck
        : [];
      if ((discardBodyCheckValues).includes(effectiveRoll)) {
        const isProtected = charData.items.some(item => {
          const itemDef = state.cardPool[item.definitionId as string];
          return getCardEffects(itemDef).some(e => e.type === 'protect-from-body-check');
        });
        if (isProtected) {
          logDetail(`Body check roll ${effectiveRoll} matches discardBodyCheck — discard suppressed by protect-from-body-check; character survives wounded`);
          const survivedAssignments = combat.strikeAssignments.map((a, i) =>
            i === combat.currentStrikeIndex ? { ...a, result: 'wounded' as const } : a,
          );
          const combatSurvived = { ...combat, strikeAssignments: survivedAssignments };
          const nextSurvived = nextStrikePhase(combatSurvived);
          if (nextSurvived) {
            return { state: { ...stateWithRoll, combat: { ...combatSurvived, ...nextSurvived } }, effects };
          }
          return finalizeCombat(stateWithRoll, effects);
        }
        logDetail(`Body check roll ${effectiveRoll} matches discardBodyCheck — character discarded to discard pile`);
        const discardAssignments = combat.strikeAssignments.map((a, i) => {
          if (i === combat.currentStrikeIndex) return { ...a, result: 'eliminated' as const };
          if (!a.resolved && a.characterId === strike.characterId) {
            logDetail(`Strike ${i} auto-resolved (discarded combatant, CoE 3.i.5)`);
            return { ...a, resolved: true, result: 'success' as const };
          }
          return a;
        });
        const newPlayersDiscard = clonePlayers(stateWithRoll);
        const newPlayerDataDiscard = { ...defPlayer };
        const combatWithBodyCheckDiscard = { ...combat, strikeAssignments: discardAssignments };
        if (company) {
          newPlayerDataDiscard.companies = newPlayerDataDiscard.companies.map(c =>
            c.id === combat.companyId
              ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
              : c,
          );
        }
        const discardedCharDefId = resolveInstanceId(state, strike.characterId);
        newPlayerDataDiscard.discardPile = [...newPlayerDataDiscard.discardPile, { instanceId: strike.characterId, definitionId: discardedCharDefId! }];
        for (const ally of charData.allies) {
          logDetail(`Discarding ally ${ally.instanceId as string} from discarded character`);
          newPlayerDataDiscard.discardPile = [...newPlayerDataDiscard.discardPile, toCardInstance(ally)];
        }
        for (const item of charData.items) {
          logDetail(`Discarding item ${item.instanceId as string} from discarded character`);
          newPlayerDataDiscard.discardPile = [...newPlayerDataDiscard.discardPile, toCardInstance(item)];
        }
        const hazardPlayerDiscard = newPlayersDiscard[1 - defPlayerIndex];
        let hazardDiscardDiscard = [...hazardPlayerDiscard.discardPile];
        for (const hazard of charData.hazards) {
          logDetail(`Discarding hazard ${hazard.instanceId as string} from discarded character`);
          hazardDiscardDiscard = [...hazardDiscardDiscard, toCardInstance(hazard)];
        }
        newPlayersDiscard[1 - defPlayerIndex] = { ...hazardPlayerDiscard, discardPile: hazardDiscardDiscard };
        const { [strike.characterId as string]: _dchar, ...remainingCharsDiscard } = newPlayerDataDiscard.characters;
        // Revert followers to general influence
        const updatedCharsDiscard = { ...remainingCharsDiscard };
        for (const followerId of charData.followers) {
          const follower = updatedCharsDiscard[followerId as string];
          if (follower) updatedCharsDiscard[followerId as string] = { ...follower, controlledBy: 'general' };
        }
        newPlayerDataDiscard.characters = pruneLeaderFollowers(updatedCharsDiscard, strike.characterId, charData.controlledBy);
        newPlayersDiscard[defPlayerIndex] = newPlayerDataDiscard;
        const nextBodyCheckDiscard = nextStrikePhase(combatWithBodyCheckDiscard);
        if (nextBodyCheckDiscard) {
          return { state: { ...stateWithRoll, players: newPlayersDiscard, combat: { ...combatWithBodyCheckDiscard, ...nextBodyCheckDiscard } }, effects };
        }
        return finalizeCombat({ ...stateWithRoll, players: newPlayersDiscard, combat: combatWithBodyCheckDiscard }, effects);
      }
    }

    if (effectiveRoll > body) {
      logDetail(`${allyMatch ? 'Ally' : 'Character'} eliminated (body check roll ${effectiveRoll} > body ${body})`);
      return eliminateCombatantFromStrike(stateWithRoll, combat, effects);
    }

    // Check for on-event: character-body-check-equals-body on the attack source.
    // Example: Giant Spiders discards non-Wizard/non-Ringwraith characters when
    // the body check roll exactly equals (not exceeds) the character's body.
    if (effectiveRoll === body && charData && !allyMatch) {
      const sourceCard = getAttackSourceCard(stateWithRoll, combat);
      const equalsBodyEvent = getOnEventEffects(sourceCard, 'character-body-check-equals-body')[0];
      if (equalsBodyEvent) {
        const targetCharDef = defById(stateWithRoll, targetDefId);
        const targetRace = isCharacterCard(targetCharDef) ? targetCharDef.race : undefined;
        const condContext: Record<string, unknown> = { target: { race: targetRace } };
        const conditionMet = !equalsBodyEvent.when || matchesCondition(equalsBodyEvent.when, condContext);
        if (conditionMet && equalsBodyEvent.apply.type === 'discard-character') {
          logDetail(`Body check equals body — character discarded to discard pile (not eliminated)`);
          const newAssignments2 = combat.strikeAssignments.map((a, i) => {
            if (i === combat.currentStrikeIndex) return { ...a, result: 'eliminated' as const };
            if (!a.resolved && a.characterId === strike.characterId) {
              logDetail(`Strike ${i} auto-resolved (discarded combatant, CoE 3.i.5)`);
              return { ...a, resolved: true, result: 'success' as const };
            }
            return a;
          });
          const newPlayers3 = clonePlayers(stateWithRoll);
          const newPlayerData2 = { ...defPlayer };
          const combatWithDiscard = { ...combat, strikeAssignments: newAssignments2 };
          if (company) {
            newPlayerData2.companies = newPlayerData2.companies.map(c =>
              c.id === combat.companyId
                ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
                : c,
            );
          }
          const discardedCharDefId = resolveInstanceId(state, strike.characterId);
          newPlayerData2.discardPile = [...newPlayerData2.discardPile, { instanceId: strike.characterId, definitionId: discardedCharDefId! }];
          for (const ally of charData.allies) {
            logDetail(`Discarding ally ${ally.instanceId as string} from discarded character`);
            newPlayerData2.discardPile = [...newPlayerData2.discardPile, toCardInstance(ally)];
          }
          for (const item of charData.items) {
            logDetail(`Discarding item ${item.instanceId as string} from discarded character`);
            newPlayerData2.discardPile = [...newPlayerData2.discardPile, toCardInstance(item)];
          }
          for (const hazard of charData.hazards) {
            logDetail(`Discarding hazard ${hazard.instanceId as string} from discarded character`);
            newPlayers3[1 - defPlayerIndex] = { ...newPlayers3[1 - defPlayerIndex], discardPile: [...newPlayers3[1 - defPlayerIndex].discardPile, toCardInstance(hazard)] };
          }
          const { [strike.characterId as string]: _disc, ...remainingCharsDisc } = newPlayerData2.characters;
          // Revert followers to general influence
          const updatedCharsDisc = { ...remainingCharsDisc };
          for (const followerId of charData.followers) {
            const follower = updatedCharsDisc[followerId as string];
            if (follower) updatedCharsDisc[followerId as string] = { ...follower, controlledBy: 'general' };
          }
          newPlayerData2.characters = pruneLeaderFollowers(updatedCharsDisc, strike.characterId, charData.controlledBy);
          newPlayers3[defPlayerIndex] = newPlayerData2;
          const next4 = nextStrikePhase(combatWithDiscard);
          if (next4) {
            return { state: { ...stateWithRoll, players: newPlayers3, combat: { ...combatWithDiscard, ...next4 } }, effects };
          }
          return finalizeCombat({ ...stateWithRoll, players: newPlayers3, combat: combatWithDiscard }, effects);
        }
      }
    }

    logDetail(`${allyMatch ? 'Ally' : 'Character'} survives body check`);
    // Advance to next strike or finalize
    const next3 = nextStrikePhase(combat);
    if (next3) {
      return { state: { ...stateWithRoll, combat: { ...combat, ...next3 } }, effects };
    }
    return finalizeCombat(stateWithRoll, effects);
  }

  if (combat.bodyCheckTarget === 'attacker-character') {
    // CvCC: defender won; roll body check for the attacking character
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    if (!strike?.attackingCharacterId) return { state, error: 'CvCC body check: no attacking character' };

    const atkPlayerIdx = getPlayerIndex(stateWithRoll, combat.attackingPlayerId);
    const atkPlayer = stateWithRoll.players[atkPlayerIdx];
    const charData = atkPlayer.characters[strike.attackingCharacterId as string];
    if (!charData) return { state, error: 'CvCC body check: attacking character not found' };

    const charDef = defById(stateWithRoll, charData.definitionId);
    const body = (charDef as { body?: number } | undefined)?.body ?? 9;
    const charName = (charDef as { name?: string } | undefined)?.name ?? (strike.attackingCharacterId as string);

    // Item-granted body-check modifiers (e.g. Helm of Fear -1) apply to the
    // bearer regardless of whether they are attacking or defending in CvCC.
    const itemBodyMod = bodyCheckRollModifier(stateWithRoll, charData);
    const effectiveRoll = rollTotal + itemBodyMod;
    logDetail(`CvCC body check vs attacking character ${charName} (body ${body}): roll ${rollTotal}${itemBodyMod ? `${formatSignedNumber(itemBodyMod)}(item)` : ''} = ${effectiveRoll}`);

    const newAssignments = combat.strikeAssignments.map((a, i) =>
      i === combat.currentStrikeIndex ? { ...a, resolved: true } : a,
    );
    const newCombat = { ...combat, strikeAssignments: newAssignments, bodyCheckTarget: null };

    if (effectiveRoll > body) {
      logDetail(`CvCC: ${charName} eliminated (roll ${effectiveRoll} > body ${body})`);
      // Eliminate the attacking character
      const newPlayers = clonePlayers(stateWithRoll);
      const charInstance = toCardInstance(charData);
      const atkCompanySource = combat.attackSource;
      if (atkCompanySource.type !== 'company-attack') return { state, error: 'Not a company attack' };

      // Find attacker's company to remove character from
      const atkCompany = newPlayers[atkPlayerIdx].companies.find(c => c.id === atkCompanySource.attackingCompanyId);
      if (atkCompany) {
        const updatedCompany = { ...atkCompany, characters: atkCompany.characters.filter(id => id !== strike.attackingCharacterId) };
        const atkRemainingChars = Object.fromEntries(
          Object.entries(newPlayers[atkPlayerIdx].characters).filter(([id]) => id !== (strike.attackingCharacterId as string)),
        ) as (typeof newPlayers)[0]['characters'];
        newPlayers[atkPlayerIdx] = {
          ...newPlayers[atkPlayerIdx],
          characters: pruneLeaderFollowers(atkRemainingChars, strike.attackingCharacterId, charData.controlledBy),
          companies: newPlayers[atkPlayerIdx].companies.map(c => c.id === atkCompany.id ? updatedCompany : c),
        };
        // Defender gets kill MP; eliminated character goes to defender's kill pile only
        const defIdx = getPlayerIndex(stateWithRoll, combat.defendingPlayerId);
        newPlayers[defIdx] = {
          ...newPlayers[defIdx],
          killPile: [...newPlayers[defIdx].killPile, charInstance],
        };
      }

      const combatWithElim = { ...newCombat, strikeAssignments: newAssignments.map((a, i) =>
        i === combat.currentStrikeIndex ? { ...a, attackerResult: 'eliminated' as const } : a,
      ) };
      const nextA = nextStrikePhase(combatWithElim);
      if (nextA) {
        return { state: { ...stateWithRoll, players: newPlayers, combat: { ...combatWithElim, ...nextA } }, effects };
      }
      return finalizeCombat({ ...stateWithRoll, players: newPlayers, combat: combatWithElim }, effects);
    } else {
      logDetail(`CvCC: ${charName} survives body check (roll ${effectiveRoll} <= body ${body})`);
      const nextA = nextStrikePhase(newCombat);
      if (nextA) {
        return { state: { ...stateWithRoll, combat: { ...newCombat, ...nextA } }, effects };
      }
      return finalizeCombat({ ...stateWithRoll, combat: newCombat }, effects);
    }
  }

  return { state, error: 'Invalid body check target' };
}

/**
 * Handle the shield-discard-roll phase (Sable Shield le-341).
 *
 * The attacking player rolls 2d6. If the result strictly exceeds the item's
 * rollThreshold, the shield is discarded from the bearer. Combat then advances
 * to the next strike or finalizes.
 */
function handleShieldDiscardRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'shield-discard-roll') return wrongActionType(state, action, 'shield-discard-roll');

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const atkPlayerIndex = getPlayerIndex(state, combat.attackingPlayerId);
  const effects: GameEffect[] = [diceRollEffect(state.players[atkPlayerIndex].name, roll, 'Shield discard roll')];

  const stateWithRoll: GameState = {
    ...updatePlayer(state, atkPlayerIndex, p => ({ ...p, lastDiceRoll: roll })),
    rng,
    cheatRollTotal,
  };

  const threshold = action.rollThreshold;
  logDetail(`Shield discard roll: attacker rolled ${rollTotal}, threshold ${threshold} — shield ${rollTotal > threshold ? 'DISCARDED' : 'survives'}`);

  let stateAfterShield = stateWithRoll;
  if (rollTotal > threshold && combat.shieldAbsorbItemId) {
    // Discard the shield from the bearer
    const defPlayerIndex = getPlayerIndex(stateWithRoll, combat.defendingPlayerId);
    const defPlayer = stateWithRoll.players[defPlayerIndex];
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const charData = defPlayer.characters[strike.characterId as string];

    if (charData) {
      const shieldItem = charData.items.find(i => i.instanceId === combat.shieldAbsorbItemId);
      if (shieldItem) {
        logDetail(`Discarding shield ${shieldItem.instanceId as string} from ${strike.characterId as string}`);
        const newItems = charData.items.filter(i => i.instanceId !== combat.shieldAbsorbItemId);
        const newDiscardPile = [...defPlayer.discardPile, toCardInstance(shieldItem)];
        stateAfterShield = updatePlayer(stateWithRoll, defPlayerIndex, p => ({
          ...p,
          characters: {
            ...p.characters,
            [strike.characterId as string]: { ...charData, items: newItems },
          },
          discardPile: newDiscardPile,
        }));
      }
    }
  }

  // Clear the shield-discard-roll field and advance combat
  const combatCleared: CombatState = { ...combat, phase: 'resolve-strike' as const, shieldAbsorbItemId: undefined };
  const next = nextStrikePhase(combatCleared);
  if (next) {
    return { state: { ...stateAfterShield, combat: { ...combatCleared, ...next } }, effects };
  }
  return finalizeCombat({ ...stateAfterShield, combat: combatCleared }, effects);
}

/**
 * Declare a cancel-attack action by playing a short-event card from hand.
 *
 * Follows the MECCG chain-of-effects rule: playing a cancel-attack card
 * declares a chain entry rather than immediately cancelling combat. The
 * opponent has priority to respond (e.g. with a hazard that cancels the
 * cancellation). When both players pass chain priority, the chain
 * auto-resolves and the cancel-attack entry applies its effect to the
 * active combat via {@link resolveCancelAttackEntry}.
 *
 * Costs (tapping a scout or enqueuing a corruption check) are paid
 * immediately at declaration per CoE rule 9.5.2 — active conditions do
 * not initiate their own chain and cannot be refunded by negation.
 * The card itself moves from hand to discard pile at declaration, matching
 * the behaviour of other short events.
 */
/**
 * Handle cancel-attack sourced from an in-play ally (e.g. The Warg-king's
 * "tap to cancel a Wolf or Animal attack"). Unlike a hand-played short event,
 * no chain entry is pushed — tapping the ally pays the cost and the
 * cancellation applies immediately via {@link resolveCancelAttackEntry}.
 */
function handleCancelAttackByInPlayAlly(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const found = findAllyInCompany(defPlayer, company.characters, action.cardInstanceId);
  if (!found) return { state, error: 'Cancel-attack source not in hand or defending company allies' };
  if (found.ally.status !== CardStatus.Untapped) {
    return { state, error: 'Ally must be untapped to cancel attack' };
  }

  const allyName = cardName(state, found.ally.definitionId);
  logDetail(`Cancel-attack declared: tapping ${allyName} to cancel ${combat.creatureRace ?? 'attack'}`);

  const tappedState = updatePlayer(state, defPlayerIndex, p =>
    updateCharacter(p, found.hostCharId, c => ({
      ...c,
      allies: c.allies.map(a =>
        a.instanceId === action.cardInstanceId ? { ...a, status: CardStatus.Tapped } : a,
      ),
    })),
  );
  return { state: resolveCancelAttackEntry(tappedState) };
}

/**
 * Handle cancel-attack sourced from an in-play character (e.g. Adûnaphel
 * the Ringwraith's Darkhaven tap). Mirrors {@link handleCancelAttackByInPlayAlly}
 * but taps the character directly.
 */
function handleCancelAttackByInPlayCharacter(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const charData = defPlayer.characters[action.cardInstanceId as string];
  if (!charData) return { state, error: 'Cancel-attack source character not found' };
  if (!company.characters.includes(action.cardInstanceId)) {
    return { state, error: 'Cancel-attack character is not in the defending company' };
  }
  if (charData.status !== CardStatus.Untapped) {
    return { state, error: 'Character must be untapped to cancel attack' };
  }

  const charName = cardName(state, charData.definitionId);
  logDetail(`Cancel-attack declared: tapping ${charName} to cancel ${combat.creatureRace ?? 'attack'}`);

  const tappedState = updatePlayer(state, defPlayerIndex, p =>
    updateCharacter(p, action.cardInstanceId, c => ({ ...c, status: CardStatus.Tapped })),
  );
  return { state: resolveCancelAttackEntry(tappedState) };
}

/**
 * Handle cancel-attack sourced from an in-play item with cost "self-and-bearer"
 * (tap item AND bearer, e.g. Torque of Hues) or cost "bearer" (tap bearer only,
 * e.g. Star-glass). Bearer makes a corruption check afterward if the effect
 * declares `enqueueCorruptionCheck`.
 */
function handleCancelAttackByInPlayItem(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const found = findItemInCompany(defPlayer, company.characters, action.cardInstanceId);
  if (!found) return { state, error: 'Cancel-attack source item not found in defending company' };

  const { item, hostCharId } = found;

  const itemDef = state.cardPool[item.definitionId as string] as { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
  const itemName = itemDef?.name ?? (item.definitionId as string);
  const cancelEffect = itemDef?.effects?.find(
    (e): e is import('../types/effects.js').CancelAttackEffect => e.type === 'cancel-attack',
  );

  const tapCost = cancelEffect?.cost?.tap;
  const bearerOnly = tapCost === 'bearer';
  const selfOnly = tapCost === 'self';
  const tapsItem = !bearerOnly; // 'self' and 'self-and-bearer' tap the item
  const tapsBearer = !selfOnly; // 'bearer' and 'self-and-bearer' tap the bearer

  if (tapsItem && item.status !== CardStatus.Untapped) {
    return { state, error: 'Item must be untapped to cancel attack' };
  }

  const bearerData = defPlayer.characters[hostCharId as string];
  if (!bearerData) return { state, error: 'Bearer character not found' };
  if (tapsBearer && bearerData.status !== CardStatus.Untapped) {
    return { state, error: 'Bearer must be untapped to cancel attack with this item' };
  }

  if (selfOnly) {
    logDetail(`Cancel-attack declared: tapping item ${itemName} to cancel ${combat.creatureRace ?? 'attack'}`);
  } else if (bearerOnly) {
    logDetail(`Cancel-attack declared: tapping bearer ${hostCharId as string} via ${itemName} to cancel ${combat.creatureRace ?? 'attack'}`);
  } else {
    logDetail(`Cancel-attack declared: tapping item ${itemName} and bearer ${hostCharId as string} to cancel ${combat.creatureRace ?? 'attack'}`);
  }

  // Tap the item and/or bearer per the cost variant.
  let tappedState = updatePlayer(state, defPlayerIndex, p =>
    updateCharacter(p, hostCharId, c => ({
      ...c,
      status: tapsBearer ? CardStatus.Tapped : c.status,
      items: tapsItem
        ? c.items.map(i =>
            i.instanceId === item.instanceId ? { ...i, status: CardStatus.Tapped } : i,
          )
        : c.items,
    })),
  );

  // Cancel the attack immediately (items, like allies, don't push a chain entry).
  tappedState = resolveCancelAttackEntry(tappedState);

  // Enqueue corruption check on bearer if effect declares it.
  if (cancelEffect?.enqueueCorruptionCheck) {
    const scope = companySubphaseScope(state.phaseState.phase, company.id);
    logDetail(`Cancel-attack: enqueuing corruption check on bearer ${hostCharId as string} (${itemName})`);
    tappedState = enqueueCorruptionCheck(tappedState, {
      source: item.instanceId,
      actor: action.player,
      scope,
      characterId: hostCharId,
      reason: itemName,
    });
  }

  return { state: tappedState };
}

function handleCancelAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  const handCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!handCard) {
    // Source may be an in-play character tapping to cancel (e.g. Adûnaphel
    // the Ringwraith's Darkhaven tap), an in-play ally (e.g. The Warg-king),
    // or an in-play item with self-and-bearer cost (e.g. Torque of Hues).
    if (defPlayer.characters[action.cardInstanceId as string]) {
      return handleCancelAttackByInPlayCharacter(state, action, combat);
    }
    // Check items before falling through to ally handler.
    const defCompany = companyById(defPlayer.companies, combat.companyId);
    if (defCompany && findItemInCompany(defPlayer, defCompany.characters, action.cardInstanceId)) {
      return handleCancelAttackByInPlayItem(state, action, combat);
    }
    return handleCancelAttackByInPlayAlly(state, action, combat);
  }

  // Look up the cancel-attack effect to determine cost type.
  const cardDef = defById(state, handCard.definitionId);
  const effects = (cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects;
  const cancelEffect = effects?.find(
    (e): e is import('../types/effects.js').CancelAttackEffect => e.type === 'cancel-attack',
  );

  // Pay character cost via cost-evaluator: tap or enqueue corruption check.
  // A cost-paying character whose race matches `costExemptRace` pays nothing
  // (e.g. The Tormented Earth: "Unless he is a Ringwraith, character makes a
  // corruption check…").
  let resultState: GameState = state;
  const exemptRace = cancelEffect?.costExemptRace;
  let costExempt = false;
  if (action.scoutInstanceId && exemptRace) {
    const scoutChar = defPlayer.characters[action.scoutInstanceId as string];
    const scoutDef = scoutChar ? defById(state, scoutChar.definitionId) : undefined;
    if (scoutDef && isCharacterCard(scoutDef) && scoutDef.race === exemptRace) {
      costExempt = true;
      logDetail(`Cancel-attack ${handCard.definitionId as string}: cost-payer is ${exemptRace} — corruption check skipped`);
    }
  }
  if (action.scoutInstanceId && cancelEffect?.cost && !costExempt) {
    const company = companyById(defPlayer.companies, combat.companyId);
    const companyId = company?.id;
    const scopeKind = state.phaseState.phase === Phase.MovementHazard
      ? 'company-mh-subphase' as const
      : 'company-site-subphase' as const;
    const costResult = applyCost(state, cancelEffect.cost, action.scoutInstanceId, {
      playerIndex: defPlayerIndex,
      sourceCardId: action.cardInstanceId,
      companyId,
      checkScopeKind: scopeKind,
      label: cardDef?.name ?? '?',
    });
    if ('error' in costResult) return { state, error: costResult.error };
    resultState = costResult.state;
  } else {
    logDetail(`Cancel-attack declared: ${handCard.definitionId as string} played via chain (no cost)`);
  }

  // Move card from hand to discard pile — short events are physically
  // discarded at play time; the chain holds only a reference.
  const newHand = removeById(defPlayer.hand, handCard.instanceId);
  const newDiscard = [...defPlayer.discardPile, toCardInstance(handCard)];

  resultState = updatePlayer(resultState, defPlayerIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: newDiscard,
  }));

  // Attack-scoped duplication limit: record this play as a constraint so the
  // legal-action scanner can block a second copy on the same attack. Applies
  // in both modes ("Cannot be duplicated against a given attack").
  const cancelDupLimit = getCardEffects(cardDef).find(
    e => e.type === 'duplication-limit' && (e as { scope: string }).scope === 'attack',
  );
  if (cancelDupLimit) {
    resultState = addConstraint(resultState, {
      source: handCard.instanceId,
      sourceDefinitionId: handCard.definitionId,
      scope: { kind: 'attack' },
      target: { kind: 'player', playerId: action.player },
      kind: { type: 'attack-card-played' },
    });
    logDetail(`${(cardDef as { name?: string }).name ?? handCard.definitionId as string}: added attack-card-played marker (cancel-attack duplication-limit scope attack)`);
  }

  // Dual-mode "reduce prowess" variant (e.g. The Tormented Earth): instead of
  // cancelling, lower the attack's strike prowess uniformly. Like halve-strikes
  // and modify-attack, this is a direct combat modification applied immediately
  // (no chain) — only outright cancellation routes through the chain.
  if (action.mode === 'reduce-prowess' && cancelEffect?.prowessPenalty !== undefined) {
    if (!resultState.combat) return { state, error: 'No active combat to reduce prowess' };
    const before = resultState.combat.strikeProwess;
    const after = before - cancelEffect.prowessPenalty;
    logDetail(`${(cardDef as { name?: string }).name ?? handCard.definitionId as string}: reduce attack prowess ${before} → ${after} (-${cancelEffect.prowessPenalty})`);
    return { state: { ...resultState, combat: { ...resultState.combat, strikeProwess: after } } };
  }

  // Push/initiate chain entry — opponent gets priority to respond. On
  // resolution, the chain resolver applies the combat cancellation via
  // resolveCancelAttackEntry.
  const payload: import('../index.js').ChainEntryPayload = action.targetCharacterId
    ? { type: 'short-event', targetCharacterId: action.targetCharacterId }
    : { type: 'short-event' };
  resultState = initiateOrPushChain(resultState, action.player, handCard, payload);

  return { state: resultState };
}

/**
 * Handle a `convert-creature-to-ally` action (Ready to His Will le-220).
 *
 * Validates eligibility, then:
 * 1. taps the controlling character (if the card requires it),
 * 2. moves the attacking creature card from the attacker's cards-in-play into
 *    the controlling character's `allies` with the effect's stat overrides
 *    (mind, body, prowess = creature prowess + prowessModifier),
 * 3. moves the event card from the defender's hand into their cards-in-play
 *    with `attachedTo` set to the new ally ("Place this card with the
 *    creature"), where it scores its 1 ally marshalling point, and
 * 4. cancels all the creature's attacks by ending combat, running the same
 *    attack-end housekeeping as a cancel-attack.
 */
function handleConvertCreatureToAlly(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'convert-creature-to-ally') return wrongActionType(state, action, 'convert-creature-to-ally');
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only the defending player may convert a creature' };
  if (combat.phase !== 'assign-strikes' || combat.strikeAssignments.length > 0) {
    return { state, error: 'Creature may only be converted before strikes are assigned' };
  }
  if (combat.attackSource.type !== 'creature') return { state, error: 'Attack is not a single creature' };

  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const atkIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const defPlayer = state.players[defIdx];

  // The event card being played.
  const handCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Conversion card not in hand' };
  const cardDef = defById(state, handCard.definitionId);
  const effect = getCardEffects(cardDef).find(
    (e): e is import('../types/effects.js').ConvertCreatureToAllyEffect => e.type === 'convert-creature-to-ally',
  );
  if (!effect) return { state, error: 'Card has no convert-creature-to-ally effect' };

  // The attacking creature card.
  const creatureInstanceId = combat.attackSource.instanceId;
  const creatureDef = resolveDef(state, creatureInstanceId);
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') return { state, error: 'Attacking creature not found' };
  const creatureRace = (creatureDef as { race: string }).race.toLowerCase();
  const creatureStrikes = (creatureDef as { strikes: number }).strikes;
  if (creatureStrikes > effect.maxStrikes) return { state, error: 'Creature has too many strikes to convert' };
  if (!effect.races.map(r => r.toLowerCase()).includes(creatureRace)) return { state, error: 'Creature race is not eligible for conversion' };

  // The controlling character.
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company || !company.characters.includes(action.controllingCharacterId)) {
    return { state, error: 'Controlling character not in defending company' };
  }
  const controller = defPlayer.characters[action.controllingCharacterId as string];
  if (!controller) return { state, error: 'Controlling character not found' };
  if (effect.controllerTaps && controller.status !== CardStatus.Untapped) {
    return { state, error: 'Controlling character must be untapped to take control' };
  }

  const creatureInPlay = findById(state.players[atkIdx].cardsInPlay, creatureInstanceId);
  if (!creatureInPlay) return { state, error: 'Creature card not in attacker cards-in-play' };

  const creatureName = (creatureDef as { name?: string }).name ?? (creatureInstanceId as string);
  const allyProwess = (creatureDef as { prowess: number }).prowess + effect.ally.prowessModifier;
  const statOverride: import('../types/state-cards.js').AllyStatOverride = {
    mind: effect.ally.mind,
    prowess: allyProwess,
    body: effect.ally.body,
  };
  const newAlly: import('../types/state-cards.js').AllyInPlay = {
    instanceId: creatureInstanceId,
    definitionId: creatureInPlay.definitionId,
    status: CardStatus.Untapped,
    statOverride,
  };

  logDetail(
    `Convert-creature-to-ally: "${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string}" converts ${creatureName} ` +
    `into an ally (mind ${statOverride.mind}, prowess ${statOverride.prowess}, body ${statOverride.body}) ` +
    `controlled by ${action.controllingCharacterId as string}${effect.controllerTaps ? ' (taps)' : ''}`,
  );

  let newState: GameState = state;

  // Remove the creature from the attacker's cards-in-play.
  newState = updatePlayer(newState, atkIdx, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
  }));

  // Add the ally to the controlling character and tap that character.
  newState = updatePlayer(newState, defIdx, p => updateCharacter(p, action.controllingCharacterId, ch => ({
    ...ch,
    status: effect.controllerTaps ? CardStatus.Tapped : ch.status,
    allies: [...ch.allies, newAlly],
  })));

  // Move the event card from hand to cards-in-play, "placed with the creature"
  // (attachedTo the new ally so the two are discarded together). The event card
  // scores its printed 1 ally marshalling point while in play.
  newState = updatePlayer(newState, defIdx, p => ({
    ...p,
    hand: p.hand.filter(c => c.instanceId !== action.cardInstanceId),
    cardsInPlay: [
      ...p.cardsInPlay,
      {
        instanceId: handCard.instanceId,
        definitionId: handCard.definitionId,
        status: CardStatus.Untapped,
        attachedTo: creatureInstanceId,
      },
    ],
  }));

  // All attacks of the creature are canceled — end combat and run the same
  // attack-end housekeeping as a cancel-attack.
  newState = { ...newState, combat: null };
  newState = sweepExpired(newState, { kind: 'attack-end' });
  newState = recordHazardEncountered(newState, state, combat);

  logDetail('Creature converted to ally — combat ended, returning to enclosing phase');
  return { state: newState };
}

/**
 * Apply the cancel-attack effect when its chain entry resolves.
 *
 * Called from the chain resolver when a short-event entry with a
 * `cancel-attack` effect is resolved (and not negated). Applies the
 * combat-cancellation logic that previously ran immediately in
 * {@link handleCancelAttack}:
 *
 * - For multi-attack creatures (e.g. Assassin), reduce `strikesTotal` by
 *   one rather than ending combat — each multi-attack sub-attack is a
 *   separate "attack".
 * - Otherwise, clear `state.combat` and move the attacking creature from
 *   the attacker's cardsInPlay to their discard pile.
 *
 * Returns the unchanged state if combat is no longer active (fizzle).
 */
export function resolveCancelAttackEntry(state: GameState): GameState {
  const combat = state.combat;
  if (!combat) {
    logDetail('Cancel-attack resolves: no active combat — fizzle');
    return state;
  }

  const newPlayers = clonePlayers(state);

  // For multi-attack creatures (e.g. Assassin), cancelling one attack
  // removes one strike rather than ending the entire combat.
  if (combat.forceSingleTarget && combat.strikesTotal > 1) {
    const newStrikesTotal = combat.strikesTotal - 1;
    logDetail(`Multi-attack: one attack canceled, strikes reduced ${combat.strikesTotal} → ${newStrikesTotal}`);
    const newCancelByTap = combat.cancelByTapRemaining !== undefined
      ? Math.min(combat.cancelByTapRemaining, newStrikesTotal)
      : undefined;
    return {
      ...state,
      players: newPlayers,
      combat: {
        ...combat,
        strikesTotal: newStrikesTotal,
        cancelByTapRemaining: newCancelByTap,
        multiAttackCount: combat.multiAttackCount !== undefined ? combat.multiAttackCount - 1 : undefined,
      },
    };
  }

  // If this was a creature attack, move creature card from attacker's
  // cardsInPlay to discard.
  const atkIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const creatureInstanceId =
    combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
      : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
        : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
          : null;
  if (creatureInstanceId) {
    const creatureInPlay = findById(newPlayers[atkIdx].cardsInPlay, creatureInstanceId);
    if (creatureInPlay) {
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        cardsInPlay: newPlayers[atkIdx].cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
        discardPile: [...newPlayers[atkIdx].discardPile, toCardInstance(creatureInPlay)],
      };
    }
  }

  // card-triggered-attack cancelled: the attack never resolved. If there are remaining
  // queued attacks (multi-attack form), trigger the next one. Otherwise check for
  // untapped characters; queue bearer selection if any remain, or discard the card.
  let stateWithCancelledPlayers: GameState = { ...state, players: newPlayers, combat: null };
  if (combat.attackSource.type === 'card-triggered-attack') {
    const { cardInstanceId, remainingAttacks } = combat.attackSource;
    const defIdx = getPlayerIndex(stateWithCancelledPlayers, combat.defendingPlayerId);
    const cardDefId = resolveInstanceId(stateWithCancelledPlayers, cardInstanceId);
    const cardLabel = cardDefId ? cardName(stateWithCancelledPlayers, cardDefId, '?') : '?';

    if (remainingAttacks && remainingAttacks.length > 0) {
      // More attacks remain — trigger the next one
      const next = remainingAttacks[0];
      const rest = remainingAttacks.slice(1);
      const defPlayer = stateWithCancelledPlayers.players[defIdx];
      const atkPlayer = stateWithCancelledPlayers.players[1 - defIdx];
      const inPlayNames = buildInPlayNames(stateWithCancelledPlayers);
      const creatureRace = normalizeCreatureRace(next.creatureType);
      const effectiveProwess = resolveAttackProwess(
        stateWithCancelledPlayers, next.prowess, inPlayNames, creatureRace, true, undefined,
        { companyId: combat.companyId },
      );
      const effectiveStrikes = resolveAttackStrikes(
        stateWithCancelledPlayers, next.strikes, inPlayNames, creatureRace, true, { companyId: combat.companyId },
      );
      logDetail(
        `Card-auto-attack cancelled: "${cardLabel}" triggering next attack — ${next.creatureType} ` +
        `(${effectiveStrikes} strikes, ${effectiveProwess} prowess)`,
      );
      const nextCombat: CombatState = {
        attackSource: {
          type: 'card-triggered-attack',
          cardInstanceId,
          ...(rest.length > 0 ? { remainingAttacks: rest } : {}),
        },
        companyId: combat.companyId,
        defendingPlayerId: defPlayer.id,
        attackingPlayerId: atkPlayer.id,
        strikesTotal: effectiveStrikes,
        strikeProwess: effectiveProwess,
        creatureBody: null,
        creatureRace,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      };
      stateWithCancelledPlayers = { ...stateWithCancelledPlayers, combat: nextCombat };
    } else {
      const defPlayer = stateWithCancelledPlayers.players[defIdx];
      const company = companyById(defPlayer.companies, combat.companyId);
      const anyUntapped = company
        ? company.characters.some(charId => {
            const ch = defPlayer.characters[charId as string];
            return ch && ch.status === CardStatus.Untapped;
          })
        : false;
      if (!anyUntapped) {
        logDetail(`Card-auto-attack cancelled: no untapped characters — discarding "${cardLabel}"`);
        stateWithCancelledPlayers = discardCardTriggeredCard(stateWithCancelledPlayers, cardInstanceId, defIdx);
      } else {
        const cardDef = cardDefId ? defById(stateWithCancelledPlayers, cardDefId) : undefined;
        const triggerEffect = cardDef
          ? (getCardEffects(cardDef).find(
              (e): e is TriggerAttackOnPlayEffect => e.type === 'trigger-attack-on-play',
            ) ?? null)
          : null;
        const afterAttack = triggerEffect?.afterAttack ?? 'attach-with-constraint';
        const discardFactionsAtSite = triggerEffect?.discardFactionsAtSite ?? false;
        logDetail(
          `Card-auto-attack cancelled: untapped characters remain — queuing select-card-bearer for "${cardLabel}"`,
        );
        stateWithCancelledPlayers = enqueueResolution(stateWithCancelledPlayers, {
          source: cardInstanceId,
          actor: combat.defendingPlayerId,
          scope: { kind: 'phase', phase: stateWithCancelledPlayers.phaseState.phase },
          kind: {
            type: 'select-card-bearer',
            cardInstanceId,
            companyId: combat.companyId,
            ...(afterAttack !== 'attach-with-constraint' ? { mode: afterAttack } : {}),
            ...(discardFactionsAtSite ? { discardFactionsAtSite: true } : {}),
          },
        });
      }
    }
  }

  // Sweep attack-scoped constraints (e.g. duplication-limit markers from
  // cancel-attack or modify-attack cards played on this attack) now that the
  // attack has ended via cancellation.
  stateWithCancelledPlayers = sweepExpired(stateWithCancelledPlayers, { kind: 'attack-end' });

  // Per CoE 3.i.1 and CRF 22 Annotation 14, a company is still considered to
  // have "faced" an attack once combat is initiated, even if the attack is
  // then canceled. Record the canceled creature in hazardsEncountered so that
  // subsequent creature self-effects see it — e.g. Orc-lieutenant's +4 prowess
  // "if played on a company that has already faced an Orc attack this turn"
  // must apply even when the prior Orc attack (e.g. Hobgoblins) was canceled.
  // recordHazardEncountered is a no-op outside the M/H phase and for
  // non-creature attack sources, so multi-attack partial cancels (which return
  // earlier with combat still active) and card-triggered attacks are unaffected.
  stateWithCancelledPlayers = recordHazardEncountered(stateWithCancelledPlayers, state, combat);

  logDetail('Combat canceled by chain resolution — returning to enclosing phase');
  return stateWithCancelledPlayers;
}

/**
 * Apply a `strike-modifier` effect when its chain entry resolves (or immediately
 * in reroll/default mode). Dispatches to {@link resolveStrikeCore} for dodge and
 * reroll modes; accumulates prowess/body bonuses for the default modifier mode.
 *
 * Called from `apply-dispatcher.ts` (chain path) and directly from
 * {@link handlePlayStrikeEvent} for reroll and default modes.
 *
 * @param state - Current game state (must have active combat).
 * @param effect - The resolved `strike-modifier` effect from the card definition.
 */
export function resolveChainStrikeModifier(state: GameState, effect: StrikeModifierEffect): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No active combat' };

  if (effect.dodge) {
    return resolveStrikeCore(state, combat, 'dodge', effect.bodyPenalty ?? 0, null);
  }
  if (effect.reroll) {
    // Apply any prowess bonus before resolving — supports combined reroll+bonus cards (e.g. Swift Strokes).
    let preState = state;
    if (effect.prowessBonus) {
      const bonus = effect.prowessBonus;
      const newAssignments = combat.strikeAssignments.map((a, i) =>
        i === combat.currentStrikeIndex
          ? { ...a, strikeProwessBonus: (a.strikeProwessBonus ?? 0) + bonus }
          : a,
      );
      preState = { ...state, combat: { ...combat, strikeAssignments: newAssignments } };
    }
    return resolveStrikeCore(preState, preState.combat!, 'reroll', 0, null);
  }

  // Default: accumulate prowess/body bonuses on the current strike assignment.
  const prowessBonus = effect.prowessBonus ?? 0;
  const bodyPenalty = effect.bodyPenalty ?? 0;
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? {
          ...a,
          strikeProwessBonus: (a.strikeProwessBonus ?? 0) + prowessBonus,
          strikeBodyPenalty: (a.strikeBodyPenalty ?? 0) + bodyPenalty,
        }
      : a,
  );
  return { state: { ...state, combat: { ...combat, strikeAssignments: newAssignments } } };
}

/**
 * Cancel one strike by tapping a non-target character in the defending
 * company. Used by the `cancel-attack-by-tap` combat rule (e.g. Assassin).
 * Removes one strike assignment and decrements cancelByTapRemaining.
 */
function handleCancelByTap(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-by-tap') return wrongActionType(state, action, 'cancel-by-tap');
  if (combat.phase !== 'assign-strikes' || combat.assignmentPhase !== 'cancel-by-tap') {
    return { state, error: 'Can only cancel-by-tap during cancel-by-tap sub-phase' };
  }
  if (action.player !== combat.defendingPlayerId) {
    return { state, error: 'Only defending player can cancel-by-tap' };
  }
  if (!combat.cancelByTapRemaining || combat.cancelByTapRemaining <= 0) {
    return { state, error: 'No cancel-by-tap opportunities remaining' };
  }

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company || !company.characters.includes(action.characterId)) {
    return { state, error: 'Character not in defending company' };
  }

  // By default the target character cannot tap to cancel (Assassin: "not the defending character").
  // When cancelByTapAllowTarget is set (Slayer: "any one character"), the target may also tap.
  const targetCharId = combat.strikeAssignments[0]?.characterId;
  if (!combat.cancelByTapAllowTarget && action.characterId === targetCharId) {
    return { state, error: 'Cannot tap the defending character to cancel' };
  }

  const charData = defPlayer.characters[action.characterId as string];
  if (!charData || charData.status !== CardStatus.Untapped) {
    return { state, error: 'Character must be untapped' };
  }

  logDetail(`Cancel-by-tap: ${action.characterId as string} tapped to cancel one attack against ${targetCharId as string}`);

  // Tap the character
  const newPlayers = clonePlayers(state);
  const newCharacters = { ...defPlayer.characters };
  newCharacters[action.characterId as string] = { ...charData, status: CardStatus.Tapped };
  newPlayers[defPlayerIndex] = { ...defPlayer, characters: newCharacters };

  // Remove one full attack's worth of strike assignments.
  // For multi-attack creatures (e.g. Nameless Thing: 3 attacks × 2 strikes),
  // strikesPerAttack is set so one tap cancels one full attack (all its strikes).
  const strikesToRemove = combat.strikesPerAttack ?? 1;
  const newAssignments = [...combat.strikeAssignments];
  for (let i = 0; i < strikesToRemove; i++) newAssignments.pop();

  const newCancelRemaining = combat.cancelByTapRemaining - 1;
  const newStrikesTotal = combat.strikesTotal - strikesToRemove;

  logDetail(`Strikes reduced: ${combat.strikesTotal} → ${newStrikesTotal}, cancels remaining: ${newCancelRemaining}`);

  // If no strikes remain, cancel combat entirely
  if (newAssignments.length === 0) {
    logDetail('All strikes canceled — combat ends');
    // Move creature to discard
    const atkIdx = getPlayerIndex(state, combat.attackingPlayerId);
    const creatureInstanceId =
      combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
        : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
          : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
            : null;
    if (creatureInstanceId) {
      const creatureInPlay = findById(newPlayers[atkIdx].cardsInPlay, creatureInstanceId);
      if (creatureInPlay) {
        newPlayers[atkIdx] = {
          ...newPlayers[atkIdx],
          cardsInPlay: newPlayers[atkIdx].cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
          discardPile: [...newPlayers[atkIdx].discardPile, toCardInstance(creatureInPlay)],
        };
      }
    }
    return { state: { ...state, players: newPlayers, combat: null } };
  }

  let newCombat: CombatState = {
    ...combat,
    strikeAssignments: newAssignments,
    strikesTotal: newStrikesTotal,
    cancelByTapRemaining: newCancelRemaining > 0 ? newCancelRemaining : undefined,
    multiAttackCount: combat.multiAttackCount !== undefined ? combat.multiAttackCount - 1 : undefined,
  };

  // If no more cancels available, proceed to strike resolution
  if (newCancelRemaining <= 0) {
    logDetail('No more cancel-by-tap opportunities — proceeding to resolution');
    const next = nextStrikePhase(newCombat);
    newCombat = { ...newCombat, assignmentPhase: 'done', ...next };
  }

  return { state: { ...state, players: newPlayers, combat: newCombat } };
}

/**
 * Halve the number of strikes in the current attack (rounded up) by
 * discarding a short event card from hand. Only allowed during the
 * assign-strikes phase before any strikes have been assigned.
 */
function handleHalveStrikes(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'halve-strikes') return wrongActionType(state, action, 'halve-strikes');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only halve strikes before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to halve' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can halve strikes' };

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  const discardedCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!discardedCard) return { state, error: 'Card not in hand' };

  const originalStrikes = combat.strikesTotal;
  const cardDef = state.cardPool[discardedCard.definitionId as string];
  const halveEffect = getCardEffects(cardDef).find(
    (e): e is HalveStrikesEffect => e.type === 'halve-strikes',
  );
  const op = halveEffect?.op ?? 'halve';
  let newStrikes: number;
  if (op === 'subtract') {
    const subtractValue = halveEffect?.value ?? 2;
    const min = halveEffect?.min ?? 1;
    newStrikes = Math.max(min, originalStrikes - subtractValue);
    logDetail(`Strikes reduced by ${subtractValue} (min ${min}): ${originalStrikes} → ${newStrikes} (${discardedCard.definitionId as string} played)`);
  } else {
    newStrikes = Math.ceil(originalStrikes / 2);
    logDetail(`Strikes halved: ${originalStrikes} → ${newStrikes} (${discardedCard.definitionId as string} played)`);
  }

  const newHand = removeById(defPlayer.hand, discardedCard.instanceId);
  const newDiscard = [...defPlayer.discardPile, toCardInstance(discardedCard)];

  return {
    state: {
      ...updatePlayer(state, defPlayerIndex, p => ({ ...p, hand: newHand, discardPile: newDiscard })),
      combat: { ...combat, strikesTotal: newStrikes },
    },
  };
}

/**
 * Play a `protect-from-strike-assignment` short event from hand during the
 * assign-strikes phase. The targeted character is added to
 * `CombatState.protectedFromStrikeAssignment`, preventing any strike in the
 * current attack from being assigned to them. The card is discarded.
 *
 * Used by Ruse (le-225) mode B: play on a scout; no strikes may be assigned
 * to that scout for the rest of the current attack.
 */
function handleProtectFromStrikeAssignment(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'protect-from-assignment') return wrongActionType(state, action, 'protect-from-assignment');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only protect from strike assignment before strikes are assigned' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can protect a character from strike assignment' };

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  const playedCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!playedCard) return { state, error: 'Card not in hand' };

  const targetChar = defPlayer.characters[action.targetCharacterId as string];
  if (!targetChar) return { state, error: 'Target character not in defending company' };

  const cardName_ = cardName(state, playedCard.definitionId);
  const targetName_ = cardName(state, targetChar.definitionId, action.targetCharacterId as string);
  logDetail(`${cardName_} played — ${targetName_} is now protected from strike assignment this attack`);

  const newHand = removeById(defPlayer.hand, playedCard.instanceId);
  const newDiscard = [...defPlayer.discardPile, toCardInstance(playedCard)];

  const alreadyProtected = combat.protectedFromStrikeAssignment ?? [];
  const newProtected = alreadyProtected.includes(action.targetCharacterId)
    ? alreadyProtected
    : [...alreadyProtected, action.targetCharacterId];

  return {
    state: {
      ...updatePlayer(state, defPlayerIndex, p => ({ ...p, hand: newHand, discardPile: newDiscard })),
      combat: { ...combat, protectedFromStrikeAssignment: newProtected },
    },
  };
}

/**
 * Tap an in-play item to boost the bearer's prowess for the one strike
 * currently being resolved. The item must be untapped and belong to the
 * character assigned the current strike. Tapping it accumulates
 * `prowessBonus` onto `StrikeAssignment.strikeProwessBonus`, benefiting
 * only that one defender for that one strike.
 *
 * Used by Shield of Iron-bound Ash (tw-327).
 */
function handleTapItemForStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'tap-item-for-strike') return wrongActionType(state, action, 'tap-item-for-strike');
  if (combat.phase !== 'resolve-strike') return { state, error: 'Can only tap item for strike during resolve-strike phase' };

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return { state, error: 'No active unresolved strike' };
  if (currentStrike.characterId !== action.characterInstanceId) return { state, error: 'Item bearer is not the current strike target' };

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  if (!defPlayer.characters[action.characterInstanceId as string]) return { state, error: 'Character not found' };

  const tapped = updateAttachment(defPlayer, 'items', action.cardInstanceId, it => ({ ...it, status: CardStatus.Tapped }));
  if (!tapped || tapped.charId !== action.characterInstanceId) return { state, error: 'Item not found on character' };
  const item = tapped.attachment;
  if (item.status !== CardStatus.Untapped) return { state, error: 'Item must be untapped to activate' };

  const itemDef = defById(state, item.definitionId);
  const effect = getCardEffects(itemDef).find(
    (e): e is ModifyAttackEffect => e.type === 'modify-attack' && (e).scope === 'current-strike',
  );
  if (!effect) return { state, error: 'Item has no modify-attack(current-strike) effect' };

  const itemName = (itemDef as { name?: string } | undefined)?.name ?? (item.definitionId as string);
  const prowessBonus = effect.prowessModifier ?? 0;
  logDetail(`Tap-item-for-strike: tapping ${itemName} on ${action.characterInstanceId as string} (+${prowessBonus} prowess for current strike)`);

  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? { ...a, strikeProwessBonus: (a.strikeProwessBonus ?? 0) + prowessBonus }
      : a,
  );

  return {
    state: {
      ...updatePlayer(state, defPlayerIndex, () => tapped.player),
      combat: { ...combat, strikeAssignments: newAssignments },
    },
  };
}

/**
 * Tap an in-play ally carrying a `combat-tap-company-boost` effect to grant an
 * attack-scoped stat boost to every matching character in the ally's own
 * company. Mirrors the `company-combat-boost` short-event path (one
 * `character-stat-modifier` constraint per matching character, `scope: attack`,
 * swept when the attack finalizes) but is triggered by tapping the ally instead
 * of playing a card from hand. Works for the defending company in creature
 * combat and for either company in CvCC.
 *
 * Used by Great Lord of Goblin-gate (as-75).
 */
function handleTapAllyCombatBoost(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'tap-ally-combat-boost') return wrongActionType(state, action, 'tap-ally-combat-boost');

  const playerIndex = getPlayerIndex(state, action.player);
  if (playerIndex < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIndex];

  // Locate the ally and the character bearing it.
  const tapped = updateAttachment(player, 'allies', action.cardInstanceId, a => ({ ...a, status: CardStatus.Tapped }));
  if (!tapped) return { state, error: 'Ally not in play under this player' };
  const { charId: bearerCharId, attachment: ally } = tapped;
  if (ally.status !== CardStatus.Untapped) return { state, error: 'Ally must be untapped to activate' };

  const allyDef = defById(state, ally.definitionId);
  const boostEffects = getCardEffects(allyDef).filter(
    (e): e is CombatTapCompanyBoostEffect => e.type === 'combat-tap-company-boost',
  );
  if (boostEffects.length === 0) return { state, error: 'Ally has no combat-tap-company-boost effect' };

  // The bearer's company must be involved in the current combat (defending
  // company in creature combat, or either company in CvCC).
  const company = player.companies.find(c => c.characters.includes(bearerCharId));
  if (!company) return { state, error: 'Ally bearer is not in a company' };
  const attackingCompanyId = combat.attackSource.type === 'company-attack' ? combat.attackSource.attackingCompanyId : undefined;
  const involved = company.id === combat.companyId || (combat.isCvCC === true && company.id === attackingCompanyId);
  if (!involved) return { state, error: 'Ally company not involved in this combat' };

  // Each copy may apply its boost only once per attack (no stacking).
  const already = state.activeConstraints.some(c => c.source === ally.instanceId && c.scope.kind === 'attack');
  if (already) return { state, error: 'Ally boost already applied this attack' };

  // Tap the ally.
  const allyName = (allyDef as { name?: string } | undefined)?.name ?? (ally.definitionId as string);
  let newState = updatePlayer(state, playerIndex, () => tapped.player);

  // Apply one attack-scoped character-stat-modifier constraint per matching
  // character in the ally's company.
  let applied = 0;
  for (const boostEffect of boostEffects) {
    for (const charId of company.characters) {
      const charData = newState.players[playerIndex].characters[charId as string];
      if (!charData) continue;
      const charCardDef = defById(newState, charData.definitionId);
      if (!charCardDef) continue;
      if (boostEffect.filter) {
        const ctx = {
          target: {
            race: ('race' in charCardDef ? (charCardDef as { race?: string }).race : undefined) ?? '',
            name: ('name' in charCardDef ? (charCardDef as { name?: string }).name : undefined) ?? '',
            skills: ('skills' in charCardDef ? (charCardDef as { skills?: readonly string[] }).skills : undefined) ?? [],
          },
        };
        if (!matchesCondition(boostEffect.filter, ctx)) continue;
      }
      logDetail(`${allyName}: adding attack-scoped +${boostEffect.value} ${boostEffect.stat} to ${charId as string}`);
      newState = addConstraint(newState, {
        source: ally.instanceId,
        sourceDefinitionId: ally.definitionId,
        scope: { kind: 'attack' },
        target: { kind: 'character', characterId: charId },
        kind: {
          type: 'character-stat-modifier',
          stat: boostEffect.stat,
          value: boostEffect.value,
          characterId: charId,
        },
      });
      applied++;
    }
  }
  logDetail(`${allyName} tapped — applied combat boost to ${applied} character(s) in company ${company.id as string}`);

  return { state: newState };
}

/**
 * Activate an in-play item's `modify-attack` effect to adjust the
 * current attack's prowess and/or body. When cost is `{ tap: "self" }` the
 * item taps — unless its `discardIfBearerNot` clause fires (bearer race
 * mismatch), in which case the item is discarded instead. When cost is
 * `{ tap: "bearer" }` only the bearer taps; the item stays untapped (e.g.
 * Star-glass). Modifiers apply uniformly: prowess to every strike (via
 * `combat.strikeProwess`) and body to the creature body check (via
 * `combat.creatureBody`). If `enqueueCorruptionCheck` is true, a corruption
 * check is enqueued on the bearer after the modification.
 *
 * Used by Black Arrow (tw-494) and Star-glass (tw-330).
 */
function handleModifyAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'modify-attack') return wrongActionType(state, action, 'modify-attack');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only modify attack before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to modify attack' };

  const playerIndex = state.players.findIndex(p => p.id === action.player);
  if (playerIndex < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIndex];

  // --- From-hand path ---
  if (action.characterInstanceId === undefined) {
    const handCard = findById(player.hand, action.cardInstanceId);
    if (!handCard) return { state, error: 'Card not in hand' };
    const cardDef = defById(state, handCard.definitionId);
    if (!cardDef) return { state, error: 'Card definition not found' };
    const effect = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').ModifyAttackEffect => e.type === 'modify-attack' && !!(e).fromHand,
    );
    if (!effect) return { state, error: 'Card has no modify-attack (fromHand) effect' };

    const expectedPlayerId = effect.player === 'attacker'
      ? combat.attackingPlayerId
      : combat.defendingPlayerId;
    if (action.player !== expectedPlayerId) {
      return { state, error: `Only ${effect.player === 'attacker' ? 'attacking' : 'defending'} player can play this card` };
    }

    const prowessModifier = effect.prowessModifier ?? 0;
    const bodyModifier = effect.bodyModifier ?? 0;
    const newHand = removeById(player.hand, handCard.instanceId);
    const newDiscard = [...player.discardPile, toCardInstance(handCard)];
    const newStrikeProwess = combat.strikeProwess + prowessModifier;
    const newCreatureBody = combat.creatureBody === null ? null : combat.creatureBody + bodyModifier;
    const cardLabel = cardDef.name;
    logDetail(`Modify-attack (from hand): ${cardLabel} played — strike prowess ${combat.strikeProwess} → ${newStrikeProwess}, creature body ${combat.creatureBody ?? 'n/a'} → ${newCreatureBody ?? 'n/a'}`);

    let newState: GameState = {
      ...updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand, discardPile: newDiscard })),
      combat: { ...combat, strikeProwess: newStrikeProwess, creatureBody: newCreatureBody },
    };

    const attackDupLimit = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').DuplicationLimitEffect =>
        e.type === 'duplication-limit' && (e as { scope: string }).scope === 'attack',
    );
    if (attackDupLimit) {
      newState = addConstraint(newState, {
        source: handCard.instanceId,
        sourceDefinitionId: handCard.definitionId,
        scope: { kind: 'attack' },
        target: { kind: 'player', playerId: action.player },
        kind: { type: 'attack-card-played' },
      });
      logDetail(`${cardLabel}: added attack-card-played marker (duplication-limit scope attack)`);
    }

    return { state: newState };
  }

  // --- In-play item path ---
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can modify attack with an item' };

  const charData = player.characters[action.characterInstanceId as string];
  if (!charData) return { state, error: 'Character not found' };

  const itemIndex = charData.items.findIndex(it => it.instanceId === action.cardInstanceId);
  if (itemIndex < 0) {
    // --- In-play ally path (e.g. Great Bats: tap to remove the "attacker
    // chooses defending characters" rule from the attack) ---
    const allyIndex = charData.allies.findIndex(a => a.instanceId === action.cardInstanceId);
    if (allyIndex < 0) return { state, error: 'Card not found on character' };
    const ally = charData.allies[allyIndex];
    const allyDef = defById(state, ally.definitionId);
    if (!allyDef) return { state, error: 'Ally definition not found' };
    const allyEffect = getCardEffects(allyDef).find(
      (e): e is import('../types/effects.js').ModifyAttackEffect =>
        e.type === 'modify-attack' && !(e).fromHand && (e).scope !== 'current-strike',
    );
    if (!allyEffect) return { state, error: 'Ally has no modify-attack effect' };
    if (allyEffect.cost?.tap !== 'self') return { state, error: 'Ally modify-attack requires a tap-self cost' };
    if (ally.status !== CardStatus.Untapped) return { state, error: 'Ally must be untapped to activate' };
    if (allyEffect.removeAttackerChoosesDefenders && !combat.attackerChoosesDefenders) {
      return { state, error: 'Attack has no attacker-chooses-defenders rule to remove' };
    }

    const allyName = 'name' in allyDef ? (allyDef as { name: string }).name : ally.definitionId as string;
    const updatedAllyChar = {
      ...charData,
      allies: charData.allies.map((a, i) => i === allyIndex ? { ...a, status: CardStatus.Tapped } : a),
    };
    const allyPlayers = clonePlayers(state);
    allyPlayers[playerIndex] = {
      ...allyPlayers[playerIndex],
      characters: { ...allyPlayers[playerIndex].characters, [action.characterInstanceId as string]: updatedAllyChar },
    };

    const allyProwessMod = allyEffect.prowessModifier ?? 0;
    const allyBodyMod = allyEffect.bodyModifier ?? 0;
    const allyStrikeProwess = combat.strikeProwess + allyProwessMod;
    const allyCreatureBody = combat.creatureBody === null ? null : combat.creatureBody + allyBodyMod;
    // Removing attacker-chooses-defenders hands strike assignment back to the
    // defender: clear the flag, and if the attacker was already up to assign
    // (no strikes placed yet — guaranteed by the pre-assignment gate above),
    // flip the assignment sub-phase back to the defender. In the cancel-window
    // the sub-phase stays put; the defender's eventual pass now routes to
    // 'defender' instead of 'attacker'.
    const removeRule = allyEffect.removeAttackerChoosesDefenders === true && combat.attackerChoosesDefenders === true;
    const newAssignmentPhase = removeRule && combat.assignmentPhase === 'attacker' ? 'defender' : combat.assignmentPhase;
    logDetail(`Modify-attack: tapping ally ${allyName}${removeRule ? ' — attacker-chooses-defenders removed, defender assigns strikes' : ''} (prowess ${formatSignedNumber(allyProwessMod)}, body ${formatSignedNumber(allyBodyMod)})`);

    return {
      state: {
        ...state,
        players: allyPlayers,
        combat: {
          ...combat,
          strikeProwess: allyStrikeProwess,
          creatureBody: allyCreatureBody,
          assignmentPhase: newAssignmentPhase,
          ...(removeRule ? { attackerChoosesDefenders: undefined } : {}),
        },
      },
    };
  }
  const item = charData.items[itemIndex];

  const itemDef = defById(state, item.definitionId);
  if (!itemDef) return { state, error: 'Item definition not found' };
  const effect = getCardEffects(itemDef).find(
    (e): e is import('../types/effects.js').ModifyAttackEffect =>
      e.type === 'modify-attack' &&
      !(e).fromHand &&
      (e).scope !== 'current-strike',
  );
  if (!effect) return { state, error: 'Item has no modify-attack effect' };

  const tapCost = effect.cost?.tap;
  const bearerOnly = tapCost === 'bearer';

  if (!bearerOnly && item.status !== CardStatus.Untapped) {
    return { state, error: 'Item must be untapped to activate' };
  }
  if (bearerOnly && charData.status !== CardStatus.Untapped) {
    return { state, error: 'Bearer must be untapped to activate this item' };
  }

  const charDef = defById(state, charData.definitionId);
  if (!charDef || !isCharacterCard(charDef)) return { state, error: 'Bearer is not a character' };

  const prowessModifier = effect.prowessModifier ?? 0;
  const bodyModifier = effect.bodyModifier ?? 0;
  const strikesModifier = effect.strikesModifier ?? 0;
  const itemName = itemDef.name;

  const shouldDiscard = !bearerOnly && effect.discardIfBearerNot
    ? !effect.discardIfBearerNot.race.includes(charDef.race as string)
    : false;

  let updatedChar;
  if (bearerOnly) {
    logDetail(`Modify-attack: bearer ${charDef.name ?? ''} taps via ${itemName} (prowess ${formatSignedNumber(prowessModifier)}, body ${formatSignedNumber(bodyModifier)})`);
    updatedChar = { ...charData, status: CardStatus.Tapped };
  } else if (shouldDiscard) {
    logDetail(`Modify-attack: ${itemName} tapped — bearer ${charDef.name ?? ''} is not a ${effect.discardIfBearerNot?.race.join('/') ?? ''}, discarding item`);
    updatedChar = { ...charData, items: charData.items.filter((_, i) => i !== itemIndex) };
  } else {
    logDetail(`Modify-attack: tapping ${itemName} on ${charDef.name ?? ''} (prowess ${formatSignedNumber(prowessModifier)}, body ${formatSignedNumber(bodyModifier)}, strikes ${formatSignedNumber(strikesModifier)})`);
    updatedChar = {
      ...charData,
      items: charData.items.map((it, i) => i === itemIndex ? { ...it, status: CardStatus.Tapped } : it),
    };
  }

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    characters: { ...newPlayers[playerIndex].characters, [action.characterInstanceId as string]: updatedChar },
  };

  if (shouldDiscard) {
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      discardPile: [...newPlayers[playerIndex].discardPile, toCardInstance(item)],
    };
  }

  const newStrikeProwess = combat.strikeProwess + prowessModifier;
  const newCreatureBody = combat.creatureBody === null ? null : combat.creatureBody + bodyModifier;
  const newStrikesTotal = strikesModifier !== 0 ? Math.max(1, combat.strikesTotal + strikesModifier) : combat.strikesTotal;
  logDetail(`Modify-attack applied: strike prowess ${combat.strikeProwess} → ${newStrikeProwess}, creature body ${combat.creatureBody ?? 'n/a'} → ${newCreatureBody ?? 'n/a'}, strikes ${combat.strikesTotal} → ${newStrikesTotal}`);

  let resultState: GameState = {
    ...state,
    players: newPlayers,
    combat: { ...combat, strikeProwess: newStrikeProwess, creatureBody: newCreatureBody, strikesTotal: newStrikesTotal },
  };

  if (effect.enqueueCorruptionCheck) {
    const company = companyById(player.companies, combat.companyId);
    const scope = companySubphaseScope(state.phaseState.phase, company!.id);
    logDetail(`Modify-attack: enqueuing corruption check on bearer ${action.characterInstanceId as string} (${itemName})`);
    resultState = enqueueCorruptionCheck(resultState, {
      source: item.instanceId,
      actor: action.player,
      scope,
      characterId: action.characterInstanceId,
      reason: itemName,
    });
  }

  return { state: resultState };
}

/**
 * Transfer one item from an eliminated character to an unwounded companion.
 * Available during the 'item-salvage' combat phase (CoE rule 3.I.2).
 */
function handleSalvageItem(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'salvage-item') return wrongActionType(state, action, 'salvage-item');
  if (combat.phase !== 'item-salvage') return { state, error: 'Not in item-salvage phase' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can salvage items' };

  const { salvageItems, salvageRecipients } = combat;
  if (!salvageItems || !salvageRecipients) return { state, error: 'No salvage state' };

  // Validate the item exists in salvage pool
  const itemIndex = salvageItems.findIndex(it => it.instanceId === action.itemInstanceId);
  if (itemIndex < 0) return { state, error: 'Item not available for salvage' };

  // Validate the recipient is eligible
  if (!salvageRecipients.includes(action.recipientCharacterId)) {
    return { state, error: 'Character not eligible to receive salvaged item' };
  }

  const item = salvageItems[itemIndex];
  const newPlayers = clonePlayers(state);
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const recipientChar = newPlayers[defIdx].characters[action.recipientCharacterId as string];
  if (!recipientChar) return { state, error: 'Recipient character not found' };

  logDetail(`Salvaging item ${item.instanceId as string} to character ${action.recipientCharacterId as string}`);

  // Transfer the item to the recipient character
  const newCharacters = { ...newPlayers[defIdx].characters };
  newCharacters[action.recipientCharacterId as string] = {
    ...recipientChar,
    items: [...recipientChar.items, item],
  };
  newPlayers[defIdx] = { ...newPlayers[defIdx], characters: newCharacters };

  // Remove item from salvage pool and recipient from eligible list
  const remainingItems = salvageItems.filter((_, i) => i !== itemIndex);
  const remainingRecipients = salvageRecipients.filter(r => r !== action.recipientCharacterId);

  // If no more items or no more recipients, finish salvage
  if (remainingItems.length === 0 || remainingRecipients.length === 0) {
    // Discard any remaining unsalvaged items
    for (const leftover of remainingItems) {
      logDetail(`Discarding unsalvaged item ${leftover.instanceId as string}`);
      newPlayers[defIdx] = {
        ...newPlayers[defIdx],
        discardPile: [...newPlayers[defIdx].discardPile, toCardInstance(leftover)],
      };
    }
    return finishSalvage({ ...state, players: newPlayers }, combat);
  }

  // More items and recipients available — stay in salvage phase
  logDetail(`Item salvage continues: ${remainingItems.length} item(s) remaining, ${remainingRecipients.length} recipient(s) remaining`);
  return {
    state: {
      ...state,
      players: newPlayers,
      combat: { ...combat, salvageItems: remainingItems, salvageRecipients: remainingRecipients },
    },
  };
}

/**
 * Transition out of item-salvage phase back to the normal combat flow.
 * Clears salvage fields and advances to the next strike or finalizes combat.
 */
function finishSalvage(state: GameState, combat: CombatState): ReducerResult {
  const cleanCombat: CombatState = { ...combat, phase: 'body-check', salvageItems: undefined, salvageRecipients: undefined };
  const next = nextStrikePhase(cleanCombat);
  if (next) {
    return { state: { ...state, combat: { ...cleanCombat, ...next } } };
  }
  return finalizeCombat({ ...state, combat: cleanCombat });
}

/**
 * Defender discards one item from the company after a successful agent strike
 * with strikeEffect: 'discard-item' (An Article Missing, dm-43).
 * Once the item is discarded, combat advances to the next strike or finalizes.
 */
function handleDiscardItemFromCompany(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'discard-item-from-company') return wrongActionType(state, action, 'discard-item-from-company');
  if (combat.phase !== 'discard-item-from-company') return { state, error: 'Not in discard-item-from-company phase' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can discard the item' };

  const { discardItemOptions } = combat;
  if (!discardItemOptions) return { state, error: 'No discard-item options in combat state' };

  const itemIndex = discardItemOptions.findIndex(it => it.instanceId === action.itemInstanceId);
  if (itemIndex < 0) return { state, error: 'Item not available for discard' };

  const item = discardItemOptions[itemIndex];
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);

  // Remove item from its bearer and add to discard pile
  const removed = removeAttachment(state.players[defIdx], 'items', item.instanceId);
  if (!removed) return { state, error: 'Item not found on any character in company' };

  logDetail(`An Article Missing: discarding item ${item.instanceId as string} from company`);
  const newPlayers = clonePlayers(state);
  newPlayers[defIdx] = {
    ...removed.player,
    discardPile: [...removed.player.discardPile, toCardInstance(item)],
  };

  const cleanCombat: CombatState = { ...combat, phase: 'resolve-strike', discardItemOptions: undefined };
  const next = nextStrikePhase(cleanCombat);
  if (!next) {
    return finalizeCombat({ ...state, players: newPlayers, combat: cleanCombat });
  }
  return { state: { ...state, players: newPlayers, combat: { ...cleanCombat, ...next } } };
}

/**
 * Remove a card-triggered-attack card from cardsInPlay and send it to the
 * defending player's discard pile. Used when no untapped characters survive
 * the attack (or the attack is cancelled) so the card cannot be assigned.
 */
function discardCardTriggeredCard(
  state: GameState,
  cardInstanceId: import('../index.js').CardInstanceId,
  defPlayerIdx: number,
): GameState {
  const newPlayers: [import('../index.js').PlayerState, import('../index.js').PlayerState] = [
    state.players[0],
    state.players[1],
  ];
  for (let pi = 0; pi < 2; pi++) {
    const inPlay = findById(newPlayers[pi].cardsInPlay, cardInstanceId);
    if (inPlay) {
      newPlayers[pi] = {
        ...newPlayers[pi],
        cardsInPlay: newPlayers[pi].cardsInPlay.filter(c => c.instanceId !== cardInstanceId),
      };
      newPlayers[defPlayerIdx] = {
        ...newPlayers[defPlayerIdx],
        discardPile: [
          ...newPlayers[defPlayerIdx].discardPile,
          toCardInstance(inPlay),
        ],
      };
      return { ...state, players: newPlayers };
    }
  }
  return state;
}

/**
 * Finalize combat after all strikes are resolved.
 *
 * If all strikes were defeated (result === 'success' — the character won the
 * roll and any creature body check failed), the creature card moves to the
 * defending player's marshalling point pile. If any strike was not defeated
 * (e.g. a creature that passed its body check, result === 'survived'), the
 * creature stays in the hazard player's discard pile.
 */
/**
 * Handle a `take-trophy` action during the `trophy-offer` combat phase.
 *
 * The chosen Orc/Troll character receives the defeated creature card as a
 * trophy (placed under the character). The creature is removed from the
 * kill pile (kill-MP was already counted in finalizeCombat) and stored on
 * the character instead. After taking a trophy the phase returns to normal
 * (removes the combat state).
 */
function handleTakeTrophy(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'take-trophy') return wrongActionType(state, action, 'take-trophy');
  if (combat.phase !== 'trophy-offer') return { state, error: 'take-trophy only valid in trophy-offer phase' };

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const char = defPlayer.characters[action.characterId as string];
  if (!char) return { state, error: 'Trophy character not found' };

  // Find the creature instance in the kill pile (it was moved there in finalizeCombat)
  const creatureInKillPile = findById(defPlayer.killPile, action.creatureInstanceId);
  if (!creatureInKillPile) return { state, error: 'Creature not found in kill pile for trophy' };

  logDetail(`Trophy: ${action.characterId as string} takes ${action.creatureInstanceId as string} as a trophy (MELE §8.37)`);

  // Remove from kill pile and add to character's trophies
  const newKillPile = removeById(defPlayer.killPile, action.creatureInstanceId);
  const newTrophies = [...(char.trophies ?? []), creatureInKillPile];
  const newPlayers = clonePlayers(state);
  newPlayers[defPlayerIndex] = {
    ...defPlayer,
    killPile: newKillPile,
    characters: {
      ...defPlayer.characters,
      [action.characterId as string]: { ...char, trophies: newTrophies },
    },
  };

  // Clear combat and return
  return { state: { ...state, players: newPlayers, combat: null } };
}

/**
 * Handle a `pass` action during the `trophy-offer` combat phase.
 * The defending player declines to take any trophy; combat ends normally.
 * Applies rule 8.22: if the defeated creature is in the defender's kill pile
 * but alignment-mismatched, move it to out-of-play instead.
 */
function finalizeCombatFromTrophyOffer(state: GameState, combat: CombatState): ReducerResult {
  logDetail('Trophy offer declined — combat finalized without trophy');
  const finalState = applyRule8_22AfterTrophyDecision(state, combat);
  return { state: { ...finalState, combat: null } };
}

/**
 * Apply CoE rule 8.22 after the trophy decision is resolved (either no eligible
 * characters or player declined). Checks the creature in the defender's kill pile
 * and moves it to out-of-play if the alignment doesn't match the creature's starred status.
 *
 * - Hero/FW: starred creatures → out-of-play
 * - Minion/Balrog: non-starred creatures → out-of-play
 */
function applyRule8_22AfterTrophyDecision(state: GameState, combat: CombatState): GameState {
  const creatureInstanceId =
    combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
      : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
        : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
          : null;
  if (!creatureInstanceId || combat.detainment) return state;

  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defIdx];
  const creatureInKill = defPlayer.killPile.find(c => c.instanceId === creatureInstanceId);
  if (!creatureInKill) return state;

  const creatureDef = resolveDef(state, creatureInstanceId) as { starredKillMarshallingPoints?: boolean } | undefined;
  const isStarred = creatureDef?.starredKillMarshallingPoints === true;
  const defAlignment = defPlayer.alignment;
  const defIsMinion = defAlignment === Alignment.Ringwraith || defAlignment === Alignment.Balrog;
  const worthMP = defIsMinion ? isStarred : !isStarred;

  if (!worthMP) {
    logDetail(`Rule 8.22: moving ${isStarred ? 'starred' : 'non-starred'} creature from kill pile to out-of-play for ${defAlignment} defender`);
    const newPlayers = clonePlayers(state);
    newPlayers[defIdx] = {
      ...newPlayers[defIdx],
      killPile: newPlayers[defIdx].killPile.filter(c => c.instanceId !== creatureInstanceId),
      outOfPlayPile: [...newPlayers[defIdx].outOfPlayPile, creatureInKill],
    };
    return { ...state, players: [newPlayers[0], newPlayers[1]] as unknown as typeof state.players };
  }
  return state;
}

function finalizeCombat(state: GameState, effects: GameEffect[] = []): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No combat to finalize' };

  // 'absorbed' strikes (Sable Shield) do not count as defeating the creature —
  // the attacker won the roll but the wound was intercepted by the item.
  const allDefeated = combat.strikeAssignments.length > 0
    && combat.strikeAssignments.every(a => a.result === 'success');

  const newPlayers = clonePlayers(state);

  // Creature attacks (M/H or on-guard): the creature card is in the
  // attacker's cardsInPlay during combat. After combat it moves to:
  // - defender's kill pile (all strikes defeated) for marshalling points
  // - attacker's discard pile (any strike not defeated)
  //
  // Played-auto-attacks (site `dynamic-auto-attack` effect, e.g. Framsburg
  // td-175) are a special case: the creature is "treated in all ways as
  // the site's automatic-attack", which means it is discarded after
  // combat regardless of outcome — the resource player does NOT gain
  // kill-MP, mirroring standard auto-attacks.
  const creatureInstanceId =
    combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
      : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
        : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
          : null;
  const isPlayedAutoAttack = combat.attackSource.type === 'played-auto-attack';

  if (creatureInstanceId) {
    const atkIdx = getPlayerIndex(state, combat.attackingPlayerId);
    const defIdx = getPlayerIndex(state, combat.defendingPlayerId);

    // Remove creature from attacker's cardsInPlay
    const creatureInPlay = findById(newPlayers[atkIdx].cardsInPlay, creatureInstanceId);
    const creatureCard = creatureInPlay
      ? toCardInstance(creatureInPlay)
      : undefined;
    newPlayers[atkIdx] = {
      ...newPlayers[atkIdx],
      cardsInPlay: newPlayers[atkIdx].cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
    };

    if (isPlayedAutoAttack && creatureCard) {
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        discardPile: [...newPlayers[atkIdx].discardPile, creatureCard],
      };
      logDetail(`Played-auto-attack creature discarded (no kill-MP awarded — treated as site's automatic-attack)`);
    } else if (allDefeated && creatureCard && combat.detainment) {
      // CoE rule 3.II.3 — defeated detainment creature is discarded instead
      // of going to the attacked player's MP pile (0 kill-MP awarded).
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        discardPile: [...newPlayers[atkIdx].discardPile, creatureCard],
      };
      logDetail(`All strikes defeated (detainment) — creature discarded instead of kill pile (§3.II.3)`);
    } else if (allDefeated && creatureCard) {
      // Always move to kill pile initially. Rule 8.22 routing (kill pile vs out-of-play)
      // is applied after the trophy-offer decision to avoid race with trophy code.
      newPlayers[defIdx] = {
        ...newPlayers[defIdx],
        killPile: [...newPlayers[defIdx].killPile, creatureCard],
      };
      logDetail(`All strikes defeated — creature moved to defender's kill pile`);
    } else if (creatureCard) {
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        discardPile: [...newPlayers[atkIdx].discardPile, creatureCard],
      };
      logDetail(`Combat ended — creature moved to attacker's discard`);
    }
  }

  // AS-39 Summons from Long Sleep: if the attacking creature was played from a
  // reserved slot (reservingCardInstanceId present), discard the AS-39 card after combat.
  if (combat.attackSource.type === 'creature' && combat.attackSource.reservingCardInstanceId) {
    const reservingId = combat.attackSource.reservingCardInstanceId;
    const atkIdx2 = getPlayerIndex(state, combat.attackingPlayerId);
    const reservingCard = newPlayers[atkIdx2].cardsInPlay.find(c => c.instanceId === reservingId);
    if (reservingCard) {
      const reservingName = cardName(state, reservingCard.definitionId, '?');
      logDetail(`AS-39 Summons from Long Sleep: creature played from reserved slot — discarding "${reservingName}" after combat`);
      newPlayers[atkIdx2] = {
        ...newPlayers[atkIdx2],
        cardsInPlay: newPlayers[atkIdx2].cardsInPlay.filter(c => c.instanceId !== reservingId),
        reservedCreatures: newPlayers[atkIdx2].reservedCreatures.filter(r => r.sourceCardInstanceId !== reservingId),
        discardPile: [...newPlayers[atkIdx2].discardPile, toCardInstance(reservingCard)],
      };
    } else {
      logDetail(`AS-39 Summons from Long Sleep: reserving card ${reservingId as string} already removed`);
    }
  }

  logDetail('Combat finalized — returning to enclosing phase');

  // Check for on-event: character-wounded-by-self effects on the attack source.
  // If any characters were wounded (not eliminated) and the attack source card
  // has this effect, enqueue a pending corruption-check resolution per
  // wounded character via the unified pending-resolution system.
  //
  // Under detainment (CoE rule 3.II.1.1), successful strikes tap rather than
  // wound — the character "is not considered to have been wounded and
  // passive conditions that depend on a character being wounded are not
  // initiated". Skip the on-wounded trigger entirely.
  let stateAfterCombat: GameState = { ...state, players: newPlayers, combat: null };
  const woundedCharIds = combat.detainment
    ? []
    : combat.strikeAssignments
        .filter(a => a.result === 'wounded')
        .map(a => a.characterId);

  if (
    woundedCharIds.length > 0 &&
    (state.phaseState.phase === Phase.Site || state.phaseState.phase === Phase.MovementHazard)
  ) {
    const sourceCard = getAttackSourceCard(state, combat);
    const sourceName = (sourceCard as { name?: string } | undefined)?.name ?? 'Wound';
    const woundEvents = getOnEventEffects(sourceCard, 'character-wounded-by-self');
    for (const woundEvent of woundEvents) {
      const conditionContext = buildOnEventContext(state);
      if (woundEvent.when && !matchesCondition(woundEvent.when, conditionContext)) {
        logDetail(`On-event condition not met for ${sourceName} — skipping`);
        continue;
      }

      if (woundEvent.apply.type === 'force-check') {
        const modifier = woundEvent.apply.modifier ?? 0;
        const actor = combat.defendingPlayerId;
        const actorIndex = getPlayerIndex(stateAfterCombat, actor);
        const phaseStateActive = state.phaseState as { activeCompanyIndex: number };
        const company = stateAfterCombat.players[actorIndex].companies[phaseStateActive.activeCompanyIndex];
        const companyId = company?.id;
        logDetail(`Wound corruption checks queued for ${woundedCharIds.length} character(s) (${sourceName}, modifier ${modifier})`);
        if (companyId) {
          const scope = companySubphaseScope(state.phaseState.phase, companyId);
          const source = combat.attackSource.type === 'creature' ? combat.attackSource.instanceId : null;
          for (const characterId of woundedCharIds) {
            stateAfterCombat = enqueueCorruptionCheck(stateAfterCombat, {
              source,
              actor,
              scope,
              characterId,
              modifier,
              reason: sourceName,
            });
          }
        }
      } else if (
        woundEvent.apply.type === 'move'
        && woundEvent.apply.select === 'filter-all'
        && woundEvent.apply.from === 'items-on-wounded'
        && woundEvent.apply.to === 'discard'
      ) {
        const filter = woundEvent.apply.filter;
        stateAfterCombat = discardWoundedItems(stateAfterCombat, combat, woundedCharIds, sourceName, filter);
      } else if (woundEvent.apply.type === 'force-discard-one-company-item') {
        // Brigands: fires once per attack (not per wound). Company must discard one item.
        const actor = combat.defendingPlayerId;
        const companyId = combat.companyId;
        const actorIndex = getPlayerIndex(stateAfterCombat, actor);
        const defPlayer = stateAfterCombat.players[actorIndex];
        const company = companyById(defPlayer?.companies ?? [], companyId);
        const hasItems = (company?.characters ?? []).some(charId => {
          const ch = defPlayer.characters[charId as string];
          return ch && ch.items.length > 0;
        });
        if (hasItems) {
          const scope = companySubphaseScope(state.phaseState.phase, companyId);
          const source = combat.attackSource.type === 'creature' ? combat.attackSource.instanceId : null;
          logDetail(`${sourceName}: wound triggers discard-one-company-item for company ${companyId as string}`);
          stateAfterCombat = enqueueResolution(stateAfterCombat, {
            source,
            actor,
            scope,
            kind: { type: 'discard-one-company-item', companyId },
          });
        } else {
          logDetail(`${sourceName}: discard-one-company-item triggered but company has no items — skipping`);
        }
      } else if (woundEvent.apply.type === 'discard-character') {
        stateAfterCombat = discardWoundedCharacters(stateAfterCombat, combat, woundedCharIds, sourceName, woundEvent.when);
      }
    }
  }

  // Check for on-event: company-member-wounded effects on characters' attached
  // hazard events. When any characters were wounded, scan every character in
  // the defending company for attached hazards carrying this event; for each
  // match, enqueue a corruption check on the bearer (the character bearing the
  // hazard, not necessarily the wounded character). Used by Despair of the Heart.
  if (
    woundedCharIds.length > 0 &&
    (state.phaseState.phase === Phase.Site || state.phaseState.phase === Phase.MovementHazard)
  ) {
    const defPlayerIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
    const defPlayer = stateAfterCombat.players[defPlayerIdx];
    const company = companyById(defPlayer?.companies ?? [], combat.companyId);
    if (company) {
      const scope = companySubphaseScope(state.phaseState.phase, company.id);
      for (const bearerInstId of company.characters) {
        const bearer = defPlayer.characters[bearerInstId as string];
        if (!bearer) continue;
        for (const hazard of bearer.hazards) {
          const hazardDef = defById(stateAfterCombat, hazard.definitionId) as
            { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
          if (!hazardDef) continue;
          const companyMemberWoundedEvents = getOnEventEffects(hazardDef, 'company-member-wounded');
          for (const evt of companyMemberWoundedEvents) {
            if (evt.apply.type === 'force-check') {
              const modifier = evt.apply.modifier ?? 0;
              const hazardName = hazardDef.name ?? hazard.definitionId as string;
              logDetail(`Company-member-wounded: ${hazardName} triggers corruption check on bearer ${bearerInstId as string} (modifier ${modifier})`);
              stateAfterCombat = enqueueCorruptionCheck(stateAfterCombat, {
                source: hazard.instanceId,
                actor: combat.defendingPlayerId,
                scope,
                characterId: bearerInstId,
                modifier,
                reason: hazardName,
              });
            }
          }
        }
      }
    }
  }

  // Check for on-event: bearer-wounded effects on allies attached to wounded characters.
  // When any characters are wounded (not eliminated), scan each wounded character's
  // allies for this event. If an ally has bearer-wounded → discard-self, discard it.
  // Used by Regiment of Black Crows (as-76) and Great Bats (as-74).
  if (woundedCharIds.length > 0) {
    const defPlayerIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
    let defPlayer = stateAfterCombat.players[defPlayerIdx];
    let anyDiscarded = false;
    for (const charId of woundedCharIds) {
      const charData = defPlayer.characters[charId as string];
      if (!charData) continue;
      const alliesToDiscard: (typeof charData.allies)[number][] = [];
      for (const ally of charData.allies) {
        const allyDef = defById(stateAfterCombat, ally.definitionId);
        const bearerWoundedEvents = getOnEventEffects(allyDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined, 'bearer-wounded');
        if (bearerWoundedEvents.some(e => e.apply?.type === 'discard-self')) {
          const allyName = (allyDef as { name?: string } | undefined)?.name ?? (ally.definitionId as string);
          logDetail(`bearer-wounded: discarding ally "${allyName}" from wounded character ${charId as string}`);
          alliesToDiscard.push(ally);
          anyDiscarded = true;
        }
      }
      if (alliesToDiscard.length > 0) {
        const remainingAllies = charData.allies.filter(a => !alliesToDiscard.some(d => d.instanceId === a.instanceId));
        const newDiscard = [...defPlayer.discardPile, ...alliesToDiscard.map(a => toCardInstance(a))];
        defPlayer = {
          ...defPlayer,
          characters: {
            ...defPlayer.characters,
            [charId as string]: { ...charData, allies: remainingAllies },
          },
          discardPile: newDiscard,
        };
      }
    }
    if (anyDiscarded) {
      stateAfterCombat = updatePlayer(stateAfterCombat, defPlayerIdx, () => defPlayer);
    }
  }

  // LE-140 Stay Her Appetite: if the detainment attack was not fully defeated,
  // the ally that triggered the attack is discarded.
  if (combat.attackSource.type === 'stay-her-appetite-attack' && !allDefeated) {
    const { allyInstanceId, allyOwnerPlayerIndex, hostCharacterInstanceId } = combat.attackSource;
    stateAfterCombat = updatePlayer(stateAfterCombat, allyOwnerPlayerIndex, p => {
      const hostChar = p.characters[hostCharacterInstanceId as string];
      if (!hostChar) {
        logDetail(`LE-140 Stay Her Appetite: host character ${hostCharacterInstanceId as string} not found — cannot discard ally`);
        return p;
      }
      const ally = hostChar.allies.find(a => a.instanceId === allyInstanceId);
      if (!ally) {
        logDetail(`LE-140 Stay Her Appetite: ally ${allyInstanceId as string} not on host character — already discarded?`);
        return p;
      }
      const allyName = cardName(stateAfterCombat, ally.definitionId, '?');
      logDetail(`LE-140 Stay Her Appetite: attack not defeated — discarding ally "${allyName}"`);
      return {
        ...p,
        characters: {
          ...p.characters,
          [hostCharacterInstanceId as string]: {
            ...hostChar,
            allies: hostChar.allies.filter(a => a.instanceId !== allyInstanceId),
          },
        },
        discardPile: [...p.discardPile, toCardInstance(ally)],
      };
    });
  }

  // Check for on-event: attack-not-defeated effects on the attack source.
  // If the attack was NOT fully defeated and the creature card carries this
  // event, apply its constraint to the defending company.
  if (!allDefeated) {
    const sourceCardForNotDefeated = getAttackSourceCard(state, combat);
    const notDefeatedEvents = getOnEventEffects(sourceCardForNotDefeated, 'attack-not-defeated');
    for (const nde of notDefeatedEvents) {
      if (nde.apply.type === 'add-constraint' && nde.apply.constraint === 'deny-scout-resources') {
        const creatureSource =
          combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
            : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
              : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
                : null;
        if (creatureSource) {
          const creatureDefId = resolveInstanceId(state, creatureSource);
          const creatureName = cardName(state, creatureDefId!, 'creature');
          logDetail(`Attack not defeated — ${creatureName} fires deny-scout-resources on company ${combat.companyId as string}`);
          stateAfterCombat = addConstraint(stateAfterCombat, {
            source: creatureSource,
            sourceDefinitionId: (creatureDefId ?? creatureSource) as import('../types/common.js').CardDefinitionId,
            scope: { kind: 'turn' },
            target: { kind: 'company', companyId: combat.companyId },
            kind: { type: 'deny-scout-resources' },
          });
        }
      }
    }
  }

  // Check for on-event: attack-not-canceled effects on the attack source.
  // All resolved combats were by definition not canceled (cancellation prevents
  // combat resolution entirely), so this fires unconditionally after any attack.
  const sourceCardForNotCanceled = getAttackSourceCard(state, combat);
  const notCanceledEvents = getOnEventEffects(sourceCardForNotCanceled, 'attack-not-canceled');
  for (const nce of notCanceledEvents) {
    if (nce.apply.type === 'add-constraint' && nce.apply.constraint === 'creature-attack-boost') {
      const creatureSource =
        combat.attackSource.type === 'creature' ? combat.attackSource.instanceId
          : combat.attackSource.type === 'on-guard-creature' ? combat.attackSource.cardInstanceId
            : combat.attackSource.type === 'played-auto-attack' ? combat.attackSource.instanceId
              : null;
      if (creatureSource) {
        const creatureDefId = resolveInstanceId(state, creatureSource);
        const creatureName = cardName(state, creatureDefId!, 'creature');
        const boostRace = nce.apply.race ?? '';
        const boostStrikes = nce.apply.strikes ?? 0;
        const boostProwess = nce.apply.prowess ?? 0;
        logDetail(`Attack not canceled — ${creatureName} fires creature-attack-boost (race=${boostRace}, +${boostStrikes} strikes, +${boostProwess} prowess) on company ${combat.companyId as string}`);
        stateAfterCombat = addConstraint(stateAfterCombat, {
          source: creatureSource,
          sourceDefinitionId: (creatureDefId ?? creatureSource) as import('../types/common.js').CardDefinitionId,
          scope: { kind: 'turn' },
          target: { kind: 'company', companyId: combat.companyId },
          kind: {
            type: 'creature-attack-boost',
            race: boostRace,
            strikes: boostStrikes,
            prowess: boostProwess,
          },
        });
      }
    }
  }

  // Check for on-event: attack-defeated effects on permanent events in play.
  // When all strikes were defeated, scan every player's cardsInPlay for
  // permanent events whose on-event condition matches the attack's race
  // (e.g. The Moon Is Dead: discard when an Undead attack is defeated).
  if (allDefeated && combat.creatureRace) {
    const isAutomaticAttack = combat.attackSource.type === 'automatic-attack'
      || combat.attackSource.type === 'played-auto-attack';
    const attackCtx = {
      enemy: { race: combat.creatureRace },
      attack: { isolated: combat.isolated ?? false, isAutomaticAttack },
      inPlay: buildInPlayNames(stateAfterCombat),
    };
    const allDiscardedIds = new Set<string>();
    const updatedPlayersAD = stateAfterCombat.players.map(player => {
      const toDiscard: import('../types/state-cards.js').CardInPlay[] = [];
      const remaining: import('../types/state-cards.js').CardInPlay[] = [];
      for (const card of player.cardsInPlay) {
        const def = stateAfterCombat.cardPool[card.definitionId as string] as { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
        const defeatedEvents = getOnEventEffects(def, 'attack-defeated');
        let shouldDiscard = false;
        for (const ev of defeatedEvents) {
          if (!ev.when || matchesContext(ev.when, attackCtx)) {
            if (ev.apply.type === 'discard-self') {
              shouldDiscard = true;
              break;
            }
          }
        }
        if (shouldDiscard) { toDiscard.push(card); } else { remaining.push(card); }
      }
      if (toDiscard.length === 0) return player;
      const discarded = toDiscard.map(c => (toCardInstance(c)));
      for (const c of toDiscard) {
        allDiscardedIds.add(c.instanceId as string);
        const defName = cardName(stateAfterCombat, c.definitionId, '?');
        logDetail(`Attack-defeated: discarding "${defName}" from cardsInPlay (on-event: attack-defeated)`);
      }
      return { ...player, cardsInPlay: remaining, discardPile: [...player.discardPile, ...discarded] };
    }) as unknown as typeof stateAfterCombat.players;
    stateAfterCombat = { ...stateAfterCombat, players: updatedPlayersAD };
    // Remove constraints sourced from discarded permanent events
    if (allDiscardedIds.size > 0) {
      stateAfterCombat = {
        ...stateAfterCombat,
        activeConstraints: stateAfterCombat.activeConstraints.filter(
          c => !allDiscardedIds.has(c.source as string),
        ),
      };
    }
  }

  // Handle permanent-event auto-attack onDefeat:'remove-from-play' (e.g. Balrog of Moria TW-12).
  // When all strikes of a site automatic-attack are defeated and the attack's source
  // is a permanent-event carrying this flag, remove the event from the hazard player's
  // cardsInPlay and move it to the defending player's killPile to award kill MPs.
  if (allDefeated && combat.attackSource.type === 'automatic-attack') {
    const { siteInstanceId, attackIndex } = combat.attackSource;
    const siteDef = resolveDef(state, siteInstanceId);
    if (siteDef && isSiteCard(siteDef)) {
      const autoAttacks = getActiveAutoAttacks(state, siteDef);
      const aa = autoAttacks[attackIndex];
      const sourceInstId = aa?.sourceInstanceId;
      if (sourceInstId) {
        const sourceDef = resolveDef(state, sourceInstId);
        const effects = (sourceDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
        for (const eff of effects) {
          if (eff.type !== 'permanent-event-auto-attack') continue;
          const peaEff = eff;
          if (peaEff.onDefeat !== 'remove-from-play') continue;
          const sourceName = (sourceDef as { name?: string } | undefined)?.name ?? '?';
          const hazardIdx = getPlayerIndex(stateAfterCombat, combat.attackingPlayerId);
          const defIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
          const sourceCard = stateAfterCombat.players[hazardIdx]?.cardsInPlay.find(c => c.instanceId === sourceInstId);
          if (sourceCard) {
            const cardRef = toCardInstance(sourceCard);
            const updatedPlayersOD = stateAfterCombat.players.map((p, idx) => {
              if (idx === hazardIdx) return { ...p, cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== sourceInstId) };
              if (idx === defIdx) return { ...p, killPile: [...p.killPile, cardRef] };
              return p;
            }) as unknown as typeof stateAfterCombat.players;
            stateAfterCombat = { ...stateAfterCombat, players: updatedPlayersOD };
            logDetail(`Permanent-event "${sourceName}" defeated — removed from play, kill MPs awarded to defender`);
          }
          break;
        }
      }
    }
  }

  // Handle permanent-event auto-attack discardAfterUse (e.g. Witch-king at Iron-deeps / Under-leas).
  // Fires regardless of outcome (win or lose). When a site auto-attack's source is a permanent
  // event with discardAfterUse: true, move the card from the hazard player's cardsInPlay to their
  // discard pile. No kill MPs are awarded ("ignore result of defeat").
  if (combat.attackSource.type === 'automatic-attack') {
    const { siteInstanceId: dauSiteInstId, attackIndex: dauAttackIdx } = combat.attackSource;
    const dauSiteDef = resolveDef(state, dauSiteInstId);
    if (dauSiteDef && isSiteCard(dauSiteDef)) {
      const dauAttacks = getActiveAutoAttacks(state, dauSiteDef);
      const dauAa = dauAttacks[dauAttackIdx];
      const dauSourceInstId = dauAa?.sourceInstanceId;
      if (dauSourceInstId) {
        const dauSourceDef = resolveDef(state, dauSourceInstId);
        const dauEffects = (dauSourceDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
        for (const dauEff of dauEffects) {
          if (dauEff.type !== 'permanent-event-auto-attack') continue;
          if (!dauEff.discardAfterUse) continue;
          const dauSourceName = (dauSourceDef as { name?: string } | undefined)?.name ?? '?';
          const dauHazardIdx = getPlayerIndex(stateAfterCombat, combat.attackingPlayerId);
          const dauSourceCard = stateAfterCombat.players[dauHazardIdx]?.cardsInPlay.find(c => c.instanceId === dauSourceInstId);
          if (dauSourceCard) {
            const dauCardRef = toCardInstance(dauSourceCard);
            const dauUpdatedPlayers = stateAfterCombat.players.map((p, idx) => {
              if (idx === dauHazardIdx) return { ...p, cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== dauSourceInstId), discardPile: [...p.discardPile, dauCardRef] };
              return p;
            }) as unknown as typeof stateAfterCombat.players;
            stateAfterCombat = { ...stateAfterCombat, players: dauUpdatedPlayers };
            logDetail(`Permanent-event "${dauSourceName}" used as extra auto-attack (discardAfterUse) — moved to discard pile`);
          }
          break;
        }
      }
    }
  }

  stateAfterCombat = recordHazardEncountered(stateAfterCombat, state, combat);

  // Apply post-attack effects scheduled by accepted haven-join offers
  // (e.g. Alatar's "following the attack, tap + corruption check").
  // Effects fire regardless of outcome. After effects, any haven-jumped
  // character is restored to their original company.
  stateAfterCombat = applyPostAttackEffects(stateAfterCombat, state, combat);
  stateAfterCombat = restoreHavenJumpOrigins(stateAfterCombat, combat);

  // card-triggered-attack finalization (e.g. Rescue Prisoners, Burning Rick, Cot, and Tree):
  // The card sits in cardsInPlay during the attack. After combat, check whether there
  // are remaining queued attacks (multi-attack form); if so, trigger the next one.
  // On the final attack, check for untapped characters to determine whether to discard
  // or queue bearer selection.
  if (combat.attackSource.type === 'card-triggered-attack') {
    const { cardInstanceId, remainingAttacks } = combat.attackSource;
    const defIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
    const cardDefId = resolveInstanceId(stateAfterCombat, cardInstanceId);
    const cardLabel = cardDefId ? cardName(stateAfterCombat, cardDefId, '?') : '?';

    if (remainingAttacks && remainingAttacks.length > 0) {
      // More attacks remain — trigger the next one immediately
      const next = remainingAttacks[0];
      const rest = remainingAttacks.slice(1);
      const defPlayer = stateAfterCombat.players[defIdx];
      const atkPlayer = stateAfterCombat.players[1 - defIdx];
      const inPlayNames = buildInPlayNames(stateAfterCombat);
      const creatureRace = normalizeCreatureRace(next.creatureType);
      const effectiveProwess = resolveAttackProwess(
        stateAfterCombat, next.prowess, inPlayNames, creatureRace, true, undefined,
        { companyId: combat.companyId },
      );
      const effectiveStrikes = resolveAttackStrikes(
        stateAfterCombat, next.strikes, inPlayNames, creatureRace, true, { companyId: combat.companyId },
      );
      logDetail(
        `Card-auto-attack: "${cardLabel}" triggering next attack — ${next.creatureType} ` +
        `(${effectiveStrikes} strikes, ${effectiveProwess} prowess)` +
        (rest.length > 0 ? `; ${rest.length} more after this` : ''),
      );
      const nextCombat: CombatState = {
        attackSource: {
          type: 'card-triggered-attack',
          cardInstanceId,
          ...(rest.length > 0 ? { remainingAttacks: rest } : {}),
        },
        companyId: combat.companyId,
        defendingPlayerId: defPlayer.id,
        attackingPlayerId: atkPlayer.id,
        strikesTotal: effectiveStrikes,
        strikeProwess: effectiveProwess,
        creatureBody: null,
        creatureRace,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      };
      stateAfterCombat = { ...stateAfterCombat, combat: nextCombat };
    } else {
      // Final (or only) attack — check for untapped characters
      const defPlayer = stateAfterCombat.players[defIdx];
      const company = companyById(defPlayer.companies, combat.companyId);
      const anyUntapped = company
        ? company.characters.some(charId => {
            const ch = defPlayer.characters[charId as string];
            return ch && ch.status === CardStatus.Untapped;
          })
        : false;

      if (!anyUntapped) {
        // No untapped characters — discard the card from cardsInPlay
        logDetail(
          `Card-auto-attack: no untapped characters after combat — discarding "${cardLabel}" from cardsInPlay`,
        );
        stateAfterCombat = discardCardTriggeredCard(stateAfterCombat, cardInstanceId, defIdx);
      } else {
        // Untapped characters remain — queue bearer selection for the resource player
        // Read card definition to determine post-attack mode and faction-discard flag
        const cardDef = cardDefId ? defById(stateAfterCombat, cardDefId) : undefined;
        const triggerEffect = cardDef
          ? (getCardEffects(cardDef).find(
              (e): e is TriggerAttackOnPlayEffect => e.type === 'trigger-attack-on-play',
            ) ?? null)
          : null;
        const afterAttack = triggerEffect?.afterAttack ?? 'attach-with-constraint';
        const discardFactionsAtSite = triggerEffect?.discardFactionsAtSite ?? false;
        logDetail(
          `Card-auto-attack: untapped characters remain — queuing select-card-bearer for "${cardLabel}" ` +
          `(company ${combat.companyId as string}, mode: ${afterAttack})`,
        );
        stateAfterCombat = enqueueResolution(stateAfterCombat, {
          source: cardInstanceId,
          actor: combat.defendingPlayerId,
          scope: { kind: 'phase', phase: stateAfterCombat.phaseState.phase },
          kind: {
            type: 'select-card-bearer',
            cardInstanceId,
            companyId: combat.companyId,
            ...(afterAttack !== 'attach-with-constraint' ? { mode: afterAttack } : {}),
            ...(discardFactionsAtSite ? { discardFactionsAtSite: true } : {}),
          },
        });
      }
    }
  }

  // lucky-search-attack finalization (Lucky Search tw-269):
  // After combat, move the found item to the scout or discard it if the scout
  // was wounded. Reshuffle all non-item revealed cards back into the play deck.
  if (combat.attackSource.type === 'lucky-search-attack') {
    const { scoutInstanceId, foundItemInstanceId, revealedCardInstanceIds } = combat.attackSource;
    const defIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);

    const scoutWounded = combat.strikeAssignments.some(
      a => a.characterId === scoutInstanceId && a.result === 'wounded',
    );

    // Partition the deck: revealed cards vs remainder
    const revealedSet = new Set(revealedCardInstanceIds.map(id => id as string));
    const allRevealedCards = stateAfterCombat.players[defIdx].playDeck.filter(
      c => revealedSet.has(c.instanceId as string),
    );
    const remainingDeck = stateAfterCombat.players[defIdx].playDeck.filter(
      c => !revealedSet.has(c.instanceId as string),
    );

    const foundCard = foundItemInstanceId
      ? findById(allRevealedCards, foundItemInstanceId)
      : null;
    const nonItemRevealed = foundCard
      ? allRevealedCards.filter(c => c.instanceId !== foundItemInstanceId)
      : allRevealedCards;

    if (foundCard && !scoutWounded) {
      // Scout takes control: attach item to scout
      logDetail(`Lucky Search: scout not wounded — ${String(foundCard.definitionId)} attached to scout ${String(scoutInstanceId)}`);
      stateAfterCombat = updatePlayer(stateAfterCombat, defIdx, p =>
        updateCharacter(p, scoutInstanceId as string, ch => ({
          ...ch,
          items: [...ch.items, { instanceId: foundCard.instanceId, definitionId: foundCard.definitionId, status: CardStatus.Untapped }],
        })),
      );
    } else if (foundCard && scoutWounded) {
      logDetail(`Lucky Search: scout wounded — discarding found item ${String(foundCard.definitionId)}`);
      stateAfterCombat = updatePlayer(stateAfterCombat, defIdx, p => ({
        ...p,
        discardPile: [...p.discardPile, toCardInstance(foundCard)],
      }));
    } else {
      logDetail(`Lucky Search: no item found in deck`);
    }

    // Reshuffle non-item revealed cards back into the remaining deck
    const [reshuffled, newRng] = shuffle([...nonItemRevealed, ...remainingDeck], stateAfterCombat.rng);
    logDetail(`Lucky Search: reshuffling ${nonItemRevealed.length} revealed card(s) back into deck (${remainingDeck.length} remaining)`);
    stateAfterCombat = { ...updatePlayer(stateAfterCombat, defIdx, p => ({ ...p, playDeck: reshuffled })), rng: newRng };
  }

  // Clear attack-scoped constraints (e.g. company-combat-boost stat modifiers
  // from short events like "The Dwarves Are upon You!").
  stateAfterCombat = sweepExpired(stateAfterCombat, { kind: 'attack-end' });

  // Tidings of Bold Spies (le-143): if the company being attacked has a
  // tidings-attacks-queue constraint with remaining attacks, initiate the next
  // combat immediately. Each queued attack mirrors the site's auto-attack stats
  // but is NOT itself an automatic-attack.
  const tidingsConstraint = stateAfterCombat.activeConstraints.find(
    c => c.target.kind === 'company'
      && c.target.companyId === combat.companyId
      && c.kind.type === 'tidings-attacks-queue',
  );
  if (tidingsConstraint && tidingsConstraint.kind.type === 'tidings-attacks-queue') {
    const { attacks, attackIndex } = tidingsConstraint.kind;
    if (attackIndex < attacks.length) {
      const aa = attacks[attackIndex];
      const race = normalizeCreatureRace(aa.creatureType);
      const inPlayNames2 = buildInPlayNames(stateAfterCombat);
      const activeIdx2 = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
      const siteDef2 = (() => {
        const company2 = activeIdx2 >= 0 ? companyById(stateAfterCombat.players[activeIdx2].companies, combat.companyId) : undefined;
        const destInst2 = company2?.destinationSite ?? company2?.currentSite ?? null;
        const destDefId2 = destInst2 ? resolveInstanceId(stateAfterCombat, destInst2.instanceId) : null;
        const def2 = destDefId2 ? defById(stateAfterCombat, destDefId2) : undefined;
        return def2 && isSiteCard(def2) ? def2 : undefined;
      })();
      const tidingsBoostCtx = { companyId: combat.companyId };
      const prowess2 = resolveAttackProwess(stateAfterCombat, aa.prowess, inPlayNames2, race, true, undefined, tidingsBoostCtx);
      const strikes2 = resolveAttackStrikes(stateAfterCombat, aa.strikes, inPlayNames2, race, true, tidingsBoostCtx);
      const body2 = resolveAttackBody(stateAfterCombat, aa.body ?? null, inPlayNames2, race, tidingsBoostCtx);
      const aaAttackerChooses2 = aa.combatRules?.includes('attacker-chooses-defenders') ?? false;
      logDetail(`Tidings of Bold Spies: initiating attack ${attackIndex + 1}/${attacks.length}: ${aa.creatureType} (${strikes2} strikes, ${prowess2} prowess)`);
      const nextCombat: CombatState = {
        attackSource: { type: 'tidings-attack', eventInstanceId: tidingsConstraint.source, attackIndex },
        companyId: combat.companyId,
        defendingPlayerId: combat.defendingPlayerId,
        attackingPlayerId: combat.attackingPlayerId,
        strikesTotal: strikes2,
        strikeProwess: prowess2,
        creatureBody: body2,
        creatureRace: race,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: aaAttackerChooses2 ? 'cancel-window' : 'defender',
        bodyCheckTarget: null,
        detainment: isDetainmentAttack({
          attackEffects: siteDef2?.effects,
          attackRace: race as import('../index.js').Race | null,
          defendingAlignment: activeIdx2 >= 0 ? stateAfterCombat.players[activeIdx2].alignment : Alignment.Wizard,
          defendingSiteEffects: siteDef2?.effects,
        }),
        ...(aaAttackerChooses2 ? { attackerChoosesDefenders: true } : {}),
      };
      // Update the queue constraint to point to the next attack.
      stateAfterCombat = removeConstraint(stateAfterCombat, tidingsConstraint.id);
      if (attackIndex + 1 < attacks.length) {
        stateAfterCombat = addConstraint(stateAfterCombat, {
          source: tidingsConstraint.source,
          sourceDefinitionId: tidingsConstraint.sourceDefinitionId,
          scope: { kind: 'company-mh-phase', companyId: combat.companyId },
          target: { kind: 'company', companyId: combat.companyId },
          kind: {
            type: 'tidings-attacks-queue',
            attacks,
            attackIndex: attackIndex + 1,
          },
        });
      }
      return { state: { ...stateAfterCombat, combat: nextCombat }, effects };
    }
    // Queue exhausted — remove the constraint.
    stateAfterCombat = removeConstraint(stateAfterCombat, tidingsConstraint.id);
  }

  // MELE §8.37: Trophy offer — after a non-detainment non-played-auto-attack
  // creature defeat, eligible Orc/Troll characters may take the creature as
  // a trophy. We transition to the `trophy-offer` phase rather than finalizing
  // immediately so the defending player can choose.
  if (allDefeated && !combat.detainment && !isPlayedAutoAttack && creatureInstanceId) {
    const defIdx3 = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
    const defPlayer3 = stateAfterCombat.players[defIdx3];
    // Find Orc/Troll (not half-orc) characters that faced at least one strike
    const facedStrikeCharIds = new Set<string>(
      combat.strikeAssignments.map(a => a.characterId as string),
    );
    const trophyEligible: import('../types/common.js').CardInstanceId[] = [];
    for (const charId of facedStrikeCharIds) {
      const char = defPlayer3.characters[charId];
      if (!char) continue;
      const def = defById(stateAfterCombat, char.definitionId);
      if (!def || !isCharacterCard(def)) continue;
      // Half-orcs count as Orcs for most purposes but may NOT take trophies
      // (CoE 3.IV.1.1; glossary "Half-orc").
      if ((def.race === Race.Orc || def.race === Race.Troll) && !isHalfOrc(def)) {
        trophyEligible.push(charId as import('../types/common.js').CardInstanceId);
      }
    }
    if (trophyEligible.length > 0) {
      logDetail(`Trophy offer: ${trophyEligible.length} eligible Orc/Troll character(s) may take creature ${creatureInstanceId as string} as a trophy (MELE §8.37)`);
      // Creature is in kill pile; rule 8.22 is applied after the trophy decision
      // (in finalizeCombatFromTrophyOffer or take-trophy handler).
      const trophyOfferCombat: CombatState = {
        ...combat,
        phase: 'trophy-offer',
        trophyEligibleCharacters: trophyEligible,
      };
      return { state: { ...stateAfterCombat, combat: trophyOfferCombat }, effects };
    }
  }

  // No trophy offer — apply rule 8.22 alignment-based routing now.
  let stateWithRule8_22 = applyRule8_22AfterTrophyDecision(stateAfterCombat, combat);

  // Sweep leader-leaves-company events for any eliminated leaders
  const anyLeaderEliminated = combat.strikeAssignments.some(a => {
    if (a.result !== 'eliminated') return false;
    const defId = resolveInstanceId(stateWithRule8_22, a.characterId);
    const def = defId ? defById(stateWithRule8_22, defId) : undefined;
    return !!(def && isCharacterCard(def) && (def.keywords ?? []).includes('Leader'));
  });
  if (anyLeaderEliminated) {
    logDetail(`finalizeCombat: an eliminated character is a Leader — sweeping leader-leaves-company events on company ${combat.companyId as string}`);
    stateWithRule8_22 = sweepLeaderLeavesCompanyEvents(stateWithRule8_22, [combat.companyId]);
  }

  return {
    state: stateWithRule8_22,
    effects,
  };
}

/**
 * Apply each {@link PostAttackEffect} in order at combat finalization.
 *
 * For each targeted character, optionally tap them if they are still
 * untapped, then enqueue a corruption check if configured. Enqueued via
 * the unified pending-resolution system scoped to the company's current
 * sub-phase (M/H or Site) so it auto-clears when the sub-phase ends.
 *
 * Reusable by any card that schedules post-attack side-effects via
 * `on-event: creature-attack-begins` + `apply.postAttack`.
 */
function applyPostAttackEffects(
  stateAfterCombat: GameState,
  stateBeforeFinalize: GameState,
  combat: CombatState,
): GameState {
  const effects = combat.postAttackEffects ?? [];
  if (effects.length === 0) return stateAfterCombat;

  let s = stateAfterCombat;
  const defIdx = s.players.findIndex(p => p.id === combat.defendingPlayerId);
  if (defIdx < 0) return s;

  const phaseStateActive = stateBeforeFinalize.phaseState as { activeCompanyIndex?: number };
  const activeCompanyIndex = phaseStateActive.activeCompanyIndex ?? -1;
  // The scope-anchor company is the post-combat active company — i.e. the
  // company the M/H or Site sub-phase is currently servicing. Haven-jumped
  // characters are still attached there at this point (restore runs after).
  const scopeCompany = activeCompanyIndex >= 0
    ? s.players[defIdx].companies[activeCompanyIndex]
    : undefined;
  const scopeCompanyId = scopeCompany?.id;

  for (const effect of effects) {
    // Tap if untapped
    if (effect.tapIfUntapped) {
      const char = s.players[defIdx].characters[effect.targetCharacterId as string];
      if (char && char.status === CardStatus.Untapped) {
        const newPlayers: [PlayerState, PlayerState] = [s.players[0], s.players[1]];
        newPlayers[defIdx] = {
          ...s.players[defIdx],
          characters: {
            ...s.players[defIdx].characters,
            [effect.targetCharacterId as string]: { ...char, status: CardStatus.Tapped },
          },
        };
        s = { ...s, players: newPlayers };
        logDetail(`Post-attack: tapped ${effect.targetCharacterId as string}`);
      }
    }
    // Corruption check
    if (effect.corruptionCheck && scopeCompanyId) {
      const modifier = effect.corruptionCheck.modifier ?? 0;
      const scope = companySubphaseScope(stateBeforeFinalize.phaseState.phase, scopeCompanyId);
      s = enqueueCorruptionCheck(s, {
        source: null,
        actor: combat.defendingPlayerId,
        scope,
        characterId: effect.targetCharacterId,
        modifier,
        reason: 'post-attack corruption check',
      });
      logDetail(`Post-attack: corruption check queued on ${effect.targetCharacterId as string} (mod ${modifier})`);
    }
  }

  return s;
}

/**
 * After combat, return any haven-jumped characters to their original
 * company. The character's CharacterInPlay stays unchanged; only the
 * companies' `characters` membership lists are rewritten.
 */
function restoreHavenJumpOrigins(
  stateAfterCombat: GameState,
  combat: CombatState,
): GameState {
  const origins = combat.havenJumpOrigins ?? [];
  if (origins.length === 0) return stateAfterCombat;

  const defIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
  if (defIdx < 0) return stateAfterCombat;

  const player = stateAfterCombat.players[defIdx];
  const newCompanies = player.companies.map(c => {
    let chars = c.characters;
    for (const o of origins) {
      if (chars.includes(o.characterId) && c.id !== o.originCompanyId) {
        chars = chars.filter(id => id !== o.characterId);
      }
      if (c.id === o.originCompanyId && !chars.includes(o.characterId)) {
        chars = [...chars, o.characterId];
      }
    }
    return chars === c.characters ? c : { ...c, characters: chars };
  });

  const newPlayers: [PlayerState, PlayerState] = [stateAfterCombat.players[0], stateAfterCombat.players[1]];
  newPlayers[defIdx] = { ...player, companies: newCompanies };
  for (const o of origins) {
    logDetail(`Haven-jump finalize: ${o.characterId as string} returned to company ${o.originCompanyId as string}`);
  }
  return { ...stateAfterCombat, players: newPlayers };
}

/**
 * Build an on-event condition context from the current game state.
 * Includes `company.hazardsEncountered` for troll-trio condition checks.
 */
function buildOnEventContext(state: GameState): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  if (state.phaseState.phase === Phase.MovementHazard) {
    ctx.company = { hazardsEncountered: state.phaseState.hazardsEncountered };
  }
  return ctx;
}

/**
 * Discard items on wounded characters matching the move filter to the
 * defending player's discard pile. Implements the combat-specific
 * `move { select: 'filter-all', from: 'items-on-wounded', to: 'discard',
 * toOwner: 'defender', filter }` shape used by creatures like Balrog
 * of Moria to strip non-special items from their victims.
 */
function discardWoundedItems(
  state: GameState,
  combat: CombatState,
  woundedCharIds: readonly CardInstanceId[],
  sourceName: string,
  filter: import('../types/effects.js').Condition | undefined,
): GameState {
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const cloned = clonePlayers(state);
  const newCharacters = { ...cloned[defIdx].characters };
  const discarded: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] = [];

  for (const charId of woundedCharIds) {
    const charData = newCharacters[charId as string];
    if (!charData) continue;

    const matching = charData.items.filter(item => {
      const def = defById(state, item.definitionId);
      if (!def) return false;
      if (!filter) return true;
      return matchesDefinition(def, filter);
    });

    if (matching.length === 0) continue;

    const remaining = charData.items.filter(item => !matching.some(m => m.instanceId === item.instanceId));
    newCharacters[charId as string] = { ...charData, items: remaining };

    for (const item of matching) {
      discarded.push(toCardInstance(item));
      logDetail(`${sourceName}: discarding item ${item.definitionId as string} from wounded character ${charId as string}`);
    }
  }

  cloned[defIdx] = {
    ...cloned[defIdx],
    characters: newCharacters,
    discardPile: [
      ...cloned[defIdx].discardPile,
      ...discarded,
    ],
  };

  return { ...state, players: cloned };
}

/**
 * Discard wounded characters to the defending player's discard pile when the
 * per-character condition (evaluated against `{ target: { race } }`) is met.
 * Implements the `discard-character` apply type for `character-wounded-by-self`.
 * Used by Abductor (tw-1): discards every non-Wizard/non-Ringwraith character it wounds.
 */
function discardWoundedCharacters(
  state: GameState,
  combat: CombatState,
  woundedCharIds: readonly CardInstanceId[],
  sourceName: string,
  when: import('../types/effects.js').Condition | undefined,
): GameState {
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  let stateOut = state;

  for (const charId of woundedCharIds) {
    const player = stateOut.players[defIdx];
    const charData = player?.characters[charId as string];
    if (!charData) continue;

    const charDefId = resolveInstanceId(stateOut, charId);
    const charDef = charDefId ? defById(stateOut, charDefId) : undefined;
    const charRace = charDef && isCharacterCard(charDef) ? charDef.race : undefined;
    const perCharContext: Record<string, unknown> = { target: { race: charRace } };

    if (when && !matchesCondition(when, perCharContext)) {
      logDetail(`${sourceName}: discard-character excluded for ${charId as string} (race ${String(charRace)})`);
      continue;
    }

    logDetail(`${sourceName}: discarding wounded character ${charId as string} to discard pile`);
    const cloned = clonePlayers(stateOut);
    const newPlayerData = { ...cloned[defIdx] };

    newPlayerData.companies = newPlayerData.companies.map(c => ({
      ...c,
      characters: c.characters.filter(ch => ch !== charId),
    }));
    newPlayerData.discardPile = [
      ...newPlayerData.discardPile,
      { instanceId: charId, definitionId: charDefId! },
    ];
    for (const ally of charData.allies) {
      logDetail(`${sourceName}: discarding ally ${ally.instanceId as string} from discarded character`);
      newPlayerData.discardPile = [...newPlayerData.discardPile, toCardInstance(ally)];
    }
    for (const item of charData.items) {
      logDetail(`${sourceName}: discarding item ${item.instanceId as string} from discarded character`);
      newPlayerData.discardPile = [...newPlayerData.discardPile, toCardInstance(item)];
    }
    for (const hazard of charData.hazards) {
      logDetail(`${sourceName}: discarding hazard ${hazard.instanceId as string} from discarded character`);
      cloned[1 - defIdx] = { ...cloned[1 - defIdx], discardPile: [...cloned[1 - defIdx].discardPile, toCardInstance(hazard)] };
    }
    const { [charId as string]: _removed, ...remainingChars } = newPlayerData.characters;
    // Revert followers to general influence
    const updatedChars = { ...remainingChars };
    for (const followerId of charData.followers) {
      const follower = updatedChars[followerId as string];
      if (follower) updatedChars[followerId as string] = { ...follower, controlledBy: 'general' };
    }
    newPlayerData.characters = updatedChars;

    cloned[defIdx] = newPlayerData;
    stateOut = { ...stateOut, players: cloned };
  }

  return stateOut;
}

/**
 * After combat finalization, record the creature name in the M/H phase
 * state's `hazardsEncountered` list for troll-trio condition checks.
 */
function recordHazardEncountered(
  stateAfterCombat: GameState,
  originalState: GameState,
  combat: CombatState,
): GameState {
  if (originalState.phaseState.phase !== Phase.MovementHazard) return stateAfterCombat;
  if (combat.attackSource.type !== 'creature') return stateAfterCombat;

  const creatureDefId = resolveInstanceId(originalState, combat.attackSource.instanceId);
  if (!creatureDefId) return stateAfterCombat;

  const creatureDef = originalState.cardPool[creatureDefId as string] as { name?: string } | undefined;
  const creatureName = creatureDef?.name;
  if (!creatureName) return stateAfterCombat;

  const mhState = stateAfterCombat.phaseState as MovementHazardPhaseState;
  logDetail(`Recording hazard "${creatureName}" in hazardsEncountered`);
  return {
    ...stateAfterCombat,
    phaseState: {
      ...mhState,
      hazardsEncountered: [...mhState.hazardsEncountered, creatureName],
    },
  };
}

/**
 * Look up the card definition for the attack source in combat.
 * For automatic attacks, returns the site card. For creature attacks,
 * returns the creature card definition.
 */
function getAttackSourceCard(
  state: GameState,
  combat: CombatState,
): { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined {
  if (combat.attackSource.type === 'automatic-attack') {
    const siteInstanceId = combat.attackSource.siteInstanceId;
    const siteDefId = resolveInstanceId(state, siteInstanceId);
    if (!siteDefId) return undefined;
    const siteDef = defById(state, siteDefId);
    return siteDef && isSiteCard(siteDef) ? siteDef : undefined;
  }
  if (combat.attackSource.type === 'creature' || combat.attackSource.type === 'played-auto-attack') {
    const creatureDefId = resolveInstanceId(state, combat.attackSource.instanceId);
    if (!creatureDefId) return undefined;
    return state.cardPool[creatureDefId as string] as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
  }
  return undefined;
}

/**
 * Play a hazard permanent-event from the attacker's hand during a
 * combat window (currently `resolve-strike`). Attaches the card to the
 * defender identified by `targetCharacterId` and applies any
 * `self-enters-play-combat` on-event effects it declares — notably
 * `modify-current-strike-prowess`, which adjusts the current strike's
 * prowess (Dragon's Curse: -1).
 *
 * The card's `play-window`, `play-condition` (combat-creature-race),
 * and `play-target.filter` are evaluated by the legal-action emitter
 * in `legal-actions/combat.ts`; the reducer trusts the action to be
 * legal and focuses on state transitions.
 */
function handleCombatPlayHazard(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'play-hazard') return wrongActionType(state, action, 'play-hazard');
  if (combat.phase !== 'resolve-strike') {
    return { state, error: `play-hazard during combat is only valid in resolve-strike (current: ${combat.phase})` };
  }
  if (action.player !== combat.attackingPlayerId) {
    return { state, error: 'only the attacking player may play hazards during combat' };
  }

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const handCard = findById(hazardPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'card not in hand' };
  const def = defById(state, handCard.definitionId);
  if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'permanent') {
    return { state, error: 'only hazard permanent-events may be played during combat' };
  }

  const defenderIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defenderPlayer = state.players[defenderIndex];
  const targetCharId = action.targetCharacterId;
  if (!targetCharId) return { state, error: 'targetCharacterId required for combat hazard play' };
  const targetChar = defenderPlayer.characters[targetCharId as string];
  if (!targetChar) return { state, error: 'target character not in defending player' };

  // Remove card from hand
  const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
  let newState: GameState = updatePlayer(state, hazardIndex, p => ({ ...p, hand: newHand }));

  // Ward check: a matching ward on the target discards the curse to
  // the hazard player's discard pile instead of attaching it.
  if (isWardedAgainst(newState, defenderIndex, targetCharId, def)) {
    logDetail(`Combat play-hazard: "${def.name}" cancelled by ward on target — routing to attacker's discard`);
    newState = updatePlayer(newState, hazardIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, toCardInstance(handCard)],
    }));
    return { state: newState };
  }

  // Attach to target's hazards
  logDetail(`Combat play-hazard: attaching "${def.name}" to ${targetCharId as string}`);
  newState = updatePlayer(newState, defenderIndex, p => updateCharacter(p, targetCharId as string, c => ({
    ...c,
    hazards: [...c.hazards, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }],
  })));

  // Apply self-enters-play-combat on-event effects declared by the card.
  // Currently supports `modify-current-strike-prowess` which adjusts
  // the current strike's prowess via combat.strikeAssignments[i].strikeProwessBonus.
  // The bonus is added to the defender's effective prowess (a -1 to
  // the attacker's strike prowess is equivalent to +1 to the defender),
  // so the data carries a negative `value` and the reducer flips sign.
  {
    for (const eff of getOnEventEffects(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'self-enters-play-combat')) {
      if (eff.apply.type === 'modify-current-strike-prowess') {
        const strikeDelta = eff.apply.value ?? 0;
        const defenderProwessDelta = -strikeDelta;
        logDetail(`Combat play-hazard: "${def.name}" modifies current strike's prowess by ${strikeDelta} (defender +${defenderProwessDelta})`);
        const newAssignments = combat.strikeAssignments.map((a, i) =>
          i === combat.currentStrikeIndex
            ? { ...a, strikeProwessBonus: (a.strikeProwessBonus ?? 0) + defenderProwessDelta }
            : a,
        );
        newState = { ...newState, combat: { ...combat, strikeAssignments: newAssignments } };
      }
    }
  }

  return { state: newState };
}

// ---- Prisoner-taking helpers (Rule 8.35) ----

/**
 * Search `hazards` for a hazard card that carries a `take-prisoner` effect.
 * Returns the host card instance and the effect, or null if not found.
 */
function findTakePrisonerHazard(
  state: GameState,
  _defPlayerIndex: number,
  hazards: readonly import('../types/state-cards.js').CardInPlay[],
): { hostCard: import('../types/state-cards.js').CardInstance; effect: TakePrisonerEffect } | null {
  for (const h of hazards) {
    const def = defById(state, h.definitionId);
    const eff = getCardEffects(def).find(
      (e): e is TakePrisonerEffect => e.type === 'take-prisoner',
    );
    if (eff) return { hostCard: toCardInstance(h), effect: eff };
  }
  return null;
}

/**
 * Apply the prisoner-taking outcome for a character (CoE rule 8.35):
 *
 * 1. Draw the rescue site card from the hazard player's location deck
 *    (first matching site type found).
 * 2. Discard all non-ring items from the prisoner immediately.
 * 3. Revert followers to general influence (mind subtraction deferred
 *    to the next org phase — tracked by the constraint).
 * 4. Add `character-is-prisoner` active constraint on the character.
 * 5. Add the HazardHost record to `state.hazardHosts`.
 * 6. Remove the host card from the character's `hazards` list
 *    (it now lives in the HazardHost record).
 */
function applyTakePrisoner(
  state: GameState,
  defPlayerIndex: number,
  charInstanceId: CardInstanceId,
  takePrisonerResult: { hostCard: import('../types/state-cards.js').CardInstance; effect: TakePrisonerEffect },
): GameState {
  const { hostCard, effect } = takePrisonerResult;
  const hazardPlayerIndex = 1 - defPlayerIndex;
  const hazardPlayer = state.players[hazardPlayerIndex];

  // Find the rescue site card in the hazard player's location deck.
  const rescueSiteIdx = hazardPlayer.siteDeck.findIndex(site => {
    const siteDef = defById(state, site.definitionId);
    if (!siteDef || !('siteType' in siteDef)) return false;
    return effect.rescueSiteTypes.includes((siteDef as { siteType: string }).siteType);
  });
  if (rescueSiteIdx === -1) {
    // No rescue site available — this shouldn't happen if legal-action checks passed,
    // but handle gracefully by skipping prisoner-taking.
    logDetail(`take-prisoner: no rescue site found in hazard player's location deck — skipping`);
    return state;
  }

  const rescueSiteCard = hazardPlayer.siteDeck[rescueSiteIdx];
  logDetail(`take-prisoner: rescue site is ${rescueSiteCard.definitionId as string} (drawn from hazard player's location deck)`);

  // Remove rescue site from hazard player's location deck.
  const newHazardSiteDeck = [
    ...hazardPlayer.siteDeck.slice(0, rescueSiteIdx),
    ...hazardPlayer.siteDeck.slice(rescueSiteIdx + 1),
  ];

  const defPlayer = state.players[defPlayerIndex];
  const charData = defPlayer.characters[charInstanceId as string];
  if (!charData) return state;

  // Discard all non-ring items from the prisoner (rule 8.35).
  const retainedItems = charData.items.filter(item => {
    const itemDef = defById(state, item.definitionId);
    return itemDef && 'cardType' in itemDef
      && typeof (itemDef as { cardType: string }).cardType === 'string'
      && (itemDef as { cardType: string }).cardType.includes('ring-item');
  });
  const discardedItems = charData.items.filter(item => !retainedItems.includes(item));
  if (discardedItems.length > 0) {
    logDetail(`take-prisoner: discarding ${discardedItems.length} non-ring item(s) from prisoner ${charInstanceId as string}`);
  }

  // Remove host card from the character's hazards list (it moves to HazardHost record).
  const updatedHazards = charData.hazards.filter(h => h.instanceId !== hostCard.instanceId);

  // Revert followers to general influence (rule 8.35).
  // Followers are referenced by CardInstanceId in charData.followers; their
  // controlledBy is updated on their own CharacterInPlay entries.
  const followerIds = charData.followers;

  // Update the prisoner character.
  const newCharData = {
    ...charData,
    items: retainedItems,
    hazards: updatedHazards,
    controlledBy: 'general' as const,
  };

  let newState = updatePlayer(state, defPlayerIndex, p => {
    // Revert each follower to general influence.
    const updatedChars = { ...p.characters, [charInstanceId as string]: newCharData };
    for (const followerId of followerIds) {
      const follower = updatedChars[followerId as string];
      if (follower && follower.controlledBy === charInstanceId) {
        updatedChars[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }
    return {
      ...p,
      characters: updatedChars,
      discardPile: [...p.discardPile, ...discardedItems.map(i => (toCardInstance(i)))],
    };
  });
  newState = updatePlayer(newState, hazardPlayerIndex, p => ({
    ...p,
    siteDeck: newHazardSiteDeck,
  }));

  // Add character-is-prisoner active constraint.
  newState = addConstraint(newState, {
    source: hostCard.instanceId,
    sourceDefinitionId: hostCard.definitionId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'character', characterId: charInstanceId },
    kind: { type: 'character-is-prisoner', hostInstanceId: hostCard.instanceId },
  });

  // Create HazardHost record.
  const newHost: HazardHost = {
    hostCard,
    rescueSiteCard: toCardInstance(rescueSiteCard),
    prisoners: [charInstanceId],
    ownedBy: hazardPlayer.id,
  };
  newState = { ...newState, hazardHosts: [...newState.hazardHosts, newHost] };

  logDetail(`take-prisoner: ${charInstanceId as string} is now a prisoner of ${hostCard.instanceId as string} at rescue site ${rescueSiteCard.definitionId as string}`);
  return newState;
}

/**
 * Apply the prisoner-taking outcome for a Troll-purse (dm-95) re-faced strike.
 *
 * Unlike {@link applyTakePrisoner}, the rescue site is the bound site itself
 * (the prisoner is "taken prisoner at the site") rather than a site drawn from
 * the hazard player's location deck, and the host card (Troll-purse) stays in
 * play attached to the site — it is a persistent trap that may take further
 * prisoners. As with the general prisoner rule (CoE 8.35) the prisoner's
 * non-ring items are discarded, followers revert to general influence, a
 * `character-is-prisoner` constraint is added, and a HazardHost record is
 * created so the prisoner is tracked (the rescue-attack equals the site's
 * automatic-attacks at the time of rescue).
 */
function applyTakePrisonerAtSite(
  state: GameState,
  defPlayerIndex: number,
  charInstanceId: CardInstanceId,
  hostInstanceId: CardInstanceId,
  siteInstanceId: CardInstanceId,
): GameState {
  const hazardPlayerIndex = 1 - defPlayerIndex;
  const hazardPlayerState = state.players[hazardPlayerIndex];
  const defPlayer = state.players[defPlayerIndex];
  const charData = defPlayer.characters[charInstanceId as string];
  if (!charData) return state;

  // The host (Troll-purse) stays in the hazard player's cardsInPlay.
  const hostInPlay = hazardPlayerState.cardsInPlay.find(c => c.instanceId === hostInstanceId);
  if (!hostInPlay) {
    logDetail(`take-prisoner (Troll-purse): host ${hostInstanceId as string} not found in play — skipping`);
    return state;
  }
  const hostCard = toCardInstance(hostInPlay);

  // The rescue site is the bound site itself.
  const siteDefId = resolveInstanceId(state, siteInstanceId);
  if (!siteDefId) {
    logDetail(`take-prisoner (Troll-purse): site ${siteInstanceId as string} not resolvable — skipping`);
    return state;
  }
  const rescueSiteCard = { instanceId: siteInstanceId, definitionId: siteDefId };

  // Discard all non-ring items from the prisoner (rule 8.35).
  const retainedItems = charData.items.filter(item => {
    const itemDef = defById(state, item.definitionId);
    return itemDef && 'cardType' in itemDef
      && typeof (itemDef as { cardType: string }).cardType === 'string'
      && (itemDef as { cardType: string }).cardType.includes('ring-item');
  });
  const discardedItems = charData.items.filter(item => !retainedItems.includes(item));
  if (discardedItems.length > 0) {
    logDetail(`take-prisoner (Troll-purse): discarding ${discardedItems.length} non-ring item(s) from prisoner ${charInstanceId as string}`);
  }

  const followerIds = charData.followers;
  const newCharData = {
    ...charData,
    items: retainedItems,
    controlledBy: 'general' as const,
  };

  let newState = updatePlayer(state, defPlayerIndex, p => {
    const updatedChars = { ...p.characters, [charInstanceId as string]: newCharData };
    for (const followerId of followerIds) {
      const follower = updatedChars[followerId as string];
      if (follower && follower.controlledBy === charInstanceId) {
        updatedChars[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }
    return {
      ...p,
      characters: updatedChars,
      discardPile: [...p.discardPile, ...discardedItems.map(i => toCardInstance(i))],
    };
  });

  // Add character-is-prisoner active constraint pointing to the Troll-purse.
  newState = addConstraint(newState, {
    source: hostInstanceId,
    sourceDefinitionId: hostInPlay.definitionId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'character', characterId: charInstanceId },
    kind: { type: 'character-is-prisoner', hostInstanceId },
  });

  // Create the HazardHost record (rescue site = the bound site).
  const newHost: HazardHost = {
    hostCard,
    rescueSiteCard,
    prisoners: [charInstanceId],
    ownedBy: hazardPlayerState.id,
  };
  newState = { ...newState, hazardHosts: [...newState.hazardHosts, newHost] };

  logDetail(`take-prisoner (Troll-purse): ${charInstanceId as string} is now a prisoner at site ${siteDefId as string}`);
  return newState;
}
