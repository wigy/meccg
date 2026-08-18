/**
 * @module reducer-combat
 *
 * Combat handlers for the game reducer. Covers strike assignment,
 * strike resolution, support strikes, body checks, and combat finalization.
 */

import type { GameState, CombatState, StrikeAssignment, GameAction, CardInstanceId } from '../index.js';
import { isAvatarCharacter } from '../types/cards.js';
import { CardStatus } from '../types/common.js';
import { getPlayerIndex } from '../state-utils.js';
import { logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer-utils.js';
import { companyById, playerById, toCardInstance, updatePlayer, updateCharacter, wrongActionType, defById, getCardEffects } from './reducer-utils.js';
import { formatSignedNumber } from '../format-helpers.js';
import { handlePlayResourceShortEvent } from './reducer-events.js';
import { handleCombatPlayHazard } from './combat-hazard-play.js';
import { nextStrikePhase, handleResolveStrike, advanceStrikeOrFinalize } from './combat-strike.js';
import { findAllyInCompany, findCompanyAllies, isAllyImmuneToSiteKeyedAttack } from './legal-actions/combat.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { handleCancelAttack, handleCancelByTap, handleCancelWeaponEffects } from './combat-cancel.js';
import { handleHavenJoinAttack, handleAgentStrikeRoll, handleSupportStrike, handleCancelStrike, handleDodgeStrike, handleFleeFromStrike, handleSacrificeOfForm, handlePlayStrikeEvent, handleBodyCheckRoll, handleShieldDiscardRoll, handleConvertCreatureToAlly, handleHalveStrikes, handleProtectFromStrikeAssignment, handleTapItemForStrike, handleFaceStrikeOnTap, handleTapAllyCombatBoost, handleTapAllyBodyCheckBoost, handleModifyAttack, handleSalvageItem, finishSalvage, handleDiscardItemFromCompany, handleTakeTrophy, finalizeCombatFromTrophyOffer } from './combat-actions.js';
import { finalizeCombat } from './combat-finalize.js';
import { handleGrantActionApply } from './grant-action-apply.js';

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
  'cancel-weapon-effects': handleCancelWeaponEffects,
  'convert-creature-to-ally': handleConvertCreatureToAlly,
  'cancel-by-tap': handleCancelByTap,
  'play-strike-event': handlePlayStrikeEvent,
  'cancel-strike': handleCancelStrike,
  'dodge-strike': handleDodgeStrike,
  'flee-from-strike': handleFleeFromStrike,
  'play-sacrifice-of-form': handleSacrificeOfForm,
  'protect-from-assignment': handleProtectFromStrikeAssignment,
  'halve-strikes': handleHalveStrikes,
  'tap-item-for-strike': handleTapItemForStrike,
  'face-strike-on-tap': handleFaceStrikeOnTap,
  'tap-ally-combat-boost': handleTapAllyCombatBoost,
  'tap-ally-body-check-boost': handleTapAllyBodyCheckBoost,
  'modify-attack': handleModifyAttack,
  'apply-attacker-attack-option': handleApplyAttackerAttackOption,
  'salvage-item': handleSalvageItem,
  'discard-item-from-company': handleDiscardItemFromCompany,
  'play-hazard': handleCombatPlayHazard,
  'haven-join-attack': handleHavenJoinAttack,
  // Rule 3.iv / 3.iv.5: resource short-events may be played between strike
  // sequences or during step 5 if they affect the current strike. The event
  // handler applies its effects without touching the combat state.
  'play-short-event': handlePlayResourceShortEvent,
  'take-trophy': handleTakeTrophy,
  // Rule 2.1.1: any-phase grant-actions (e.g. Cram's discard-to-untap-bearer)
  // remain activatable while combat is active — `handleGrantActionApply` is
  // combat-agnostic and just ignores the unused `combat` parameter.
  'activate-granted-action': (state, action) => handleGrantActionApply(state, action),
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
/**
 * Fifteen Birds in Five Firtrees (dm-129): "An untapped character in the
 * company must tap to face any strike from a subsequent hazard creature
 * attack for the rest of the turn." Called whenever a *new* (not excess)
 * strike is assigned to a defending character. Taps the character in place
 * when a turn-scoped `tap-on-strike-assignment` constraint targets the
 * defending company and the attack is hazard-creature-sourced (a played
 * creature, an on-guard reveal, or a played-auto-attack — never a site
 * automatic attack or CvCC, which never install this constraint's source
 * card in the first place, but the source check keeps this helper honest).
 * A no-op when the character is already tapped or no such constraint applies.
 */
function applyTapOnStrikeAssignment(state: GameState, combat: CombatState, characterId: CardInstanceId): GameState {
  const hazardSourced = combat.attackSource.type === 'creature'
    || combat.attackSource.type === 'on-guard-creature'
    || combat.attackSource.type === 'played-auto-attack';
  if (!hazardSourced) return state;

  const constrained = state.activeConstraints.some(c =>
    c.kind.type === 'tap-on-strike-assignment'
    && c.target.kind === 'company' && c.target.companyId === combat.companyId,
  );
  if (!constrained) return state;

  const playerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const player = state.players[playerIndex];
  const char = player.characters[characterId];
  if (!char || char.status !== CardStatus.Untapped) return state;

  logDetail(`Tap-on-strike-assignment: ${characterId as string} taps to face a strike (Fifteen Birds in Five Firtrees)`);
  return updatePlayer(state, playerIndex, p => updateCharacter(p, characterId, c => ({ ...c, status: CardStatus.Tapped })));
}

function handleAssignStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'assign-strike') return wrongActionType(state, action, 'assign-strike');

  const existingIdx = combat.strikeAssignments.findIndex(a => a.characterId === action.characterId);

  let newAssignments: StrikeAssignment[];

  // Force-single-target (multi-attack): auto-assign all strikes to the chosen character
  if (combat.forceSingleTarget && combat.strikeAssignments.length === 0 && existingIdx < 0) {
    newAssignments = [];
    // Each attack's assignment gets `excessStrikesPerAttack` preset (CRF 22
    // Assassin: a global strikes boost becomes a -1 prowess excess strike on
    // that attack, not a genuine extra strike). One assignment marks an
    // attack boundary every `strikesPerAttack` entries (defaults to 1).
    const literalStrikesPerAttack = combat.strikesPerAttack ?? 1;
    const excessPerAttack = combat.excessStrikesPerAttack ?? 0;
    for (let i = 0; i < combat.strikesTotal; i++) {
      const isAttackBoundary = (i + 1) % literalStrikesPerAttack === 0;
      newAssignments.push({
        characterId: action.characterId,
        excessStrikes: isAttackBoundary ? excessPerAttack : 0,
        resolved: false,
      });
    }
    logDetail(`Multi-attack: all ${combat.strikesTotal} strikes auto-assigned to ${action.characterId as string}`);

    const tappedState = applyTapOnStrikeAssignment(state, combat, action.characterId);
    let newCombatState: CombatState = { ...combat, strikeAssignments: newAssignments };

    // If cancel-by-tap is available, transition to cancel-by-tap sub-phase
    if (combat.cancelByTapRemaining && combat.cancelByTapRemaining > 0) {
      logDetail(`Cancel-by-tap window: defender may cancel up to ${combat.cancelByTapRemaining} attack(s)`);
      newCombatState = { ...newCombatState, assignmentPhase: 'cancel-by-tap' };
      return { state: { ...tappedState, combat: newCombatState } };
    }

    // Otherwise proceed to strike resolution
    const next = nextStrikePhase(newCombatState);
    newCombatState = { ...newCombatState, assignmentPhase: 'done', ...next };
    return { state: { ...tappedState, combat: newCombatState } };
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

  let tappedState = state;
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
    tappedState = applyTapOnStrikeAssignment(state, combat, action.characterId);
  }

  const newTotalAllocated = newAssignments.length
    + newAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  const allAssigned = newTotalAllocated >= combat.strikesTotal;

  let newCombatState: CombatState = { ...combat, strikeAssignments: newAssignments };
  if (allAssigned) {
    const next = nextStrikePhase(newCombatState);
    newCombatState = { ...newCombatState, assignmentPhase: 'done', ...next };
  }

  return { state: { ...tappedState, combat: newCombatState } };
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

/**
 * Apply an in-play `attacker-attack-option` to the current attack (e.g.
 * Ungoliant's Progeny ba-27: a Spider attack gains +1 prowess and becomes
 * detainment). Legal only in the attacking player's `resolve-strike` Step 1
 * window before any strike has resolved, once per attack. Bumps
 * `combat.strikeProwess` and/or sets `combat.detainment`, then flags the combat
 * so the one-shot option cannot be applied again.
 */
function handleApplyAttackerAttackOption(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'apply-attacker-attack-option') return wrongActionType(state, action, 'apply-attacker-attack-option');
  if (combat.phase !== 'resolve-strike') return { state, error: 'Attacker-attack-option only during resolve-strike' };
  if (action.player !== combat.attackingPlayerId) return { state, error: 'Only the attacking player may apply this option' };
  if (combat.attackerAttackOptionApplied) return { state, error: 'Attacker-attack-option already applied this attack' };
  if (combat.strikeAssignments.some(s => s.resolved)) return { state, error: 'Attacker-attack-option must be applied before any strike resolves' };

  const attacker = playerById(state, action.player);
  const card = attacker?.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
  if (!card) return { state, error: 'Source card is not in play' };
  const def = defById(state, card.definitionId);
  const effect = def
    ? getCardEffects(def).find(e => e.type === 'attacker-attack-option' && e.creatureRace === combat.creatureRace)
    : undefined;
  if (!effect || effect.type !== 'attacker-attack-option') {
    return { state, error: 'No matching attacker-attack-option effect for this attack' };
  }

  const prowessBump = effect.prowessModifier ?? 0;
  const newProwess = combat.strikeProwess + prowessBump;
  const newDetainment = combat.detainment || effect.detainment === true;
  logDetail(
    `Attacker applies "${def?.name ?? card.definitionId as string}" to the ${combat.creatureRace ?? '?'} attack: prowess ${combat.strikeProwess}${prowessBump ? ` ${formatSignedNumber(prowessBump)} → ${newProwess}` : ''}${newDetainment && !combat.detainment ? ', now detainment' : ''}`,
  );
  return {
    state: {
      ...state,
      combat: { ...combat, strikeProwess: newProwess, detainment: newDetainment, attackerAttackOptionApplied: true },
    },
  };
}

/**
 * Assign every strike of an "each character in the company faces one strike"
 * attack at once — one strike per character of the defending company — and
 * advance to strike ordering (or straight to resolution when a single strike
 * results).
 *
 * Per CoE 3.ii.2 such an attack's strike count cannot be modified and every
 * character is a target, so neither the defender's (3.ii) nor the attacker's
 * (3.iii) assignment step has any decision left to make. The engine therefore
 * performs the assignment itself once the defending player closes their
 * pre-assignment window (CoE 3.i) with a `pass`, which is also the last moment
 * the attack can be canceled (CRF 22 Annotation 13) — hence
 * `preAssignmentWindowClosed`.
 *
 * Characters shielded by `protect-from-strike-assignment` (Ruse le-225 mode B)
 * and, for `excludeAvatarStrikes` attacks (Neeker-breekers tw-493), avatars are
 * left out; `strikesTotal` is recomputed from the characters that actually face
 * a strike, since the company may have changed since combat began (e.g. an
 * Alatar haven-join). With nobody left to strike the attack has no target and
 * the combat finalizes immediately.
 *
 * Returns `null` when an effect has reduced the attack to fewer strikes than
 * the company has characters (`halve-strikes`): the strikes no longer cover
 * everybody, so choosing who faces them is a real decision and the normal
 * defender/attacker assignment steps apply instead.
 */
function autoAssignEachCharacterStrikes(state: GameState, combat: CombatState): ReducerResult | null {
  const defender = playerById(state, combat.defendingPlayerId);
  const company = defender ? companyById(defender.companies, combat.companyId) : null;
  const protectedIds = new Set(
    (combat.protectedFromStrikeAssignment ?? []).map(id => id as string),
  );
  // Per CoE 2.V.2.2, allies are treated as characters for facing strikes, so
  // they face one too, unless made immune by a play-flag or protected.
  const facingAllies = defender && company
    ? findCompanyAllies(defender, company.characters)
      .filter(({ ally }) => {
        if (protectedIds.has(ally.instanceId as string)) {
          logDetail(`Each character faces one strike: ally ${ally.instanceId as string} is protected from strike assignment — skipping`);
          return false;
        }
        const allyDef = defById(state, ally.definitionId) as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
        if (hasPlayFlag(allyDef, 'no-attack')) {
          logDetail(`Each character faces one strike: ally ${ally.instanceId as string} has no-attack — excluded`);
          return false;
        }
        if (isAllyImmuneToSiteKeyedAttack(state, ally, combat)) return false;
        return true;
      })
      .map(({ ally }) => ally.instanceId)
    : [];

  if (company && combat.strikesTotal < company.characters.length + facingAllies.length) {
    logDetail(`Each character faces one strike: only ${combat.strikesTotal} strike(s) left for ${company.characters.length} character(s) and ${facingAllies.length} ally/allies — falling back to manual assignment`);
    return null;
  }
  const facing = (company?.characters ?? []).filter(charId => {
    if (protectedIds.has(charId as string)) {
      logDetail(`Each character faces one strike: ${charId as string} is protected from strike assignment — skipping`);
      return false;
    }
    if (combat.excludeAvatarStrikes) {
      const charData = defender?.characters[charId];
      const charDef = charData ? defById(state, charData.definitionId) : undefined;
      if (isAvatarCharacter(charDef)) {
        logDetail(`Each character faces one strike: ${charId as string} is an avatar — excluded from strike assignment`);
        return false;
      }
    }
    return true;
  });

  const strikeAssignments: StrikeAssignment[] = [...facing, ...facingAllies].map(characterId => ({
    characterId,
    excessStrikes: 0,
    resolved: false,
  }));
  const assigned: CombatState = {
    ...combat,
    strikesTotal: strikeAssignments.length,
    strikeAssignments,
    assignmentPhase: 'done',
    havenJumpOffers: undefined,
    preAssignmentWindowClosed: true,
  };

  const next = nextStrikePhase(assigned);
  if (!next) {
    logDetail('Each character faces one strike: no character faces a strike — finalizing combat');
    return finalizeCombat({ ...state, combat: assigned });
  }
  logDetail(`Each character faces one strike: automatically assigning ${strikeAssignments.length} strike(s), one per character → phase ${next.phase ?? assigned.phase}`);
  return { state: { ...state, combat: { ...assigned, ...next } } };
}

/** Defender passes during strike assignment — attacker assigns remaining. */


function handleCombatPass(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass');

  // The defending company may have dissolved mid-combat (e.g. its last
  // character was eliminated by a pending resolution before any strike was
  // assigned), or the attack may have had its strike count reduced to zero
  // before assignment began. Either way there is nothing to strike or
  // assign — the attack fizzles.
  if (combat.phase === 'assign-strikes' && combat.strikeAssignments.length === 0) {
    const fizzleDefPlayer = playerById(state, combat.defendingPlayerId);
    const fizzleCompany = fizzleDefPlayer ? companyById(fizzleDefPlayer.companies, combat.companyId) : null;
    if (!fizzleCompany || fizzleCompany.characters.length === 0) {
      logDetail('Combat pass: defending company no longer exists — attack fizzles, finalizing combat');
      return finalizeCombat(state);
    }
    if (combat.strikesTotal <= 0) {
      logDetail('Combat pass: attack has zero strikes — attack fizzles, finalizing combat');
      return finalizeCombat(state);
    }
  }

  // A strike whose assigned target has left play mid-combat (e.g.
  // eliminated by an earlier strike's body check) cannot be resolved —
  // mark it resolved with no result and advance.
  if (combat.phase === 'resolve-strike') {
    const skipStrike = combat.strikeAssignments[combat.currentStrikeIndex];
    if (skipStrike && !skipStrike.resolved) {
      const skipDefPlayer = playerById(state, combat.defendingPlayerId);
      const skipCompany = skipDefPlayer ? companyById(skipDefPlayer.companies, combat.companyId) : null;
      const targetGone = skipDefPlayer
        && !skipDefPlayer.characters[skipStrike.characterId]
        && !(skipCompany && findAllyInCompany(skipDefPlayer, skipCompany.characters, skipStrike.characterId));
      if (targetGone) {
        logDetail(`Combat pass: strike target ${skipStrike.characterId as string} left play — skipping the strike`);
        const updatedCombat: CombatState = {
          ...combat,
          strikeAssignments: combat.strikeAssignments.map((a, i) =>
            i === combat.currentStrikeIndex ? { ...a, resolved: true } : a),
        };
        return advanceStrikeOrFinalize(state, updatedCombat);
      }
    }
  }

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

  // Pass closing the pre-assignment window of an "each character in the company
  // faces one strike" attack (Wandering Eldar le-97, Watcher in the Water le-99,
  // …). Every character faces exactly one strike, so neither player has an
  // assignment to make: the engine assigns them all here and jumps straight to
  // strike ordering/resolution, skipping both the defender and the attacker
  // assignment steps. Site automatic-attacks and Carrion Feeders (ba-11)
  // pre-assign at combat creation, so their assignments are already non-empty
  // and this branch does not apply to them.
  if (combat.phase === 'assign-strikes'
    && combat.eachCharacterFacesOneStrike
    && combat.strikeAssignments.length === 0) {
    const autoAssigned = autoAssignEachCharacterStrikes(state, combat);
    if (autoAssigned) return autoAssigned;
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

  // CoE rule 3.i / 8.02 — attacker declines their pre-assignment window
  // (modify-attack / cancel / halve / protect options), allowing the
  // defender to begin strike assignment. Mirrors attackerStep1Done in
  // resolve-strike (rule 3.iv.1); without this, an attacker holding an
  // unrevealed on-guard modify-attack card (Unabated in Malice ba-26) could
  // be raced past by the defender's assign-strike action.
  if (
    combat.phase === 'assign-strikes'
    && combat.assignmentPhase === 'defender'
    && !combat.isCvCC
    && action.player === combat.attackingPlayerId
    && !combat.attackerPreAssignDone
  ) {
    logDetail('Attacker passed pre-assignment window — defender may begin strike assignment');
    return {
      state: { ...state, combat: { ...combat, attackerPreAssignDone: true } },
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
